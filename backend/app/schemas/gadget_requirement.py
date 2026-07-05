import uuid

from pydantic import BaseModel


class EligibleLink(BaseModel):
    id: uuid.UUID
    name: str


class GadgetRequirementOut(BaseModel):
    requirement_id: uuid.UUID
    role_key: str
    label: str
    gadget_category: str
    is_required: bool
    eligible_links: list[EligibleLink]
    assigned_link_id: uuid.UUID | None


class GadgetAssignmentUpdate(BaseModel):
    gadget_link_id: uuid.UUID
