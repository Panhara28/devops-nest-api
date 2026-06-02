import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import type { AuthUser, TokenPair } from './auth.types';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';

@Injectable()
export class AuthService {
  private readonly refreshTokenTtlMs: number;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {
    const days = parseInt(this.config.get('JWT_REFRESH_EXPIRES_IN', '7'), 10);
    this.refreshTokenTtlMs = days * 24 * 60 * 60 * 1000;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async generateAuthTokens(user: { id: number; email: string }): Promise<TokenPair> {
    const accessToken = this.jwtService.sign({ sub: user.id, email: user.email });
    const refreshToken = randomBytes(32).toString('hex');

    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hashToken(refreshToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + this.refreshTokenTtlMs),
      },
    });

    return { access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer' };
  }

  // ─── Auth flows ─────────────────────────────────────────────────────────────

  async validateUser(email: string, password: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return null;
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return null;
    const { password: _pw, ...result } = user;
    return result;
  }

  async register(dto: RegisterDto): Promise<TokenPair> {
    const hashed = await bcrypt.hash(dto.password, 10);
    try {
      const user = await this.prisma.user.create({
        data: { email: dto.email, name: dto.name, password: hashed },
        select: { id: true, email: true },
      });
      return this.generateAuthTokens(user);
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('Email already in use');
      throw e;
    }
  }

  async login(user: { id: number; email: string }): Promise<TokenPair> {
    return this.generateAuthTokens(user);
  }

  async logout(userId: number, refreshToken: string): Promise<{ message: string }> {
    await this.prisma.refreshToken.deleteMany({
      where: { tokenHash: this.hashToken(refreshToken), userId },
    });
    return { message: 'Logged out successfully' };
  }

  async refreshTokens(rawToken: string): Promise<TokenPair> {
    const tokenHash = this.hashToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true } } },
    });

    if (!stored) throw new UnauthorizedException('Invalid refresh token');

    if (stored.expiresAt < new Date()) {
      await this.prisma.refreshToken.delete({ where: { id: stored.id } });
      throw new UnauthorizedException('Refresh token expired, please log in again');
    }

    // Rotate: delete old token before issuing new pair
    await this.prisma.refreshToken.delete({ where: { id: stored.id } });
    return this.generateAuthTokens(stored.user);
  }

  async getProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, createdAt: true, updatedAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Always return same response to prevent email enumeration
    if (!user) {
      return { message: 'If that email exists, a password reset token has been sent' };
    }

    // Invalidate any existing reset tokens
    await this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

    const resetToken = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        tokenHash: this.hashToken(resetToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    // In production: send resetToken via email. Returned here for development only.
    return {
      message: 'If that email exists, a password reset token has been sent',
      reset_token: resetToken,
    };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hashToken(token) },
    });

    if (!stored || stored.used || stored.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: stored.id },
        data: { used: true },
      }),
      this.prisma.user.update({
        where: { id: stored.userId },
        data: { password: hashed },
      }),
      // Invalidate all active sessions after password reset
      this.prisma.refreshToken.deleteMany({ where: { userId: stored.userId } }),
    ]);

    return { message: 'Password reset successfully. Please log in with your new password.' };
  }

  async changePassword(userId: number, dto: ChangePasswordDto): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const isMatch = await bcrypt.compare(dto.currentPassword, user.password);
    if (!isMatch) throw new UnauthorizedException('Current password is incorrect');

    const hashed = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { password: hashed } }),
      // Log out all devices after password change
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
    ]);

    return { message: 'Password changed successfully. Please log in again.' };
  }
}
