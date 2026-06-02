import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { Role } from '@prisma/client';

const PRODUCT_INCLUDE = {
  createdBy: { select: { id: true, name: true, email: true } },
};

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateProductDto, createdById: number) {
    return this.prisma.product.create({
      data: { ...dto, createdById },
      include: PRODUCT_INCLUDE,
    });
  }

  async findAll(query: QueryProductDto) {
    const { category, search, published, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where = {
      ...(published !== undefined && { published }),
      ...(category && { category: { contains: category } }),
      ...(search && {
        OR: [
          { name: { contains: search } },
          { description: { contains: search } },
        ],
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    });
    if (!product) throw new NotFoundException(`Product #${id} not found`);
    return product;
  }

  async update(id: number, dto: UpdateProductDto, userId: number, userRole: Role) {
    const product = await this.findOne(id);
    if (product.createdById !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException('You can only edit your own products');
    }
    try {
      return await this.prisma.product.update({
        where: { id },
        data: dto,
        include: PRODUCT_INCLUDE,
      });
    } catch (e: any) {
      if (e?.code === 'P2025') throw new NotFoundException(`Product #${id} not found`);
      throw e;
    }
  }

  async remove(id: number, userId: number, userRole: Role) {
    const product = await this.findOne(id);
    if (product.createdById !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException('You can only delete your own products');
    }
    try {
      await this.prisma.product.delete({ where: { id } });
      return { message: `Product #${id} deleted` };
    } catch (e: any) {
      if (e?.code === 'P2025') throw new NotFoundException(`Product #${id} not found`);
      throw e;
    }
  }

  async publish(id: number, userId: number, userRole: Role) {
    const product = await this.findOne(id);
    if (product.createdById !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException('You can only publish your own products');
    }
    return this.prisma.product.update({
      where: { id },
      data: { published: true },
      include: PRODUCT_INCLUDE,
    });
  }
}
