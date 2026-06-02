import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { buildMockPrisma, createTestApp, MockPrisma } from './helpers/create-test-app';

describe('Posts (e2e)', () => {
  let app: INestApplication;
  let mockPrisma: MockPrisma;
  let ownerToken: string;
  let otherToken: string;
  let adminToken: string;

  const owner      = { id: 1, email: 'owner@test.com',  name: 'Owner',  role: 'USER',  createdAt: new Date(), updatedAt: new Date() };
  const otherUser  = { id: 2, email: 'other@test.com',  name: 'Other',  role: 'USER',  createdAt: new Date(), updatedAt: new Date() };
  const adminUser  = { id: 3, email: 'admin@test.com',  name: 'Admin',  role: 'ADMIN', createdAt: new Date(), updatedAt: new Date() };

  const mockPost = {
    id: 1,
    title: 'Test Post',
    content: 'This is the post content',
    published: true,
    authorId: owner.id,
    author: { id: owner.id, name: owner.name, email: owner.email },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeAll(async () => {
    mockPrisma = buildMockPrisma();
    app = await createTestApp(mockPrisma);
    const jwtService = app.get(JwtService);
    ownerToken = jwtService.sign({ sub: owner.id,     email: owner.email });
    otherToken = jwtService.sign({ sub: otherUser.id, email: otherUser.email });
    adminToken = jwtService.sign({ sub: adminUser.id, email: adminUser.email });
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  // ─── GET /posts ───────────────────────────────────────────────────────────

  describe('GET /api/v1/posts', () => {
    it('200 — public endpoint, returns published posts', async () => {
      mockPrisma.post.findMany.mockResolvedValue([mockPost]);

      const res = await request(app.getHttpServer()).get('/api/v1/posts');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data[0].title).toBe('Test Post');
    });

    it('200 — returns empty array when no posts', async () => {
      mockPrisma.post.findMany.mockResolvedValue([]);
      const res = await request(app.getHttpServer()).get('/api/v1/posts');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  // ─── GET /posts/:id ───────────────────────────────────────────────────────

  describe('GET /api/v1/posts/:id', () => {
    it('200 — returns post by id (public)', async () => {
      mockPrisma.post.findUnique.mockResolvedValue(mockPost);

      const res = await request(app.getHttpServer()).get('/api/v1/posts/1');

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(1);
      expect(res.body.data.author).toMatchObject({ id: owner.id, name: owner.name });
    });

    it('404 — post not found', async () => {
      mockPrisma.post.findUnique.mockResolvedValue(null);
      const res = await request(app.getHttpServer()).get('/api/v1/posts/999');
      expect(res.status).toBe(404);
    });

    it('400 — non-numeric id', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/posts/abc');
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /posts ──────────────────────────────────────────────────────────

  describe('POST /api/v1/posts', () => {
    it('201 — authenticated user creates post', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(owner); // JwtStrategy
      mockPrisma.post.create.mockResolvedValue(mockPost);

      const res = await request(app.getHttpServer())
        .post('/api/v1/posts')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Test Post', content: 'This is the post content' });

      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe('Test Post');
    });

    it('401 — unauthenticated cannot create post', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/posts')
        .send({ title: 'Test Post', content: 'This is the post content' });
      expect(res.status).toBe(401);
    });

    it('400 — short title', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(owner);
      const res = await request(app.getHttpServer())
        .post('/api/v1/posts')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Hi', content: 'This is the post content' });
      expect(res.status).toBe(400);
    });

    it('400 — short content', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(owner);
      const res = await request(app.getHttpServer())
        .post('/api/v1/posts')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Valid title', content: 'Too short' });
      expect(res.status).toBe(400);
    });
  });

  // ─── PATCH /posts/:id ─────────────────────────────────────────────────────

  describe('PATCH /api/v1/posts/:id', () => {
    it('200 — owner can update their post', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(owner);       // JwtStrategy
      mockPrisma.post.findUnique.mockResolvedValue(mockPost);    // PostsService.findOne
      mockPrisma.post.update.mockResolvedValue({ ...mockPost, title: 'Updated' });

      const res = await request(app.getHttpServer())
        .patch('/api/v1/posts/1')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe('Updated');
    });

    it('403 — non-owner cannot update post', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(otherUser);   // JwtStrategy (different user)
      mockPrisma.post.findUnique.mockResolvedValue(mockPost);    // authorId=1, but user.id=2

      const res = await request(app.getHttpServer())
        .patch('/api/v1/posts/1')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ title: 'Hacked' });

      expect(res.status).toBe(403);
    });

    it('200 — admin can update any post', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(adminUser);
      mockPrisma.post.findUnique.mockResolvedValue(mockPost);
      mockPrisma.post.update.mockResolvedValue({ ...mockPost, title: 'Admin Update' });

      const res = await request(app.getHttpServer())
        .patch('/api/v1/posts/1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Admin Update' });

      expect(res.status).toBe(200);
    });

    it('401 — no token', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/posts/1')
        .send({ title: 'X' });
      expect(res.status).toBe(401);
    });

    it('404 — post not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(owner);
      mockPrisma.post.findUnique.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .patch('/api/v1/posts/999')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Updated' });

      expect(res.status).toBe(404);
    });
  });

  // ─── DELETE /posts/:id ────────────────────────────────────────────────────

  describe('DELETE /api/v1/posts/:id', () => {
    it('200 — owner can delete their post', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(owner);
      mockPrisma.post.findUnique.mockResolvedValue(mockPost);
      mockPrisma.post.delete.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .delete('/api/v1/posts/1')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.message).toContain('deleted');
    });

    it('403 — non-owner cannot delete post', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(otherUser);
      mockPrisma.post.findUnique.mockResolvedValue(mockPost); // authorId=1, user.id=2

      const res = await request(app.getHttpServer())
        .delete('/api/v1/posts/1')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
    });

    it('200 — admin can delete any post', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(adminUser);
      mockPrisma.post.findUnique.mockResolvedValue(mockPost);
      mockPrisma.post.delete.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .delete('/api/v1/posts/1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('401 — no token', async () => {
      const res = await request(app.getHttpServer()).delete('/api/v1/posts/1');
      expect(res.status).toBe(401);
    });
  });
});
