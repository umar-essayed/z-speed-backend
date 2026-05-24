const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== SEARCHING POSTGRESQL FOR PANADOL ITEMS ===');
  const items = await prisma.foodItem.findMany({
    where: {
      OR: [
        { name: { contains: 'panadol', mode: 'insensitive' } },
        { nameAr: { contains: 'بنادول', mode: 'insensitive' } }
      ]
    },
    include: {
      section: {
        include: {
          restaurant: true
        }
      },
      variants: true
    }
  });

  console.log(`Found ${items.length} panadol items in PostgreSQL:`);
  for (const item of items) {
    const r = item.section.restaurant;
    console.log(`- Item ID: ${item.id}`);
    console.log(`  Name: ${item.name} | NameAr: ${item.nameAr}`);
    console.log(`  Price: ${item.price} | hasFractions: ${item.hasFractions}`);
    console.log(`  Section: ${item.section.name} (ID: ${item.sectionId})`);
    console.log(`  Restaurant ID: ${r.id} | Name: ${r.name} | Status: ${r.status}`);
    console.log(`  Variants count: ${item.variants.length}`);
    for (const v of item.variants) {
      console.log(`    * Variant ID: ${v.id} | Name: ${v.name} | Price: ${v.price}`);
    }
    console.log('---------------------------------------------');
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
