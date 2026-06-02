import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PostsService } from './posts.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  post: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

const mockPost = {
  id: 1,
  title: 'Test Post',
  content: 'Some content here',
  published: true,
  authorId: 1,
  author: { id: 1, name: 'Alice', email: 'alice@example.com' },
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('PostsService', () => {
  let service: PostsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PostsService>(PostsService);
    jest.clearAllMocks();
  });

  describe('findOne', () => {
    it('returns post when found', async () => {
      mockPrisma.post.findUnique.mockResolvedValue(mockPost);
      expect(await service.findOne(1)).toEqual(mockPost);
    });

    it('throws NotFoundException when post not found', async () => {
      mockPrisma.post.findUnique.mockResolvedValue(null);
      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('allows owner to update their post', async () => {
      mockPrisma.post.findUnique.mockResolvedValue(mockPost);
      mockPrisma.post.update.mockResolvedValue({ ...mockPost, title: 'Updated' });
      const result = await service.update(1, { title: 'Updated' }, 1, Role.USER);
      expect(result.title).toBe('Updated');
    });

    it('allows admin to update any post', async () => {
      mockPrisma.post.findUnique.mockResolvedValue(mockPost);
      mockPrisma.post.update.mockResolvedValue({ ...mockPost, title: 'Admin Edit' });
      const result = await service.update(1, { title: 'Admin Edit' }, 99, Role.ADMIN);
      expect(result.title).toBe('Admin Edit');
    });

    it('throws ForbiddenException when non-owner non-admin tries to update', async () => {
      mockPrisma.post.findUnique.mockResolvedValue(mockPost);
      await expect(service.update(1, { title: 'Hack' }, 2, Role.USER))
        .rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when post not found', async () => {
      mockPrisma.post.findUnique.mockResolvedValue(null);
      await expect(service.update(999, {}, 1, Role.USER)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('allows owner to delete their post', async () => {
      mockPrisma.post.findUnique.mockResolvedValue(mockPost);
      mockPrisma.post.delete.mockResolvedValue({});
      expect(await service.remove(1, 1, Role.USER)).toEqual({ message: 'Post #1 deleted' });
    });

    it('allows admin to delete any post', async () => {
      mockPrisma.post.findUnique.mockResolvedValue(mockPost);
      mockPrisma.post.delete.mockResolvedValue({});
      expect(await service.remove(1, 99, Role.ADMIN)).toEqual({ message: 'Post #1 deleted' });
    });

    it('throws ForbiddenException when non-owner non-admin tries to delete', async () => {
      mockPrisma.post.findUnique.mockResolvedValue(mockPost);
      await expect(service.remove(1, 2, Role.USER)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when post not found', async () => {
      mockPrisma.post.findUnique.mockResolvedValue(null);
      await expect(service.remove(999, 1, Role.USER)).rejects.toThrow(NotFoundException);
    });
  });
});
