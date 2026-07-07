"""Per-Sydekyk access checks for tenant users.

A commander is unconstrained (full access to every Sydekyk in their HQ). A hero is scoped by
`UserSydekykPermission` rows — no row means no access. Two grant flags:
  - can_use       → run the Sydekyk (upload/trigger work, retry its missions)
  - can_configure → change its settings/engine/gadget assignments

Routers call `assert_can_use` / `assert_can_configure`; both raise 403 on denial.
"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.user_permission import UserSydekykPermission


def is_commander(user: User) -> bool:
    return user.role == "commander"


def _perm(db: Session, user_id: uuid.UUID, sydekyk_id: uuid.UUID) -> UserSydekykPermission | None:
    return (
        db.query(UserSydekykPermission)
        .filter(UserSydekykPermission.user_id == user_id, UserSydekykPermission.sydekyk_id == sydekyk_id)
        .first()
    )


def can_use(db: Session, user: User, sydekyk_id: uuid.UUID) -> bool:
    if is_commander(user):
        return True
    perm = _perm(db, user.id, sydekyk_id)
    return bool(perm and perm.can_use)


def can_configure(db: Session, user: User, sydekyk_id: uuid.UUID) -> bool:
    if is_commander(user):
        return True
    perm = _perm(db, user.id, sydekyk_id)
    return bool(perm and perm.can_configure)


def assert_can_use(db: Session, user: User, sydekyk_id: uuid.UUID) -> None:
    if not can_use(db, user, sydekyk_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to use this Sydekyk. Ask your Commander to grant it.",
        )


def assert_can_configure(db: Session, user: User, sydekyk_id: uuid.UUID) -> None:
    if not can_configure(db, user, sydekyk_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to configure this Sydekyk. Ask your Commander to grant it.",
        )
