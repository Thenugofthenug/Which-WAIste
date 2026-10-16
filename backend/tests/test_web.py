"""API/data integrity tests, including real CNN training and restart recovery."""
import tempfile
import os
import unittest
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select, text

from backend import cnn
from backend.database import Game, HelpOpen, SortAction, TrainingRun
from backend.main import create_app


class WebTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.url = 'sqlite:///' + (Path(self.folder.name) / 'test.db').as_posix()
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
        self.game = self.client.post('/api/sessions', json={}).json()
        self.path = '/api/sessions/' + self.game['id']

    def tearDown(self):
        self.client.__exit__(None, None, None)
        if self.admin:
            with self.admin.connect() as connection:
                connection.execute(text(f'DROP DATABASE {self.database_name}'))
            self.admin.dispose()
        self.folder.cleanup()

    def send(self, index, chosen=None, outcome='sorted'):
        return self.client.post(f'{self.path}/items/{index}', json={
            'outcome': outcome, 'chosen_class': chosen, 'response_ms': 1200, 'speed': 'FAST'})

    def expected(self):
        with self.app.state.Session() as db:
            game = db.get(Game, self.game['id'])
            return [item.expected for item in cnn.game_items(game.seed)]

    def test_health_and_validation(self):
        self.assertEqual(self.client.get('/api/health').status_code, 200)
        self.assertEqual(len(self.game['items']), 30)
        self.assertNotIn('expected_class', self.game['items'][0])
        self.assertEqual(self.send(0).status_code, 422)
        self.assertEqual(self.send(0, 3).status_code, 422)
        self.assertEqual(self.send(30, 0).status_code, 404)
        self.assertEqual(self.send(0, 0, 'missed').status_code, 422)
        self.assertEqual(self.client.post(self.path + '/train', json={}).status_code, 409)

    def test_score_is_server_calculated_and_retries_do_not_duplicate(self):
        expected = self.expected()
        result = self.send(0, expected[0]).json()
        self.assertEqual(result['summary']['score'], 10)
        self.assertEqual(self.send(0, expected[0]).json()['summary']['score'], 10)
        self.assertEqual(self.send(0, (expected[0] + 1) % 3).status_code, 409)
        self.send(1, (expected[1] + 1) % 3)
        missed = self.send(2, outcome='missed').json()
        self.assertEqual((missed['summary']['score'], missed['summary']['streak'], missed['summary']['missed']), (10, 0, 1))
        with self.app.state.Session() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(SortAction)), 3)
            self.assertIsNone(db.get(SortAction, (self.game['id'], 2)).chosen_class)

    def test_saved_actions_restore_in_the_order_items_were_resolved(self):
        self.send(3, 0)
        self.send(1, outcome='missed')
        self.send(0, 2)
        restored = self.client.get(self.path).json()
        self.assertEqual([action['index'] for action in restored['actions']], [3, 1, 0])

    def test_help_topic_tracking_is_idempotent_and_survives_restart(self):
        event = {'event_id': str(uuid4()), 'topic': 'filters'}
        self.assertEqual(self.client.post(self.path + '/help', json=event).status_code, 201)
        self.client.post(self.path + '/help', json=event)
        self.assertEqual(self.client.post(self.path + '/help', json={**event, 'topic': 'pixels'}).status_code, 409)
        self.send(0, outcome='missed')
        with TestClient(create_app(self.url)) as restarted:
            self.assertEqual(restarted.get(self.path).json()['summary']['missed'], 1)
        with self.app.state.Session() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(HelpOpen)), 1)

    def test_all_missed_round_does_not_train_with_fake_labels(self):
        for i in range(30):
            self.assertEqual(self.send(i, outcome='missed').status_code, 200)
        result = self.client.get(self.path).json()
        self.assertEqual(result['summary']['score'], 0)
        self.assertEqual(self.client.post(self.path + '/train', json={}).status_code, 422)

    def test_partial_dataset_real_training_and_saved_model_work_after_restart(self):
        expected = self.expected()
        for i in range(30):
            response = self.send(i, expected[i]) if i < 18 else self.send(i, outcome='missed')
            self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.post(self.path + '/train', json={'epochs': 3}).status_code, 202)
        training = self.client.get(self.path + '/training').json()
        self.assertEqual(training['status'], 'done', training)
        self.assertEqual(len(training['history']), 3)
        results = training['results']
        self.assertEqual(sum(results['split'].values()), 18)
        self.assertTrue(0 <= results['before_accuracy'] <= 1)
        self.assertTrue(0 <= results['test_accuracy'] <= 1)
        prediction = results['predictions'][0]
        self.assertAlmostEqual(sum(prediction['before']), 1, places=5)
        self.assertEqual(len(prediction['inspection']['layers']), 4)
        with TestClient(create_app(self.url)) as restarted:
            response = restarted.post(self.path + '/try-item?novel=true', json={})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertAlmostEqual(sum(response.json()['probabilities']), 1, places=5)
        # A second run gets a separate research record instead of overwriting the first.
        self.assertEqual(self.client.post(self.path + '/train', json={'epochs': 3}).status_code, 202)
        with self.app.state.Session() as db:
            runs = list(db.scalars(select(TrainingRun)))
            self.assertEqual(len(runs), 2)
            self.assertTrue(all(run.status == 'done' and len(run.history) == 3 for run in runs))


if __name__ == '__main__':
    unittest.main()
