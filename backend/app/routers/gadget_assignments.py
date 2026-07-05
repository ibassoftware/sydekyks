import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import require_commander, require_tenant_member
from app.db.session import get_db
from app.models.gadget import Gadget, TenantGadgetLink
from app.models.gadget_requirement import SydekykGadgetRequirement, TenantSydekykGadgetAssignment
from app.models.user import User
from app.schemas.gadget_requirement import EligibleLink, GadgetAssignmentUpdate, GadgetRequirementOut

router = APIRouter(prefix="/api/tenant", tags=["gadget-assignments"], dependencies=[Depends(require_tenant_member)])


@router.get("/sydekyks/{sydekyk_id}/gadget-requirements", response_model=list[GadgetRequirementOut])
def list_requirements(sydekyk_id: uuid.UUID, user: User = Depends(require_tenant_member), db: Session = Depends(get_db)):
    requirements = (
        db.query(SydekykGadgetRequirement)
        .filter(SydekykGadgetRequirement.sydekyk_id == sydekyk_id)
        .order_by(SydekykGadgetRequirement.created_at.asc())
        .all()
    )

    # Map category -> tenant's eligible links.
    links = (
        db.query(TenantGadgetLink, Gadget.category)
        .join(Gadget, Gadget.id == TenantGadgetLink.gadget_id)
        .filter(TenantGadgetLink.tenant_id == user.tenant_id)
        .all()
    )
    by_category: dict[str, list[EligibleLink]] = {}
    for link, category in links:
        by_category.setdefault(category, []).append(EligibleLink(id=link.id, name=link.name))

    assignments = {
        a.requirement_id: a.gadget_link_id
        for a in db.query(TenantSydekykGadgetAssignment).filter(
            TenantSydekykGadgetAssignment.tenant_id == user.tenant_id
        )
    }

    return [
        GadgetRequirementOut(
            requirement_id=req.id,
            role_key=req.role_key,
            label=req.label,
            gadget_category=req.gadget_category,
            is_required=req.is_required,
            eligible_links=by_category.get(req.gadget_category, []),
            assigned_link_id=assignments.get(req.id),
        )
        for req in requirements
    ]


@router.put("/sydekyks/{sydekyk_id}/gadget-requirements/{requirement_id}/assignment")
def set_assignment(
    sydekyk_id: uuid.UUID,
    requirement_id: uuid.UUID,
    payload: GadgetAssignmentUpdate,
    user: User = Depends(require_commander),
    db: Session = Depends(get_db),
):
    req = (
        db.query(SydekykGadgetRequirement)
        .filter(SydekykGadgetRequirement.id == requirement_id, SydekykGadgetRequirement.sydekyk_id == sydekyk_id)
        .first()
    )
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")

    link = (
        db.query(TenantGadgetLink, Gadget.category)
        .join(Gadget, Gadget.id == TenantGadgetLink.gadget_id)
        .filter(TenantGadgetLink.id == payload.gadget_link_id, TenantGadgetLink.tenant_id == user.tenant_id)
        .first()
    )
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gadget Link not found")
    if link[1] != req.gadget_category:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"That Gadget Link is a {link[1]} link, but this requirement needs a {req.gadget_category} link",
        )

    assignment = (
        db.query(TenantSydekykGadgetAssignment)
        .filter(
            TenantSydekykGadgetAssignment.tenant_id == user.tenant_id,
            TenantSydekykGadgetAssignment.requirement_id == requirement_id,
        )
        .first()
    )
    if assignment is None:
        assignment = TenantSydekykGadgetAssignment(
            tenant_id=user.tenant_id, requirement_id=requirement_id, gadget_link_id=payload.gadget_link_id
        )
        db.add(assignment)
    else:
        assignment.gadget_link_id = payload.gadget_link_id
    db.commit()
    return {"ok": True}


@router.delete(
    "/sydekyks/{sydekyk_id}/gadget-requirements/{requirement_id}/assignment", status_code=status.HTTP_204_NO_CONTENT
)
def clear_assignment(
    sydekyk_id: uuid.UUID,
    requirement_id: uuid.UUID,
    user: User = Depends(require_commander),
    db: Session = Depends(get_db),
):
    db.query(TenantSydekykGadgetAssignment).filter(
        TenantSydekykGadgetAssignment.tenant_id == user.tenant_id,
        TenantSydekykGadgetAssignment.requirement_id == requirement_id,
    ).delete()
    db.commit()
