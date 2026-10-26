"""Browser API and static React host. Run one worker per instance for CNN training."""
import logging
import os
import random
import secrets
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select, text, update
from sqlalchemy.orm import undefer

from backend import cnn
from backend.database import (ActivityEvent, Base, Game, GamePlayer, HelpOpen,
                              LearningRateAdjustment, Player, SortAction, TrainingRun, TrainingSettings,
                              TryClick, make_database, now)

TOPICS = ('labels', 'pixels', 'filters', 'weights', 'learning', 'testing', 'accuracy', 'confidence', 'new-items')


class ActionBody(BaseModel):
    outcome: Literal['sorted', 'missed']
    chosen_class: int | None = Field(default=None, ge=0, le=2)
    response_ms: int = Field(ge=0, le=3_600_000)
    speed: Literal['SLOW', 'NORMAL', 'FAST']

    @model_validator(mode='after')
    def valid_choice(self):
        if (self.outcome == 'sorted') != (self.chosen_class is not None):
            raise ValueError('Sorted items require a class; missed items must have no class.')
        return self


class TrainingBody(BaseModel):
    epochs: Literal[3, 10, 50] = 3
    learning_rate: float = Field(default=.001, ge=.0001, le=.1)
    training_mode: Literal['classroom', 'full'] = 'classroom'


class HelpBody(BaseModel):
    event_id: UUID
    topic: Literal['labels', 'pixels', 'filters', 'weights', 'learning', 'testing', 'accuracy', 'confidence', 'new-items']


class LearningRateBody(BaseModel):
    event_id: UUID
    exponent: float = Field(ge=-4, le=-1, allow_inf_nan=False)


class PlayerBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)

    @field_validator('first_name', 'last_name', mode='before')
    @classmethod
    def trim_name(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if any(ord(character) < 32 or ord(character) == 127 for character in value):
                raise ValueError('Names cannot contain control characters.')
        return value


class SessionBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    player_id: UUID | None = None


class ActivityBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    event_id: UUID
    kind: Literal['training_plan', 'epoch_review', 'weight_experiment', 'detective_answer']
    training_run_id: UUID | None = None
    goal: Literal['more_practice', 'step_size'] | None = None
    epoch: int | None = Field(default=None, ge=1, le=50, strict=True)
    response: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False, strict=True)
    weight: float | None = Field(default=None, ge=-3, le=3, allow_inf_nan=False, strict=True)
    question: Literal['robot_input', 'predict_bin', 'test_destination'] | None = None
    answer: Literal['pixel_values', 'item_name', 'bin_label', 'Recycling', 'Compost', 'Landfill', 'outside_bins'] | None = None
    item_index: int | None = Field(default=None, ge=0, le=29, strict=True)
    prediction_id: UUID | None = None

    @model_validator(mode='after')
    def valid_activity(self):
        allowed = {
            'training_plan': {'goal'},
            'epoch_review': {'epoch'},
            'weight_experiment': {'response', 'weight'},
            'detective_answer': {'question', 'answer'},
        }[self.kind]
        if self.kind == 'detective_answer':
            allowed |= {'prediction_id'} if self.question == 'test_destination' else {'item_index'}
            choices = {'robot_input': {'pixel_values', 'item_name', 'bin_label'},
                       'predict_bin': {'Recycling', 'Compost', 'Landfill'},
                       'test_destination': {'Recycling', 'Compost', 'Landfill', 'outside_bins'}}
            if not self.training_run_id or self.answer not in choices.get(self.question, set()):
                raise ValueError('Choose an answer for this investigation and include its training run.')
        values = {key: getattr(self, key) for key in (
            'goal', 'epoch', 'response', 'weight', 'question', 'answer', 'item_index', 'prediction_id')}
        if self.model_fields_set.intersection(values) - allowed:
            raise ValueError('This activity contains fields for a different activity.')
        if any(values[key] is None for key in allowed):
            raise ValueError('This activity is missing a required field.')
        return self


def summary(actions):
    streak = best = correct = missed = 0
    for action in sorted(actions, key=lambda a: a.order):
        if action.correct:
            correct += 1
            streak += 1
            best = max(best, streak)
        else:
            streak = 0
        missed += action.outcome == 'missed'
    return {'resolved': len(actions), 'correct': correct, 'wrong': len(actions) - correct - missed,
            'missed': missed, 'score': correct * 10, 'streak': streak, 'best_streak': best}


class SupersededTraining(Exception):
    """The server interrupted this run or accepted a newer one."""


def create_app(database_url=None):
    engine, Session = make_database(database_url)
    training_slot = threading.BoundedSemaphore(1)
    prediction_slots = threading.BoundedSemaphore(4)
    training_pool = prediction_pool = None

    @asynccontextmanager
    async def lifespan(_app):
        nonlocal training_pool, prediction_pool
        # Reuse two stable CNN threads rather than growing workspaces across HTTP workers.
        # Prediction has its own thread so another student's long training cannot block it.
        training_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='waiste-training')
        prediction_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='waiste-prediction')
        try:
            Base.metadata.create_all(engine)
            with Session.begin() as db:
                db.execute(update(Game).where(Game.training_status == 'running').values(
                    training_status='interrupted', training_error='Server restarted. Your game is saved; start training again.'))
                db.execute(update(TrainingRun).where(TrainingRun.status == 'running').values(status='interrupted'))
            yield
        finally:
            training_pool.shutdown(wait=True, cancel_futures=True)
            prediction_pool.shutdown(wait=True, cancel_futures=True)
            engine.dispose()

    app = FastAPI(title='Which wAIste API', lifespan=lifespan)
    app.state.Session = Session
    app.add_middleware(CORSMiddleware,
                       allow_origins=[os.environ.get('FRONTEND_ORIGIN', 'http://localhost:5173')],
                       allow_methods=['GET', 'POST'], allow_headers=['Content-Type'])

    def connection():
        with Session() as db:
            yield db

    def find_game(db, game_id, lock=False, load_weights=False):
        query = select(Game).where(Game.id == str(game_id))
        if load_weights:
            query = query.options(undefer(Game.model_weights))
        game = db.scalar(query.with_for_update() if lock else query)
        if game is None:
            raise HTTPException(404, 'Game not found.')
        return game

    def actions_for(db, game_id):
        return list(db.scalars(select(SortAction).where(SortAction.session_id == str(game_id)).order_by(SortAction.order)))

    def player_for(db, game_id):
        link = db.get(GamePlayer, str(game_id))
        return link.player_id if link else None

    def training_settings(db, run_id):
        settings = db.get(TrainingSettings, run_id) if run_id else None
        if settings:
            return {'training_mode': settings.training_mode,
                    'augmentations_per_item': settings.augmentations_per_item}
        # Historical runs used eight views; untrained games start in classroom mode.
        mode = 'full' if run_id else 'classroom'
        return {'training_mode': mode, 'augmentations_per_item': cnn.TRAINING_MODES[mode]}

    @app.get('/api/health')
    def health(db=Depends(connection)):
        db.execute(text('SELECT 1'))
        return {'status': 'ok', 'database': engine.dialect.name}

    @app.post('/api/players', status_code=201)
    def new_player(body: PlayerBody, db=Depends(connection)):
        player = Player(id=str(uuid4()), first_name=body.first_name, last_name=body.last_name)
        db.add(player)
        db.commit()
        return {'id': player.id}

    @app.post('/api/sessions', status_code=201)
    def new_game(body: SessionBody | None = None, db=Depends(connection)):
        player_id = str(body.player_id) if body and body.player_id else None
        if player_id and db.get(Player, player_id) is None:
            raise HTTPException(404, 'Player not found. Please enter your name again.')
        game = Game(id=str(uuid4()), seed=secrets.randbits(31), version=cnn.CURRENT_VERSION)
        db.add(game)
        if player_id:
            db.flush()
            db.add(GamePlayer(session_id=game.id, player_id=player_id))
        db.commit()
        return {'id': game.id, 'player_id': player_id,
                'items': cnn.public_items(game.seed, pixel_art=cnn.uses_pixel_art(game.version)), 'categories': cnn.CATEGORIES,
                'actions': [], 'summary': summary([]), 'training': {
                    'status': 'ready', 'history': [], 'learning_rate': float(game.learning_rate), 'run_id': None,
                    **training_settings(db, None)}}

    @app.get('/api/sessions/{game_id}')
    def get_game(game_id: UUID, db=Depends(connection)):
        game = find_game(db, game_id)
        actions = actions_for(db, game.id)
        return {'id': game.id, 'player_id': player_for(db, game.id),
                'items': cnn.public_items(game.seed, pixel_art=cnn.uses_pixel_art(game.version)), 'categories': cnn.CATEGORIES,
                'summary': summary(actions), 'actions': [
                    {'index': a.item_index, 'outcome': a.outcome, 'chosen_class': a.chosen_class,
                     'correct': a.correct, 'expected_class': a.expected_class} for a in actions],
                'detective_answers': detective_answers(db, game.id),
                'training': {'status': game.training_status, 'epochs': game.training_epochs,
                             **training_settings(db, game.training_run_id),
                             'learning_rate': float(game.learning_rate), 'run_id': game.training_run_id,
                             'history': game.history, 'probe': game.probe, 'results': game.results,
                             'error': game.training_error}}

    @app.post('/api/sessions/{game_id}/items/{index}')
    def record_action(game_id: UUID, index: int, body: ActionBody, db=Depends(connection)):
        if not 0 <= index < 30:
            raise HTTPException(404, 'Item not found.')
        game = find_game(db, game_id, lock=True)
        previous = db.get(SortAction, (game.id, index))
        if previous:
            if previous.outcome != body.outcome or previous.chosen_class != body.chosen_class:
                raise HTTPException(409, 'This item already has a different saved action.')
            return {'correct': previous.correct, 'expected_class': previous.expected_class,
                    'summary': summary(actions_for(db, game.id))}
        actions = actions_for(db, game.id)
        item = cnn.game_items(game.seed, pixel_art=cnn.uses_pixel_art(game.version))[index]
        action = SortAction(session_id=game.id, item_index=index, item_name=item.name,
                            expected_class=item.expected, chosen_class=body.chosen_class,
                            outcome=body.outcome, correct=body.chosen_class == item.expected,
                            order=len(actions), response_ms=body.response_ms, speed=body.speed)
        db.add(action)
        actions.append(action)
        if len(actions) == 30:
            game.completed_at = now()
        db.commit()
        return {'correct': action.correct, 'expected_class': item.expected, 'summary': summary(actions)}

    @app.get('/api/sessions/{game_id}/training')
    def training_status(game_id: UUID, db=Depends(connection)):
        game = find_game(db, game_id)
        return {'status': game.training_status, 'epochs': game.training_epochs, 'history': game.history,
                **training_settings(db, game.training_run_id),
                'learning_rate': float(game.learning_rate), 'run_id': game.training_run_id,
                'probe': game.probe, 'results': game.results, 'error': game.training_error}

    @app.post('/api/sessions/{game_id}/help', status_code=201)
    def record_help(game_id: UUID, body: HelpBody, db=Depends(connection)):
        game = find_game(db, game_id, lock=True)
        previous = db.get(HelpOpen, str(body.event_id))
        if previous and (previous.session_id != game.id or previous.topic != body.topic):
            raise HTTPException(409, 'Help event already exists.')
        if not previous:
            db.add(HelpOpen(id=str(body.event_id), session_id=game.id, topic=body.topic))
            db.commit()
        return {'saved': True}

    def detective_answers(db, game_id):
        return [{'event_id': entry.id, 'training_run_id': entry.training_run_id, **entry.data}
                for entry in db.scalars(select(ActivityEvent).where(
                    ActivityEvent.session_id == game_id, ActivityEvent.kind == 'detective_answer')
                    .order_by(ActivityEvent.created_at))]

    @app.post('/api/sessions/{game_id}/activity', status_code=201)
    def record_activity(game_id: UUID, body: ActivityBody, db=Depends(connection)):
        game = find_game(db, game_id, lock=True)
        run_id = str(body.training_run_id) if body.training_run_id else None
        if run_id:
            run = db.get(TrainingRun, run_id)
            if run is None or run.session_id != game.id:
                raise HTTPException(422, 'Training run does not belong to this game.')
            if body.kind == 'epoch_review' and body.epoch not in {
                    entry.get('epoch') for entry in run.history}:
                raise HTTPException(422, 'This training epoch is not available to review.')
        data = body.model_dump(mode='json', exclude={'event_id', 'kind', 'training_run_id'}, exclude_none=True)
        if body.kind == 'detective_answer':
            if run.status != 'done':
                raise HTTPException(422, 'Complete this training run before investigating it.')
            if body.question == 'test_destination':
                prediction = db.get(TryClick, str(body.prediction_id))
                if prediction is None or prediction.session_id != game.id or prediction.training_run_id != run_id:
                    raise HTTPException(422, 'This prediction does not belong to this game and training run.')
                robot_choice = cnn.CATEGORIES[prediction.predicted_class]
                destination = prediction.destination
                data.update(item_name=prediction.item_name, robot_choice=robot_choice,
                            destination=destination, matches_robot=body.answer == robot_choice,
                            follows_guideline=body.answer == (destination if destination in cnn.CATEGORIES else 'outside_bins'))
            else:
                predictions = (run.results or {}).get('predictions', [])
                if body.item_index >= len(predictions):
                    raise HTTPException(422, 'This test item is not available in this training run.')
                prediction = predictions[body.item_index]
                data['item_name'] = prediction['name']
                if body.question == 'robot_input':
                    data['concept_correct'] = body.answer == 'pixel_values'
                else:
                    probabilities = prediction['probabilities']
                    robot_choice = cnn.CATEGORIES[probabilities.index(max(probabilities))]
                    data.update(robot_choice=robot_choice, matches_robot=body.answer == robot_choice,
                                follows_guideline=body.answer == prediction['guideline'])
        previous = db.get(ActivityEvent, str(body.event_id))
        if previous and (previous.session_id != game.id or previous.training_run_id != run_id
                         or previous.kind != body.kind or previous.data != data):
            raise HTTPException(409, 'Activity event already exists with different data.')
        if not previous:
            db.add(ActivityEvent(id=str(body.event_id), session_id=game.id,
                                 training_run_id=run_id, kind=body.kind, data=data))
            db.commit()
        return {'saved': True}

    def active_training(db, game_id, run_id):
        return db.scalar(select(Game).where(
            Game.id == game_id, Game.training_run_id == run_id,
            Game.training_status == 'running').with_for_update())

    def save_training(db, game_id, run_id, **values):
        # Check at the write itself, including on SQLite where FOR UPDATE is ignored.
        active_run = select(TrainingRun.id).where(
            TrainingRun.id == run_id, TrainingRun.session_id == game_id,
            TrainingRun.status == 'running').exists()
        result = db.execute(update(Game).where(
            Game.id == game_id, Game.training_run_id == run_id,
            Game.training_status == 'running', active_run).values(**values)
            .execution_options(synchronize_session=False))
        return result.rowcount == 1

    def train_in_background(game_id, run_id, epochs, rate, training_mode):
        try:
            with Session() as db:
                game = active_training(db, game_id, run_id)
                if game is None:
                    return
                seed = game.seed
                pixel_art = cnn.uses_pixel_art(game.version)
                actions = actions_for(db, game_id)

            def emit(kind, payload):
                with Session.begin() as db:
                    game = active_training(db, game_id, run_id)
                    if game is None:
                        raise SupersededTraining()
                    values = {'probe': {key: payload[key] for key in ('probe_idx', 'viz', 'probs')}}
                    if kind == 'epoch':
                        values['history'] = [*game.history, {key: payload[key] for key in (
                            'epoch', 'train_loss', 'train_acc', 'val_loss', 'val_acc', 'lr')}]
                    if not save_training(db, game_id, run_id, **values):
                        raise SupersededTraining()
                    if kind == 'epoch':
                        db.execute(update(TrainingRun).where(
                            TrainingRun.id == run_id, TrainingRun.session_id == game_id,
                            TrainingRun.status == 'running').values(history=values['history']))

            results, weights = training_pool.submit(
                cnn.run_training, seed, actions, epochs, rate, emit, pixel_art=pixel_art,
                training_mode=training_mode).result()
            with Session.begin() as db:
                if save_training(db, game_id, run_id, results=results, model_weights=weights,
                                 training_status='done'):
                    db.execute(update(TrainingRun).where(
                        TrainingRun.id == run_id, TrainingRun.session_id == game_id,
                        TrainingRun.status == 'running').values(status='done', results=results, completed_at=now()))
        except SupersededTraining:
            # A replaced worker stops at its next callback instead of wasting classroom CPU.
            pass
        except Exception as exc:
            logging.exception('CNN training failed for session %s', game_id)
            with Session.begin() as db:
                message = str(exc) if isinstance(exc, ValueError) else 'Training failed. Your gameplay is saved; please retry.'
                if save_training(db, game_id, run_id, training_status='error', training_error=message):
                    db.execute(update(TrainingRun).where(
                        TrainingRun.id == run_id, TrainingRun.session_id == game_id,
                        TrainingRun.status == 'running').values(status='error', completed_at=now()))
        finally:
            training_slot.release()

    @app.post('/api/sessions/{game_id}/learning-rate', status_code=201)
    def record_learning_rate(game_id: UUID, body: LearningRateBody, db=Depends(connection)):
        game = find_game(db, game_id, lock=True)
        previous = db.get(LearningRateAdjustment, str(body.event_id))
        if previous and (previous.session_id != game.id or previous.exponent != body.exponent):
            raise HTTPException(409, 'Learning-rate event already exists.')
        if not previous:
            db.add(LearningRateAdjustment(id=str(body.event_id), session_id=game.id,
                                          exponent=body.exponent, value=10 ** body.exponent))
            db.commit()
        return {'saved': True}

    @app.post('/api/sessions/{game_id}/train', status_code=202)
    def start_training(game_id: UUID, body: TrainingBody, tasks: BackgroundTasks, db=Depends(connection)):
        game = find_game(db, game_id, lock=True)
        if game.training_status == 'running':
            raise HTTPException(409, 'This robot is already training.')
        actions = actions_for(db, game.id)
        if len(actions) != 30:
            raise HTTPException(409, 'Finish the sorting round first.')
        labels = [a.chosen_class for a in actions if a.outcome == 'sorted']
        splits = cnn.stratified_split(labels, random.Random(42))
        if not all(splits):
            raise HTTPException(422, 'Your robot needs more labeled examples. Play again so we can set aside validation and test items.')
        if not training_slot.acquire(blocking=False):
            raise HTTPException(429, 'Another robot is training. Your game is saved; try again shortly.')
        try:
            game.training_status, game.history, game.training_error = 'running', [], None
            # Old results remain in TrainingRun; polls should describe this run only.
            game.results, game.probe = None, None
            game.training_epochs, game.learning_rate = body.epochs, str(body.learning_rate)
            game.training_run_id = str(uuid4())
            db.add(TrainingRun(id=game.training_run_id, session_id=game.id,
                               epochs=body.epochs, learning_rate=str(body.learning_rate)))
            db.flush()
            db.add(TrainingSettings(training_run_id=game.training_run_id, training_mode=body.training_mode,
                                    augmentations_per_item=cnn.TRAINING_MODES[body.training_mode]))
            db.commit()
        except Exception:
            training_slot.release()
            raise
        tasks.add_task(train_in_background, game.id, game.training_run_id,
                       body.epochs, body.learning_rate, body.training_mode)
        return {'status': 'running'}

    @app.post('/api/sessions/{game_id}/try-item')
    def try_new_item(game_id: UUID, novel: bool = False, db=Depends(connection)):
        if not prediction_slots.acquire(blocking=False):
            raise HTTPException(429, 'The robot is busy testing other items. Please try again in a moment.',
                                headers={'Retry-After': '1'})
        try:
            game = find_game(db, game_id, load_weights=True)
            if game.training_status != 'done' or not game.model_weights:
                raise HTTPException(409, 'Train your robot first.')
            # Release the connection while waiting; retain the identity of this model for analytics.
            session_id, run_id = game.id, game.training_run_id
            weights, pixel_art = game.model_weights, cnn.uses_pixel_art(game.version)
            db.rollback()
            try:
                result = prediction_pool.submit(cnn.try_item, weights, novel, pixel_art=pixel_art).result()
            except Exception:
                logging.exception('CNN prediction failed for session %s', session_id)
                raise HTTPException(503, 'The robot could not test this item. Please try again.') from None
            predicted = result['probabilities'].index(max(result['probabilities']))
            expected = cnn.CATEGORIES.index(result['destination']) if result['has_valid_bin'] else None
            prediction_id = str(uuid4())
            db.add(TryClick(id=prediction_id, session_id=session_id, training_run_id=run_id,
                            kind='never_seen' if novel else 'familiar', item_name=result['name'],
                            predicted_class=predicted, confidence=result['probabilities'][predicted],
                            destination=result['destination'], correct=None if expected is None else predicted == expected))
            db.commit()
            return {**result, 'prediction_id': prediction_id, 'training_run_id': run_id}
        finally:
            prediction_slots.release()

    dist = Path(__file__).resolve().parents[1] / 'frontend' / 'dist'
    if (dist / 'assets').is_dir():
        app.mount('/assets', StaticFiles(directory=dist / 'assets'), name='assets')
    if (dist / 'fonts').is_dir():
        app.mount('/fonts', StaticFiles(directory=dist / 'fonts'), name='fonts')

    @app.get('/')
    def root():
        if (dist / 'index.html').is_file():
            return FileResponse(dist / 'index.html')
        return {'status': 'ok', 'frontend': 'Run Vite on http://localhost:5173', 'docs': '/docs'}

    @app.get('/favicon.svg')
    def favicon():
        path = dist / 'favicon.svg'
        if not path.is_file():
            raise HTTPException(404)
        return FileResponse(path)

    return app


app = create_app()
