const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const restaurant = await prisma.restaurant.findFirst();
  console.log('Restaurant:', restaurant);
}

run().catch(console.error).finally(() => prisma.$disconnect());
