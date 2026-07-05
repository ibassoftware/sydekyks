"""The single boundary for Mission document bytes.

Every read/write of `MissionDocument.content` MUST go through this module. That keeps the eventual
migration to S3-compatible object storage a one-file change: add a new backend branch here and set
`storage_backend`/`storage_key` accordingly — no call sites elsewhere touch `.content` directly.

Today the only backend is `postgres_bytea` (bytes live in the `mission_documents.content` column).
The `MissionDocument` model already reserves `storage_backend` and `storage_key` for the S3 move.
"""

from app.models.mission import MissionDocument

POSTGRES_BYTEA = "postgres_bytea"


def write_content(document: MissionDocument, content: bytes) -> MissionDocument:
    """Persist bytes for a (not-yet-committed or existing) MissionDocument via its backend.
    Caller is responsible for adding/committing the ORM object."""
    document.storage_backend = POSTGRES_BYTEA
    document.content = content
    return document


def read_content(document: MissionDocument | None) -> bytes | None:
    """Return the document's bytes regardless of backend, or None if absent."""
    if document is None:
        return None
    if document.storage_backend == POSTGRES_BYTEA:
        return document.content
    raise ValueError(f"Unsupported document storage backend: {document.storage_backend!r}")
