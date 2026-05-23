const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("=== CHECKING USER RELATIONS ===");
  const userIds = ['fa37afd9-674b-4927-b32d-63853131e601', 'QPBzlOR8WKb8APfi8iBflXHh2ml2'];

  for (const id of userIds) {
    console.log(`\nChecking User: ${id}`);
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            ownedRestaurants: true,
            orders: true,
            reviews: true,
            notifications: true,
            ledgers: true,
            favorites: true,
            requestedApprovals: true,
            reviewedApprovals: true,
            auditLogs: true,
            disputes: true,
            promoUsages: true,
            rides: true
          }
        }
      }
    });
    console.log(JSON.stringify(user, null, 2));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
