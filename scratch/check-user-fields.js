const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("=== DETAIL USER FIELD INSPECTION ===");
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: 'pharmacy@zspeedapp.com' },
        { email: 'pharmacy_owner_direct@zspeed.com' }
      ]
    }
  });
  console.log(JSON.stringify(users, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
