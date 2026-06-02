# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

NestJS 11 + TypeScript, Prisma 7 (prisma-client-js), MySQL via `@prisma/adapter-mariadb`, JWT + Passport auth, class-validator.

## Commands

```bash
npm run start:dev      # dev server with watch
npm run build          # compile TypeScript
npm run lint           # ESLint --fix
npm run format         # Prettier --write src/**/*.ts

npm run db:migrate     # prisma migrate dev (creates migration + applies)
npm run db:push        # prisma db push (no migration file, dev-only)
npm run db:seed        # ts-node prisma/seed.ts
npm run db:generate    # prisma generate (after schema changes)
npm run db:studio      # Prisma Studio UI

npm run test           # unit tests (src/**/*.spec.ts)
npm run test:e2e       # e2e tests (test/**/*.e2e-spec.ts)
npm run test:cov       # with coverage
```

Run a single test file: `npm run test -- src/users/users.service.spec.ts`

## Environment Variables

Required in `.env` (gitignored):

```
DATABASE_URL="mysql://user:pass@localhost:3306/nest_api"
JWT_SECRET="change-in-production"
JWT_EXPIRES_IN="7d"
PORT=3000
NODE_ENV=development
```

## Prisma 7 Adapter Pattern

Prisma 7 does **not** auto-read `DATABASE_URL` at runtime and does not support `url = env("DATABASE_URL")` in `prisma/schema.prisma`. The connection URL must be passed explicitly via the `@prisma/adapter-mariadb` adapter:

```ts
// src/prisma/prisma.service.ts
constructor() {
  const adapter = new PrismaMariaDb(process.env.DATABASE_URL!);
  super({ adapter });
}
```

`prisma.config.ts` holds the URL only for CLI commands (migrations, studio). Do not use `@prisma/adapter-mysql2` — it does not exist; use `@prisma/adapter-mariadb` for MySQL.

After any schema change: run `npm run db:generate`, then `npm run db:migrate`.

## Architecture

- **Global prefix:** `/api/v1` — all endpoints start with this.
- **Response shape:** every endpoint returns `{ success: true, data: ..., timestamp: "..." }` via `TransformInterceptor`. Error responses return `{ statusCode, timestamp, path, message }`.
- **Validation:** `ValidationPipe` is global with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`. DTOs must use `class-validator` decorators; unknown properties are rejected with 400.
- **Rate limiting:** 100 requests per 60 seconds globally via `@nestjs/throttler`.
- **Auth:** JWT Bearer token. Use `@UseGuards(JwtAuthGuard)` for protected routes. Use `@Roles(Role.ADMIN)` + `@UseGuards(JwtAuthGuard, RolesGuard)` for admin-only routes. Use `@CurrentUser()` param decorator to get the authenticated user.
- **PrismaModule** is `@Global()` — do not import it in feature modules; `PrismaService` is available everywhere.

## Code Style

Prettier: single quotes, trailing commas everywhere.

ESLint: `@typescript-eslint/no-explicit-any` is OFF — `any` is permitted. Float promises and unsafe arguments produce warnings, not errors.

TypeScript: `noImplicitAny` is disabled; `strictNullChecks` is enabled.
