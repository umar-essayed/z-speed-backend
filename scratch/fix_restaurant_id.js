const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  await prisma.restaurant.update({
    where: { id: '794c1583-0c99-47d5-96b4-705d12901cf5' },
    data: { firebaseId: 'iBse6IVbrN53QikUkpqo' }
  });
  console.log('Fixed Restaurant!');
}

run().catch(console.error).finally(() => prisma.$disconnect());
