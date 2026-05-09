
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDrivers() {
  const drivers = await prisma.driverProfile.findMany({
    include: { user: true }
  });

  console.log('Total Drivers:', drivers.length);
  drivers.forEach(d => {
    console.log(`Driver: ${d.user.name} (${d.user.email})`);
    console.log(`  - Status: ${d.applicationStatus}`);
    console.log(`  - Available: ${d.isAvailable}`);
    console.log(`  - Location: ${d.currentLat}, ${d.currentLng}`);
    console.log('---');
  });

  const available = drivers.filter(d => 
    d.isAvailable && 
    d.applicationStatus === 'APPROVED' && 
    d.currentLat !== null
  );
  console.log('Total Available & Approved:', available.length);
}

checkDrivers()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
