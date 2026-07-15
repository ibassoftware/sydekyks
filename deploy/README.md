# Sydekyks — Production Deployment Runbook

Single-host Docker deployment. **Traefik** terminates TLS on 80/443 (auto Let's Encrypt certs);
everything else runs on an internal network. All state lives in **named volumes**, so updates never
lose data.

Stack: `traefik` · `frontend` (nginx static) · `backend` (FastAPI) · `worker` (arq) · `postgres`
(pgvector) · `redis` · `litellm-proxy` + `litellm-postgres`.

---

## ⚠️ Read first — capacity

This server has **1.9 GB RAM** and was already swapping ~3.4 GB running only the old Meteor app.
This full stack is being deployed onto it by explicit choice; expect heavy swap use and possible
OOM instability. Mitigations if it gets unstable: bump the VPS RAM (recommended ≥4 GB), or drop
`litellm-proxy` + `litellm-postgres` and point `LITELLM_PROXY_URL` at a hosted endpoint.

Because RAM is tight, **stop the old Meteor stack before building** (build needs ~1 GB):

```bash
docker stop app mongodb      # frees port 80 + ~1 GB RAM. Does NOT delete them (rollback-safe).
```

The old app's data was already backed up to `deploy_meteor_app_mongo_backup.archive.gz` (kept off-server).

---

## Prerequisites

1. **DNS** — an A record for `APP_DOMAIN` (e.g. `app.sydekyks.ai`) pointing at this server's public
   IP. Let's Encrypt's HTTP-01 challenge needs this resolvable and port 80 reachable.
2. **Ports 80 and 443 free** — stop the old Meteor container (above); it holds port 80.
3. **Docker + Compose v2** — already present (`docker compose version`).

## First deploy

```bash
# 1. Get the code onto the server
git clone https://github.com/ibassoftware/sydekyks.git /opt/sydekyks
cd /opt/sydekyks
git checkout feat/postmark        # or main once merged

# 2. Configure secrets
cp .env.prod.example .env
#    Edit .env — set APP_DOMAIN, ACME_EMAIL, and generate every secret.
#    Generate the Fernet key (keep it STABLE forever):
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# 3. Free port 80 + RAM, then build & start
docker stop app mongodb
docker compose -f docker-compose.prod.yml up -d --build

# 4. Watch it come up (first run pulls images + gets certs — give it a minute)
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f traefik backend
```

Migrations run automatically on the `backend` container's start (`alembic upgrade head`). The
bootstrap super-admin is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

Then in the app: **Command Center → Inbound Email (Postmark)** to set the domain/token and copy the
webhook URL into Postmark.

## Updating (no data loss)

```bash
cd /opt/sydekyks
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Named volumes (`postgres_data`, `redis_data`, `litellm_postgres_data`, `traefik_letsencrypt`)
persist across rebuilds; migrations re-run idempotently. Zero manual DB steps.

## Backups

All app data is in Postgres (documents are stored as `bytea`, not on disk), so a single `pg_dump`
is a complete backup:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U sydekyks sydekyks | gzip > sydekyks-$(date +%F).sql.gz
```

Recommended: a daily cron of the above, copied off-box.

## Rollback

- **App update gone wrong:** `git checkout <previous-sha> && docker compose -f docker-compose.prod.yml up -d --build`.
- **Back to the old Meteor site:** `docker compose -f docker-compose.prod.yml down` then
  `docker start app mongodb` (both were only stopped, never removed).

## Notes

- Only `traefik` publishes host ports (80/443). Postgres/Redis/LiteLLM are internal-only — not
  reachable from the internet.
- `backend` runs uvicorn with `--proxy-headers` so the Postmark webhook URL shown in the Command
  Center resolves to `https://APP_DOMAIN/...` rather than the internal address.
- After go-live, **rotate the server's root password and switch SSH to key-only auth** — the
  password was shared in plaintext during setup.
