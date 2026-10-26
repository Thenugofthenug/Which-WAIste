"""Local launcher isolation and preflight; no real PostgreSQL installation needed."""
import contextlib
import csv
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from backend import local_server
from backend.database import Base, Game, GamePlayer, Player, make_database


class LocalServerTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.config = self.root / 'local-server.json'

    def tearDown(self):
        self.folder.cleanup()

    def settings(self, **changes):
        data = dict(host='127.0.0.1', port=5432, database='waiste_local',
                    user='waiste_local_app', password='test-only @:/ secret')
        data.update(changes)
        self.config.write_text(json.dumps(data), encoding='utf-8')
        return data

    def test_postgres_url_keeps_special_password_private_and_pins_loopback_address(self):
        data = self.settings(host='localhost')
        url, label = local_server.local_database_url('postgresql', self.config, self.root / 'unused.db')
        self.assertEqual(url.password, data['password'])
        self.assertEqual(url.query['hostaddr'], '127.0.0.1')
        self.assertEqual(url.database, 'waiste_local')
        self.assertNotIn(data['password'], label)
        self.assertNotIn(data['password'], str(url))

    def test_remote_hosts_invalid_ports_and_incomplete_config_are_rejected(self):
        for changes in ({'host': 'example.onrender.com'}, {'host': '192.168.1.5'},
                        {'port': '5432'}, {'port': 0}, {'password': ''}, {'database': ''}):
            with self.subTest(changes=changes):
                self.settings(**changes)
                with self.assertRaises(local_server.SetupError):
                    local_server.local_database_url('postgresql', self.config, self.root / 'unused.db')
        self.config.write_text('{not json', encoding='utf-8')
        with self.assertRaises(local_server.SetupError):
            local_server.local_database_url('postgresql', self.config, self.root / 'unused.db')

    def test_default_postgres_does_not_fall_back_or_contact_inherited_render_url(self):
        self.settings(password='')
        with patch.dict(os.environ, {'DATABASE_URL': 'postgresql://remote.invalid/study'}), \
                patch.object(local_server, 'check_database') as connect, \
                contextlib.redirect_stderr(io.StringIO()) as output:
            result = local_server.main(['--config', str(self.config), '--check-only'])
            self.assertEqual(os.environ['DATABASE_URL'], 'postgresql://remote.invalid/study')
        self.assertEqual(result, 2)
        connect.assert_not_called()
        self.assertIn('Fill the local PostgreSQL password', output.getvalue())

    def test_explicit_sqlite_preflight_ignores_parent_production_database(self):
        path = self.root / 'practice.db'
        with patch.dict(os.environ, {'DATABASE_URL': 'postgresql://remote.invalid/study', 'APP_ENV': 'production'}), \
                patch.object(local_server, 'check_server'), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            result = local_server.main(['--database', 'sqlite', '--sqlite-path', str(path), '--check-only'])
            self.assertTrue(os.environ['DATABASE_URL'].startswith('sqlite:'))
            self.assertEqual(os.environ['APP_ENV'], 'local-classroom')
        self.assertEqual(result, 0)
        self.assertTrue(path.is_file())
        self.assertIn('No web server started', output.getvalue())

    def test_connect_failure_does_not_print_password_or_attempt_another_database(self):
        self.settings()
        url, _ = local_server.local_database_url('postgresql', self.config, self.root / 'unused.db')
        with patch.object(local_server, 'create_engine') as factory:
            factory.return_value.connect.side_effect = RuntimeError('test-only @:/ secret')
            with self.assertRaises(local_server.SetupError) as failure:
                local_server.check_database(url)
        self.assertNotIn('test-only', str(failure.exception))
        self.assertIn('No fallback', str(failure.exception))
        factory.assert_called_once()
        factory.return_value.dispose.assert_called_once()

    def test_export_requires_existing_sqlite_data_and_does_not_start_server(self):
        with contextlib.redirect_stderr(io.StringIO()) as output:
            result = local_server.main(['--database', 'sqlite', '--sqlite-path', str(self.root / 'absent.db'),
                                        '--export', str(self.root / 'csv')])
        self.assertEqual(result, 2)
        self.assertFalse((self.root / 'absent.db').exists())
        self.assertIn('does not exist yet', output.getvalue())

    def test_export_uses_selected_local_records_and_names_require_explicit_flag(self):
        path = self.root / 'practice.db'
        engine, Session = make_database('sqlite:///' + path.as_posix())
        Base.metadata.create_all(engine)
        player_id, game_id = str(uuid4()), str(uuid4())
        with Session.begin() as db:
            db.add(Player(id=player_id, first_name='Export', last_name='Test'))
            db.add(Game(id=game_id, seed=1))
            db.flush()
            db.add(GamePlayer(session_id=game_id, player_id=player_id))
        engine.dispose()
        for named in (False, True):
            folder = self.root / ('named' if named else 'anonymous')
            args = ['--database', 'sqlite', '--sqlite-path', str(path), '--export', str(folder)]
            if named:
                args.append('--include-names')
            with patch.dict(os.environ, {'DATABASE_URL': 'postgresql://remote.invalid/study'}), \
                    patch.object(local_server, 'check_server') as server_check, \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(local_server.main(args), 0)
            server_check.assert_not_called()
            with (folder / 'game_players.csv').open(encoding='utf-8', newline='') as source:
                rows = list(csv.DictReader(source))
            self.assertEqual([(row['session_id'], row['player_id']) for row in rows], [(game_id, player_id)])
            self.assertEqual((folder / 'players.csv').exists(), named)
            if named:
                with (folder / 'players.csv').open(encoding='utf-8', newline='') as source:
                    self.assertEqual(next(csv.DictReader(source))['first_name'], 'Export')


if __name__ == '__main__':
    unittest.main()
