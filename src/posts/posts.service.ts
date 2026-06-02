import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { Role } from '@prisma/client';

const POST_INCLUDE = {
  author: { select: { id: true, name: true, email: true } },
};

@Injectable()
export class PostsService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreatePostDto, authorId: number) {
    return this.prisma.post.create({
      data: { ...dto, authorId },
      include: POST_INCLUDE,
    });
  }

  findAll() {
    return this.prisma.post.findMany({
      where: { published: true },
      include: POST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: number) {
    const post = await this.prisma.post.findUnique({
      where: { id },
      include: POST_INCLUDE,
    });
    if (!post) throw new NotFoundException(`Post #${id} not found`);
    return post;
  }

  async update(id: number, dto: UpdatePostDto, userId: number, userRole: Role) {
    const post = await this.findOne(id);
    if (post.authorId !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException('You can only edit your own posts');
    }
    try {
      return await this.prisma.post.update({
        where: { id },
        data: dto,
        include: POST_INCLUDE,
      });
    } catch (e: any) {
      if (e?.code === 'P2025') throw new NotFoundException(`Post #${id} not found`);
      throw e;
    }
  }

  async remove(id: number, userId: number, userRole: Role) {
    const post = await this.findOne(id);
    if (post.authorId !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException('You can only delete your own posts');
    }
    try {
      await this.prisma.post.delete({ where: { id } });
      return { message: `Post #${id} deleted` };
    } catch (e: any) {
      if (e?.code === 'P2025') throw new NotFoundException(`Post #${id} not found`);
      throw e;
    }
  }
}
