import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const user = await prisma.user.findFirst({ where: { firebaseUid: 'tpsumw3PcFUUHLy4m1kXSgoZZ1v1' } });
  console.log("User in Postgres:", user);
}
main().finally(() => prisma.$disconnect());
