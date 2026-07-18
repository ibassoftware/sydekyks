"""Nudge Sydekyk - sales follow-up agent. Importing the package registers its playbook + SQLAlchemy
metadata and exposes `router` + `seed` for the generic discovery loop (app/sydekyks/__init__.py)."""

from app.sydekyks.nudge import models, playbook  # noqa: F401 - import for registration side-effects
from app.sydekyks.nudge.router import router  # noqa: F401 - collected by collect_routers()
from app.sydekyks.nudge.seed import seed  # noqa: F401 - collected by collect_seed_functions()
