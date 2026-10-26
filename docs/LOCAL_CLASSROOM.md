# One laptop hosting four local players

This setup is separate from Render. Your laptop serves the built React game,
FastAPI and the CNN. Your browser is player station 1; the other three laptops
connect using your laptop's Wi-Fi IPv4 address. They need a current browser, not
Python, Node or PostgreSQL. All four sessions use the database on the host laptop.

The launcher defaults to **local PostgreSQL** and stops if it is not configured.
An explicit **SQLite practice mode** lets you test before PostgreSQL is ready.
Neither mode uses an inherited Render `DATABASE_URL` or automatically transfers
data to/from Render. The existing `.data/waiste.db` is not the practice database.

## 1. What is ready / what remains

### Host setup completed October 25, 2026

PostgreSQL 18 is installed and its Windows service `postgresql-x64-18` is running.
The forgotten local administrator password was reset, and the separate
`waiste_local_app` role and `waiste_local` database were created. The original
password-authentication configuration was restored and verified. Render was not
contacted or changed.

The private `.data/local-server.json` now contains the application credentials.
The separate `.data/local-postgres-admin.json` contains the new local `postgres`
administrator credentials. Both files are ignored by Git. Keep these files private;
the administrator account is for maintenance, not the game's connection.

Local launcher preflight passed. Actual game startup created the tables, the home
page returned HTTP 200, and `/api/health` returned `database: postgresql`. The game
server was stopped after verification; PostgreSQL itself remains running. The
earlier pending/setup notes below describe the original preparation and fresh
installations; this host no longer needs section 4's role/database creation steps.

Start the game with `./scripts/start-local.ps1` from the project root. The database
service currently uses Manual startup. After a reboot, if preflight cannot connect,
open Windows Services and start `postgresql-x64-18` with administrator permission
before starting the game. A rehearsal from the other laptops is still required.

- Ready: local-only database selection, a production-build launcher, dependency,
  port and connection checks, student-URL hints, and local data exports.
- Ready: help/rate/learning events use cryptographically random UUIDs on LAN HTTP
  even when the browser does not provide the HTTPS-only `crypto.randomUUID()`.
  Retries still retain the original event ID. No weak random-ID fallback is used.
- Ready: the game retains its single training slot, separate prediction thread,
  saved student/session/run links and existing graphics/lessons.
- Pending: a usable local PostgreSQL installation/service, role/database/password
  setup, the real network/firewall path and a second-device/four-device rehearsal.
- PostgreSQL 18 program files were found on the reviewed host. That alone does
  not prove a configured/running service. This preparation does not install,
  initialize, start, stop or change any PostgreSQL installation.
- No Windows firewall rules, network settings, certificates or Render settings
  are changed by these scripts. No hosted deployment is performed.

Use only an approved trusted network/hotspot. This simple LAN mode uses HTTP,
so traffic including names is not encrypted across Wi-Fi. Confirm that this
matches the instructor's collection/network procedure before real student use;
trusted HTTPS would need separate certificate setup. Do not expose this server
through public router port forwarding.

## 2. Prepare the host while online

Open PowerShell in the repository root. Use the prepared `.venv` and installed
frontend packages if already present. On a fresh copy, install once:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm.cmd run setup
```

The frontend build uses already installed packages and is rebuilt by the launch
script. Downloads should be completed before school. The launcher does not
download or install dependencies and does not require Vite to run during play.

Private PostgreSQL settings belong in **`.data/local-server.json`**, which is
Git-ignored. The launcher creates an empty-password template if that file is
missing, and never overwrites an existing configuration. A blank local copy has
been prepared on the reviewed laptop. Share only the example, not credentials.

```json
{
  "host": "127.0.0.1",
  "port": 5432,
  "database": "waiste_local",
  "user": "waiste_local_app",
  "password": ""
}
```

Leave this password blank until you create your LOCAL role/database. Do not
paste a Render URL or its password here. The launcher rejects remote DB hosts,
constructs the URL safely for passwords with special characters, and pins the
database connection to loopback. PostgreSQL is not exposed to student laptops.

## 3. Test now without PostgreSQL

Start explicit practice mode:

```powershell
.\scripts\start-local.ps1 -Database SQLite
```

This builds the frontend and starts one Uvicorn worker on `0.0.0.0:8000`, saving
practice records in **`.data/local-classroom.db`**. Keep this terminal open.
Your own browser opens **http://127.0.0.1:8000**.

The other three laptops open a displayed student URL such as
`http://192.168.1.100:8000`, using the host's actual Wi-Fi IPv4 address. That is
an example, not a fixed address. If several candidates appear (VPN/Ethernet/etc),
run `ipconfig` and choose the Wi-Fi adapter for the network shared by all devices.
Never put `0.0.0.0` or `127.0.0.1` into another laptop's browser to reach the host.

Check readiness without starting a web server:

```powershell
.\scripts\start-local.ps1 -Database SQLite -CheckOnly
```

SQLite practice records remain in their own database. They do not appear later
in PostgreSQL or Render. Do not mix practice and study data without recording
which source was used. Switching database modes does not migrate sessions; use
fresh practice browser tabs/clear only the appropriate practice session once
all its events have saved, or use Different student before changing modes.

## 4. After PostgreSQL is installed/configured

Do these steps on the hosting laptop, not on student devices. If PostgreSQL
is already installed, establish its local service/admin access rather than
installing a second copy without checking.

1. Confirm the local PostgreSQL service is running and know its local port
   (normally 5432) and the administrative account created during installation.
2. In pgAdmin or a separate DataGrip **local** connection, connect to
   `127.0.0.1`, database `postgres`, using the local administrator. Do not run
   these commands on your Render data source.
3. Choose a strong local application password and run the following statements
   **separately**, outside a surrounding transaction. Replace the example password:

```sql
CREATE ROLE waiste_local_app LOGIN PASSWORD 'REPLACE_WITH_A_LOCAL_PASSWORD';
```

```sql
CREATE DATABASE waiste_local OWNER waiste_local_app;
```

4. Put that application-role password into `.data/local-server.json`. Use valid
   JSON escaping if it contains a quote or backslash. Adjust the local port if
   installation uses a different one; keep the DB host on loopback.
5. Run preflight:

```powershell
.\scripts\start-local.ps1 -CheckOnly
```

6. If preflight passes, start the actual PostgreSQL-backed game:

```powershell
.\scripts\start-local.ps1
```

The first actual startup creates the existing game tables. Preflight only checks
the connection/build/port; it does not create the database, roles or game tables.
If PostgreSQL is unavailable or the password is blank/wrong, the launcher stops
with a setup message. It never substitutes another database.

Keep credentials on the host. For analysis in DataGrip, create a separate source
named **Which wAIste - LOCAL**, host `127.0.0.1`, database `waiste_local`, port
matching the JSON, user `waiste_local_app`, and the local password. The existing
name/session/activity queries work with the same schema after the game starts.
Do not substitute Render's external SSL connection string for this local source.

## 5. Network and device rehearsal

1. Connect all four laptops to the same approved network/hotspot. School Wi-Fi
   may prevent device-to-device traffic even when Internet browsing works. A
   hotspot also needs testing for client-to-client communication.
2. Verify the game and `http://127.0.0.1:8000/api/health` on the host first.
3. Verify `http://HOST_WIFI_IP:8000/api/health` on another laptop. Expect
   `database: sqlite` in explicit practice mode or `database: postgresql` in the
   final local PostgreSQL mode. A root page alone is not proof that saves work.
4. Windows Firewall may require permission for the hosting Python process on
   the chosen network. The scripts do not grant it or change the network profile.
   Follow the appropriate device/IT procedure; do not disable the firewall.
5. Register four recognizable test players in four separate browsers, complete
   all 30 outcomes, open help, change a learning rate, train and test pictures.
   Inspect separate player/session links and tracked events in the selected DB.
6. Start training near-simultaneously. One run is admitted; other students should
   see the saved-progress/busy message and can retry. Test both item-test buttons.
7. Disconnect/reconnect one client during a save, keep its tab open, retry and
   verify no duplicate item records. Wait for saves before Different student.
8. Rehearse a host restart after saves, restore a completed session and verify
   the data and model remain available. A running training job needs a fresh
   attempt after restart, not continuation at its previous epoch.

The host must remain powered, awake and running the server terminal. Moving
between networks can change its student URL. The host is also student station
1, so the other three stations plus its own browser make four players total.
Student machines need no database ports or credentials; only the game's HTTP port.

## 6. Local exports and data preservation

Run exports in another PowerShell terminal in the repository root. These commands
select the same local-only settings as the launcher, ignoring inherited Render
environment variables. Export folders below live under ignored `.data/`.

PostgreSQL (after tables/data exist):

```powershell
.\scripts\start-local.ps1 -ExportTo .data\local-postgres-export
```

SQLite practice:

```powershell
.\scripts\start-local.ps1 -Database SQLite -ExportTo .data\local-sqlite-export
```

Default exports use IDs and omit the separate names table, images and model
weights. If the approved analysis needs the name-to-ID lookup, use a separate
private folder:

```powershell
.\scripts\start-local.ps1 -ExportTo .data\local-named-export -IncludeNames
```

Use distinct export folders by collection/date and protect named data according
to the study procedure. CSV is for analysis, not full restoration of model blobs.
Back up PostgreSQL using the appropriate local database backup tool as well.
For SQLite, finish saves and stop the server before making a raw DB-file copy.
Do not delete or replace existing files to reset between students.

## 7. Commands and troubleshooting

Stop the server with Ctrl+C, after pending saves finish. No scheduled/background
service is installed. Restart with the same mode/settings to use the same DB.

To avoid a rebuild only after the current source has already been built:

```powershell
.\scripts\start-local.ps1 -SkipBuild
```

To use another free HTTP port, change all browser URLs to match:

```powershell
.\scripts\start-local.ps1 -Database SQLite -Port 8001
```

Stop the previous game server before changing ports. Do not run two application
instances against the same local database; startup recovery and the training
limits are designed for one server process.

If PowerShell script execution is restricted, do not change a managed device's
policy. The equivalent launch commands after `npm.cmd run build` are:

```powershell
.\.venv\Scripts\python.exe -B -m backend.local_server --database sqlite
# Later, once local PostgreSQL is ready:
.\.venv\Scripts\python.exe -B -m backend.local_server
```

The Python module expects an existing private JSON configuration for PostgreSQL;
copy the example to `.data/local-server.json` if using it without the PS wrapper.
Its other options include `--check-only`, `--port`, `--export` and
`--include-names`. Run `--help` for the complete list.

| Symptom | Check |
| --- | --- |
| Blank PostgreSQL password / local DB not ready | Complete section 4, or deliberately choose SQLite for practice. |
| Host root returns only setup JSON | Build frontend in this project copy before launch. |
| Port unavailable | Stop the prior server or choose a free port; do not start a second server on the same port. |
| Works on host but not another laptop | Host Wi-Fi IP/port, shared network, device isolation and the hosting firewall path. |
| Game loads but no help/activity rows | Current build, browser compatibility, save error/pending queue, and selected DB. |
| Previous session not found after switching DB | Browser tab remembers another database's session ID; finish/preserve those saves before switching. |
| DataGrip shows old Render records | Select the separate LOCAL source and the database used by the launcher. |

Render/Docker settings remain independent. These local additions have not been
pushed or deployed. A network rehearsal with the real other laptops remains
necessary even after automated/local loopback tests pass.

## Preparation verification (October 24, 2026)

- 69 frontend tests passed, including real App activity callbacks with
  `randomUUID` unavailable; event IDs remain valid and distinct.
- Backend regression tests and seven focused local-launcher checks passed,
  including local-only selection, connection-error handling and optional named
  CSV exports. Frontend lint/build and PowerShell syntax checks passed.
- The actual launcher was exercised through HTTP with four simulated players
  using a disposable local SQLite DB, despite a deliberately invalid remote URL
  inherited from the parent process. It saved 120 sorting records, four training
  runs, 36 help events, four rate events, 12 learning activities and 24 predictions.
  Per-session links, exports and restoration after a server restart matched.
- The real SQLite PowerShell preflight passed. Default PostgreSQL preflight
  correctly stopped at the empty local password without changing DB mode.
- No local PostgreSQL role/database was created or installed, no live Render
  connection was used, and no server was left running after these checks.
- Physical peer-laptop connectivity, Windows Firewall permission, approved
  network choice and actual PostgreSQL operation still need your later test.
