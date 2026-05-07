const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = '3e884147-66fa-4c96-9267-df368db66455';
  const profile = await prisma.driverProfile.findUnique({
    where: { userId }
  });
  console.log('DRIVER_PROFILE_ID:', profile.id);
}

main();
