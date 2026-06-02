import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const adminPassword = await bcrypt.hash('admin123', 10);
  const userPassword = await bcrypt.hash('user1234', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      name: 'Admin User',
      password: adminPassword,
      role: Role.ADMIN,
    },
  });

  const user = await prisma.user.upsert({
    where: { email: 'user@example.com' },
    update: {},
    create: {
      email: 'user@example.com',
      name: 'Regular User',
      password: userPassword,
      role: Role.USER,
    },
  });

  await prisma.post.createMany({
    data: [
      {
        title: 'Getting Started with NestJS',
        content: 'NestJS is a progressive Node.js framework for building efficient and scalable server-side applications.',
        published: true,
        authorId: admin.id,
      },
      {
        title: 'Prisma with MySQL',
        content: 'Prisma is a next-generation ORM that makes working with databases easy and type-safe.',
        published: true,
        authorId: user.id,
      },
    ],
    skipDuplicates: true,
  });

  console.log('Seed completed:', { admin: admin.email, user: user.email });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
