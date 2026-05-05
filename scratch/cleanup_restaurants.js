const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanup() {
  const ownerId = '06fb7436-cbb2-4c99-9fda-1ab6db6d8f41';
  
  // Find all restaurants for this owner
  const restaurants = await prisma.restaurant.findMany({
    where: { ownerId },
    orderBy: { createdAt: 'desc' }
  });

  if (restaurants.length <= 1) {
    console.log('Only one or zero restaurants found. No cleanup needed.');
    return;
  }

  // The "last" one created (index 0 because of desc order)
  const lastCreated = restaurants[0];
  
  // Actually, let's keep the one that was most recently updated as it likely has the latest settings
  const mostRecentlyUpdated = [...restaurants].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  
  console.log(`Keeping restaurant: ${mostRecentlyUpdated.name} (ID: ${mostRecentlyUpdated.id})`);

  const idsToDelete = restaurants
    .map(r => r.id)
    .filter(id => id !== mostRecentlyUpdated.id);

  if (idsToDelete.length === 0) {
    console.log('No extra restaurants to delete.');
    return;
  }

  console.log(`Deleting data for restaurants: ${idsToDelete.join(', ')}`);

  // Manual cascade deletion for related data
  await prisma.cartItem.deleteMany({ where: { foodItem: { section: { restaurantId: { in: idsToDelete } } } } });
  await prisma.orderItem.deleteMany({ where: { foodItem: { section: { restaurantId: { in: idsToDelete } } } } });
  await prisma.order.deleteMany({ where: { restaurantId: { in: idsToDelete } } });
  
  await prisma.foodItem.deleteMany({ where: { section: { restaurantId: { in: idsToDelete } } } });
  await prisma.menuSection.deleteMany({ where: { restaurantId: { in: idsToDelete } } });
  
  await prisma.promotion.deleteMany({ where: { restaurantId: { in: idsToDelete } } });
  await prisma.review.deleteMany({ where: { restaurantId: { in: idsToDelete } } });
  await prisma.favorite.deleteMany({ where: { restaurantId: { in: idsToDelete } } });
  await prisma.restaurantCuisine.deleteMany({ where: { restaurantId: { in: idsToDelete } } });
  await prisma.restaurantCategory.deleteMany({ where: { restaurantId: { in: idsToDelete } } });

  console.log(`Now deleting restaurants: ${idsToDelete.join(', ')}`);

  // Delete the restaurants themselves
  await prisma.restaurant.deleteMany({
    where: {
      id: { in: idsToDelete }
    }
  });

  console.log('Cleanup successful!');
}

cleanup()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
