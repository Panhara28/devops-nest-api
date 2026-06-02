# ── Stage 1: Install production dependencies ──────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: Build TypeScript ─────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# ── Stage 3: Production runtime ───────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser  -u 1001 -S appuser -G appgroup

# Runtime artifacts only
COPY --from=deps  /app/node_modules  ./node_modules
COPY --from=build /app/dist          ./dist
COPY --from=build /app/package.json  ./package.json
# Prisma schema + migrations needed for `prisma migrate deploy` at startup
COPY --from=build /app/prisma        ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1

ENTRYPOINT ["./entrypoint.sh"]
