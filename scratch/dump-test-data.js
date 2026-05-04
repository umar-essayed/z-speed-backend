const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.order.findMany({
    where: { id: '45935d93-7442-4a8f-87cc-a6c2b72d9d88' },
    include: { restaurant: true }
  });
  console.log('--- ORDER DATA ---');
  console.log(JSON.stringify(orders, null, 2));
  console.log('--- USERS ---');
  console.table(users);

  const restaurants = await prisma.restaurant.findMany({
    take: 5,
    include: {
      menuSections: {
        include: { items: true }
      }
    }
  });
  console.log('\n--- RESTAURANTS & ITEMS ---');
  restaurants.forEach(r => {
    console.log(`Restaurant: ${r.name} (${r.id})`);
    r.menuSections.forEach(s => {
      s.items.forEach(i => {
        console.log(`  - Item: ${i.name} (${i.id}) Price: ${i.price}`);
      });
    });
  });

  const drivers = await prisma.driverProfile.findMany({
    take: 5,
    include: { user: true }
  });
  console.log('\n--- DRIVERS ---');
  drivers.forEach(d => {
    console.log(`Driver: ${d.user.email} (${d.id}) UserID: ${d.userId}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
