const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function setPassword() {
  const hashedPassword = await bcrypt.hash('123456', 10);
  await prisma.user.update({
    where: { email: 'test_vendor@zspeed.app' },
    data: { passwordHash: hashedPassword }
  });
  console.log('✅ Password set to: 123456');
}

setPassword().catch(console.error).finally(() => prisma.$disconnect());
