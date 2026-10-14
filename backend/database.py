"""Durable anonymous game records. SQLite locally, PostgreSQL on Render."""
import os
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import (JSON, BigInteger, DateTime, ForeignKey, Integer, LargeBinary,
                        String, Text, create_engine)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def now():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Game(Base):
    __tablename__ = 'game_sessions'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    seed: Mapped[int] = mapped_column(BigInteger)
    version: Mapped[str] = mapped_column(String(40), default='lava-web-v1')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    training_status: Mapped[str] = mapped_column(String(20), default='ready')
    training_epochs: Mapped[int] = mapped_column(Integer, default=3)
    learning_rate: Mapped[str] = mapped_column(String(20), default='0.001')
    history: Mapped[list] = mapped_column(JSON, default=list)
    probe: Mapped[dict | None] = mapped_column(JSON)
    results: Mapped[dict | None] = mapped_column(JSON)
    model_weights: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)
    training_error: Mapped[str | None] = mapped_column(Text)
    training_run_id: Mapped[str | None] = mapped_column(String(36))


class TrainingRun(Base):
    __tablename__ = 'training_runs'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey('game_sessions.id', ondelete='CASCADE'), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default='running')
    epochs: Mapped[int] = mapped_column(Integer)
    learning_rate: Mapped[str] = mapped_column(String(20))
    history: Mapped[list] = mapped_column(JSON, default=list)
    results: Mapped[dict | None] = mapped_column(JSON)


class SortAction(Base):
    __tablename__ = 'sort_actions'
    session_id: Mapped[str] = mapped_column(ForeignKey('game_sessions.id', ondelete='CASCADE'), primary_key=True)
    item_index: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_name: Mapped[str] = mapped_column(String(80))
    expected_class: Mapped[int] = mapped_column(Integer)
    chosen_class: Mapped[int | None] = mapped_column(Integer)
    outcome: Mapped[str] = mapped_column(String(12))
    correct: Mapped[bool]
    order: Mapped[int] = mapped_column(Integer)
    response_ms: Mapped[int] = mapped_column(Integer)
    speed: Mapped[str] = mapped_column(String(10))
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class HelpOpen(Base):
    __tablename__ = 'help_events'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey('game_sessions.id', ondelete='CASCADE'), index=True)
    topic: Mapped[str] = mapped_column(String(60))
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


def make_database(url=None):
    url = url or os.environ.get('DATABASE_URL')
    if not url:
        if os.environ.get('APP_ENV') == 'production':
            raise RuntimeError('Set DATABASE_URL to a persistent PostgreSQL database in production.')
        folder = Path(__file__).resolve().parents[1] / '.data'
        folder.mkdir(exist_ok=True)
        url = f'sqlite:///{(folder / "waiste.db").as_posix()}'
    if url.startswith(('postgres://', 'postgresql://')):
        url = 'postgresql+psycopg://' + url.split('://', 1)[1]
    engine = create_engine(url, pool_pre_ping=True, **(
        {'connect_args': {'check_same_thread': False, 'timeout': 30}} if url.startswith('sqlite') else {}))
    return engine, sessionmaker(engine, expire_on_commit=False)
