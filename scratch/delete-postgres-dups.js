const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const ids = [
    'cd9afc28-ef0d-451f-916c-ccdec316de6f',
    '63aab301-da85-4cf6-8c7f-9b91af922c97'
  ];

  console.log('--- DELETING POSTGRES DUPLICATES ---');
  for (const id of ids) {
    const exists = await prisma.restaurant.findUnique({ where: { id } });
    if (exists) {
      console.log(`Deleting ${id}...`);
      await prisma.restaurant.delete({ where: { id } });
      console.log(`✅ Deleted.`);
    } else {
      console.log(`${id} does not exist.`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
