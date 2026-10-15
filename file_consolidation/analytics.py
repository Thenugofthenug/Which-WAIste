"""
Analytics
=========
Anonymous usage statistics, saved to a local SQLite database file
(STATS_DB_NAME, next to the game) to help improve the experience.

What is recorded:
  - every item the player sorts or misses (the dataset they build)
  - learning-rate slider adjustments and the value each one settles on
  - each training run (learning rate, dataset size, results)
  - clicks on FAMILIAR ITEM vs NEVER-SEEN ITEM after training

Nothing identifies a player: each launch gets a random session ID, and the
data never leaves the computer. Set ANALYTICS_ENABLED = False in config.py to
turn it off. If the database ever fails, tracking switches itself off and the
game carries on. Run stats_report.py to see summaries or export spreadsheets.
"""
import math
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path

from config import ANALYTICS_ENABLED, CATEGORIES, STATS_DB_NAME

DB_PATH = Path(__file__).resolve().parent / STATS_DB_NAME

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    session_id   TEXT PRIMARY KEY,          -- random, one per launch of the game
    started_at   TEXT NOT NULL
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
    best_streak  INTEGER
);
CREATE TABLE IF NOT EXISTS sorted_items (            -- the dataset each player provides
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id      INTEGER NOT NULL REFERENCES games(game_id),
    item_name    TEXT NOT NULL,
    expected_bin TEXT NOT NULL,                       -- bin most recycling programs use
    chosen_bin   TEXT,                                -- the player's label (NULL if missed)
    outcome      TEXT NOT NULL CHECK (outcome IN ('correct', 'wrong', 'missed')),
    at           TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lr_adjustments (          -- one row each time the slider settles
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT NOT NULL REFERENCES sessions(session_id),
    game_id      INTEGER REFERENCES games(game_id),
    lr_value     REAL NOT NULL,
    lr_exponent  REAL NOT NULL,                       -- log10 of the value, as on the slider
    at           TEXT NOT NULL
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
    finished_at      TEXT
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
    at            TEXT NOT NULL
);

-- ready-made summaries
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
"""


def _now():
    return datetime.now().isoformat(timespec="seconds")


class Stats:
    """One instance per launch. Every method is safe to call: if tracking is off
    or the database fails, it simply does nothing."""

    def __init__(self, path=DB_PATH, enabled=ANALYTICS_ENABLED):
        self.session_id = uuid.uuid4().hex
        self.game_id = None
        self.conn = None
        if not enabled:
            return
        try:
            self.conn = sqlite3.connect(str(path))
            self.conn.executescript(SCHEMA)
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

    # ------------------------------------------------------------------- events
    def start_game(self):
        self.game_id = self._write("INSERT INTO games (session_id, started_at) VALUES (?, ?)",
                                   (self.session_id, _now()))

    def item_sorted(self, item_name, expected, chosen):
        """chosen = bin index the player picked, or None if the item went into the lava."""
        outcome = "missed" if chosen is None else "correct" if chosen == expected else "wrong"
        self._write("INSERT INTO sorted_items (game_id, item_name, expected_bin, chosen_bin, outcome, at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (self.game_id, item_name, self._bin(expected), self._bin(chosen), outcome, _now()))

    def finish_game(self, score, correct, wrong, missed, best_streak):
        self._write("UPDATE games SET finished_at = ?, score = ?, correct = ?, wrong = ?, missed = ?, "
                    "best_streak = ? WHERE game_id = ?",
                    (_now(), score, correct, wrong, missed, best_streak, self.game_id))

    def lr_settled(self, value):
        self._write("INSERT INTO lr_adjustments (session_id, game_id, lr_value, lr_exponent, at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (self.session_id, self.game_id, value, round(math.log10(value), 1), _now()))

    def training_started(self, lr, n_train, n_val, n_test):
        return self._write("INSERT INTO training_runs (session_id, game_id, lr_start, n_train, n_val, n_test, "
                           "started_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                           (self.session_id, self.game_id, lr, n_train, n_val, n_test, _now()))

    def training_finished(self, run_id, lr_end, epochs_completed, stopped_early, before_test_acc, test_acc):
        if run_id is None:
            return
        self._write("UPDATE training_runs SET lr_end = ?, epochs_completed = ?, stopped_early = ?, "
                    "before_test_acc = ?, test_acc = ?, finished_at = ? WHERE run_id = ?",
                    (lr_end, epochs_completed, int(stopped_early), before_test_acc, test_acc, _now(), run_id))

    def try_click(self, kind, item_name, predicted, confidence, correct):
        """kind: 'familiar' or 'never_seen'; correct: True/False, or None if no right bin exists."""
        self._write("INSERT INTO try_clicks (session_id, game_id, kind, item_name, predicted_bin, confidence, "
                    "correct, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (self.session_id, self.game_id, kind, item_name, self._bin(predicted), float(confidence),
                     None if correct is None else int(correct), _now()))

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
