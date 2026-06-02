import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildMockPrisma, createTestApp, MockPrisma } from './helpers/create-test-app';

describe('App (e2e)', () => {
  let app: INestApplication;
  let mockPrisma: MockPrisma;

  beforeAll(async () => {
    mockPrisma = buildMockPrisma();
    app = await createTestApp(mockPrisma);
  });

  afterAll(() => app.close());

  it('404 — unknown route returns structured error', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/unknown-route');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ statusCode: 404 });
  });

  it('global prefix — routes outside /api/v1 return 404', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(404);
  });
});
