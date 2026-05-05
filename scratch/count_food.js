const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const count = await prisma.foodItem.count();
  console.log('Food Items count:', count);
}

run().catch(console.error).finally(() => prisma.$disconnect());
