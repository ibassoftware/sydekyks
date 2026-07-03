from app.core.config import settings
from app.core.security import hash_password
from app.db.session import Base, SessionLocal, engine
from app.models.user import User


def run():
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == settings.admin_email).first()
        if existing:
            print(f"Admin user already exists: {settings.admin_email}")
            return

        admin = User(
            tenant_id=None,
            email=settings.admin_email,
            hashed_password=hash_password(settings.admin_password),
            role="super_admin",
        )
        db.add(admin)
        db.commit()
        print(f"Created super_admin user: {settings.admin_email}")
    finally:
        db.close()


if __name__ == "__main__":
    run()
