const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkUser() {
  const user = await prisma.user.findUnique({
    where: { email: 'test_vendor@zspeed.app' }
  });
  
  if (user) {
    console.log('✅ User found in DB:');
    console.log(`- Email: ${user.email}`);
    console.log(`- Role: ${user.role}`);
    console.log(`- Status: ${user.status}`);
    console.log(`- Has Password Hash: ${!!user.passwordHash}`);
  } else {
    console.log('❌ User NOT found in DB!');
  }
}

checkUser().catch(console.error).finally(() => prisma.$disconnect());
