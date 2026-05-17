import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const drivers = await prisma.driverProfile.findMany({
    take: 5,
  });

  console.log(`Found ${drivers.length} drivers.`);

  for (const driver of drivers) {
    await prisma.driverProfile.update({
      where: { id: driver.id },
      data: { canTransport: true },
    });
    console.log(`Updated driver ${driver.id} to canTransport: true`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
