import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const searchId = '12317E96';
  
  console.log(`Searching for order matching: ${searchId}...`);

  // Search by id (UUID) or firebaseOrderId
  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { id: { startsWith: searchId, mode: 'insensitive' } },
        { firebaseOrderId: { startsWith: searchId, mode: 'insensitive' } },
      ],
    },
  });

  if (orders.length === 0) {
    // Try without the # if the user included it in the string but startsWith doesn't like it
    const cleanId = searchId.startsWith('#') ? searchId.substring(1) : searchId;
    const orders2 = await prisma.order.findMany({
      where: {
        OR: [
          { id: { startsWith: cleanId, mode: 'insensitive' } },
          { firebaseOrderId: { startsWith: cleanId, mode: 'insensitive' } },
        ],
      },
    });
    
    if (orders2.length === 0) {
      console.log('Order not found.');
      return;
    }
    orders.push(...orders2);
  }

  console.log(`Found ${orders.length} order(s):`);
  for (const order of orders) {
    console.log(`- ID: ${order.id}, Status: ${order.status}, Firebase ID: ${order.firebaseOrderId}`);
    
    // Update status to CANCELLED
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED' },
    });
    
    console.log(`  Updated status to: ${updated.status}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
