const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function forceUpdate() {
  const hashedPassword = await bcrypt.hash('123456', 10);
  
  // Force update the vendor
  const user = await prisma.user.upsert({
    where: { email: 'test_vendor@zspeed.app' },
    update: { 
      passwordHash: hashedPassword,
      status: 'ACTIVE',
      role: 'VENDOR'
    },
    create: {
      email: 'test_vendor@zspeed.app',
      name: 'Test Vendor',
      passwordHash: hashedPassword,
      status: 'ACTIVE',
      role: 'VENDOR'
    }
  });

  console.log('✅ User updated/created with password "123456"');
}

forceUpdate().catch(console.error).finally(() => prisma.$disconnect());
