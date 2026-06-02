import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    const hashed = await bcrypt.hash(dto.password, 10);
    try {
      return await this.prisma.user.create({
        data: { ...dto, password: hashed },
        select: USER_SELECT,
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('Email already in use');
      throw e;
    }
  }

  findAll() {
    return this.prisma.user.findMany({ select: USER_SELECT });
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException(`User #${id} not found`);
    return user;
  }

  async update(id: number, dto: UpdateUserDto) {
    const data: Record<string, unknown> = { ...dto };
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
    }
    try {
      return await this.prisma.user.update({
        where: { id },
        data,
        select: USER_SELECT,
      });
    } catch (e: any) {
      if (e?.code === 'P2025') throw new NotFoundException(`User #${id} not found`);
      throw e;
    }
  }

  async remove(id: number) {
    try {
      await this.prisma.user.delete({ where: { id } });
      return { message: `User #${id} deleted` };
    } catch (e: any) {
      if (e?.code === 'P2025') throw new NotFoundException(`User #${id} not found`);
      throw e;
    }
  }
}
