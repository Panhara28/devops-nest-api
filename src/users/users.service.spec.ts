import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    const dto = { email: 'test@example.com', name: 'Test User', password: 'password123' };

    it('creates user and hashes password', async () => {
      const created = { id: 1, email: dto.email, name: dto.name, role: 'USER', createdAt: new Date(), updatedAt: new Date() };
      mockPrisma.user.create.mockResolvedValue(created);

      const result = await service.create(dto);

      const callArg = mockPrisma.user.create.mock.calls[0][0];
      expect(callArg.data.password).not.toBe(dto.password);
      expect(callArg.data.email).toBe(dto.email);
      expect(result).toEqual(created);
    });

    it('throws ConflictException on duplicate email (P2002)', async () => {
      mockPrisma.user.create.mockRejectedValue({ code: 'P2002' });
      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('rethrows unknown errors', async () => {
      mockPrisma.user.create.mockRejectedValue(new Error('DB down'));
      await expect(service.create(dto)).rejects.toThrow('DB down');
    });
  });

  describe('findOne', () => {
    it('returns user when found', async () => {
      const user = { id: 1, email: 'a@b.com', name: 'A', role: 'USER', createdAt: new Date(), updatedAt: new Date() };
      mockPrisma.user.findUnique.mockResolvedValue(user);
      expect(await service.findOne(1)).toEqual(user);
    });

    it('throws NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates user successfully', async () => {
      const updated = { id: 1, name: 'Updated', email: 'a@b.com', role: 'USER', createdAt: new Date(), updatedAt: new Date() };
      mockPrisma.user.update.mockResolvedValue(updated);
      expect(await service.update(1, { name: 'Updated' })).toEqual(updated);
    });

    it('hashes password when included in update', async () => {
      mockPrisma.user.update.mockResolvedValue({});
      await service.update(1, { password: 'newpass123' });
      const callArg = mockPrisma.user.update.mock.calls[0][0];
      expect(callArg.data.password).not.toBe('newpass123');
    });

    it('throws NotFoundException when user not found (P2025)', async () => {
      mockPrisma.user.update.mockRejectedValue({ code: 'P2025' });
      await expect(service.update(999, { name: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes user and returns message', async () => {
      mockPrisma.user.delete.mockResolvedValue({});
      expect(await service.remove(1)).toEqual({ message: 'User #1 deleted' });
    });

    it('throws NotFoundException when user not found (P2025)', async () => {
      mockPrisma.user.delete.mockRejectedValue({ code: 'P2025' });
      await expect(service.remove(999)).rejects.toThrow(NotFoundException);
    });
  });
});
