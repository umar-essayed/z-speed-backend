const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function main() {
  const output = [];
  output.push('=== SEARCHING POSTGRESQL FOR PANADOL ITEMS ===');
  
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

  output.push(`Found ${items.length} panadol items in PostgreSQL:`);
  for (const item of items) {
    const r = item.section.restaurant;
    output.push(`- Item ID: ${item.id}`);
    output.push(`  Name: ${item.name} | NameAr: ${item.nameAr}`);
    output.push(`  Price: ${item.price} | hasFractions: ${item.hasFractions}`);
    output.push(`  Section: ${item.section.name} (ID: ${item.sectionId})`);
    output.push(`  Restaurant ID: ${r.id} | Name: ${r.name} | Status: ${r.status}`);
    output.push(`  Variants count: ${item.variants.length}`);
    for (const v of item.variants) {
      output.push(`    * Variant ID: ${v.id} | Name: ${v.name} | Price: ${v.price}`);
    }
    output.push('---------------------------------------------');
  }

  fs.writeFileSync('scratch/postgres-panadols-output.txt', output.join('\n'));
  console.log('✅ Wrote results to scratch/postgres-panadols-output.txt');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
