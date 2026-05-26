import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const dummyEmail = 'oy2obDfLswReNk2fgBPzPiL7A593@vendor.zspeed.com';
  const realEmail = 'furniture_vendor@test.com';
  const targetUid = 'oy2obDfLswReNk2fgBPzPiL7A593';

  console.log(`Starting duplicate user merge for ${realEmail}...`);

  // 1. Delete any restaurants owned by the dummy email user to avoid constraint issues (if any exist)
  const dummyUser = await prisma.user.findUnique({
    where: { email: dummyEmail }
  });

  if (dummyUser) {
    console.log(`Found dummy user with ID: ${dummyUser.id}. Cleaning up references...`);
    
    // Check if dummy user owns any restaurants
    const ownedRests = await prisma.restaurant.findMany({
      where: { ownerId: dummyUser.id }
    });
    
    for (const rest of ownedRests) {
      console.log(`Deleting restaurant ${rest.name} (${rest.id}) owned by dummy user...`);
      await prisma.restaurant.delete({ where: { id: rest.id } });
    }
    
    // Delete dummy user
    await prisma.user.delete({ where: { id: dummyUser.id } });
    console.log(`Deleted dummy user ${dummyEmail} successfully.`);
  } else {
    console.log(`No dummy user found for ${dummyEmail}.`);
  }

  // 2. Update the real vendor user's firebaseUid
  const realUser = await prisma.user.findUnique({
    where: { email: realEmail }
  });

  if (realUser) {
    await prisma.user.update({
      where: { id: realUser.id },
      data: { firebaseUid: targetUid }
    });
    console.log(`Updated real user ${realEmail} to have firebaseUid = ${targetUid}`);
  } else {
    console.log(`❌ Error: Real user ${realEmail} not found!`);
  }

  console.log('✅ Merge completed successfully!');
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
