"""API/data integrity tests, including real CNN training and restart recovery."""
import base64
import io
import tempfile
import os
import unittest
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, func, select, text

from backend import cnn
from backend.database import Game, HelpOpen, LearningRateAdjustment, SortAction, TrainingRun, TryClick
from backend.main import create_app
from backend.stats_report import collect_report, export_csv


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
            return [item.expected for item in cnn.game_items(game.seed, pixel_art=cnn.uses_pixel_art(game.version))]

    def test_new_artwork_keeps_rgb_model_inputs_and_transparent_browser_images(self):
        with self.app.state.Session() as db:
            game = db.get(Game, self.game['id'])
            self.assertEqual(game.version, cnn.CURRENT_VERSION)
            current = cnn.game_items(game.seed)
            legacy = cnn.game_items(game.seed, pixel_art=False)
        self.assertEqual([(item.name, item.expected) for item in current],
                         [(item.name, item.expected) for item in legacy])
        self.assertTrue(all(item.image.mode == 'RGB' and item.image.size == (128, 128) for item in current))
        self.assertNotEqual(current[0].image.tobytes(), legacy[0].image.tobytes())
        image = Image.open(io.BytesIO(base64.b64decode(self.game['items'][0]['image'].split(',', 1)[1])))
        self.assertEqual((image.mode, image.size), ('RGBA', (128, 128)))
        self.assertEqual(image.getpixel((0, 0))[3], 0)

    def test_legacy_saved_game_restores_its_original_artwork(self):
        game_id, seed = str(uuid4()), 8675309
        with self.app.state.Session.begin() as db:
            # The existing default stays legacy; no data migration is required.
            db.add(Game(id=game_id, seed=seed))
        expected = cnn.public_items(seed, pixel_art=False)
        with TestClient(create_app(self.url)) as restarted:
            restored = restarted.get('/api/sessions/' + game_id)
            self.assertEqual(restored.status_code, 200)
            self.assertEqual(restored.json()['items'], expected)
        self.assertFalse(cnn.uses_pixel_art('lava-web-v2-analytics'))
        self.assertFalse(cnn.uses_pixel_art('unknown-version'))

    def test_training_and_new_predictions_use_the_saved_artwork_version(self):
        prediction = dict(name='Aluminum can', image='image', probabilities=[.8, .1, .1],
                          destination='Recycling', has_valid_bin=True)
        for pixel_art in (True, False):
            with self.subTest(pixel_art=pixel_art):
                game_id, seed = str(uuid4()), 123
                with self.app.state.Session.begin() as db:
                    db.add(Game(id=game_id, seed=seed, version=(
                        cnn.CURRENT_VERSION if pixel_art else 'lava-web-v2-analytics')))
                path = '/api/sessions/' + game_id
                items = cnn.game_items(seed, pixel_art=pixel_art)
                with patch('backend.cnn.game_items', wraps=cnn.game_items) as regenerate:
                    result = self.client.post(path + '/items/0', json={
                        'outcome': 'sorted', 'chosen_class': items[0].expected, 'response_ms': 1000, 'speed': 'NORMAL'})
                    self.assertEqual(result.status_code, 200)
                    regenerate.assert_called_once_with(seed, pixel_art=pixel_art)
                with self.app.state.Session.begin() as db:
                    for index, item in enumerate(items[1:], 1):
                        db.add(SortAction(session_id=game_id, item_index=index, item_name=item.name,
                                          expected_class=item.expected, chosen_class=item.expected,
                                          outcome='sorted', correct=True, order=index, response_ms=1000, speed='NORMAL'))
                with patch('backend.cnn.run_training', return_value=({'predictions': []}, b'saved model')) as train:
                    self.assertEqual(self.client.post(path + '/train', json={'epochs': 3}).status_code, 202)
                    self.assertEqual(self.client.get(path + '/training').json()['status'], 'done')
                    self.assertEqual(train.call_args.kwargs, {'pixel_art': pixel_art})
                    self.assertEqual(train.call_args.args[0], seed)
                with patch('backend.cnn.try_item', return_value=prediction) as try_item:
                    self.assertEqual(self.client.post(path + '/try-item?novel=true', json={}).status_code, 200)
                    try_item.assert_called_once_with(b'saved model', True, pixel_art=pixel_art)

    def test_built_frontend_pixel_font_is_served(self):
        font = Path(__file__).resolve().parents[2] / 'frontend' / 'dist' / 'fonts' / 'PressStart2P-Regular.ttf'
        if not font.is_file():
            self.skipTest('Build the frontend first to check its hosted font.')
        response = self.client.get('/fonts/PressStart2P-Regular.ttf')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, font.read_bytes())

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

    def test_learning_rate_settlements_are_validated_and_safe_to_retry(self):
        event = {'event_id': str(uuid4()), 'exponent': -2.5}
        for _ in range(2):
            self.assertEqual(self.client.post(self.path + '/learning-rate', json=event).status_code, 201)
        self.assertEqual(self.client.post(self.path + '/learning-rate', json={**event, 'exponent': -2}).status_code, 409)
        self.assertEqual(self.client.post(self.path + '/learning-rate', json={**event, 'exponent': 0}).status_code, 422)
        with TestClient(create_app(self.url)):
            with self.app.state.Session() as db:
                rates = list(db.scalars(select(LearningRateAdjustment)))
                self.assertEqual(len(rates), 1)
                self.assertAlmostEqual(rates[0].value, 10 ** -2.5)
                self.assertEqual(rates[0].session_id, self.game['id'])

    def test_new_item_analytics_preserve_ungradable_results_and_export_without_images(self):
        self.assertEqual(self.client.post(self.path + '/try-item', json={}).status_code, 409)
        with self.app.state.Session.begin() as db:
            game = db.get(Game, self.game['id'])
            game.training_status, game.model_weights = 'done', b'test weights'
        familiar = dict(name='New can', image='not exported', probabilities=[.9, .05, .05],
                        destination='Recycling', has_valid_bin=True)
        novel = dict(name='Battery', image='not exported', probabilities=[.1, .2, .7],
                     destination='Special collection', has_valid_bin=False)
        with patch('backend.cnn.try_item', side_effect=[familiar, novel]):
            for kind in ('false', 'true'):
                self.assertEqual(self.client.post(self.path + '/try-item?novel=' + kind, json={}).status_code, 200)
        with self.app.state.Session() as db:
            clicks = list(db.scalars(select(TryClick).order_by(TryClick.created_at)))
            self.assertEqual([click.kind for click in clicks], ['familiar', 'never_seen'])
            self.assertEqual([click.correct for click in clicks], [True, None])
            self.assertAlmostEqual(clicks[-1].confidence, .7)
        self.send(0, 0)
        self.send(1, outcome='missed')
        report = collect_report(self.app.state.Session)
        self.assertEqual(report['dataset_by_game'][1][0]['missed'], 1)
        self.assertEqual(report['sort_actions'][1][0]['chosen_bin'], 'Recycling')
        self.assertEqual(len(report['try_clicks'][1]), 2)
        self.assertNotIn('model_weights', report['game_sessions'][0])
        output = Path(self.folder.name) / 'export'
        export_csv(report, output)
        self.assertTrue((output / 'try_clicks.csv').exists())
        self.assertNotIn('not exported', (output / 'try_clicks.csv').read_text())

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
        with self.app.state.Session() as db:
            click = db.scalar(select(TryClick))
            self.assertEqual(click.training_run_id, db.get(Game, self.game['id']).training_run_id)
        # A second run gets a separate research record instead of overwriting the first.
        self.assertEqual(self.client.post(self.path + '/train', json={'epochs': 3}).status_code, 202)
        with self.app.state.Session() as db:
            runs = list(db.scalars(select(TrainingRun)))
            self.assertEqual(len(runs), 2)
            self.assertTrue(all(run.status == 'done' and len(run.history) == 3 for run in runs))


if __name__ == '__main__':
    unittest.main()
