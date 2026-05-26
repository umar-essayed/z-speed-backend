import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const restaurants = await prisma.restaurant.findMany({
    select: {
      id: true,
      firebaseId: true,
      name: true,
      owner: { select: { email: true } },
    },
  });
  console.log('--- RESTAURANTS IN POSTGRES ---');
  console.log(JSON.stringify(restaurants, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
