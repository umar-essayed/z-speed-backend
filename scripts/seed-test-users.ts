import { PrismaClient, Role, AccountStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding test users...');

  const users = [
    {
      email: 'superadmin@zspeed.app',
      name: 'Super Admin',
      role: Role.SUPERADMIN,
    },
    {
      email: 'admin@zspeed.app',
      name: 'System Admin',
      role: Role.ADMIN,
    },
    {
      email: 'vendor@zspeed.app',
      name: 'Z-SPEED Vendor',
      role: Role.VENDOR,
    },
    {
      email: 'driver@zspeed.app',
      name: 'Z-SPEED Driver',
      role: Role.DRIVER,
    },
    {
      email: 'customer@zspeed.app',
      name: 'Z-SPEED Customer',
      role: Role.CUSTOMER,
    },
  ];

  for (const userData of users) {
    const user = await prisma.user.upsert({
      where: { email: userData.email },
      update: {
        role: userData.role,
        status: AccountStatus.ACTIVE,
      },
      create: {
        email: userData.email,
        name: userData.name,
        role: userData.role,
        status: AccountStatus.ACTIVE,
        supabaseId: `test-${userData.role.toLowerCase()}`, // Mock Supabase ID
        authProvider: 'email',
        emailVerified: true,
      },
    });
    console.log(`✅ Created/Updated user: ${user.email} (${user.role})`);
  }

  console.log('🚀 Seeding completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
