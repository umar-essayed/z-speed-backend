import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const customer = await prisma.user.findFirst({
    where: { role: 'CUSTOMER' },
    select: { id: true, name: true }
  });
  
  const restaurant = await prisma.restaurant.findFirst({
    select: { id: true, name: true }
  });
  
  const driver = await prisma.user.findFirst({
    where: { role: 'DRIVER' },
    select: { id: true, name: true }
  });

  console.log('CUSTOMER:', JSON.stringify(customer));
  console.log('RESTAURANT:', JSON.stringify(restaurant));
  console.log('DRIVER:', JSON.stringify(driver));
}

main().catch(console.error).finally(() => prisma.$disconnect());
