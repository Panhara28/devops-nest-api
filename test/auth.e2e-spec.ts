import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { buildMockPrisma, createTestApp, MockPrisma } from './helpers/create-test-app';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let mockPrisma: MockPrisma;
  let jwtService: JwtService;
  let hashedPassword: string;
  let validToken: string;

  const testUser = {
    id: 1,
    email: 'auth@test.com',
    name: 'Auth User',
    role: 'USER',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeAll(async () => {
    hashedPassword = await bcrypt.hash('password123', 10);
    mockPrisma = buildMockPrisma();
    app = await createTestApp(mockPrisma);
    jwtService = app.get(JwtService);
    validToken = jwtService.sign({ sub: testUser.id, email: testUser.email });
  });

  afterAll(() => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((q: Promise<unknown>[]) => Promise.all(q));
  });

  // ─── POST /auth/register ───────────────────────────────────────────────────

  describe('POST /api/v1/auth/register', () => {
    it('201 — creates account and returns token pair', async () => {
      mockPrisma.user.create.mockResolvedValue({ id: 2, email: 'new@test.com' });
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'new@test.com', name: 'New User', password: 'password123' });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ access_token: expect.any(String), token_type: 'Bearer' });
      expect(res.body.data.refresh_token).toHaveLength(64);
    });

    it('400 — rejects invalid email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email', name: 'X', password: 'pass123' });
      expect(res.status).toBe(400);
    });

    it('400 — rejects short password', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'a@b.com', name: 'X', password: '123' });
      expect(res.status).toBe(400);
    });

    it('400 — rejects extra fields (forbidNonWhitelisted)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'a@b.com', name: 'X', password: 'pass123', admin: true });
      expect(res.status).toBe(400);
    });

    it('409 — duplicate email', async () => {
      mockPrisma.user.create.mockRejectedValue({ code: 'P2002' });
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'dup@test.com', name: 'Dup', password: 'password123' });
      expect(res.status).toBe(409);
    });
  });

  // ─── POST /auth/login ─────────────────────────────────────────────────────

  describe('POST /api/v1/auth/login', () => {
    it('201 — returns token pair on valid credentials', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...testUser, password: hashedPassword });
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: 'password123' });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ access_token: expect.any(String), token_type: 'Bearer' });
    });

    it('401 — wrong password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...testUser, password: hashedPassword });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: 'wrongpassword' });

      expect(res.status).toBe(401);
    });

    it('401 — user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'ghost@test.com', password: 'password123' });

      expect(res.status).toBe(401);
    });

    it('401 — missing password (LocalStrategy rejects before DTO pipe)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'a@b.com' });
      expect(res.status).toBe(401);
    });
  });

  // ─── GET /auth/me ─────────────────────────────────────────────────────────

  describe('GET /api/v1/auth/me', () => {
    it('200 — returns profile for authenticated user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(testUser);

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: testUser.id, email: testUser.email });
    });

    it('401 — no token', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });

    it('401 — malformed token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not.a.valid.token');
      expect(res.status).toBe(401);
    });
  });

  // ─── POST /auth/refresh ───────────────────────────────────────────────────

  describe('POST /api/v1/auth/refresh', () => {
    it('201 — rotates refresh token and returns new pair', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 5,
        expiresAt: new Date(Date.now() + 86400000),
        user: { id: testUser.id, email: testUser.email },
      });
      mockPrisma.refreshToken.delete.mockResolvedValue({});
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: 'a'.repeat(64) });

      expect(res.status).toBe(201);
      expect(res.body.data.access_token).toBeDefined();
      expect(res.body.data.refresh_token).toBeDefined();
    });

    it('401 — invalid refresh token', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: 'bad-token' });
      expect(res.status).toBe(401);
    });

    it('400 — missing refresh_token field', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({});
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /auth/logout ────────────────────────────────────────────────────

  describe('POST /api/v1/auth/logout', () => {
    it('201 — deletes refresh token', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(testUser);
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ refresh_token: 'a'.repeat(64) });

      expect(res.status).toBe(201);
      expect(res.body.data.message).toContain('Logged out');
    });

    it('401 — missing JWT', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({ refresh_token: 'a'.repeat(64) });
      expect(res.status).toBe(401);
    });
  });

  // ─── POST /auth/forgot-password ───────────────────────────────────────────

  describe('POST /api/v1/auth/forgot-password', () => {
    it('201 — returns reset token when email exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(testUser);
      mockPrisma.passwordResetToken.deleteMany.mockResolvedValue({});
      mockPrisma.passwordResetToken.create.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: testUser.email });

      expect(res.status).toBe(201);
      expect(res.body.data.reset_token).toHaveLength(64);
    });

    it('201 — same message even when email does not exist (enumeration guard)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'ghost@test.com' });

      expect(res.status).toBe(201);
      expect(res.body.data.message).toBeDefined();
      expect(res.body.data.reset_token).toBeUndefined();
    });

    it('400 — invalid email format', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'not-email' });
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /auth/reset-password ────────────────────────────────────────────

  describe('POST /api/v1/auth/reset-password', () => {
    it('201 — resets password with valid token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 1,
        userId: testUser.id,
        used: false,
        expiresAt: new Date(Date.now() + 3600000),
      });
      mockPrisma.passwordResetToken.update.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: 'a'.repeat(64), password: 'newpassword123' });

      expect(res.status).toBe(201);
      expect(res.body.data.message).toContain('Password reset');
    });

    it('400 — invalid or expired token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: 'bad-token', password: 'newpassword123' });
      expect(res.status).toBe(400);
    });

    it('400 — short new password', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: 'tok', password: '123' });
      expect(res.status).toBe(400);
    });
  });

  // ─── PATCH /auth/change-password ──────────────────────────────────────────

  describe('PATCH /api/v1/auth/change-password', () => {
    it('200 — changes password and invalidates sessions', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...testUser,
        password: hashedPassword,
      });
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .patch('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ currentPassword: 'password123', newPassword: 'newpass456' });

      expect(res.status).toBe(200);
      expect(res.body.data.message).toContain('Password changed');
    });

    it('401 — wrong current password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...testUser,
        password: hashedPassword,
      });

      const res = await request(app.getHttpServer())
        .patch('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ currentPassword: 'wrongpassword', newPassword: 'newpass456' });

      expect(res.status).toBe(401);
    });

    it('401 — no JWT', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/auth/change-password')
        .send({ currentPassword: 'password123', newPassword: 'newpass456' });
      expect(res.status).toBe(401);
    });
  });
});
