"""Run the built classroom game with an explicitly local database.

PostgreSQL is the default and never silently falls back to SQLite. This launcher
does not install PostgreSQL, create roles/databases, change firewall rules or
contact Render. See docs/LOCAL_CLASSROOM.md for preparation and data exports.
"""
import argparse
import importlib.util
import ipaddress
import json
import os
import socket
import sys
from pathlib import Path

from sqlalchemy import URL, create_engine, inspect, text

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / '.data' / 'local-server.json'
DEFAULT_SQLITE = ROOT / '.data' / 'local-classroom.db'


class SetupError(Exception):
    """A local prerequisite needs attention before the game can start."""


def local_database_url(database, config_path, sqlite_path):
    if database == 'sqlite':
        path = Path(sqlite_path).expanduser().resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        return URL.create('sqlite', database=str(path)), str(path)
    try:
        settings = json.loads(Path(config_path).read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        raise SetupError('Create .data/local-server.json from scripts/local-server.example.json, '
                         'then fill it after creating the LOCAL PostgreSQL role/database.') from None
    if not isinstance(settings, dict):
        raise SetupError('Local database settings must be a JSON object.')
    host = settings.get('host', '127.0.0.1')
    if host not in ('127.0.0.1', 'localhost', '::1'):
        raise SetupError('This launcher accepts only a loopback database host; Render/remote URLs are not allowed.')
    port = settings.get('port', 5432)
    if type(port) is not int or not 1 <= port <= 65535:
        raise SetupError('PostgreSQL port must be an integer from 1 to 65535.')
    for field in ('database', 'user', 'password'):
        if not isinstance(settings.get(field), str) or not settings[field].strip():
            raise SetupError(f'Fill the local PostgreSQL {field} in .data/local-server.json. '
                             'Until PostgreSQL is ready, explicitly choose SQLite for a practice test.')
    # Explicit hostaddr also prevents libpq environment variables redirecting
    # this connection to an inherited PGHOSTADDR or service configuration.
    url = URL.create('postgresql+psycopg', host=host, port=port,
                     database=settings['database'], username=settings['user'],
                     password=settings['password'], query={
                         'connect_timeout': '4',
                         'hostaddr': '127.0.0.1' if host == 'localhost' else host,
                     })
    return url, f"PostgreSQL {host}:{port}/{settings['database']}"


def check_database(url):
    engine = None
    try:
        engine = create_engine(url, pool_pre_ping=True)
        with engine.connect() as connection:
            connection.execute(text('SELECT 1'))
    except Exception:
        # Never dump a URL/password from connection exceptions into the console.
        raise SetupError('The selected LOCAL database is not ready. Check that PostgreSQL is running, '
                         'the local role/database exist, and the private JSON settings are correct. '
                         'No fallback to Render or SQLite was attempted.') from None
    finally:
        if engine is not None:
            engine.dispose()


def check_server(port):
    if not (ROOT / 'frontend' / 'dist' / 'index.html').is_file():
        raise SetupError('The frontend build is missing. Run npm.cmd run build from the repository root.')
    missing = [name for name in ('uvicorn', 'fastapi', 'torch', 'numpy', 'PIL')
               if importlib.util.find_spec(name) is None]
    if missing:
        raise SetupError('Install requirements.txt in .venv; missing runtime packages: ' + ', '.join(missing))
    with socket.socket() as listener:
        try:
            listener.bind(('0.0.0.0', port))
        except OSError:
            raise SetupError(f'Port {port} is unavailable. Stop the previous local game or choose another port.') from None


def lan_addresses():
    try:
        addresses = {entry[4][0] for entry in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)}
    except OSError:
        return []
    return sorted(address for address in addresses
                  if ipaddress.ip_address(address).is_private
                  and not ipaddress.ip_address(address).is_loopback
                  and not ipaddress.ip_address(address).is_link_local)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', choices=('postgresql', 'sqlite'), default='postgresql')
    parser.add_argument('--config', type=Path, default=DEFAULT_CONFIG)
    parser.add_argument('--sqlite-path', type=Path, default=DEFAULT_SQLITE)
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--check-only', action='store_true', help='Check readiness without starting a server.')
    parser.add_argument('--export', type=Path, metavar='FOLDER', help='Export this local database instead of serving.')
    parser.add_argument('--include-names', action='store_true', help='Include the separate players CSV in an export.')
    args = parser.parse_args(argv)
    if not 1024 <= args.port <= 65535:
        parser.error('Choose an unprivileged HTTP port from 1024 to 65535.')
    if args.include_names and args.export is None:
        parser.error('--include-names is only used with --export.')
    try:
        url, label = local_database_url(args.database, args.config, args.sqlite_path)
        if args.export and args.database == 'sqlite' and not Path(url.database).is_file():
            raise SetupError('The local SQLite database does not exist yet. Start a practice game first.')
        if not args.export:
            check_server(args.port)
        check_database(url)
        # Set the child process environment before importing the web app. A
        # parent terminal's Render DATABASE_URL must never select this database.
        os.environ['DATABASE_URL'] = url.render_as_string(hide_password=False)
        os.environ['APP_ENV'] = 'local-classroom'
        print(f'Selected LOCAL storage: {label}', flush=True)
        if args.export:
            from backend.database import make_database
            from backend.stats_report import collect_report, export_csv
            engine, Session = make_database()
            try:
                if not inspect(engine).has_table('game_sessions'):
                    raise SetupError('This local database has no browser game tables yet. Start the actual game before exporting.')
                report = collect_report(Session, include_names=args.include_names)
                export_csv(report, args.export)
                for table, (_, rows) in report.items():
                    print(f'{table}: {len(rows)} rows')
                print(f'Local export saved to {args.export.resolve()}')
            finally:
                engine.dispose()
            return 0
        print('Readiness checks passed.', flush=True)
        if args.check_only:
            print('No web server started. Database tables are created when the actual game starts.')
            return 0
        print(f'Host laptop: http://127.0.0.1:{args.port}', flush=True)
        for address in lan_addresses():
            print(f'Possible student URL: http://{address}:{args.port}', flush=True)
        print('Use the host Wi-Fi IPv4 address (ipconfig) if no suitable URL appears above.', flush=True)
        print('The other laptops need the same approved network and inbound HTTP access to this laptop.', flush=True)
        print('Keep this terminal open; Ctrl+C stops the game. Database credentials stay on the host.', flush=True)
        import uvicorn
        uvicorn.run('backend.main:app', host='0.0.0.0', port=args.port, workers=1, access_log=False)
        return 0
    except SetupError as error:
        print(f'LOCAL SETUP: {error}', file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 0


if __name__ == '__main__':
    raise SystemExit(main())
