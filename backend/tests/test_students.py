"""Student identity is separate from retry-safe learning and gameplay records."""
import csv
import os
import tempfile
import unittest
from pathlib import Path
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select, text

from backend.database import ActivityEvent, Game, GamePlayer, Player, SortAction, TrainingRun
from backend.main import create_app
from backend.stats_report import collect_report, export_csv


class StudentTrackingTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.url = 'sqlite:///' + (Path(self.folder.name) / 'students.db').as_posix()
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

    def player(self, first=' María-José ', last=" O'Neill "):
        response = self.client.post('/api/players', json={'first_name': first, 'last_name': last})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(set(response.json()), {'id'})
        UUID(response.json()['id'])
        return response.json()['id']

    def game(self, player_id=None):
        response = self.client.post('/api/sessions', json={'player_id': player_id})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def activity(self, game_id, kind, **fields):
        event = {'event_id': str(uuid4()), 'kind': kind, **fields}
        return event, self.client.post(f'/api/sessions/{game_id}/activity', json=event)

    def test_unicode_names_trim_and_do_not_deduplicate_students_by_name(self):
        first = self.player()
        second = self.player()
        self.assertNotEqual(first, second)
        with self.app.state.Session() as db:
            player = db.get(Player, first)
            self.assertEqual((player.first_name, player.last_name), ('María-José', "O'Neill"))
        for payload in (
                {'first_name': ' ', 'last_name': 'Name'},
                {'first_name': 'Name', 'last_name': ''},
                {'first_name': 'A' * 81, 'last_name': 'Name'},
                {'first_name': 'A', 'last_name': 'B' * 81},
                {'first_name': 'A\nB', 'last_name': 'Name'},
                {'first_name': 123, 'last_name': 'Name'},
                {'first_name': 'Name'},
                {'first_name': 'Name', 'last_name': 'Name', 'email': 'unused@example.test'}):
            with self.subTest(payload=payload):
                self.assertEqual(self.client.post('/api/players', json=payload).status_code, 422)
        self.assertEqual(self.client.get('/api/players').status_code, 405)
        self.assertEqual(self.client.get('/api/players/' + first).status_code, 404)

    def test_one_student_links_multiple_rounds_and_old_rounds_remain_valid_after_restart(self):
        player_id = self.player()
        games = [self.game(player_id), self.game(player_id)]
        self.assertTrue(all(game['player_id'] == player_id for game in games))
        legacy = self.client.post('/api/sessions').json()
        self.assertIsNone(legacy['player_id'])
        game_id = games[0]['id']
        self.assertEqual(self.client.post(f'/api/sessions/{game_id}/items/0', json={
            'outcome': 'missed', 'response_ms': 800, 'speed': 'FAST'}).status_code, 200)
        with TestClient(create_app(self.url)) as restarted:
            restored = restarted.get('/api/sessions/' + game_id).json()
            self.assertEqual(restored['player_id'], player_id)
            self.assertEqual(restored['summary']['missed'], 1)
            self.assertNotIn('first_name', str(restored))
            self.assertNotIn('last_name', str(restored))
            self.assertNotIn('María', str(restored))
            self.assertIsNone(restarted.get('/api/sessions/' + legacy['id']).json()['player_id'])
        with self.app.state.Session() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(GamePlayer)), 2)
            self.assertEqual(db.scalar(select(func.count()).select_from(Player)), 1)
            self.assertEqual(db.scalar(select(func.count()).select_from(SortAction)), 1)
        self.assertEqual(self.client.post('/api/sessions', json={'player_id': str(uuid4())}).status_code, 404)
        self.assertEqual(self.client.post('/api/sessions', json={'player_id': 'not-an-id'}).status_code, 422)

    def test_existing_game_tables_need_no_alter_or_identity_backfill(self):
        # Simulate upgrading a pre-name database: remove only the new, empty tables.
        with self.app.state.Session.begin() as db:
            legacy_id = str(uuid4())
            db.add(Game(id=legacy_id, seed=5))
        engine = self.app.state.Session.kw['bind']
        for table in (ActivityEvent.__table__, GamePlayer.__table__, Player.__table__):
            table.drop(engine)
        with TestClient(create_app(self.url)) as upgraded:
            response = upgraded.get('/api/sessions/' + legacy_id)
            self.assertEqual(response.status_code, 200)
            self.assertIsNone(response.json()['player_id'])
            student = upgraded.post('/api/players', json={'first_name': 'New', 'last_name': 'Student'}).json()
            self.assertEqual(upgraded.post('/api/sessions', json={'player_id': student['id']}).status_code, 201)

    def test_learning_events_are_bounded_idempotent_and_linked_to_the_right_run(self):
        game_id = self.game(self.player())['id']
        other_game_id = self.game()['id']
        run_id, other_run_id = str(uuid4()), str(uuid4())
        with self.app.state.Session.begin() as db:
            for item_id, session_id in ((run_id, game_id), (other_run_id, other_game_id)):
                db.add(TrainingRun(id=item_id, session_id=session_id, status='done', epochs=3,
                                   learning_rate='.001', history=[{'epoch': 1}, {'epoch': 2}]))
        for kind, fields in (
                ('training_plan', {'goal': 'more_practice'}),
                ('epoch_review', {'epoch': 2, 'training_run_id': run_id}),
                ('weight_experiment', {'response': .6, 'weight': -2.5, 'training_run_id': run_id})):
            with self.subTest(kind=kind):
                event, response = self.activity(game_id, kind, **fields)
                self.assertEqual(response.status_code, 201, response.text)
                path = f'/api/sessions/{game_id}/activity'
                self.assertEqual(self.client.post(path, json=event).status_code, 201)
                self.assertEqual(self.client.post(f'/api/sessions/{other_game_id}/activity', json={
                    **event, 'training_run_id': None}).status_code, 409)
                changed = {**event, **({'goal': 'step_size'} if kind == 'training_plan'
                                      else {'epoch': 1} if kind == 'epoch_review' else {'weight': 0})}
                self.assertEqual(self.client.post(path, json=changed).status_code, 409)
        invalid = (
            ('training_plan', {}), ('training_plan', {'goal': 'other'}),
            ('training_plan', {'goal': 'step_size', 'epoch': 1}),
            ('training_plan', {'goal': 'step_size', 'weight': None}),
            ('epoch_review', {'epoch': 0}), ('epoch_review', {'epoch': 51}),
            ('epoch_review', {'epoch': 1.5}), ('epoch_review', {'epoch': True}),
            ('epoch_review', {'epoch': 3, 'training_run_id': run_id}),
            ('epoch_review', {'epoch': 1, 'training_run_id': other_run_id}),
            ('epoch_review', {'epoch': 1, 'training_run_id': str(uuid4())}),
            ('weight_experiment', {'weight': 0}),
            ('weight_experiment', {'response': 1.01, 'weight': 0}),
            ('weight_experiment', {'response': .5, 'weight': -3.01}),
            ('weight_experiment', {'response': .5, 'weight': 3.01}),
            ('weight_experiment', {'response': True, 'weight': 0}),
            ('weight_experiment', {'response': .5, 'weight': 'NaN'}),
            ('weight_experiment', {'response': 'Infinity', 'weight': 0}),
            ('weight_experiment', {'response': .5, 'weight': 0, 'notes': 'not collected'}),
        )
        for kind, fields in invalid:
            with self.subTest(kind=kind, fields=fields):
                self.assertEqual(self.activity(game_id, kind, **fields)[1].status_code, 422)
        with TestClient(create_app(self.url)):
            with self.app.state.Session() as db:
                events = list(db.scalars(select(ActivityEvent).order_by(ActivityEvent.created_at)))
                self.assertEqual(len(events), 3)
                self.assertEqual(events[0].data, {'goal': 'more_practice'})
                self.assertEqual(events[1].data, {'epoch': 2})
                self.assertEqual(events[2].training_run_id, run_id)

    def test_default_export_has_joinable_ids_and_requires_opt_in_for_names(self):
        player_id = self.player()
        game_id = self.game(player_id)['id']
        self.activity(game_id, 'training_plan', goal='step_size')
        report = collect_report(self.app.state.Session)
        self.assertNotIn('players', report)
        self.assertNotIn('María-José', str(report))
        self.assertEqual(report['game_players'][1], [{'session_id': game_id, 'player_id': player_id}])
        self.assertEqual(report['activity_events'][1][0]['data'], {'goal': 'step_size'})
        output = Path(self.folder.name) / 'anonymous-export'
        export_csv(report, output)
        self.assertFalse((output / 'players.csv').exists())
        named = collect_report(self.app.state.Session, include_names=True)
        output = Path(self.folder.name) / 'named-export'
        export_csv(named, output)
        with (output / 'players.csv').open(encoding='utf-8', newline='') as source:
            rows = list(csv.DictReader(source))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['id'], player_id)
        self.assertEqual(rows[0]['first_name'], 'María-José')
        self.assertNotIn('first_name', named['game_sessions'][0])
        self.assertNotIn('last_name', named['activity_events'][0])


if __name__ == '__main__':
    unittest.main()
