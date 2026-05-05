const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const r = await prisma.restaurant.findUnique({ where: { firebaseId: 'iBse6IVbrN53QikUkpqo' } });
  console.log('Found:', r);
}

run().catch(console.error).finally(() => prisma.$disconnect());
