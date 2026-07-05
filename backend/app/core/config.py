from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://sydekyks:sydekyks@localhost:5432/sydekyks"
    jwt_secret: str = "dev-secret-change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    admin_email: str = "rein@ibasuite.com"
    admin_password: str = "admin123"
    cors_origins: list[str] = ["http://localhost:5173"]
    encryption_key: str = "5fto_knqSHvZPLD6rRnVbetrEbhgHH24KoJpXBjjJYs="
    litellm_proxy_url: str = "http://localhost:4000"
    litellm_master_key: str = "sk-sydekyks-dev-master-key-change-me"
    # Inbound email (Postmark) — app-wide, proves "came from our configured webhook" (not per-tenant).
    email_webhook_basic_auth_user: str = "postmark"
    email_webhook_basic_auth_pass: str = "dev-inbound-webhook-secret-change-me"
    email_inbound_domain: str = "inbound.sydekyks.app"


settings = Settings()
