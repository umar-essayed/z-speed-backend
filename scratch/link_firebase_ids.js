const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  // 1. Update Test Restaurant
  const restaurant = await prisma.restaurant.updateMany({
    where: { name: 'Test Restaurant' },
    data: { firebaseId: 'iBse6IVbrN53QikUkpqo' }
  });
  console.log('Updated Restaurant:', restaurant.count);

  // 2. Update Test Customer (Z-SPEED Customer)
  const user = await prisma.user.updateMany({
    where: { email: 'customer@zspeed.app' },
    data: { firebaseUid: 'UlZEznsHHdOq9M82ERxxYsEgMbx1' }
  });
  console.log('Updated Customer:', user.count);
}

run().catch(console.error).finally(() => prisma.$disconnect());
