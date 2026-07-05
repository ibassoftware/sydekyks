"""Idempotency helpers for migrations.

The baseline reproduces pre-Alembic tables via a name-filtered `create_all` against the *current*
models, so a fresh-DB `upgrade head` may already have columns/tables that a later additive migration
also declares. Guarding each add/create with an existence check makes every migration safe whether
it runs on a fresh DB (baseline built the object) or on a stamped, drifted demo DB (it did not).
"""

from alembic import op
from sqlalchemy import inspect


def _inspector():
    return inspect(op.get_bind())


def has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def has_column(table: str, column: str) -> bool:
    if not has_table(table):
        return False
    return column in {c["name"] for c in _inspector().get_columns(table)}


def has_index(table: str, index: str) -> bool:
    if not has_table(table):
        return False
    return index in {i["name"] for i in _inspector().get_indexes(table)}


def has_fk(table: str, fk_name: str) -> bool:
    if not has_table(table):
        return False
    return fk_name in {fk.get("name") for fk in _inspector().get_foreign_keys(table)}
