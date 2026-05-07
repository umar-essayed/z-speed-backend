const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = '3e884147-66fa-4c96-9267-df368db66455';
  const profile = await prisma.driverProfile.findUnique({
    where: { userId },
    include: { user: true }
  });
  console.log('Driver Profile:', JSON.stringify(profile, null, 2));

  const restaurant = await prisma.restaurant.findFirst({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true }
  });
  console.log('Target Restaurant:', JSON.stringify(restaurant, null, 2));

  const customer = await prisma.user.findFirst({
    where: { role: 'CUSTOMER' },
    select: { id: true, name: true }
  });
  console.log('Target Customer:', JSON.stringify(customer, null, 2));
}

main();
