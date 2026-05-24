const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const user1 = await prisma.user.findFirst({
    where: { email: 'Info@mostafasolimangroup.com' }
  });

  const user2 = await prisma.user.findFirst({
    where: { email: 'info@mostafasolimangroup.com' }
  });

  console.log('--- USER 1 ---');
  if (user1) {
    console.log(`ID: ${user1.id}, Name: ${user1.name}, firebaseUid: ${user1.firebaseUid}, Role: ${user1.role}`);
  } else {
    console.log('User 1 not found');
  }

  console.log('\n--- USER 2 ---');
  if (user2) {
    console.log(`ID: ${user2.id}, Name: ${user2.name}, firebaseUid: ${user2.firebaseUid}, Role: ${user2.role}`);
  } else {
    console.log('User 2 not found');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
