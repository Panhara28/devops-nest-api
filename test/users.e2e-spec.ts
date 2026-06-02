import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { buildMockPrisma, createTestApp, MockPrisma } from './helpers/create-test-app';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let mockPrisma: MockPrisma;
  let userToken: string;
  let adminToken: string;

  const regularUser = { id: 1, email: 'user@test.com', name: 'Regular', role: 'USER', createdAt: new Date(), updatedAt: new Date() };
  const adminUser   = { id: 2, email: 'admin@test.com', name: 'Admin',   role: 'ADMIN', createdAt: new Date(), updatedAt: new Date() };

  beforeAll(async () => {
    mockPrisma = buildMockPrisma();
    app = await createTestApp(mockPrisma);
    const jwtService = app.get(JwtService);
    userToken  = jwtService.sign({ sub: regularUser.id, email: regularUser.email });
    adminToken = jwtService.sign({ sub: adminUser.id,   email: adminUser.email });
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  // ─── POST /users ──────────────────────────────────────────────────────────

  describe('POST /api/v1/users', () => {
    it('201 — creates user (public endpoint)', async () => {
      mockPrisma.user.create.mockResolvedValue(regularUser);

      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .send({ email: 'user@test.com', name: 'Regular', password: 'password123' });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ email: 'user@test.com' });
      expect(res.body.data).not.toHaveProperty('password');
    });

    it('400 — missing name', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .send({ email: 'a@b.com', password: 'pass123' });
      expect(res.status).toBe(400);
    });

    it('409 — duplicate email', async () => {
      mockPrisma.user.create.mockRejectedValue({ code: 'P2002' });
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .send({ email: 'dup@test.com', name: 'Dup', password: 'pass123' });
      expect(res.status).toBe(409);
    });
  });

  // ─── GET /users ───────────────────────────────────────────────────────────

  describe('GET /api/v1/users', () => {
    it('401 — no token', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/users');
      expect(res.status).toBe(401);
    });

    it('403 — regular user is not ADMIN', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(regularUser);
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(403);
    });

    it('200 — admin gets all users', async () => {
      // JwtStrategy.validate calls findUnique for the admin token
      mockPrisma.user.findUnique.mockResolvedValue(adminUser);
      mockPrisma.user.findMany.mockResolvedValue([regularUser, adminUser]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ─── GET /users/:id ───────────────────────────────────────────────────────

  describe('GET /api/v1/users/:id', () => {
    it('200 — returns user when authenticated', async () => {
      // First call: JwtStrategy.validate; second call: UsersService.findOne
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(regularUser)
        .mockResolvedValueOnce(regularUser);

      const res = await request(app.getHttpServer())
        .get('/api/v1/users/1')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(1);
    });

    it('401 — no token', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/users/1');
      expect(res.status).toBe(401);
    });

    it('404 — user not found', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(regularUser) // JwtStrategy
        .mockResolvedValueOnce(null);       // UsersService.findOne

      const res = await request(app.getHttpServer())
        .get('/api/v1/users/999')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(404);
    });

    it('400 — non-numeric id', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(regularUser);
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/abc')
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(400);
    });
  });

  // ─── PATCH /users/:id ────────────────────────────────────────────────────

  describe('PATCH /api/v1/users/:id', () => {
    it('200 — user can update their own profile', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(regularUser); // JwtStrategy
      mockPrisma.user.update.mockResolvedValue({ ...regularUser, name: 'Updated' });

      const res = await request(app.getHttpServer())
        .patch('/api/v1/users/1')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated');
    });

    it('403 — user cannot update another user\'s profile', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(regularUser); // JwtStrategy (id=1)

      const res = await request(app.getHttpServer())
        .patch('/api/v1/users/2') // targeting user id=2
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Hacked' });

      expect(res.status).toBe(403);
    });

    it('200 — admin can update any user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(adminUser); // JwtStrategy (admin)
      mockPrisma.user.update.mockResolvedValue({ ...regularUser, name: 'AdminEdited' });

      const res = await request(app.getHttpServer())
        .patch('/api/v1/users/1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'AdminEdited' });

      expect(res.status).toBe(200);
    });

    it('401 — no token', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/users/1')
        .send({ name: 'X' });
      expect(res.status).toBe(401);
    });
  });

  // ─── DELETE /users/:id ────────────────────────────────────────────────────

  describe('DELETE /api/v1/users/:id', () => {
    it('200 — admin can delete user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(adminUser); // JwtStrategy
      mockPrisma.user.delete.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .delete('/api/v1/users/1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('403 — regular user cannot delete', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(regularUser);

      const res = await request(app.getHttpServer())
        .delete('/api/v1/users/1')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('401 — no token', async () => {
      const res = await request(app.getHttpServer()).delete('/api/v1/users/1');
      expect(res.status).toBe(401);
    });
  });
});
