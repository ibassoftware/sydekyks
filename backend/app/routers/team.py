"""HQ team management (commander-only).

A commander can add users to their own HQ, set each user's role, and scope non-commander (hero)
users to specific Sydekyks via Use / Configure grants. All actions are tenant-scoped: a commander
only ever sees or touches users and Sydekyks belonging to their own HQ. Platform super_admins are
never listed or mutable here.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.deps import require_commander
from app.core.security import hash_password
from app.db.session import get_db
from app.models.sydekyk import Sydekyk, SydekykInstall
from app.models.user import User
from app.models.user_permission import UserSydekykPermission
from app.schemas.team import (
    TENANT_ROLES,
    SydekykPermissionOut,
    SydekykPermissionUpdate,
    TeamUserCreate,
    TeamUserOut,
    TeamUserRoleUpdate,
)

router = APIRouter(prefix="/api/tenant/team", tags=["team"], dependencies=[Depends(require_commander)])


def _to_user_out(u: User, current: User) -> TeamUserOut:
    return TeamUserOut(id=u.id, email=u.email, role=u.role, created_at=u.created_at, is_self=u.id == current.id)


def _get_tenant_user(db: Session, user_id: uuid.UUID, tenant_id: uuid.UUID) -> User:
    """Fetch a user that belongs to the commander's HQ, or 404. Never resolves platform admins."""
    target = db.get(User, user_id)
    if target is None or target.tenant_id != tenant_id or target.role == "super_admin":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return target


def _visible_sydekyks(db: Session, tenant_id: uuid.UUID) -> list[Sydekyk]:
    """Sydekyks this HQ can grant: published roster Sydekyks it has installed + its own exclusives."""
    installed_ids = {
        row[0] for row in db.query(SydekykInstall.sydekyk_id).filter(SydekykInstall.tenant_id == tenant_id).all()
    }
    sydekyks = (
        db.query(Sydekyk)
        .filter(
            Sydekyk.is_published.is_(True),
            or_(Sydekyk.tenant_id.is_(None), Sydekyk.tenant_id == tenant_id),
        )
        .order_by(Sydekyk.created_at.asc())
        .all()
    )
    return [s for s in sydekyks if s.is_exclusive or s.id in installed_ids]


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


@router.get("/users", response_model=list[TeamUserOut])
def list_users(user: User = Depends(require_commander), db: Session = Depends(get_db)):
    users = db.query(User).filter(User.tenant_id == user.tenant_id).order_by(User.created_at.asc()).all()
    return [_to_user_out(u, user) for u in users]


@router.post("/users", response_model=TeamUserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: TeamUserCreate, user: User = Depends(require_commander), db: Session = Depends(get_db)):
    if payload.role not in TENANT_ROLES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use")

    new_user = User(
        tenant_id=user.tenant_id,
        email=payload.email,
        hashed_password=hash_password(payload.password),
        role=payload.role,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return _to_user_out(new_user, user)


@router.patch("/users/{user_id}", response_model=TeamUserOut)
def update_user_role(
    user_id: uuid.UUID, payload: TeamUserRoleUpdate, user: User = Depends(require_commander), db: Session = Depends(get_db)
):
    if payload.role not in TENANT_ROLES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")
    target = _get_tenant_user(db, user_id, user.tenant_id)
    if target.id == user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You can't change your own role")

    # Never leave an HQ without a commander.
    if target.role == "commander" and payload.role != "commander" and _commander_count(db, user.tenant_id) <= 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="An HQ must keep at least one Commander")

    target.role = payload.role
    db.commit()
    db.refresh(target)
    return _to_user_out(target, user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: uuid.UUID, user: User = Depends(require_commander), db: Session = Depends(get_db)):
    target = _get_tenant_user(db, user_id, user.tenant_id)
    if target.id == user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You can't remove yourself")
    if target.role == "commander" and _commander_count(db, user.tenant_id) <= 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="An HQ must keep at least one Commander")
    db.delete(target)  # cascades to user_sydekyk_permissions
    db.commit()


def _commander_count(db: Session, tenant_id: uuid.UUID) -> int:
    return db.query(User).filter(User.tenant_id == tenant_id, User.role == "commander").count()


# ---------------------------------------------------------------------------
# Per-Sydekyk permissions
# ---------------------------------------------------------------------------


@router.get("/users/{user_id}/permissions", response_model=list[SydekykPermissionOut])
def get_user_permissions(user_id: uuid.UUID, user: User = Depends(require_commander), db: Session = Depends(get_db)):
    target = _get_tenant_user(db, user_id, user.tenant_id)
    is_commander_target = target.role == "commander"
    existing = {
        p.sydekyk_id: p
        for p in db.query(UserSydekykPermission).filter(UserSydekykPermission.user_id == target.id).all()
    }
    out = []
    for s in _visible_sydekyks(db, user.tenant_id):
        perm = existing.get(s.id)
        # A commander implicitly has full access to everything — reflect that in the read.
        out.append(
            SydekykPermissionOut(
                sydekyk_id=s.id,
                sydekyk_name=s.name,
                is_exclusive=s.is_exclusive,
                can_use=is_commander_target or bool(perm and perm.can_use),
                can_configure=is_commander_target or bool(perm and perm.can_configure),
            )
        )
    return out


@router.put("/users/{user_id}/permissions/{sydekyk_id}", response_model=SydekykPermissionOut)
def set_user_permission(
    user_id: uuid.UUID,
    sydekyk_id: uuid.UUID,
    payload: SydekykPermissionUpdate,
    user: User = Depends(require_commander),
    db: Session = Depends(get_db),
):
    target = _get_tenant_user(db, user_id, user.tenant_id)
    if target.role == "commander":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Commanders already have full access — per-Sydekyk grants apply to Heroes only",
        )

    sydekyk = next((s for s in _visible_sydekyks(db, user.tenant_id) if s.id == sydekyk_id), None)
    if sydekyk is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sydekyk not available to this HQ")

    # Configure implies Use — you can't meaningfully configure a Sydekyk you can't run.
    can_configure = payload.can_configure
    can_use = payload.can_use or can_configure

    perm = (
        db.query(UserSydekykPermission)
        .filter(UserSydekykPermission.user_id == target.id, UserSydekykPermission.sydekyk_id == sydekyk_id)
        .first()
    )
    if perm is None:
        perm = UserSydekykPermission(user_id=target.id, sydekyk_id=sydekyk_id)
        db.add(perm)
    perm.can_use = can_use
    perm.can_configure = can_configure
    db.commit()

    return SydekykPermissionOut(
        sydekyk_id=sydekyk.id, sydekyk_name=sydekyk.name, is_exclusive=sydekyk.is_exclusive,
        can_use=can_use, can_configure=can_configure,
    )
