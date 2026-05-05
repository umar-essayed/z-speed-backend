const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDb() {
  const restaurants = await prisma.restaurant.findMany({ select: { id: true, name: true, ownerId: true } });
  console.log('Restaurants in Postgres:', restaurants);

  const users = await prisma.user.findMany({ select: { id: true, email: true, name: true, role: true }});
  console.log('Users in Postgres:', users.filter(u => u.role === 'CUSTOMER'));
}

checkDb().finally(() => prisma.$disconnect());
