import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { buildMockPrisma, createTestApp, MockPrisma } from './helpers/create-test-app';

describe('Products (e2e)', () => {
  let app: INestApplication;
  let mockPrisma: MockPrisma;
  let adminToken: string;
  let userToken: string;

  const adminUser = { id: 1, email: 'admin@test.com', name: 'Admin', role: 'ADMIN', createdAt: new Date(), updatedAt: new Date() };
  const regularUser = { id: 2, email: 'user@test.com',  name: 'User',  role: 'USER',  createdAt: new Date(), updatedAt: new Date() };

  const mockProduct = {
    id: 1,
    name: 'Test Product',
    description: 'A great product description here',
    price: '99.99',
    stock: 10,
    category: 'electronics',
    published: true,
    createdById: adminUser.id,
    createdBy: { id: adminUser.id, name: adminUser.name, email: adminUser.email },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeAll(async () => {
    mockPrisma = buildMockPrisma();
    app = await createTestApp(mockPrisma);
    const jwtService = app.get(JwtService);
    adminToken = jwtService.sign({ sub: adminUser.id, email: adminUser.email });
    userToken  = jwtService.sign({ sub: regularUser.id, email: regularUser.email });
  });

  afterAll(() => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((q: Promise<unknown>[]) => Promise.all(q));
  });

  // ─── POST /products ───────────────────────────────────────────────────────

  describe('POST /api/v1/products', () => {
    const dto = {
      name: 'Test Product',
      description: 'A great product description here',
      price: 99.99,
      stock: 10,
      category: 'electronics',
    };

    it('201 — ADMIN creates product', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(adminUser);
      mockPrisma.product.create.mockResolvedValue(mockProduct);

      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(dto);

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Test Product');
    });

    it('403 — regular user cannot create product', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(regularUser);

      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${userToken}`)
        .send(dto);

      expect(res.status).toBe(403);
    });

    it('401 — unauthenticated cannot create product', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .send(dto);
      expect(res.status).toBe(401);
    });

    it('400 — negative price rejected', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(adminUser);
      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...dto, price: -10 });
      expect(res.status).toBe(400);
    });

    it('400 — negative stock rejected', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(adminUser);
      const res = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...dto, stock: -1 });
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /products ────────────────────────────────────────────────────────

  describe('GET /api/v1/products', () => {
    it('200 — public, returns paginated list', async () => {
      mockPrisma.$transaction.mockResolvedValue([[mockProduct], 1]);

      const res = await request(app.getHttpServer()).get('/api/v1/products');

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.totalPages).toBe(1);
    });

    it('200 — filters by category query param', async () => {
      mockPrisma.$transaction.mockResolvedValue([[mockProduct], 1]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/products?category=electronics&page=1&limit=10');

      expect(res.status).toBe(200);
    });

    it('200 — search by keyword', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/products?search=test');

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(0);
    });
  });

  // ─── GET /products/:id ────────────────────────────────────────────────────

  describe('GET /api/v1/products/:id', () => {
    it('200 — returns product (public)', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);

      const res = await request(app.getHttpServer()).get('/api/v1/products/1');

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(1);
      expect(res.body.data.price).toBe('99.99');
    });

    it('404 — product not found', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      const res = await request(app.getHttpServer()).get('/api/v1/products/999');
      expect(res.status).toBe(404);
    });

    it('400 — non-numeric id', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/products/abc');
      expect(res.status).toBe(400);
    });
  });

  // ─── PATCH /products/:id ──────────────────────────────────────────────────

  describe('PATCH /api/v1/products/:id', () => {
    it('200 — owner updates their product', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(adminUser);
      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);
      mockPrisma.product.update.mockResolvedValue({ ...mockProduct, name: 'Updated' });

      const res = await request(app.getHttpServer())
        .patch('/api/v1/products/1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated');
    });

    it('403 — non-owner cannot update', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(regularUser);
      mockPrisma.product.findUnique.mockResolvedValue(mockProduct); // createdById=1, user.id=2

      const res = await request(app.getHttpServer())
        .patch('/api/v1/products/1')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Hacked' });

      expect(res.status).toBe(403);
    });

    it('401 — no token', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/products/1')
        .send({ name: 'X' });
      expect(res.status).toBe(401);
    });

    it('404 — product not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(adminUser);
      mockPrisma.product.findUnique.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .patch('/api/v1/products/999')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ stock: 5 });

      expect(res.status).toBe(404);
    });
  });

  // ─── PATCH /products/:id/publish ─────────────────────────────────────────

  describe('PATCH /api/v1/products/:id/publish', () => {
    it('200 — owner can publish', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(adminUser);
      mockPrisma.product.findUnique.mockResolvedValue({ ...mockProduct, published: false });
      mockPrisma.product.update.mockResolvedValue({ ...mockProduct, published: true });

      const res = await request(app.getHttpServer())
        .patch('/api/v1/products/1/publish')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.published).toBe(true);
    });

    it('401 — no token', async () => {
      const res = await request(app.getHttpServer()).patch('/api/v1/products/1/publish');
      expect(res.status).toBe(401);
    });
  });

  // ─── DELETE /products/:id ─────────────────────────────────────────────────

  describe('DELETE /api/v1/products/:id', () => {
    it('200 — owner deletes their product', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(adminUser);
      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);
      mockPrisma.product.delete.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .delete('/api/v1/products/1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.message).toContain('deleted');
    });

    it('403 — non-owner cannot delete', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(regularUser);
      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);

      const res = await request(app.getHttpServer())
        .delete('/api/v1/products/1')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('401 — no token', async () => {
      const res = await request(app.getHttpServer()).delete('/api/v1/products/1');
      expect(res.status).toBe(401);
    });

    it('404 — product not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(adminUser);
      mockPrisma.product.findUnique.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .delete('/api/v1/products/999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });
});
