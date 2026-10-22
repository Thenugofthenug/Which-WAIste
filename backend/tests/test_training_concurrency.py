"""Keep delayed training workers attached to the run that actually accepted them."""
import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select, text

from backend.database import Game, SortAction, TrainingRun, TryClick
from backend.main import create_app


class TrainingConcurrencyTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.url = 'sqlite:///' + (Path(self.folder.name) / 'training.db').as_posix()
        self.admin = None
        if os.environ.get('TEST_DATABASE_URL'):
            self.database_name = 'waiste_test_' + uuid4().hex
            self.admin = create_engine(os.environ['TEST_DATABASE_URL'], isolation_level='AUTOCOMMIT')
            with self.admin.connect() as connection:
                connection.execute(text(f'CREATE DATABASE {self.database_name}'))
            self.url = os.environ['TEST_DATABASE_URL'].rsplit('/', 1)[0] + '/' + self.database_name
        self.app = create_app(self.url)
        self.client = TestClient(self.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        if self.admin:
            with self.admin.connect() as connection:
                connection.execute(text(f'DROP DATABASE {self.database_name}'))
            self.admin.dispose()
        self.folder.cleanup()

    def complete_game(self):
        game_id = str(uuid4())
        with self.app.state.Session.begin() as db:
            db.add(Game(id=game_id, seed=42, model_weights=b'previous model'))
            db.flush()
            for index in range(30):
                db.add(SortAction(session_id=game_id, item_index=index, item_name=f'Item {index}',
                                  expected_class=index % 3, chosen_class=index % 3,
                                  outcome='sorted', correct=True, order=index,
                                  response_ms=1000, speed='NORMAL'))
        return '/api/sessions/' + game_id

    def accept_without_running(self, client, path):
        with patch('backend.main.BackgroundTasks.add_task') as schedule:
            response = client.post(path + '/train', json={})
        self.assertEqual(response.status_code, 202, response.text)
        schedule.assert_called_once()
        return schedule.call_args.args

    def trained_game(self):
        path = self.complete_game()
        run_id = str(uuid4())
        with self.app.state.Session.begin() as db:
            game = db.get(Game, path.rsplit('/', 1)[-1])
            game.training_status, game.training_run_id = 'done', run_id
            db.add(TrainingRun(id=run_id, session_id=game.id, status='done', epochs=3, learning_rate='.001'))
        return path, run_id

    @staticmethod
    def prediction():
        return dict(name='Test can', image='image', probabilities=[.8, .1, .1],
                    destination='Recycling', has_valid_bin=True)

    @staticmethod
    def epoch(number):
        return dict(epoch=number, train_loss=.4, train_acc=.7, val_loss=.6, val_acc=.5,
                    lr=.001, probe_idx=0, viz={'layers': [], 'edges': []}, probs=[.7, .2, .1])

    def test_old_callbacks_results_and_errors_cannot_revive_or_replace_a_run(self):
        for newer_run in (False, True):
            for late_event in ('epoch', 'done', 'error'):
                with self.subTest(newer_run=newer_run, late_event=late_event):
                    path = self.complete_game()
                    scheduled = self.accept_without_running(self.client, path)
                    worker, game_id, accepted_run_id, *_ = scheduled
                    self.assertEqual(accepted_run_id, self.client.get(path + '/training').json()['run_id'])
                    latest = {}
                    reached_after_late_epoch = []

                    def delayed_train(_seed, _actions, _epochs, _rate, emit, **_kwargs):
                        emit('epoch', self.epoch(1))
                        # A second application's startup interrupts this still-alive worker.
                        # This models a deployment overlap or a delayed request around restart.
                        with TestClient(create_app(self.url)) as restarted:
                            interrupted = restarted.get(path + '/training').json()
                            self.assertEqual(interrupted['status'], 'interrupted')
                            self.assertEqual(len(interrupted['history']), 1)
                            if newer_run:
                                self.accept_without_running(restarted, path)
                            latest.update(restarted.get(path + '/training').json())
                        if late_event == 'epoch':
                            emit('epoch', self.epoch(2))
                            reached_after_late_epoch.append(True)
                        if late_event == 'error':
                            raise ValueError('A delayed old worker failed')
                        return {'predictions': [], 'old_worker': True}, b'stale model'

                    with patch('backend.cnn.run_training', side_effect=delayed_train):
                        if late_event == 'error':
                            with self.assertLogs(level='ERROR'):
                                worker(*scheduled[1:])
                        else:
                            worker(*scheduled[1:])
                    self.assertEqual(self.client.get(path + '/training').json(), latest)
                    if late_event == 'epoch':
                        self.assertEqual(reached_after_late_epoch, [], 'A superseded worker must stop promptly')
                    with self.app.state.Session() as db:
                        old = db.get(TrainingRun, accepted_run_id)
                        self.assertEqual(old.status, 'interrupted')
                        self.assertEqual([entry['epoch'] for entry in old.history], [1])
                        self.assertIsNone(old.results)
                        game = db.get(Game, game_id)
                        self.assertEqual(game.model_weights, b'previous model')
                        if newer_run:
                            self.assertNotEqual(game.training_run_id, accepted_run_id)
                            new = db.get(TrainingRun, game.training_run_id)
                            self.assertEqual((new.status, new.history, new.results), ('running', [], None))

                    # Even a cancelled/late worker releases its own app's CPU slot.
                    next_path = self.complete_game()
                    next_task = self.accept_without_running(self.client, next_path)
                    with patch('backend.cnn.run_training', return_value=({'predictions': []}, b'next model')):
                        next_task[0](*next_task[1:])
                    self.assertEqual(self.client.get(next_path + '/training').json()['status'], 'done')

    def test_four_students_retry_while_one_trains_without_losing_their_rounds(self):
        paths = [self.complete_game() for _ in range(4)]
        accepted = self.accept_without_running(self.client, paths[0])
        self.assertEqual(self.client.post(paths[0] + '/train', json={}).status_code, 409)
        for path in paths[1:]:
            response = self.client.post(path + '/train', json={})
            self.assertEqual(response.status_code, 429, response.text)
            state = self.client.get(path).json()
            self.assertEqual(len(state['actions']), 30)
            self.assertEqual(state['training']['status'], 'ready')
        with self.app.state.Session() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(TrainingRun)), 1)
        with patch('backend.cnn.run_training', return_value=({'predictions': []}, b'trained model')):
            accepted[0](*accepted[1:])
            for path in paths[1:]:
                task = self.accept_without_running(self.client, path)
                task[0](*task[1:])
        for path in paths:
            state = self.client.get(path).json()
            self.assertEqual(state['training']['status'], 'done')
            self.assertEqual(len(state['actions']), 30)

    def test_a_replaced_queued_worker_never_starts_the_cnn(self):
        path = self.complete_game()
        task = self.accept_without_running(self.client, path)
        with TestClient(create_app(self.url)) as restarted:
            self.accept_without_running(restarted, path)
            current = restarted.get(path + '/training').json()
        with patch('backend.cnn.run_training') as train:
            task[0](*task[1:])
        train.assert_not_called()
        self.assertEqual(self.client.get(path + '/training').json(), current)

    def test_active_failure_is_saved_and_releases_slot_for_the_next_student(self):
        path = self.complete_game()
        task = self.accept_without_running(self.client, path)
        with patch('backend.cnn.run_training', side_effect=ValueError('Try this round again')):
            with self.assertLogs(level='ERROR'):
                task[0](*task[1:])
        status = self.client.get(path + '/training').json()
        self.assertEqual((status['status'], status['error']), ('error', 'Try this round again'))
        with self.app.state.Session() as db:
            run = db.get(TrainingRun, status['run_id'])
            self.assertEqual(run.status, 'error')
            self.assertIsNotNone(run.completed_at)
        next_path = self.complete_game()
        next_task = self.accept_without_running(self.client, next_path)
        with patch('backend.cnn.run_training', return_value=({'predictions': []}, b'next model')):
            next_task[0](*next_task[1:])
        self.assertEqual(self.client.get(next_path + '/training').json()['status'], 'done')

    def test_prediction_bursts_are_serial_bounded_and_recover_after_failure(self):
        for fail_first in (False, True):
            with self.subTest(fail_first=fail_first):
                path, _ = self.trained_game()
                game_id = path.rsplit('/', 1)[-1]
                if fail_first:
                    with patch('backend.cnn.try_item', side_effect=RuntimeError('Test failure')):
                        with self.assertLogs(level='ERROR'):
                            response = self.client.post(path + '/try-item', json={})
                    self.assertEqual(response.status_code, 503)

                release = threading.Event()
                started = threading.Event()
                lock = threading.Lock()
                counters = {'active': 0, 'peak': 0}
                thread_ids = set()

                def predict(*_args, **_kwargs):
                    with lock:
                        counters['active'] += 1
                        counters['peak'] = max(counters['peak'], counters['active'])
                        thread_ids.add(threading.get_ident())
                    started.set()
                    try:
                        self.assertTrue(release.wait(15), 'Prediction test was not released')
                        return self.prediction()
                    finally:
                        with lock:
                            counters['active'] -= 1

                with patch('backend.cnn.try_item', side_effect=predict):
                    with ThreadPoolExecutor(max_workers=8) as callers:
                        requests = [callers.submit(self.client.post, path + '/try-item', json={})
                                    for _ in range(8)]
                        rejected = []
                        try:
                            self.assertTrue(started.wait(10))
                            for request in as_completed(requests, timeout=15):
                                response = request.result()
                                self.assertEqual(response.status_code, 429)
                                self.assertEqual(response.headers['Retry-After'], '1')
                                rejected.append(response)
                                if len(rejected) == 4:
                                    break
                            # Admission happens before looking up a game or loading weights.
                            missing = '/api/sessions/' + str(uuid4()) + '/try-item'
                            self.assertEqual(self.client.post(missing, json={}).status_code, 429)
                            with self.app.state.Session() as db:
                                self.assertEqual(db.scalar(select(func.count()).select_from(TryClick)
                                                           .where(TryClick.session_id == game_id)), 0)
                        finally:
                            release.set()
                        responses = [request.result() for request in requests]
                self.assertEqual(sorted(response.status_code for response in responses), [200] * 4 + [429] * 4)
                self.assertEqual(counters['peak'], 1)
                self.assertEqual(len(thread_ids), 1, 'CNN predictions must reuse their stable worker thread')
                with self.app.state.Session() as db:
                    self.assertEqual(db.scalar(select(func.count()).select_from(TryClick)
                                               .where(TryClick.session_id == game_id)), 4)

    def test_prediction_releases_connection_and_keeps_the_model_run_it_started_with(self):
        path, old_run_id = self.trained_game()
        game_id = path.rsplit('/', 1)[-1]
        started, release = threading.Event(), threading.Event()

        def predict(*_args, **_kwargs):
            started.set()
            self.assertTrue(release.wait(10))
            return self.prediction()

        with patch('backend.cnn.try_item', side_effect=predict):
            with ThreadPoolExecutor(max_workers=1) as caller:
                request = caller.submit(self.client.post, path + '/try-item', json={})
                try:
                    self.assertTrue(started.wait(10))
                    self.assertEqual(self.app.state.Session.kw['bind'].pool.checkedout(), 0)
                    new_run_id = str(uuid4())
                    with self.app.state.Session.begin() as db:
                        game = db.get(Game, game_id)
                        game.training_run_id, game.training_status = new_run_id, 'running'
                        db.add(TrainingRun(id=new_run_id, session_id=game_id, epochs=3, learning_rate='.001'))
                finally:
                    release.set()
                self.assertEqual(request.result().status_code, 200)
        with self.app.state.Session() as db:
            click = db.scalar(select(TryClick).where(TryClick.session_id == game_id))
            self.assertEqual(click.training_run_id, old_run_id)
            self.assertEqual(db.get(Game, game_id).training_run_id, new_run_id)

    def test_predictions_can_finish_while_another_students_training_is_running(self):
        task = self.accept_without_running(self.client, self.complete_game())
        path, _ = self.trained_game()
        started, release = threading.Event(), threading.Event()
        threads = {}

        def train(*_args, **_kwargs):
            threads['training'] = threading.get_ident()
            started.set()
            self.assertTrue(release.wait(15))
            return {'predictions': []}, b'trained model'

        def predict(*_args, **_kwargs):
            threads['prediction'] = threading.get_ident()
            return self.prediction()

        with patch('backend.cnn.run_training', side_effect=train), patch('backend.cnn.try_item', side_effect=predict):
            with ThreadPoolExecutor(max_workers=1) as caller:
                training = caller.submit(task[0], *task[1:])
                try:
                    self.assertTrue(started.wait(10))
                    self.assertEqual(self.client.post(path + '/try-item', json={}).status_code, 200)
                    self.assertFalse(training.done())
                    self.assertNotEqual(threads['training'], threads['prediction'])
                finally:
                    release.set()
                training.result()


if __name__ == '__main__':
    unittest.main()
