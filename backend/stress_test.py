"""Exercise a disposable local server with rotating classroom groups.

Run: python -m backend.stress_test --groups 20 --students 4
Optional STRESS_DATABASE_URL: a LOCAL PostgreSQL admin URL (creates/drops a
unique test database). Never connects to Render or the normal game database.
"""
import argparse
import asyncio
import csv
import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
from collections import Counter, defaultdict
from pathlib import Path
from uuid import uuid4

import httpx
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url

from backend.database import (Game, GamePlayer, Player, SortAction, TrainingRun,
                              TrainingSettings, make_database)
from backend.stats_report import collect_report, export_csv

ROOT = Path(__file__).resolve().parents[1]
TOPICS = ('labels', 'pixels', 'filters', 'weights', 'learning', 'testing',
          'accuracy', 'confidence', 'new-items')


def memory_mib(pid):
    """Sample the server, excluding the load generator and PostgreSQL."""
    if sys.platform == 'win32':
        import ctypes
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [('cb', wintypes.DWORD), ('faults', wintypes.DWORD)] + [
                (name, ctypes.c_size_t) for name in ('peak', 'rss', 'peak_paged', 'paged',
                                                    'peak_nonpaged', 'nonpaged', 'pagefile',
                                                    'peak_pagefile', 'private')]
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        psapi = ctypes.WinDLL('psapi', use_last_error=True)
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
        handle = kernel.OpenProcess(0x1010, False, pid)
        if not handle:
            return None
        try:
            counters = Counters()
            counters.cb = ctypes.sizeof(counters)
            if psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
                return round(counters.rss / 2**20, 1)
        finally:
            kernel.CloseHandle(handle)
    elif sys.platform.startswith('linux'):
        for line in Path(f'/proc/{pid}/status').read_text().splitlines():
            if line.startswith('VmRSS:'):
                return round(int(line.split()[1]) / 1024, 1)
    return None


class ClassroomTest:
    def __init__(self, args, folder, database_url):
        self.args, self.folder, self.database_url = args, folder, database_url
        self.engine, self.Session = make_database(database_url)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            self.port = sock.getsockname()[1]
        self.process = None
        self.server_pid = None
        self.pid_file = folder / 'server.pid'
        self.log = (folder / 'server.log').open('w', encoding='utf-8')
        self.statuses, self.timings = Counter(), defaultdict(list)
        self.memory, self.groups, self.games = [], [], []
        self.health_errors = []

    def start(self):
        self.pid_file.unlink(missing_ok=True)
        self.server_pid = None
        env = {**os.environ, 'DATABASE_URL': self.database_url, 'APP_ENV': 'production',
               'PYTHONUNBUFFERED': '1', 'OMP_NUM_THREADS': '2',
               'WAISTE_STRESS_PID_FILE': str(self.pid_file), 'WAISTE_STRESS_PORT': str(self.port)}
        # On Windows a venv python.exe can launch a second interpreter. Ask the
        # serving interpreter for its PID so memory samples and restarts are real.
        bootstrap = (
            "import os; from pathlib import Path; "
            "Path(os.environ['WAISTE_STRESS_PID_FILE']).write_text(str(os.getpid())); "
            "import uvicorn; uvicorn.run('backend.main:app', host='127.0.0.1', "
            "port=int(os.environ['WAISTE_STRESS_PORT']), workers=1, access_log=False, log_level='warning')")
        self.process = subprocess.Popen([
            sys.executable, '-B', '-c', bootstrap], cwd=ROOT, env=env,
            stdout=self.log, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)

    def stop(self):
        if not self.server_pid and self.pid_file.exists():
            self.server_pid = int(self.pid_file.read_text())
        if self.server_pid and self.process and self.server_pid != self.process.pid:
            try:
                os.kill(self.server_pid, signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                # It may have exited already; do not mask cleanup of the launcher.
                pass
        if self.process and self.process.poll() is None:
            if self.server_pid == self.process.pid or not self.server_pid:
                self.process.terminate()
            try:
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=10)

    async def ready(self, client):
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise AssertionError('Test server exited; inspect the saved server log.')
            try:
                if (await client.get('/api/health')).status_code == 200:
                    self.server_pid = int(self.pid_file.read_text())
                    return
            except httpx.TransportError:
                pass
            await asyncio.sleep(.2)
        raise AssertionError('Test server did not start within 60 seconds.')

    async def request(self, client, method, path, *, body=None, expected=(200,), label=None):
        start = time.perf_counter()
        response = await client.request(method, '/api' + path, json=body)
        self.timings[label or path.rsplit('/', 1)[-1]].append(time.perf_counter() - start)
        self.statuses[response.status_code] += 1
        assert response.status_code in expected, f'{method} {path}: {response.status_code} {response.text[:250]}'
        return response

    async def monitor(self, client):
        while True:
            sample = memory_mib(self.server_pid)
            if sample is not None:
                self.memory.append(sample)
            try:
                await self.request(client, 'GET', '/health', label='health')
            except Exception as exc:
                self.health_errors.append(str(exc))
            await asyncio.sleep(.25)

    async def predict(self, client, path, label='predict'):
        deadline = time.monotonic() + 60
        while True:
            response = await self.request(client, 'POST', path, body={}, expected=(200, 429), label=label)
            if response.status_code == 200:
                return response
            # Only a definite pre-work rejection is retried, never an ambiguous
            # timeout: predictions do not have idempotent event IDs.
            assert time.monotonic() < deadline, 'Prediction capacity did not recover.'
            await asyncio.sleep(.2)

    async def student(self, client, number):
        player = (await self.request(client, 'POST', '/players', expected=(201,),
                                    body={'first_name': 'LoadTest', 'last_name': f'Student{number}'})).json()
        game = (await self.request(client, 'POST', '/sessions', expected=(201,),
                                  body={'player_id': player['id']})).json()
        path = '/sessions/' + game['id']
        self.games.append((game['id'], player['id'], number))
        # Includes incorrect labels and two lava misses. Every class gets examples.
        for index in range(30):
            payload = {'outcome': 'missed' if index >= 28 else 'sorted',
                       'chosen_class': None if index >= 28 else index % 3,
                       'response_ms': 900 + index, 'speed': 'NORMAL'}
            await self.request(client, 'POST', f'{path}/items/{index}', body=payload, label='sort')
            if index % 5 == 0:
                await self.request(client, 'POST', f'{path}/items/{index}', body=payload, label='sort_retry')
        for topic in TOPICS:
            payload = {'event_id': str(uuid4()), 'topic': topic}
            for _ in range(2):
                await self.request(client, 'POST', path + '/help', body=payload, expected=(201,), label='help')
        rate = {'event_id': str(uuid4()), 'exponent': -3}
        for _ in range(2):
            await self.request(client, 'POST', path + '/learning-rate', body=rate, expected=(201,), label='rate')
        plan = {'event_id': str(uuid4()), 'kind': 'training_plan', 'goal': 'more_practice'}
        for _ in range(2):
            await self.request(client, 'POST', path + '/activity', body=plan, expected=(201,), label='activity')
        deadline = time.monotonic() + 300
        while True:
            response = await self.request(client, 'POST', path + '/train', expected=(202, 429), label='train',
                                          body={'epochs': self.args.epochs, 'learning_rate': .001,
                                                'training_mode': self.args.mode})
            if response.status_code == 202:
                break
            assert time.monotonic() < deadline, 'A student could not start training within five minutes.'
            await asyncio.sleep(.3 + number % 4 * .05)
        while True:
            training = (await self.request(client, 'GET', path + '/training', label='poll')).json()
            if training['status'] == 'done':
                break
            assert training['status'] == 'running', training.get('error')
            assert time.monotonic() < deadline, 'Training did not finish within five minutes.'
            await asyncio.sleep(.2)
        assert len(training['history']) == self.args.epochs
        for activity in ({'kind': 'epoch_review', 'epoch': self.args.epochs},
                         {'kind': 'weight_experiment', 'response': .7, 'weight': 2.0}):
            payload = {'event_id': str(uuid4()), 'training_run_id': training['run_id'], **activity}
            for _ in range(2):
                await self.request(client, 'POST', path + '/activity', body=payload, expected=(201,), label='activity')
        for novel in ('false', 'true'):
            await self.predict(client, path + '/try-item?novel=' + novel)

    def verify_database(self, extra_predictions):
        total = self.args.students * self.args.groups
        report = collect_report(self.Session)
        expected = {'game_sessions': total, 'game_players': total, 'sort_actions': total * 30,
                    'training_runs': total, 'training_settings': total, 'help_events': total * 9,
                    'lr_adjustments': total, 'activity_events': total * 3,
                    'try_clicks': total * 2 + extra_predictions, 'dataset_by_game': total}
        for table, count in expected.items():
            assert len(report[table][1]) == count, (table, len(report[table][1]), count)
        assert 'players' not in report, 'Default export must omit student names.'
        named_report = collect_report(self.Session, include_names=True)
        assert len(named_report['players'][1]) == total
        with self.Session() as db:
            for game_id, player_id, number in self.games:
                assert db.get(GamePlayer, game_id).player_id == player_id
                player = db.get(Player, player_id)
                assert (player.first_name, player.last_name) == ('LoadTest', f'Student{number}')
                game = db.get(Game, game_id)
                run = db.get(TrainingRun, game.training_run_id)
                assert game.training_status == run.status == 'done'
                assert run.session_id == game_id and len(run.history) == self.args.epochs
                assert game.model_weights and game.results == run.results
                assert db.get(TrainingSettings, run.id).training_mode == self.args.mode
                actions = list(db.scalars(select(SortAction).where(SortAction.session_id == game_id)))
                assert sorted(row.order for row in actions) == list(range(30))
                assert sum(row.outcome == 'missed' and row.chosen_class is None for row in actions) == 2
                assert all(row.chosen_class == row.item_index % 3 for row in actions if row.outcome == 'sorted')
                rows = lambda table: [row for row in report[table][1] if row['session_id'] == game_id]
                assert len(rows('help_events')) == 9
                assert {row['topic'] for row in rows('help_events')} == set(TOPICS)
                rates = rows('lr_adjustments')
                assert len(rates) == 1 and rates[0]['exponent'] == -3
                events = rows('activity_events')
                assert len(events) == 3
                by_kind = {row['kind']: row for row in events}
                assert by_kind['training_plan']['data'] == {'goal': 'more_practice'}
                assert by_kind['training_plan']['training_run_id'] is None
                for kind, data in (('epoch_review', {'epoch': self.args.epochs}),
                                   ('weight_experiment', {'response': .7, 'weight': 2.0})):
                    assert by_kind[kind]['training_run_id'] == run.id
                    assert by_kind[kind]['data'] == data
                predictions = rows('try_clicks')
                extra = sum(self.games[i % total][0] == game_id for i in range(extra_predictions))
                assert len(predictions) == 2 + extra
                assert sum(row['kind'] == 'never_seen' for row in predictions) == 1
                assert all(row['training_run_id'] == run.id and 0 <= row['confidence'] <= 1 for row in predictions)
        export_csv(report, self.folder / 'csv')
        for table, count in expected.items():
            with (self.folder / 'csv' / f'{table}.csv').open(encoding='utf-8', newline='') as source:
                assert len(list(csv.DictReader(source))) == count
        return expected

    async def run(self):
        self.start()
        start = time.perf_counter()
        async with httpx.AsyncClient(base_url=f'http://127.0.0.1:{self.port}', timeout=30,
                                     limits=httpx.Limits(max_connections=50)) as client:
            await self.ready(client)
            monitor = asyncio.create_task(self.monitor(client))
            try:
                for group in range(self.args.groups):
                    began = time.perf_counter()
                    await asyncio.gather(*(self.student(client, group * self.args.students + student)
                                           for student in range(self.args.students)))
                    snapshot = {'group': group + 1, 'seconds': round(time.perf_counter() - began, 2),
                                'server_rss_mib': memory_mib(self.server_pid)}
                    self.groups.append(snapshot)
                    print(json.dumps(snapshot), flush=True)
                # Headroom check: simultaneous real predictions, in addition to the four-player rotations.
                burst = self.args.prediction_burst
                await asyncio.gather(*(self.predict(client,
                    '/sessions/' + self.games[i % len(self.games)][0] + '/try-item', label='predict_burst')
                    for i in range(burst)))
            finally:
                monitor.cancel()
                await asyncio.gather(monitor, return_exceptions=True)
            assert not self.health_errors, self.health_errors
            counts = self.verify_database(burst)
            # A real process restart must preserve every committed row and the student links.
            previous_pid = self.server_pid
            self.stop()
            self.start()
            await self.ready(client)
            assert self.server_pid != previous_pid, 'Restart must use a new serving process.'
            for game_id, player_id, _ in self.games:
                restored = (await self.request(client, 'GET', '/sessions/' + game_id, label='restore')).json()
                assert restored['player_id'] == player_id
                assert restored['summary']['resolved'] == 30 and restored['summary']['missed'] == 2
                assert restored['training']['status'] == 'done'
                assert 'first_name' not in restored and 'last_name' not in restored
            assert self.verify_database(burst) == counts
        timings = {}
        for label, values in self.timings.items():
            values.sort()
            timings[label] = {'requests': len(values), 'p95_ms': round(values[int((len(values) - 1) * .95)] * 1000, 1),
                              'max_ms': round(values[-1] * 1000, 1)}
        return {'passed': True, 'database': self.engine.dialect.name, 'students_at_once': self.args.students,
                'groups': self.args.groups, 'students_total': len(self.games), 'epochs': self.args.epochs,
                'training_mode': self.args.mode, 'elapsed_seconds': round(time.perf_counter() - start, 1),
                'statuses': dict(self.statuses), 'timings': timings, 'row_counts': counts,
                'peak_server_rss_mib': max(self.memory, default=None), 'rotations': self.groups,
                'restart_verified': True, 'csv_verified': True,
                'limitations': 'Local host resources, not Render CPU/RAM limits; accelerated rotations, not a seven-hour soak.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--groups', type=int, default=20)
    parser.add_argument('--students', type=int, default=4)
    parser.add_argument('--epochs', type=int, choices=(3, 10, 50), default=3)
    parser.add_argument('--mode', choices=('classroom', 'full'), default='classroom')
    parser.add_argument('--prediction-burst', type=int, default=16)
    parser.add_argument('--report', type=Path, default=ROOT / '.data' / 'classroom-stress.json')
    args = parser.parse_args()
    if not (1 <= args.groups <= 100 and 1 <= args.students <= 30 and 0 <= args.prediction_burst <= 40):
        parser.error('Use 1–100 groups, 1–30 students, and 0–40 burst predictions.')
    admin, database_name, test = None, None, None
    with tempfile.TemporaryDirectory(prefix='waiste-stress-') as folder_name:
        folder = Path(folder_name)
        url = 'sqlite:///' + (folder / 'game.db').as_posix()
        try:
            if os.environ.get('STRESS_DATABASE_URL'):
                parsed = make_url(os.environ['STRESS_DATABASE_URL'])
                if parsed.get_backend_name() not in ('postgres', 'postgresql') or parsed.host not in ('127.0.0.1', 'localhost', '::1'):
                    parser.error('STRESS_DATABASE_URL must be a loopback PostgreSQL admin URL, never a hosted database.')
                if parsed.query:
                    parser.error('STRESS_DATABASE_URL cannot contain connection-option overrides.')
                # Pin the address too: libpq's PGHOSTADDR environment variable
                # otherwise can override even an explicitly local hostname.
                parsed = parsed.set(drivername='postgresql+psycopg', query={
                    'hostaddr': '127.0.0.1' if parsed.host == 'localhost' else parsed.host})
                admin = create_engine(parsed, isolation_level='AUTOCOMMIT')
                database_name = 'waiste_stress_' + uuid4().hex
                with admin.connect() as connection:
                    connection.execute(text(f'CREATE DATABASE {database_name}'))
                url = parsed.set(database=database_name).render_as_string(hide_password=False)
            test = ClassroomTest(args, folder, url)
            report = asyncio.run(test.run())
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(report, indent=2), encoding='utf-8')
            print(json.dumps({key: value for key, value in report.items() if key not in ('timings', 'rotations')}), flush=True)
            print(f'Report: {args.report}')
        finally:
            if test:
                test.stop()
                test.engine.dispose()
                test.log.close()
                args.report.parent.mkdir(parents=True, exist_ok=True)
                args.report.with_suffix('.server.log').write_text((folder / 'server.log').read_text(encoding='utf-8'), encoding='utf-8')
            if admin:
                if database_name:
                    with admin.connect() as connection:
                        connection.execute(text(f'DROP DATABASE IF EXISTS {database_name}'))
                admin.dispose()


if __name__ == '__main__':
    main()
