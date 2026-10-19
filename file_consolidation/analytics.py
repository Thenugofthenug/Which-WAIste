"""
Analytics
=========
Per-player usage statistics, saved to a local SQLite database file
(STATS_DB_NAME, next to the game), used to match gameplay with pre- and
post-survey responses.

Players
  The player's first and last name are entered at the start and stored ONCE,
  in the `players` table, which gives each name a player_id. Every other table
  refers to the player by player_id only. To de-identify the data later,
  replace the names in `players` with study IDs (or delete those two columns);
  nothing else needs editing. Names are matched ignoring capitalization and
  extra spaces, so a returning player keeps the same player_id.

What is recorded
  - every item the player sorts or misses (the dataset they build)
  - learning-rate slider adjustments and the value each one settles on
  - each training run (learning rate, dataset size, results)
  - clicks on FAMILIAR ITEM vs NEVER-SEEN ITEM after training

The data never leaves the computer. Set ANALYTICS_ENABLED = False in config.py
to turn it off (the name prompt is then skipped too). If the database ever
fails, tracking switches itself off and the game carries on. Databases from
older versions are upgraded automatically; their earlier rows have no player.
Run stats_report.py to see summaries or export spreadsheets.
"""
import math
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path

from config import ANALYTICS_ENABLED, CATEGORIES, STATS_DB_NAME

DB_PATH = Path(__file__).resolve().parent / STATS_DB_NAME

TABLES = """
CREATE TABLE IF NOT EXISTS players (
    player_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name   TEXT,
    last_name    TEXT,
    name_key     TEXT UNIQUE,                 -- "first|last", lowercase, single spaces (for matching)
    created_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    session_id   TEXT PRIMARY KEY,            -- random, one per launch of the game
    started_at   TEXT NOT NULL,
    player_id    INTEGER REFERENCES players(player_id)
);
CREATE TABLE IF NOT EXISTS games (
    game_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT NOT NULL REFERENCES sessions(session_id),
    started_at   TEXT NOT NULL,
    finished_at  TEXT,
    score        INTEGER,
    correct      INTEGER,
    wrong        INTEGER,
    missed       INTEGER,
    best_streak  INTEGER,
    player_id    INTEGER REFERENCES players(player_id)
);
CREATE TABLE IF NOT EXISTS sorted_items (            -- the dataset each player provides
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id      INTEGER NOT NULL REFERENCES games(game_id),
    item_name    TEXT NOT NULL,
    expected_bin TEXT NOT NULL,                       -- bin most recycling programs use
    chosen_bin   TEXT,                                -- the player's label (NULL if missed)
    outcome      TEXT NOT NULL CHECK (outcome IN ('correct', 'wrong', 'missed')),
    at           TEXT NOT NULL,
    player_id    INTEGER REFERENCES players(player_id)
);
CREATE TABLE IF NOT EXISTS lr_adjustments (          -- one row each time the slider settles
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT NOT NULL REFERENCES sessions(session_id),
    game_id      INTEGER REFERENCES games(game_id),
    lr_value     REAL NOT NULL,
    lr_exponent  REAL NOT NULL,                       -- log10 of the value, as on the slider
    at           TEXT NOT NULL,
    player_id    INTEGER REFERENCES players(player_id)
);
CREATE TABLE IF NOT EXISTS training_runs (
    run_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id       TEXT NOT NULL REFERENCES sessions(session_id),
    game_id          INTEGER REFERENCES games(game_id),
    lr_start         REAL NOT NULL,
    lr_end           REAL,
    n_train          INTEGER,
    n_val            INTEGER,
    n_test           INTEGER,
    epochs_completed INTEGER,
    stopped_early    INTEGER,                         -- 1 if the player pressed STOP
    before_test_acc  REAL,
    test_acc         REAL,
    started_at       TEXT NOT NULL,
    finished_at      TEXT,
    player_id        INTEGER REFERENCES players(player_id)
);
CREATE TABLE IF NOT EXISTS try_clicks (              -- post-training item tests
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT NOT NULL REFERENCES sessions(session_id),
    game_id       INTEGER REFERENCES games(game_id),
    kind          TEXT NOT NULL CHECK (kind IN ('familiar', 'never_seen')),
    item_name     TEXT NOT NULL,
    predicted_bin TEXT NOT NULL,
    confidence    REAL NOT NULL,
    correct       INTEGER,                            -- NULL when no correct bin exists
    at            TEXT NOT NULL,
    player_id     INTEGER REFERENCES players(player_id)
);
"""

# tables that gained a player_id column (older databases are upgraded in place)
PLAYER_TABLES = ["sessions", "games", "sorted_items", "lr_adjustments", "training_runs", "try_clicks"]

VIEWS = """
CREATE VIEW IF NOT EXISTS lr_popular_values AS
    SELECT lr_exponent, ROUND(MIN(lr_value), 6) AS lr_value, COUNT(*) AS times_settled
    FROM lr_adjustments GROUP BY lr_exponent ORDER BY times_settled DESC;
CREATE VIEW IF NOT EXISTS lr_adjustments_per_session AS
    SELECT session_id, COUNT(*) AS adjustments FROM lr_adjustments GROUP BY session_id;
CREATE VIEW IF NOT EXISTS try_click_counts AS
    SELECT kind, COUNT(*) AS clicks, ROUND(AVG(confidence), 3) AS avg_confidence,
           SUM(correct) AS correct, COUNT(correct) AS gradable
    FROM try_clicks GROUP BY kind;
CREATE VIEW IF NOT EXISTS dataset_by_game AS
    SELECT game_id,
           SUM(chosen_bin = 'Recycling') AS recycling,
           SUM(chosen_bin = 'Compost')   AS compost,
           SUM(chosen_bin = 'Landfill')  AS landfill,
           SUM(outcome = 'missed')       AS missed,
           SUM(outcome = 'wrong')        AS mislabeled
    FROM sorted_items GROUP BY game_id;
CREATE VIEW IF NOT EXISTS item_label_choices AS
    SELECT item_name, expected_bin, COALESCE(chosen_bin, '(missed)') AS chosen_bin, COUNT(*) AS times
    FROM sorted_items GROUP BY item_name, expected_bin, chosen_bin ORDER BY item_name, times DESC;

-- one row per player: the table to line up with pre/post surveys
CREATE VIEW IF NOT EXISTS player_overview AS
    SELECT p.player_id, p.first_name, p.last_name,
           (SELECT COUNT(*) FROM sessions s WHERE s.player_id = p.player_id)                AS sessions,
           (SELECT COUNT(*) FROM games g WHERE g.player_id = p.player_id)                   AS games_started,
           (SELECT COUNT(finished_at) FROM games g WHERE g.player_id = p.player_id)         AS games_finished,
           (SELECT ROUND(AVG(score), 1) FROM games g WHERE g.player_id = p.player_id)       AS avg_score,
           (SELECT MAX(score) FROM games g WHERE g.player_id = p.player_id)                 AS best_score,
           (SELECT COUNT(*) FROM sorted_items i WHERE i.player_id = p.player_id AND outcome = 'correct') AS items_correct,
           (SELECT COUNT(*) FROM sorted_items i WHERE i.player_id = p.player_id AND outcome = 'wrong')   AS items_mislabeled,
           (SELECT COUNT(*) FROM sorted_items i WHERE i.player_id = p.player_id AND outcome = 'missed')  AS items_missed,
           (SELECT COUNT(*) FROM lr_adjustments a WHERE a.player_id = p.player_id)          AS lr_adjustments,
           (SELECT ROUND(a.lr_value, 6) FROM lr_adjustments a WHERE a.player_id = p.player_id
                GROUP BY a.lr_exponent ORDER BY COUNT(*) DESC, MAX(a.id) DESC LIMIT 1)      AS most_settled_lr,
           (SELECT COUNT(*) FROM training_runs t WHERE t.player_id = p.player_id)           AS training_runs,
           (SELECT ROUND(MAX(test_acc), 3) FROM training_runs t WHERE t.player_id = p.player_id) AS best_test_acc,
           (SELECT COUNT(*) FROM try_clicks c WHERE c.player_id = p.player_id AND kind = 'familiar')   AS familiar_clicks,
           (SELECT COUNT(*) FROM try_clicks c WHERE c.player_id = p.player_id AND kind = 'never_seen') AS never_seen_clicks
    FROM players p ORDER BY p.last_name, p.first_name;
"""


def open_database(path=DB_PATH):
    """Connect, creating missing tables, upgrading old ones and adding the summary views."""
    conn = sqlite3.connect(str(path))
    conn.executescript(TABLES)
    for table in PLAYER_TABLES:          # databases from before player tracking lack player_id
        cols = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        if "player_id" not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN player_id INTEGER REFERENCES players(player_id)")
    conn.commit()
    conn.executescript(VIEWS)
    return conn


def _now():
    return datetime.now().isoformat(timespec="seconds")


def clean_name(text):
    """Trim and collapse spaces: '  mary   ann ' -> 'mary ann'."""
    return " ".join(str(text).split())


def name_key(first, last):
    """Matching key that ignores capitalization and extra spaces."""
    return f"{clean_name(first).casefold()}|{clean_name(last).casefold()}"


class Stats:
    """One instance per launch. Every method is safe to call: if tracking is off
    or the database fails, it simply does nothing."""

    def __init__(self, path=DB_PATH, enabled=ANALYTICS_ENABLED):
        self.session_id = uuid.uuid4().hex
        self.player_id = None
        self.game_id = None
        self.conn = None
        if not enabled:
            return
        try:
            self.conn = open_database(path)
            self._write("INSERT INTO sessions (session_id, started_at) VALUES (?, ?)", (self.session_id, _now()))
        except sqlite3.Error as err:
            self._disable(err)

    # ---------------------------------------------------------------- internals
    def _disable(self, err):
        print(f"[analytics] tracking turned off: {err}")
        if self.conn is not None:
            try:
                self.conn.close()
            except sqlite3.Error:
                pass
        self.conn = None

    def _write(self, sql, params=()):
        """Run one statement and save it right away; returns the new row id."""
        if self.conn is None:
            return None
        try:
            cur = self.conn.execute(sql, params)
            self.conn.commit()
            return cur.lastrowid
        except sqlite3.Error as err:
            self._disable(err)
            return None

    @staticmethod
    def _bin(index):
        return None if index is None else CATEGORIES[index]

    # ------------------------------------------------------------------ player
    def set_player(self, first, last):
        """Record who is playing. Returns the player_id (the same one for a returning name)."""
        if self.conn is None:
            return None
        first, last = clean_name(first), clean_name(last)
        try:
            self.conn.execute("INSERT OR IGNORE INTO players (first_name, last_name, name_key, created_at) "
                              "VALUES (?, ?, ?, ?)", (first, last, name_key(first, last), _now()))
            row = self.conn.execute("SELECT player_id FROM players WHERE name_key = ?",
                                    (name_key(first, last),)).fetchone()
            self.conn.commit()
        except sqlite3.Error as err:
            self._disable(err)
            return None
        new_id = row[0]
        if self.player_id is not None and self.player_id != new_id:
            # a different player on the same launch gets their own session
            self.session_id = uuid.uuid4().hex
            self.game_id = None
            self._write("INSERT INTO sessions (session_id, started_at) VALUES (?, ?)", (self.session_id, _now()))
        self.player_id = new_id
        self._write("UPDATE sessions SET player_id = ? WHERE session_id = ?", (self.player_id, self.session_id))
        return self.player_id

    # ------------------------------------------------------------------- events
    def start_game(self):
        self.game_id = self._write("INSERT INTO games (session_id, player_id, started_at) VALUES (?, ?, ?)",
                                   (self.session_id, self.player_id, _now()))

    def item_sorted(self, item_name, expected, chosen):
        """chosen = bin index the player picked, or None if the item went into the lava."""
        outcome = "missed" if chosen is None else "correct" if chosen == expected else "wrong"
        self._write("INSERT INTO sorted_items (game_id, player_id, item_name, expected_bin, chosen_bin, outcome, at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (self.game_id, self.player_id, item_name, self._bin(expected), self._bin(chosen), outcome, _now()))

    def finish_game(self, score, correct, wrong, missed, best_streak):
        self._write("UPDATE games SET finished_at = ?, score = ?, correct = ?, wrong = ?, missed = ?, "
                    "best_streak = ? WHERE game_id = ?",
                    (_now(), score, correct, wrong, missed, best_streak, self.game_id))

    def lr_settled(self, value):
        self._write("INSERT INTO lr_adjustments (session_id, game_id, player_id, lr_value, lr_exponent, at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (self.session_id, self.game_id, self.player_id, value, round(math.log10(value), 1), _now()))

    def training_started(self, lr, n_train, n_val, n_test):
        return self._write("INSERT INTO training_runs (session_id, game_id, player_id, lr_start, n_train, n_val, "
                           "n_test, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                           (self.session_id, self.game_id, self.player_id, lr, n_train, n_val, n_test, _now()))

    def training_finished(self, run_id, lr_end, epochs_completed, stopped_early, before_test_acc, test_acc):
        if run_id is None:
            return
        self._write("UPDATE training_runs SET lr_end = ?, epochs_completed = ?, stopped_early = ?, "
                    "before_test_acc = ?, test_acc = ?, finished_at = ? WHERE run_id = ?",
                    (lr_end, epochs_completed, int(stopped_early), before_test_acc, test_acc, _now(), run_id))

    def try_click(self, kind, item_name, predicted, confidence, correct):
        """kind: 'familiar' or 'never_seen'; correct: True/False, or None if no right bin exists."""
        self._write("INSERT INTO try_clicks (session_id, game_id, player_id, kind, item_name, predicted_bin, "
                    "confidence, correct, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (self.session_id, self.game_id, self.player_id, kind, item_name, self._bin(predicted),
                     float(confidence), None if correct is None else int(correct), _now()))

    def close(self):
        if self.conn is not None:
            self.conn.close()
            self.conn = None


class _NoStats(Stats):
    """Stand-in used when an app has no Stats object (e.g. in the unit tests)."""

    def __init__(self):
        super().__init__(enabled=False)


NO_STATS = _NoStats()


def stats_for(app):
    """The app's Stats object, or a do-nothing stand-in if it doesn't have one."""
    return getattr(app, "stats", None) or NO_STATS
