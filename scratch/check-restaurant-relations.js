const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("=== CHECKING RESTAURANTS RELATIONSHIPS ===");
  const rIds = ['ef6a8ac3-b836-4857-af1c-b707326f4a16', '7ff36fbe-667d-4a26-9a2a-4ef14b523fb4'];

  for (const id of rIds) {
    console.log(`\nChecking Restaurant: ${id}`);
    const rest = await prisma.restaurant.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            orders: true,
            menuSections: true,
            reviews: true,
          }
        }
      }
    });
    
    if (rest) {
      console.log(JSON.stringify(rest, null, 2));
      
      // Let's also check food items
      const menuSections = await prisma.menuSection.findMany({
        where: { restaurantId: id },
        include: { _count: { select: { items: true } } }
      });
      console.log("Menu Sections and Food Items count:");
      menuSections.forEach(sec => {
        console.log(`- Section "${sec.name}" (${sec.id}): ${sec._count.items} items`);
      });
    } else {
      console.log("Not found in database!");
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
