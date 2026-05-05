import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const restaurantId = '1acb76e9-a61d-424a-a255-6928a60df77f';
  const firebaseId = '5rksMbyEsVSBGbtCJkmo';

  const res = await prisma.restaurant.update({
    where: { id: restaurantId },
    data: { firebaseId: firebaseId }
  });

  console.log('Updated restaurant:', res.name, 'with firebaseId:', res.firebaseId);

  // Update the orders that got assigned to the default restaurant back to the correct restaurant
  const orders = await prisma.order.updateMany({
    where: { restaurantId: '794c1583-0c99-47d5-96b4-705d12901cf5' },
    data: { restaurantId: restaurantId }
  });

  console.log('Moved', orders.count, 'orders to the correct restaurant.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
