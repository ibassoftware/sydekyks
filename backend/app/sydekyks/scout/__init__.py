"""Scout Sydekyk — résumé scorer. Importing the package registers its playbook + SQLAlchemy
metadata and exposes `router` + `seed` for the generic discovery loop."""

from app.sydekyks.scout import models, playbook, tools  # noqa: F401 — import for registration side-effects
from app.sydekyks.scout.router import router  # noqa: F401 — collected by collect_routers()
from app.sydekyks.scout.seed import seed  # noqa: F401 — collected by collect_seed_functions()
