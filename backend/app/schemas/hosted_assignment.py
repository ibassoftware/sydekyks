import uuid

from pydantic import BaseModel, Field


class HostedAssignmentOut(BaseModel):
    sydekyk_id: uuid.UUID
    hosted_provider: str | None
    hosted_model: str | None


class HostedAssignmentUpdate(BaseModel):
    hosted_provider: str = Field(pattern="^(openai|anthropic|ollama_cloud)$")
    hosted_model: str = Field(min_length=1, max_length=150)


class HostedAssignmentTestResult(BaseModel):
    ok: bool
    message: str
