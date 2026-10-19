# Host Which wAIste on Render

Use the combined branch **`integration/temp-data-collection`**, not `temp` or
`main`. `temp` contains the desktop analytics work; the integration branch also
connects that data collection to the browser game.

## First deployment

1. Push the integration branch to the team's GitHub repository.
2. Sign in to [Render](https://dashboard.render.com/), choose **New → Blueprint**,
   and connect `Thenugofthenug/Which-WAIste`.
3. Select **`integration/temp-data-collection`** and the root `render.yaml`.
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
Tables are created on startup. Existing browser records are retained when the
two new analytics tables are added.

Automatic deployments are off. For later updates, choose **Manual Deploy →
Deploy latest commit** on this same branch after the tests pass.

## Read the collected data

The browser writes to these tables:

| Table | What it records |
| --- | --- |
| `game_sessions` | Anonymous round ID, version, seed, completion and current model |
| `sort_actions` | Item, expected/chosen bins, correct/wrong/missed, speed, response time |
| `training_runs` | Each training run, selected learning rate/epochs, history and results |
| `lr_adjustments` | Learning-rate choices after the slider rests for 700 ms |
| `try_clicks` | Familiar/unfamiliar tests, model run, prediction, confidence, destination and correctness |
| `help_events` | Help topics opened, including Robot Detective explanations |

Items outside the three categories have `correct = NULL` in `try_clicks`, because
none of the available bins is a valid answer. A high model score does not make
that prediction correct. Missed conveyor items keep a NULL label and stay out of
training.

The hosted game uses anonymous round IDs. Nug's separate desktop version retains
its player-name entry and its own local SQLite database; it does not automatically
upload those desktop records or names to Render. A teacher-issued study-code flow
would be a separate addition if survey matching is needed.

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
Exports include readable bin names, a per-round score/label summary, and flattened
training metrics. Embedded images and model weights are excluded. This report is
a local command; there is no public data-export endpoint.

## Free-trial limits

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
