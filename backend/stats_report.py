"""Export browser analytics from SQLite or DATABASE_URL (PostgreSQL).

Run: python -m backend.stats_report --csv .data/stats_csv
The separate file_consolidation/stats_report.py reads the desktop database.
"""
import argparse
import csv
from pathlib import Path

from sqlalchemy import select

from backend.database import (Game, HelpOpen, LearningRateAdjustment, SortAction,
                              TrainingRun, TryClick, make_database)
from file_consolidation.config import CATEGORIES


def collect_report(Session):
    """Produce research rows without exporting model weights or embedded images."""
    report = {}
    with Session() as db:
        for model in (Game, SortAction, HelpOpen, LearningRateAdjustment, TryClick):
            columns = [column for column in model.__table__.columns
                       if column.name not in ('model_weights', 'results', 'probe', 'history')]
            report[model.__tablename__] = (list(column.name for column in columns),
                                          [dict(row) for row in db.execute(select(*columns)).mappings()])
        fields = ['id', 'session_id', 'status', 'epochs', 'epochs_completed', 'learning_rate',
                  'train_items', 'validation_items', 'test_items', 'before_accuracy',
                  'test_accuracy', 'best_epoch', 'started_at', 'completed_at']
        runs = []
        for run in db.scalars(select(TrainingRun).order_by(TrainingRun.started_at)):
            result = run.results or {}
            split = result.get('split', {})
            runs.append(dict(id=run.id, session_id=run.session_id, status=run.status, epochs=run.epochs,
                             epochs_completed=len(run.history), learning_rate=run.learning_rate,
                             train_items=split.get('train'), validation_items=split.get('validation'),
                             test_items=split.get('test'), before_accuracy=result.get('before_accuracy'),
                             test_accuracy=result.get('test_accuracy'), best_epoch=result.get('best_epoch'),
                             started_at=run.started_at, completed_at=run.completed_at))
        report['training_runs'] = (fields, runs)

    # Add readable bin names while retaining the numerical classes for analysis.
    for name, class_fields in (('sort_actions', ['expected_class', 'chosen_class']),
                               ('try_clicks', ['predicted_class'])):
        fields, rows = report[name]
        for class_field in class_fields:
            bin_field = class_field.replace('_class', '_bin')
            fields.append(bin_field)
            for row in rows:
                row[bin_field] = CATEGORIES[row[class_field]] if row[class_field] is not None else None

    fields = ['session_id', 'resolved', 'correct', 'wrong', 'missed', 'score', 'best_streak',
              'recycling_labels', 'compost_labels', 'landfill_labels']
    datasets = []
    for game in report['game_sessions'][1]:
        actions = sorted((row for row in report['sort_actions'][1] if row['session_id'] == game['id']),
                         key=lambda row: row['order'])
        correct = sum(row['correct'] for row in actions)
        missed = sum(row['outcome'] == 'missed' for row in actions)
        streak = best = 0
        for action in actions:
            streak = streak + 1 if action['correct'] else 0
            best = max(best, streak)
        datasets.append(dict(session_id=game['id'], resolved=len(actions), correct=correct,
                             wrong=len(actions) - correct - missed, missed=missed, score=10 * correct,
                             best_streak=best, **{
                                 key: sum(row['chosen_class'] == index for row in actions)
                                 for index, key in enumerate(['recycling_labels', 'compost_labels', 'landfill_labels'])}))
    report['dataset_by_game'] = (fields, datasets)
    return report


def export_csv(report, folder):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for name, (fields, rows) in report.items():
        with (folder / f'{name}.csv').open('w', newline='', encoding='utf-8') as output:
            writer = csv.DictWriter(output, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv', type=Path, help='Write tables and a game summary to this folder.')
    args = parser.parse_args()
    engine, Session = make_database()
    try:
        report = collect_report(Session)
        for name, (_, rows) in report.items():
            print(f'{name}: {len(rows)} rows')
        if args.csv:
            export_csv(report, args.csv)
            print(f'CSV files saved to {args.csv.resolve()}')
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()
