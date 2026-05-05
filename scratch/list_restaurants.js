const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const rs = await prisma.restaurant.findMany();
  rs.forEach(r => console.log(`ID: ${r.id} | Name: ${r.name} | FirebaseID: ${r.firebaseId}`));
}

run().catch(console.error).finally(() => prisma.$disconnect());
