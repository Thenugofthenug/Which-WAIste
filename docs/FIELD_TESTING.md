# Classroom reliability checks

The planned field test uses four students at a time, with rotating groups from
8:30 a.m. to 3:30 p.m. and a 1–1.5 hour break. Test data below is synthetic and
stored in disposable local databases, never the classroom database on Render.

## What changed

- The optional training questions suggest settings but no longer lock the rounds,
  step size or practice style. Settings are disabled while starting/training.
- Screens 2 and 3 have the same Sort / Train / Test navigation at the bottom.
  Changing stages there scrolls to and focuses the new stage's top tab.
- A refresh excludes queued sorting choices immediately, including before their
  server acknowledgment arrives. Retrying retains the original event IDs.
- API calls time out after 30 seconds, including a stalled response body. A
  malformed success response is an error, not permission to discard a saved queue.
  The UI offers manual save retry; predictions are not automatically repeated.
- If the training-start response is lost, the screen checks for a matching new
  run and resumes showing its progress. Old completed results cannot be mistaken
  for a newly accepted run.
- Training callbacks can update only the run that accepted them. A worker from
  before a restart cannot overwrite a newer run's history or results.
- One stable thread handles training; another handles predictions. Predictions
  can continue during training. Up to four prediction requests are admitted,
  including the active request; excess requests get a retry message (HTTP 429).
  Connections are released while predictions wait for the CNN.

## Repeat the local load test

Install `requirements-dev.txt`, then run from the repository root:

```powershell
.\.venv\Scripts\python.exe -B -m backend.stress_test --groups 20 --students 4
```

This starts a real Uvicorn process on a free loopback port, uses a temporary
SQLite database, and removes that database when finished. It does not touch
`.data/waiste.db`. A JSON report and server log are saved under ignored `.data/`.

To test PostgreSQL, set `STRESS_DATABASE_URL` to a **local** PostgreSQL admin
database. For example, with a local test server configured on port 55435:

```powershell
$env:STRESS_DATABASE_URL = 'postgresql+psycopg://fieldtest@127.0.0.1:55435/postgres'
.\.venv\Scripts\python.exe -B -m backend.stress_test --groups 20 --students 4 --report .data/field-test-postgres-results.json
```

Use your own local credentials/server configuration. The test creates a unique
database and drops only that database afterward. It refuses remote hostnames;
do not use Render's connection string. Remove this environment variable to
return to temporary SQLite testing:

```powershell
Remove-Item Env:STRESS_DATABASE_URL
```

For the heavier training configuration:

```powershell
.\.venv\Scripts\python.exe -B -m backend.stress_test --groups 1 --students 4 --epochs 50 --mode full --report .data/field-test-full-50-results.json
```

The load test creates named test students, sorts 30 items each (including two
misses), retries saves, opens every help topic, changes the learning rate, records
learning activities, trains actual CNNs, and makes familiar/unfamiliar predictions.
It also sends a burst of 16 predictions. Only explicit capacity rejections are
retried; an uncertain prediction timeout fails the test instead of duplicating a
potentially saved click. The harness retries busy training requests to let all
simulated students finish; the browser currently asks students to retry manually.

It verifies row counts **and per-student/session/run associations**, null labels
for misses, no duplicate retried events, CSV export contents, and restoration
after a real serving-process restart. Health latency and server memory are sampled.
The memory measurement excludes the load generator and PostgreSQL.

## Local results on October 21, 2026

The PostgreSQL rotation test passed with 20 groups of four (80 students),
2,400 sorting records, 80 completed three-round Classroom runs, 720 help events,
240 learning activities and 176 predictions. All records survived restart and
the exports matched. There were no HTTP 5xx responses or health failures; busy
training/prediction requests used the expected 429 response.

The comparable local Windows runs peaked at **593.3 MiB before** the fixed CNN
threads and **429.2 MiB after**. These are sampled working-set measurements, not
Render's container-memory measurement or a guaranteed upper bound. The updated
rotation run completed in approximately 106 seconds with accelerated simulated
input; that is not a student play-through duration.

A separate PostgreSQL test also passed with four students requesting **50 rounds
in Full mode** each, plus 24 predictions, restart restoration and export checks.
It peaked at 422.9 MiB locally. Both tests left the health route responsive.

Final regression checks passed: 65 frontend tests, 31 backend tests on SQLite,
26 database/API tests on PostgreSQL and 10 original desktop/CNN tests. Frontend
lint and production build passed. A separate four-student SQLite load test passed
as well. The test runner executes frontend files sequentially to avoid exhausting
memory on this laptop when several JSDOM/Vite instances start together.

Automated UI tests cover navigation, setting edits, queued-save recovery and
definition placement at 1388 × 768. These use JSDOM and mocked element geometry;
they cannot certify visual layout. A real screenshot check at that resolution
remains outstanding because the available browser automation stopped on its
URL-policy limitation.

This is **not a seven-hour soak or a test on Render's CPU/RAM limits**. A short
four-device rehearsal on the deployed build is still needed before the field day.

## Four-device rehearsal after deploying

1. Open the same deployed build on four laptops at 1388 × 768. Use clearly
   identifiable test names so the rehearsal is separate from study data.
2. Complete sorting together, including intentional misses. Start with Classroom
   and three rounds. Simultaneous training is limited to one run; other students
   should get a retry message while their sorting stays saved.
3. Try both experiment questions, change practice style and rounds, and navigate
   using the bottom tabs. Open definition bubbles and test familiar/unfamiliar items.
4. On one device, briefly disconnect Wi-Fi during a save, reconnect, use Retry
   saving, and refresh. Check that the same item is not counted twice. Wait for
   pending saves before closing a tab or switching students.
5. Check Render's memory, CPU and error logs during training. In DataGrip, confirm
   each test student's linked sorting, training, help and activity rows. Use
   **Different student** between groups; New mission keeps the current student.
6. Repeat after the long break. Free Render services can sleep while idle; open
   the site before students return and wait for `/api/health` to respond.

Use the same PostgreSQL database when deploying updates. Export the day's data
with the existing report command. See [the hosting guide](RENDER.md) for database
joins, export commands and the free database's expiry limit.
