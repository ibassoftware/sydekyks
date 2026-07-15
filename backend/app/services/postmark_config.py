from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.crypto import decrypt_secret, encrypt_secret
from app.models.postmark import PostmarkConfig


def get_config(db: Session) -> PostmarkConfig:
    """Return the singleton Postmark config, lazily creating it (seeded from the env defaults) on
    first access so the Command Center always has a row to edit."""
    cfg = db.query(PostmarkConfig).first()
    if cfg is None:
        cfg = PostmarkConfig(
            inbound_domain=settings.email_inbound_domain,
            webhook_basic_auth_user=settings.email_webhook_basic_auth_user,
            encrypted_webhook_basic_auth_pass=encrypt_secret(settings.email_webhook_basic_auth_pass),
        )
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def get_inbound_domain(db: Session) -> str:
    return get_config(db).inbound_domain


def effective_credentials(cfg: PostmarkConfig) -> tuple[str, str]:
    """Webhook Basic Auth (user, pass) — the stored values, falling back to the env defaults for any
    field a legacy row left null."""
    user = cfg.webhook_basic_auth_user or settings.email_webhook_basic_auth_user
    pwd = (
        decrypt_secret(cfg.encrypted_webhook_basic_auth_pass)
        if cfg.encrypted_webhook_basic_auth_pass
        else settings.email_webhook_basic_auth_pass
    )
    return user, pwd


def get_webhook_credentials(db: Session) -> tuple[str, str]:
    return effective_credentials(get_config(db))
