const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const list = await prisma.restaurant.findMany({
    where: {
      name: {
        contains: 'z market',
        mode: 'insensitive'
      }
    }
  });

  console.log(`Found ${list.length} Z MARKET restaurants in Postgres:`);
  for (const r of list) {
    console.log(`ID: ${r.id}, firebaseId: ${r.firebaseId}, ownerId: ${r.ownerId}, name: ${r.name}, vendorType: ${r.vendorType}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
