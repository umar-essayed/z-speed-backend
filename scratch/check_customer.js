const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const user = await prisma.user.findUnique({ where: { id: '4b146d23-8089-4162-b611-0b7f50c32c98' } });
  console.log('Current User:', user);
  
  if (!user.name || user.name === 'Valued Customer') {
    await prisma.user.update({
      where: { id: user.id },
      data: { name: 'Omar Essayed (Test Customer)' }
    });
    console.log('Updated user name!');
  }
}

check().catch(console.error).finally(() => prisma.$disconnect());
