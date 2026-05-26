import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const oldId = 'furniture-test-restaurant-id';
  
  console.log(`Cleaning up old restaurant references for: ${oldId}`);
  
  // 1. Delete food items related to the old restaurant's sections
  const sections = await prisma.menuSection.findMany({
    where: { restaurantId: oldId }
  });
  const sectionIds = sections.map(s => s.id);
  
  console.log(`Found menu sections to delete:`, sectionIds);
  
  // Delete items
  const itemDeleteResult = await prisma.foodItem.deleteMany({
    where: { sectionId: { in: sectionIds } }
  });
  console.log(`Deleted ${itemDeleteResult.count} food items.`);
  
  // Delete sections
  const sectionDeleteResult = await prisma.menuSection.deleteMany({
    where: { restaurantId: oldId }
  });
  console.log(`Deleted ${sectionDeleteResult.count} menu sections.`);
  
  // 2. Delete the old restaurant itself
  const restDeleteResult = await prisma.restaurant.deleteMany({
    where: { id: oldId }
  });
  console.log(`Deleted ${restDeleteResult.count} restaurant records.`);
  
  console.log('✅ Cleanup completed successfully!');
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
