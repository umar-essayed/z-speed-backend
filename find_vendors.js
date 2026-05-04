const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const vendors = await prisma.user.findMany({
    where: { role: 'VENDOR' },
    include: { ownedRestaurants: true }
  });
  console.log(JSON.stringify(vendors, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
