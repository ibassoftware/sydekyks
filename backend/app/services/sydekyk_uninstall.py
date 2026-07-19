"""Teardown for a tenant uninstalling one Sydekyk.

Removes the tenant's CONFIG for that Sydekyk so a reinstall starts from scratch — settings, AI engine
(revoking the LiteLLM virtual key), gadget assignments, Hero access grants, reviewer assignment, and
the local usage cache. Operational and historical data is deliberately PRESERVED: findings, drafts,
proposals, signed contracts / e-sign envelopes, and mission audit history all survive an uninstall.
"""

import uuid

from sqlalchemy.orm import Session

from app.models.gadget_requirement import SydekykGadgetRequirement, TenantSydekykGadgetAssignment
from app.models.llm_provider import TenantSydekykLLMConfig, TenantSydekykUsageSnapshot
from app.models.review_assignment import ReviewAssignment
from app.models.sydekyk import Sydekyk
from app.models.user import User
from app.models.user_permission import UserSydekykPermission
from app.services import llm_provisioning
from app.sydekyks import collect_uninstall_functions


def purge_tenant_sydekyk_config(db: Session, *, tenant_id: uuid.UUID, sydekyk: Sydekyk) -> None:
    """Delete a (tenant, sydekyk) pair's configuration. The caller owns the commit."""
    sydekyk_id = sydekyk.id

    # AI engine — revoke the LiteLLM virtual key (and any BYOK model) before dropping the row, so we
    # don't orphan a live key. Never touches the shared Power Core registration.
    config = (
        db.query(TenantSydekykLLMConfig)
        .filter(TenantSydekykLLMConfig.tenant_id == tenant_id, TenantSydekykLLMConfig.sydekyk_id == sydekyk_id)
        .first()
    )
    if config is not None:
        llm_provisioning.revoke_tenant_config(config)
        db.delete(config)

    # Local usage cache (LiteLLM owns the real spend history).
    db.query(TenantSydekykUsageSnapshot).filter(
        TenantSydekykUsageSnapshot.tenant_id == tenant_id,
        TenantSydekykUsageSnapshot.sydekyk_id == sydekyk_id,
    ).delete(synchronize_session=False)

    # Hero access grants for this Sydekyk, scoped to this tenant's users.
    tenant_user_ids = [row[0] for row in db.query(User.id).filter(User.tenant_id == tenant_id).all()]
    if tenant_user_ids:
        db.query(UserSydekykPermission).filter(
            UserSydekykPermission.sydekyk_id == sydekyk_id,
            UserSydekykPermission.user_id.in_(tenant_user_ids),
        ).delete(synchronize_session=False)

    # Gadget assignments (which Gadget Link fills each requirement). The shared TenantGadgetLink stays.
    requirement_ids = [
        row[0]
        for row in db.query(SydekykGadgetRequirement.id)
        .filter(SydekykGadgetRequirement.sydekyk_id == sydekyk_id)
        .all()
    ]
    if requirement_ids:
        db.query(TenantSydekykGadgetAssignment).filter(
            TenantSydekykGadgetAssignment.tenant_id == tenant_id,
            TenantSydekykGadgetAssignment.requirement_id.in_(requirement_ids),
        ).delete(synchronize_session=False)

    # Reviewer assignment (also stops the review-assignee audit cron for this pair).
    db.query(ReviewAssignment).filter(
        ReviewAssignment.tenant_id == tenant_id, ReviewAssignment.sydekyk_id == sydekyk_id
    ).delete(synchronize_session=False)

    # The Sydekyk's own settings row, via its package teardown hook (if it defines one).
    hook = collect_uninstall_functions().get(sydekyk.slug)
    if hook is not None:
        hook(db, tenant_id)
