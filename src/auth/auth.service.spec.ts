import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

const mockPrisma = {
  user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  passwordResetToken: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn().mockImplementation((q: Promise<unknown>[]) => Promise.all(q)),
};

const mockJwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
const mockConfigService = {
  get: jest.fn().mockImplementation((key: string, def?: string) => {
    const cfg: Record<string, string> = {
      JWT_REFRESH_EXPIRES_IN: '7',
      JWT_SECRET: 'test-secret',
    };
    return cfg[key] ?? def;
  }),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((q: Promise<unknown>[]) => Promise.all(q));
  });

  // ─── validateUser ──────────────────────────────────────────────────────────

  describe('validateUser', () => {
    it('returns user without password on valid credentials', async () => {
      const hash = await bcrypt.hash('secret123', 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1, email: 'a@b.com', name: 'Alice', role: 'USER', password: hash,
        createdAt: new Date(), updatedAt: new Date(),
      });

      const result = await service.validateUser('a@b.com', 'secret123');
      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty('password');
      expect(result!.email).toBe('a@b.com');
    });

    it('returns null when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      expect(await service.validateUser('no@one.com', 'pass')).toBeNull();
    });

    it('returns null on wrong password', async () => {
      const hash = await bcrypt.hash('correct', 10);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 1, password: hash });
      expect(await service.validateUser('a@b.com', 'wrong')).toBeNull();
    });
  });

  // ─── register ─────────────────────────────────────────────────────────────

  describe('register', () => {
    it('creates user, hashes password, returns token pair', async () => {
      mockPrisma.user.create.mockResolvedValue({ id: 1, email: 'new@test.com' });
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await service.register({ email: 'new@test.com', name: 'New', password: 'pass123' });

      const createCall = mockPrisma.user.create.mock.calls[0][0];
      expect(createCall.data.password).not.toBe('pass123');
      expect(result).toMatchObject({ access_token: 'signed.jwt.token', token_type: 'Bearer' });
      expect(result.refresh_token).toBeDefined();
    });

    it('throws ConflictException on duplicate email', async () => {
      mockPrisma.user.create.mockRejectedValue({ code: 'P2002' });
      await expect(
        service.register({ email: 'dup@test.com', name: 'X', password: 'pass123' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rethrows unexpected DB errors', async () => {
      mockPrisma.user.create.mockRejectedValue(new Error('connection lost'));
      await expect(
        service.register({ email: 'a@b.com', name: 'X', password: 'pass123' }),
      ).rejects.toThrow('connection lost');
    });
  });

  // ─── login ─────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('creates refresh token in DB and returns token pair', async () => {
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await service.login({ id: 1, email: 'a@b.com' });

      expect(mockPrisma.refreshToken.create).toHaveBeenCalledTimes(1);
      expect(result.access_token).toBe('signed.jwt.token');
      expect(result.token_type).toBe('Bearer');
      expect(result.refresh_token).toHaveLength(64); // 32 bytes hex
    });
  });

  // ─── logout ────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('deletes the matching refresh token and returns message', async () => {
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.logout(1, 'some-raw-token');

      expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 1 }) }),
      );
      expect(result.message).toContain('Logged out');
    });
  });

  // ─── refreshTokens ─────────────────────────────────────────────────────────

  describe('refreshTokens', () => {
    const storedToken = {
      id: 10,
      tokenHash: 'hash',
      userId: 1,
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
      user: { id: 1, email: 'a@b.com' },
    };

    it('deletes old token, issues new pair (rotation)', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(storedToken);
      mockPrisma.refreshToken.delete.mockResolvedValue({});
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await service.refreshTokens('raw-token');

      expect(mockPrisma.refreshToken.delete).toHaveBeenCalledWith({ where: { id: 10 } });
      expect(result.access_token).toBeDefined();
      expect(result.refresh_token).toBeDefined();
    });

    it('throws UnauthorizedException for unknown token', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refreshTokens('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException and deletes expired token', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        ...storedToken,
        expiresAt: new Date(Date.now() - 1000),
      });
      mockPrisma.refreshToken.delete.mockResolvedValue({});

      await expect(service.refreshTokens('expired-token')).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.refreshToken.delete).toHaveBeenCalledWith({ where: { id: 10 } });
    });
  });

  // ─── getProfile ────────────────────────────────────────────────────────────

  describe('getProfile', () => {
    it('returns user profile', async () => {
      const user = { id: 1, email: 'a@b.com', name: 'Alice', role: 'USER', createdAt: new Date(), updatedAt: new Date() };
      mockPrisma.user.findUnique.mockResolvedValue(user);
      expect(await service.getProfile(1)).toEqual(user);
    });

    it('throws NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getProfile(999)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── forgotPassword ────────────────────────────────────────────────────────

  describe('forgotPassword', () => {
    it('creates reset token and returns it when user exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 1, email: 'a@b.com' });
      mockPrisma.passwordResetToken.deleteMany.mockResolvedValue({});
      mockPrisma.passwordResetToken.create.mockResolvedValue({});

      const result = await service.forgotPassword('a@b.com');

      expect(result.reset_token).toBeDefined();
      expect(result.reset_token).toHaveLength(64);
      expect(result.message).toContain('token has been sent');
    });

    it('returns same message when user does not exist (enumeration protection)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await service.forgotPassword('ghost@test.com');
      expect(result.message).toContain('token has been sent');
      expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
    });
  });

  // ─── resetPassword ─────────────────────────────────────────────────────────

  describe('resetPassword', () => {
    const validToken = {
      id: 1,
      userId: 1,
      used: false,
      expiresAt: new Date(Date.now() + 3600000),
    };

    it('updates password and marks token as used', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(validToken);
      mockPrisma.passwordResetToken.update.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({});

      const result = await service.resetPassword('raw-token', 'newpass123');
      expect(result.message).toContain('Password reset');
    });

    it('throws BadRequestException for invalid token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);
      await expect(service.resetPassword('bad', 'newpass123')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for already-used token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({ ...validToken, used: true });
      await expect(service.resetPassword('used', 'newpass123')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for expired token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        ...validToken,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.resetPassword('expired', 'newpass123')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── changePassword ────────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('updates password and invalidates all sessions', async () => {
      const hash = await bcrypt.hash('old-pass', 10);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 1, password: hash });
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({});

      const result = await service.changePassword(1, {
        currentPassword: 'old-pass',
        newPassword: 'new-pass123',
      });

      expect(result.message).toContain('Password changed');
    });

    it('throws UnauthorizedException on wrong current password', async () => {
      const hash = await bcrypt.hash('correct', 10);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 1, password: hash });

      await expect(
        service.changePassword(1, { currentPassword: 'wrong', newPassword: 'new123456' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.changePassword(99, { currentPassword: 'any', newPassword: 'new123456' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
