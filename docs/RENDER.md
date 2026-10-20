# Host Which wAIste on Render

Use **`which-wAIste-retro`** for the current classroom version. It includes the
browser game, student data collection, and the latest training and layout updates.
Keep the existing PostgreSQL database connected when updating the web service.

## First deployment

1. Push `which-wAIste-retro` to the team's GitHub repository.
2. Sign in to [Render](https://dashboard.render.com/), choose **New → Blueprint**,
   and connect `Thenugofthenug/Which-WAIste`.
3. Select **`which-wAIste-retro`** and the root `render.yaml`.
4. Review the resources: one **free Docker web service** (`which-waiste-lava`)
   and one **free PostgreSQL database** (`which-waiste-data`), both in Oregon.
5. Deploy the Blueprint. The Dockerfile builds React, installs CPU-only PyTorch,
   and starts FastAPI on Render's `PORT`. No separate frontend service is needed.
6. Open the web service's `https://…onrender.com` address. Check `/api/health`:
   it should return `"status": "ok"` and `"database": "postgresql"`.
7. Play one round, train for three epochs, open learning help, adjust the learning
   rate, and try both new-item buttons. Check that their database rows exist.

`DATABASE_URL` is connected automatically using the database's internal URL.
It is a backend secret; do not put it in a `VITE_` variable or commit it to Git.
Tables are created on startup. Existing browser records are retained when new
analytics tables are added. Student tracking adds `players`, `game_players`, and
`activity_events`; it does not alter or overwrite existing game tables. Redeploying
against the same `DATABASE_URL` keeps previous rounds, including anonymous rounds.

Automatic deployments are off. For later updates, choose **Manual Deploy →
Deploy latest commit** on this same branch after the tests pass.

## Read the collected data

The browser writes to these tables:

| Table | What it records |
| --- | --- |
| `game_sessions` | Opaque round ID, version, seed, completion and current model |
| `players` | Student ID, first name, last name and registration time |
| `game_players` | Links each named round to its student ID; one student can play multiple rounds |
| `sort_actions` | Item, expected/chosen bins, correct/wrong/missed, speed, response time |
| `training_runs` | Each training run, selected learning rate/epochs, history and results |
| `training_settings` | Practice mode and augmented views per training item for each new run |
| `lr_adjustments` | Learning-rate choices after the slider rests for 700 ms |
| `try_clicks` | Familiar/unfamiliar tests, model run, prediction, confidence, destination and correctness |
| `help_events` | Help topics opened, including Robot Detective explanations |
| `activity_events` | Training goals, actual epochs reviewed and optional weight experiments |

Items outside the three categories have `correct = NULL` in `try_clicks`, because
none of the available bins is a valid answer. A high model score does not make
that prediction correct. Missed conveyor items keep a NULL label and stay out of
training.

The browser's start screen collects first and last names once for a student. Names
are stored only in `players`, not copied into gameplay or learning-event rows.
`POST /api/players` returns an opaque ID; the browser keeps that ID in this tab's
session storage and keeps names out of URLs and browser storage. Subsequent rounds
can link to the same student ID. A new registration always creates a new ID, even
when two students share a name. The API has no public name-list or name-export
route. Historical anonymous rounds still work and have no `game_players` link.

Use the IDs to join collected actions to a student in DataGrip, for example:

```sql
SELECT p.id AS player_id, p.first_name, p.last_name,
       a.session_id, a.item_name, a.outcome, a.correct, a.response_ms
FROM players AS p
JOIN game_players AS gp ON gp.player_id = p.id
JOIN sort_actions AS a ON a.session_id = gp.session_id
ORDER BY p.id, a.session_id, a."order";
```

The same `game_players.session_id` join works with `training_runs`, `help_events`,
`lr_adjustments`, `try_clicks`, and `activity_events`. Keeping the name lookup
separate lets researchers use IDs in their analysis without spreading names into
every data file. Nug's desktop version still uses its own SQLite database; those
desktop records are not automatically uploaded to Render.

### DataGrip and CSV exports

The Blueprint initially allows database connections only from Render's private
network. In the database's **Networking / Access Control**, allow your computer's
public IP for an external connection. Avoid opening it to every IP.

In DataGrip, create a **PostgreSQL** data source using the database's external
host, port, database, username and password from Render, with SSL required.
Keep those credentials in DataGrip, not in project files. You can export query
results from DataGrip.

You can also export browser analytics with Python. Set `DATABASE_URL` to the
external PostgreSQL URL in your local terminal (include `sslmode=require`), then:

```powershell
.\.venv\Scripts\python.exe -m backend.stats_report --csv .data\render-export
```

Without `DATABASE_URL`, this command reads the local browser SQLite database.
Exports include readable bin names, a per-round score/label summary, flattened
training metrics, the student-ID link table and learning activity events. Names,
embedded images and model weights are excluded by default. Add `--include-names`
only when you need a separate `players.csv` lookup:

```powershell
.\.venv\Scripts\python.exe -m backend.stats_report --csv .data\named-export --include-names
```

Use a separate export folder for named data; a later export without the flag does
not remove an earlier `players.csv`. This report is a local command; there is no
public data-export endpoint. Generated data exports remain under ignored `.data`.

## Free-trial limits

### Faster classroom practice

New training requests default to **Classroom** mode: four augmented practice views
per labeled training item each epoch, instead of the original eight in **Full**
mode. It still trains the real CNN from scratch using every student-labeled item
in the same train/validation/test split. The 64-pixel input, model architecture,
validation/test views, filters and saved-model predictions are unchanged. Lava
items remain unlabeled and excluded. Desktop training still defaults to eight views.

This reduces practice work, so accuracy may be lower, especially after only three
epochs. Students can select Full mode for more practice; use the same mode when
comparing learning rates or epoch counts. Local fixed-seed tests found four views
more useful for learning than two. Hosting speed still depends on Render's CPU and
other requests; this is not a guarantee of a particular Render runtime.

`POST /api/sessions/{id}/train` accepts `training_mode: "classroom" | "full"`.
Status, restored sessions and completed results report `training_mode` and
`augmentations_per_item`. The additive `training_settings` table records each
choice before training starts, including interrupted runs. Existing runs without
settings are reported as Full/eight; existing models and analytics are retained.
CSV exports include both the settings table and these fields in `training_runs.csv`.

### Hosting limits

[Render's free-plan documentation](https://render.com/docs/free) says free
PostgreSQL expires **30 days after creation** and has no managed backups. Export
or back up the study data before it expires; use a durable paid setup for longer
collection. Free web services sleep after 15 minutes without traffic, so the first
visit can take about a minute to wake up.

Training runs one at a time on this service. Other students' progress is saved,
but a simultaneous training request asks them to retry. The free web service has
512 MB RAM and 0.1 CPU; try a small pilot before a whole class trains together.
If Render reports memory exhaustion or training is too slow, upgrade the web
service instead of adding workers, which would load extra CNN processes.

The application's database guard refuses to start in production without a
`DATABASE_URL`; it cannot silently fall back to a temporary SQLite file. Local
SQLite files would be lost on a Render redeploy.

Configuration references: [Blueprint fields](https://render.com/docs/blueprint-spec),
[PostgreSQL connections](https://render.com/docs/postgresql-creating-connecting).
