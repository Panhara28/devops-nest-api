---
name: nestjs-security
description: NestJS security best practices from official documentation covering authentication, authorization, encryption/hashing, Helmet, CORS, CSRF, and rate limiting. Use when implementing or reviewing any security-related code in a NestJS application.
---

# NestJS Security — Official Documentation Reference

Sources: https://docs.nestjs.com/security/authentication | authorization | encryption-and-hashing | helmet | cors | csrf | rate-limiting

---

## 1. Authentication (Passport + JWT)

### Install
```bash
npm install @nestjs/passport passport passport-local passport-jwt
npm install @nestjs/jwt
npm install -D @types/passport-local @types/passport-jwt
```

### Local Strategy (username/password)
```typescript
import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({ usernameField: 'email' }); // override default 'username'
  }

  async validate(email: string, password: string): Promise<any> {
    const user = await this.authService.validateUser(email, password);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
```

### JWT Strategy
```typescript
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: number; email: string }) {
    return { id: payload.sub, email: payload.email };
  }
}
```

### AuthModule
```typescript
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  providers: [AuthService, LocalStrategy, JwtStrategy],
})
export class AuthModule {}
```

### Guards
```typescript
// Extend built-in guards — do NOT reimplement from scratch
@Injectable() export class LocalAuthGuard extends AuthGuard('local') {}
@Injectable() export class JwtAuthGuard extends AuthGuard('jwt') {}
```

### Login endpoint pattern
```typescript
@UseGuards(LocalAuthGuard)
@Post('auth/login')
async login(@Request() req) {
  return this.authService.login(req.user);
}

// In AuthService
login(user: any) {
  const payload = { sub: user.id, email: user.email };
  return { access_token: this.jwtService.sign(payload) };
}
```

### Key rules
- Always validate the user exists in `JwtStrategy.validate()` — the token being valid doesn't mean the user still exists.
- Never store sensitive data in JWT payload — it is base64-encoded, not encrypted.
- Use `ignoreExpiration: false` (the default) — never set it to `true` in production.
- Prefer `registerAsync` with `ConfigService` over hardcoding secrets.

---

## 2. Authorization (RBAC + Claims-based)

### Basic RBAC with Reflector
```typescript
// roles.decorator.ts
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

// roles.guard.ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;
    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.some((role) => user.roles?.includes(role));
  }
}
```

### Usage
```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Get('admin')
getAdminData() {}
```

### Claims-based authorization
```typescript
// policy.decorator.ts
export const CHECK_POLICIES_KEY = 'check_policy';
export const CheckPolicies = (...handlers: PolicyHandler[]) =>
  SetMetadata(CHECK_POLICIES_KEY, handlers);

// Use a CaslAbilityFactory to define permissions per user
// Check abilities in a PoliciesGuard using the same Reflector pattern
```

### Key rules
- Use `getAllAndOverride` (not `getAllAndMerge`) for roles — the most specific decorator wins.
- Always apply `JwtAuthGuard` before `RolesGuard` — the user must be authenticated first.
- Register `RolesGuard` globally only when all routes are protected; otherwise apply per-controller.
- For fine-grained control (ownership checks, resource policies), use CASL with an `AbilityFactory`.

---

## 3. Encryption and Hashing

### Hashing passwords (bcrypt)
```bash
npm install bcrypt
npm install -D @types/bcrypt
```

```typescript
import * as bcrypt from 'bcrypt';

// Hash
const saltRounds = 10;
const hash = await bcrypt.hash(plainTextPassword, saltRounds);

// Verify
const isMatch = await bcrypt.compare(plainTextPassword, hash);
```

### Symmetric encryption (AES via Node crypto)
```typescript
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const iv = randomBytes(16);
const password = 'your-secret-password';
const salt = randomBytes(16);
const key = (await promisify(scrypt)(password, salt, 32)) as Buffer;

// Encrypt
const cipher = createCipheriv('aes-256-ctr', key, iv);
const encryptedText = Buffer.concat([cipher.update(textToEncrypt), cipher.final()]);

// Decrypt
const decipher = createDecipheriv('aes-256-ctr', key, iv);
const decryptedText = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
```

### Key rules
- Use `bcrypt` for passwords — never MD5, SHA1, or unsalted SHA256.
- `saltRounds: 10` is the recommended minimum; increase for higher security (at cost of CPU).
- Never store plain-text passwords or reversibly encrypted passwords.
- Use `randomBytes(16)` for IVs — never reuse the same IV with the same key.
- Store the IV alongside the ciphertext (it is not secret, just must be unique).
- Use `scrypt` or `pbkdf2` to derive keys from passwords, not raw password strings.

---

## 4. Helmet (HTTP Security Headers)

### Install
```bash
npm install helmet
```

### Setup — must be registered BEFORE other middleware
```typescript
// main.ts
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet()); // add early, before routes
  await app.listen(3000);
}
```

### Fastify (different import)
```typescript
import { fastifyHelmet } from '@fastify/helmet';
await app.register(fastifyHelmet);
```

### What Helmet sets by default
- `Content-Security-Policy`
- `X-DNS-Prefetch-Control`
- `X-Frame-Options` (clickjacking)
- `Strict-Transport-Security` (HSTS)
- `X-Download-Options`
- `X-Content-Type-Options` (MIME sniffing)
- `X-Permitted-Cross-Domain-Policies`
- `Referrer-Policy`
- Removes `X-Powered-By`

### Key rules
- Always add Helmet in production — it is a one-line defence against common header-based attacks.
- Register `app.use(helmet())` **before** `app.useGlobalInterceptors()` and route handlers.
- If using a CDN or reverse proxy that sets its own CSP, configure `contentSecurityPolicy: false` or customize the policy.
- For Fastify, use `@fastify/helmet` — the Express `helmet` package is not compatible.

---

## 5. CORS (Cross-Origin Resource Sharing)

### Simple enable (all origins)
```typescript
// main.ts
app.enableCors();
```

### Production configuration
```typescript
app.enableCors({
  origin: ['https://yourfrontend.com', 'https://staging.yourfrontend.com'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,         // required if using cookies or Authorization header
  maxAge: 86400,             // preflight cache in seconds (1 day)
});
```

### Dynamic origin validation
```typescript
app.enableCors({
  origin: (origin, callback) => {
    const whitelist = ['https://app.example.com'];
    if (!origin || whitelist.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
});
```

### Via AppModule (alternative)
```typescript
@Module({})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(cors({ origin: 'https://example.com' })).forRoutes('*');
  }
}
```

### Key rules
- Never use `origin: '*'` with `credentials: true` — browsers block this combination.
- In production, always whitelist specific origins — do not use wildcard.
- Set `maxAge` to reduce preflight requests on high-traffic APIs.
- `credentials: true` is required when the frontend sends cookies or Authorization headers.

---

## 6. CSRF Protection

### When needed
CSRF protection is required for **cookie-based sessions**. If using JWT in Authorization headers only, CSRF is not needed — browsers do not auto-attach Authorization headers cross-origin.

### Install (Express)
```bash
npm install csurf
npm install -D @types/csurf
```

### Setup with cookie-parser
```typescript
import * as cookieParser from 'cookie-parser';
import * as csurf from 'csurf';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.use(csurf({ cookie: true }));
  await app.listen(3000);
}
```

### Expose token to frontend
```typescript
@Get('csrf-token')
getCsrfToken(@Request() req) {
  return { csrfToken: req.csrfToken() };
}
```

### Frontend usage
```typescript
// Include in every state-changing request header
headers: { 'X-CSRF-Token': csrfToken }
```

### Key rules
- `csurf` is deprecated — for new projects, use `csrf-csrf` or `helmet`'s CSP instead.
- CSRF is only necessary when the API uses cookie-based sessions, not stateless JWT.
- Always combine with `SameSite=Strict` or `SameSite=Lax` cookies as the first line of defence.
- Never expose CSRF tokens in URLs or logs.

---

## 7. Rate Limiting (@nestjs/throttler)

### Install
```bash
npm install @nestjs/throttler
```

### Global setup
```typescript
// app.module.ts
@Module({
  imports: [
    ThrottlerModule.forRoot([{
      ttl: 60000,   // window in milliseconds
      limit: 100,   // max requests per window
    }]),
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard }, // apply globally
  ],
})
export class AppModule {}
```

### Per-route override
```typescript
@Throttle({ default: { ttl: 60000, limit: 5 } })
@Post('auth/login')
login() {}

// Skip throttling for a specific route
@SkipThrottle()
@Get('health')
healthCheck() {}
```

### Multiple named throttlers (e.g., short + long windows)
```typescript
ThrottlerModule.forRoot([
  { name: 'short', ttl: 1000,  limit: 3   },
  { name: 'long',  ttl: 60000, limit: 100 },
])

// Override one named throttler per route
@Throttle({ short: { ttl: 1000, limit: 1 } })
@Post('auth/login')
login() {}
```

### Custom storage (Redis for multi-instance)
```bash
npm install @nest-lab/throttler-storage-redis ioredis
```

```typescript
ThrottlerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    throttlers: [{ ttl: 60000, limit: 100 }],
    storage: new ThrottlerStorageRedisService(config.get('REDIS_URL')),
  }),
}),
```

### Key rules
- Always apply tighter limits on auth endpoints (`/login`, `/register`, `/forgot-password`).
- Use Redis storage in multi-instance/cluster deployments — in-memory storage is per-process.
- `@SkipThrottle()` is appropriate for health checks and internal monitoring endpoints.
- Return `429 Too Many Requests` — NestJS ThrottlerGuard does this automatically.
- `ttl` in v5+ is in **milliseconds** (not seconds like in v4 and below).

---

## Security Checklist for this project

- [ ] `app.use(helmet())` added in `main.ts` before routes
- [ ] CORS configured with explicit origin whitelist (not `*`)
- [ ] Rate limiting tighter on `POST /api/v1/auth/login`
- [ ] Passwords hashed with `bcrypt` (saltRounds ≥ 10)
- [ ] JWT secret loaded from env via `ConfigService`, not hardcoded
- [ ] `ignoreExpiration: false` in `JwtStrategy`
- [ ] `JwtStrategy.validate()` re-fetches user from DB to confirm existence
- [ ] Redis throttler storage configured for production multi-instance deployments
- [ ] CSRF not needed (project uses JWT Bearer, not cookie sessions)
