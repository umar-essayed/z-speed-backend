import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function reconcile() {
  console.log('🚀 Starting Financial Reconciliation Audit...');
  const startTime = Date.now();

  const drivers = await prisma.driverProfile.findMany({
    include: { user: { select: { name: true, walletBalance: true, id: true } } }
  });

  const restaurants = await prisma.restaurant.findMany({
    select: { id: true, name: true, walletBalance: true, ownerId: true }
  });

  let issuesFound = 0;
  const discrepancies = [];

  console.log(`📊 Checking ${drivers.length} drivers and ${restaurants.length} restaurants...`);

  // 1. Reconcile Drivers
  for (const driver of drivers) {
    const ledgerSum = await prisma.ledger.aggregate({
      where: { userId: driver.userId, status: 'completed' },
      _sum: { amount: true }
    });

    const calculated = ledgerSum._sum.amount || 0;
    const stored = driver.user.walletBalance;

    if (Math.abs(calculated - stored) > 0.01) {
      issuesFound++;
      discrepancies.push({
        type: 'DRIVER',
        name: driver.user.name,
        id: driver.id,
        stored,
        calculated,
        diff: calculated - stored
      });
    }
  }

  // 2. Reconcile Restaurants
  for (const rest of restaurants) {
    const ledgerSum = await prisma.ledger.aggregate({
      where: { userId: rest.ownerId, status: 'completed' },
      _sum: { amount: true }
    });

    const calculated = ledgerSum._sum.amount || 0;
    const stored = rest.walletBalance;

    if (Math.abs(calculated - stored) > 0.01) {
      issuesFound++;
      discrepancies.push({
        type: 'RESTAURANT',
        name: rest.name,
        id: rest.id,
        stored,
        calculated,
        diff: calculated - stored
      });
    }
  }

  console.log('\n--- AUDIT RESULTS ---');
  if (issuesFound === 0) {
    console.log('✅ All balances are consistent with ledger history.');
  } else {
    console.warn(`❌ Found ${issuesFound} discrepancies!`);
    console.table(discrepancies);
  }

  const duration = (Date.now() - startTime) / 1000;
  console.log(`\n⏱️ Audit completed in ${duration}s`);
}

reconcile()
  .catch(e => {
    console.error('Audit failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
