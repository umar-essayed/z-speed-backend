const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkIds() {
  const user = await prisma.user.findFirst({ where: { supabaseId: 'UlZEznsHHdOq9M82ERxxYsEgMbx1' } });
  console.log('Postgres User matched with Firebase ID:', user);
}

checkIds().finally(() => prisma.$disconnect());
