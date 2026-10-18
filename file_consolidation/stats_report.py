#!/usr/bin/env python3
"""
Stats report
============
Summarize the anonymous usage statistics collected by the game.

    python stats_report.py                  # print a summary
    python stats_report.py --csv stats_csv  # also export every table/summary as CSV (opens in Excel/Sheets)
    python stats_report.py --db other.db    # read a different database file

The player_overview table (and player_overview.csv) has one row per player,
with their name, for matching gameplay to pre/post surveys. Names live only in
the players table, so de-identifying means editing that one table.

You can also open whichwaiste_stats.db directly in any SQLite tool
(e.g. DB Browser for SQLite) and run your own queries.
"""
import argparse
import csv
import sys
from pathlib import Path

from analytics import DB_PATH, open_database

EXPORTS = ["player_overview", "players", "sessions", "games", "sorted_items", "lr_adjustments", "training_runs", "try_clicks",
           "dataset_by_game", "item_label_choices", "lr_popular_values", "lr_adjustments_per_session",
           "try_click_counts"]


def table(conn, title, sql, limit=None):
    cur = conn.execute(sql)
    cols = [c[0] for c in cur.description]
    rows = cur.fetchall()
    print(f"\n== {title} ==")
    if not rows:
        print("  (no data yet)")
        return
    shown = rows[:limit] if limit else rows
    widths = [max(len(str(c)), *(len(str(r[i])) for r in shown)) for i, c in enumerate(cols)]
    print("  " + "  ".join(str(c).ljust(w) for c, w in zip(cols, widths)))
    for r in shown:
        print("  " + "  ".join(str(v).ljust(w) for v, w in zip(r, widths)))
    if limit and len(rows) > limit:
        print(f"  ... {len(rows) - limit} more rows (use --csv for everything)")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", default=str(DB_PATH), help="path to the stats database")
    parser.add_argument("--csv", metavar="FOLDER", help="export every table and summary as CSV files here")
    args = parser.parse_args()

    if not Path(args.db).exists():
        sys.exit(f"No stats database found at {args.db} - play the game first.")
    conn = open_database(args.db)          # also upgrades databases from older versions

    totals = conn.execute("SELECT (SELECT COUNT(*) FROM sessions), (SELECT COUNT(*) FROM games), "
                          "(SELECT COUNT(*) FROM games WHERE finished_at IS NOT NULL), "
                          "(SELECT COUNT(*) FROM sorted_items), (SELECT COUNT(*) FROM training_runs)").fetchone()
    print("WHICHWAISTE USAGE STATS")
    print(f"  sessions {totals[0]} | games started {totals[1]} (finished {totals[2]}) | "
          f"items handled {totals[3]} | training runs {totals[4]}")

    # 0. players (match these rows with the pre/post surveys)
    table(conn, "PLAYERS (ONE ROW EACH - USE THIS TO MATCH SURVEYS)",
          "SELECT player_id, first_name, last_name, sessions, games_finished, avg_score, lr_adjustments, "
          "most_settled_lr, training_runs, best_test_acc, familiar_clicks, never_seen_clicks FROM player_overview")
    unnamed = conn.execute("SELECT COUNT(*) FROM games WHERE player_id IS NULL").fetchone()[0]
    if unnamed:
        print(f"  note: {unnamed} game(s) were recorded before player names were added (no player)")

    # 1. the datasets players provide
    table(conn, "DATASETS PLAYERS BUILT (labels per game)", "SELECT * FROM dataset_by_game ORDER BY game_id")
    table(conn, "HOW PLAYERS LABEL EACH ITEM TYPE", "SELECT * FROM item_label_choices", limit=40)

    # 2. learning-rate slider
    adj = conn.execute("SELECT COUNT(*), COUNT(DISTINCT session_id) FROM lr_adjustments").fetchone()
    sessions = max(totals[0], 1)
    print(f"\n== LEARNING-RATE SLIDER ==\n  {adj[0]} adjustments in total, "
          f"{adj[0] / sessions:.1f} per session on average; {adj[1]} of {totals[0]} sessions touched the slider")
    table(conn, "LEARNING RATES PLAYERS SETTLED ON MOST", "SELECT * FROM lr_popular_values", limit=10)
    table(conn, "LEARNING RATE USED WHEN TRAINING STARTED",
          "SELECT ROUND(lr_start, 6) AS lr_start, COUNT(*) AS runs, ROUND(AVG(test_acc), 3) AS avg_test_acc, "
          "SUM(stopped_early) AS stopped_early FROM training_runs GROUP BY ROUND(lr_start, 6) ORDER BY runs DESC",
          limit=10)

    # 3. post-training clicks
    table(conn, "FAMILIAR vs NEVER-SEEN CLICKS AFTER TRAINING", "SELECT * FROM try_click_counts")

    if args.csv:
        out = Path(args.csv)
        out.mkdir(parents=True, exist_ok=True)
        for name in EXPORTS:
            cur = conn.execute(f"SELECT * FROM {name}")
            with open(out / f"{name}.csv", "w", newline="", encoding="utf-8") as fh:
                writer = csv.writer(fh)
                writer.writerow([c[0] for c in cur.description])
                writer.writerows(cur)
        print(f"\nExported {len(EXPORTS)} CSV files to {out.resolve()}")
    conn.close()


if __name__ == "__main__":
    main()
