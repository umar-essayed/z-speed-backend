import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const targetUid = 'oy2obDfLswReNk2fgBPzPiL7A593';
  const users = await prisma.user.findMany({
    where: { firebaseUid: targetUid },
    select: {
      id: true,
      email: true,
      name: true,
      firebaseUid: true,
    },
  });
  console.log(`--- USERS WITH firebaseUid = ${targetUid} ---`);
  console.log(JSON.stringify(users, null, 2));
  
  const allUsers = await prisma.user.findMany({
    where: { email: 'furniture_vendor@test.com' },
    select: {
      id: true,
      email: true,
      name: true,
      firebaseUid: true,
    },
  });
  console.log(`--- USERS WITH EMAIL furniture_vendor@test.com ---`);
  console.log(JSON.stringify(allUsers, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
