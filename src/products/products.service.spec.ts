import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ProductsService } from './products.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  product: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockProduct = {
  id: 1,
  name: 'Test Product',
  description: 'A great product description here',
  price: '99.99',
  stock: 10,
  category: 'electronics',
  published: true,
  createdById: 1,
  createdBy: { id: 1, name: 'Admin', email: 'admin@test.com' },
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ProductsService', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((q: Promise<unknown>[]) => Promise.all(q));
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates product with createdById', async () => {
      mockPrisma.product.create.mockResolvedValue(mockProduct);
      const dto = { name: 'Test Product', description: 'A great product description here', price: 99.99, stock: 10, category: 'electronics' };

      const result = await service.create(dto, 1);

      const call = mockPrisma.product.create.mock.calls[0][0];
      expect(call.data.createdById).toBe(1);
      expect(result).toEqual(mockProduct);
    });
  });

  // ─── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated results with total', async () => {
      mockPrisma.$transaction.mockResolvedValue([[mockProduct], 1]);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('applies category filter', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);
      await service.findAll({ category: 'electronics', page: 1, limit: 20 });

      const findManyCall = mockPrisma.$transaction.mock.calls[0][0];
      expect(findManyCall).toBeDefined();
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns product when found', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);
      expect(await service.findOne(1)).toEqual(mockProduct);
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('allows owner to update', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);
      mockPrisma.product.update.mockResolvedValue({ ...mockProduct, name: 'Updated' });

      const result = await service.update(1, { name: 'Updated' }, 1, Role.USER);
      expect(result.name).toBe('Updated');
    });

    it('allows ADMIN to update any product', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);
      mockPrisma.product.update.mockResolvedValue(mockProduct);

      await expect(service.update(1, { name: 'X' }, 99, Role.ADMIN)).resolves.toBeDefined();
    });

    it('throws ForbiddenException for non-owner non-admin', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);
      await expect(service.update(1, { name: 'X' }, 2, Role.USER)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(service.update(999, {}, 1, Role.ADMIN)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('allows owner to delete', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);
      mockPrisma.product.delete.mockResolvedValue({});

      expect(await service.remove(1, 1, Role.USER)).toEqual({ message: 'Product #1 deleted' });
    });

    it('allows ADMIN to delete any product', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);
      mockPrisma.product.delete.mockResolvedValue({});

      await expect(service.remove(1, 99, Role.ADMIN)).resolves.toBeDefined();
    });

    it('throws ForbiddenException for non-owner non-admin', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);
      await expect(service.remove(1, 2, Role.USER)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(service.remove(999, 1, Role.ADMIN)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── publish ──────────────────────────────────────────────────────────────

  describe('publish', () => {
    it('allows owner to publish', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({ ...mockProduct, published: false });
      mockPrisma.product.update.mockResolvedValue({ ...mockProduct, published: true });

      const result = await service.publish(1, 1, Role.USER);
      expect(result.published).toBe(true);
    });

    it('throws ForbiddenException for non-owner non-admin', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(mockProduct);
      await expect(service.publish(1, 2, Role.USER)).rejects.toThrow(ForbiddenException);
    });
  });
});
