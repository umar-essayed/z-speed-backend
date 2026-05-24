const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { id: 'QPBzlOR8WKb8APfi8iBflXHh2ml2' },
        { firebaseUid: 'QPBzlOR8WKb8APfi8iBflXHh2ml2' },
        { email: { contains: 'pharmacy', mode: 'insensitive' } }
      ]
    }
  });

  console.log(`Found ${users.length} users in Postgres:`);
  for (const u of users) {
    console.log(`ID: ${u.id}, firebaseUid: ${u.firebaseUid}, Email: ${u.email}, Name: ${u.name}, Role: ${u.role}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
