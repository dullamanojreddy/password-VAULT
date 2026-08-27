from __future__ import annotations

import os
from collections.abc import Generator

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from models import PolicySettings


DEFAULT_DATABASE_URL = "sqlite:///./aegis.db"


def _create_engine(database_url: str):
    kwargs = {}
    if database_url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    if database_url in {"sqlite://", "sqlite:///:memory:"}:
        kwargs["poolclass"] = StaticPool
    return create_engine(database_url, **kwargs)


engine = _create_engine(os.getenv("AEGIS_DATABASE_URL", DEFAULT_DATABASE_URL))


def configure_database(database_url: str) -> None:
    global engine
    engine.dispose()
    engine = _create_engine(database_url)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        policy = session.exec(select(PolicySettings).where(PolicySettings.id == 1)).first()
        if policy is None:
            session.add(PolicySettings(id=1))
            session.commit()


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


def get_engine():
    return engine
