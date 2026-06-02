---
name: docker-deploy
description: Docker deployment guide for this NestJS + Prisma + MySQL project. Covers building images, running containers, managing migrations, environment variables, and production checklist. Use when deploying, troubleshooting containers, or setting up CI/CD Docker workflows.
disable-model-invocation: false
---

# Docker Deployment — learn-devops-nest-api

## Project Docker Files

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage production build (deps → build → runtime) |
| `Dockerfile.dev` | Single-stage dev image with hot reload |
| `docker-compose.yml` | Production stack (API + MySQL 8) |
| `docker-compose.dev.yml` | Dev stack (API with volume mount + MySQL) |
| `entrypoint.sh` | Runs `prisma migrate deploy` before starting app |
| `.dockerignore` | Excludes node_modules, .env, .git, dist from build context |

---

## Quick Start

### Production

```bash
# 1. Create .env file with secrets (never commit this)
cp .env .env.production
# Edit .env.production with real values

# 2. Build and start
docker compose --env-file .env.production up -d --build

# 3. Check status
docker compose ps
docker compose logs api --follow
```

### Development (hot reload)

```bash
docker compose -f docker-compose.dev.yml up --build
```

---

## Environment Variables

Create a `.env.production` file (gitignored) with these values:

```env
# MySQL
MYSQL_ROOT_PASSWORD=strong-root-password
MYSQL_DATABASE=nest_api
MYSQL_USER=appuser
MYSQL_PASSWORD=strong-app-password

# App
JWT_SECRET=minimum-32-char-random-secret-here
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7
ALLOWED_ORIGINS=https://yourfrontend.com
PORT=3000
MYSQL_PORT=3306
```

**Rules:**
- `JWT_SECRET` must be at least 32 characters of random data: `openssl rand -hex 32`
- Never use the same secrets in `.env` (dev) and `.env.production`
- Never hardcode secrets in `docker-compose.yml` — always use env var substitution (`${VAR}`)

---

## Build & Run Commands

```bash
# Build production image only
docker build -t nest-api:latest .

# Build with specific tag
docker build -t nest-api:1.0.0 --target runtime .

# Run standalone (no compose)
docker run -d \
  -p 3000:3000 \
  -e DATABASE_URL="mysql://user:pass@host:3306/nest_api" \
  -e JWT_SECRET="your-secret" \
  --name nest-api \
  nest-api:latest

# Start/stop compose stack
docker compose up -d
docker compose down
docker compose down -v   # also removes volumes (DELETES DATA)
```

---

## Database & Migrations

Migrations run automatically via `entrypoint.sh` before the app starts:

```sh
npx prisma migrate deploy   # applies pending migrations
exec node dist/main.js       # starts the app
```

**Manual migration commands:**

```bash
# Run migrations manually in running container
docker compose exec api npx prisma migrate deploy

# Open Prisma Studio against the container DB
docker compose exec api npx prisma studio

# Access MySQL shell
docker compose exec db mysql -u root -p nest_api

# Seed the database
docker compose exec api npm run db:seed
```

**After a schema change:**
1. Create migration locally: `npm run db:migrate` (dev DB)
2. Commit the migration files: `prisma/migrations/`
3. Rebuild and redeploy — `entrypoint.sh` runs the new migration automatically

---

## Health Check

The app exposes `GET /api/v1/health` → `{ status: "ok", timestamp: "..." }`.

Docker polls this every 30s with a 5s timeout. Check health status:

```bash
docker compose ps           # shows "healthy" / "unhealthy"
docker inspect nest-api-api-1 | grep -A5 Health
```

---

## Logs & Debugging

```bash
# Stream app logs
docker compose logs api -f

# Stream all service logs
docker compose logs -f

# Execute command inside running container
docker compose exec api sh

# Check which port is mapped
docker compose port api 3000

# See image layers and sizes
docker history nest-api:latest --human
```

---

## Common Issues

| Problem | Cause | Fix |
|---|---|---|
| `api` exits immediately | DB not ready | `depends_on` with `condition: service_healthy` handles this; check MySQL healthcheck |
| `P1001: Can't reach database` | Wrong `DATABASE_URL` hostname | Use service name `db` not `localhost` inside compose |
| `prisma migrate deploy` fails | No migration files | Run `npm run db:migrate` locally first to create them |
| `EADDRINUSE` | Port already in use on host | Change `MYSQL_PORT` or `PORT` in `.env.production` |
| Image build fails on `prisma generate` | Missing schema | Ensure `prisma/schema.prisma` is not in `.dockerignore` |
| App starts but 401 on all routes | `JWT_SECRET` env var missing | Verify it's set in docker-compose environment section |
| `Permission denied` on `entrypoint.sh` | Missing execute bit | `chmod +x entrypoint.sh` and rebuild |

---

## Production Checklist

- [ ] `JWT_SECRET` is at least 32 random chars (`openssl rand -hex 32`)
- [ ] `.env.production` is gitignored — never committed
- [ ] `ALLOWED_ORIGINS` is set to your actual frontend domain
- [ ] MySQL port (`3307` default in dev) is **not** exposed publicly in prod — remove `ports` from `db` service
- [ ] `NODE_ENV=production` is set
- [ ] `MYSQL_ROOT_PASSWORD` is strong and different from dev
- [ ] Docker image is built from a specific commit/tag, not `latest`
- [ ] Health check shows `healthy` before accepting traffic
- [ ] Volumes are backed up (`mysql_data`)
- [ ] Log rotation configured (add `logging` to compose services)

---

## Expose MySQL Internally Only (Production)

In production, remove the host port mapping from the `db` service to prevent external access:

```yaml
# docker-compose.yml — remove this from db service in production:
ports:
  - "${MYSQL_PORT:-3306}:3306"   # DELETE THIS LINE in prod
```

The API container can still reach MySQL via the internal Docker network using hostname `db`.

---

## Multi-arch Build (CI/CD)

```bash
# Build for both amd64 (server) and arm64 (Apple Silicon dev)
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t registry.example.com/nest-api:1.0.0 \
  --push .
```
