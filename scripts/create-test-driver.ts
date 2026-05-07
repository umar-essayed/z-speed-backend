import { PrismaClient, Role, AccountStatus, ApplicationStatus } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function main() {
  const email = 'driver@zspeed.app';
  const password = 'password123';
  const name = 'Z-Speed Test Driver';
  const phone = '01234567890';

  console.log(`Creating driver: ${email}`);

  // 1. Create in Supabase Auth
  const { data: sbData, error: sbError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role: Role.DRIVER },
  });

  if (sbError) {
    if (sbError.message.includes('already been registered')) {
      console.log('User already exists in Supabase');
    } else {
      console.error('Error creating Supabase user:', sbError.message);
      process.exit(1);
    }
  }

  const supabaseId = sbData?.user?.id || (await supabase.auth.admin.listUsers()).data.users.find(u => u.email === email)?.id;

  if (!supabaseId) {
    console.error('Could not find Supabase ID');
    process.exit(1);
  }

  // 2. Create/Update in Prisma DB
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      supabaseId,
      name,
      phone,
      role: Role.DRIVER,
      status: AccountStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
      isPhoneVerified: true,
    },
    create: {
      supabaseId,
      email,
      name,
      phone,
      role: Role.DRIVER,
      status: AccountStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
      isPhoneVerified: true,
      authProvider: 'email',
    },
  });

  console.log(`User created/updated in DB: ${user.id}`);

  // 3. Create/Update Driver Profile
  const profile = await prisma.driverProfile.upsert({
    where: { userId: user.id },
    update: {
      applicationStatus: ApplicationStatus.APPROVED,
      isAvailable: true,
      rating: 5.0,
      totalTrips: 0,
      totalEarnings: 0,
    },
    create: {
      userId: user.id,
      applicationStatus: ApplicationStatus.APPROVED,
      isAvailable: true,
      rating: 5.0,
      totalTrips: 0,
      totalEarnings: 0,
    },
  });

  console.log(`Driver profile created/updated: ${profile.id}`);

  // 4. Create/Update Vehicle
  await prisma.vehicle.upsert({
    where: { driverProfileId: profile.id },
    update: {
      type: 'car',
      make: 'Toyota',
      model: 'Corolla',
      year: 2022,
      plateNumber: 'ZSP-001',
      color: 'White',
    },
    create: {
      driverProfileId: profile.id,
      type: 'car',
      make: 'Toyota',
      model: 'Corolla',
      year: 2022,
      plateNumber: 'ZSP-001',
      color: 'White',
    },
  });

  console.log('Vehicle linked to driver');
  console.log('\n--- Driver Credentials ---');
  console.log(`Email: ${email}`);
  console.log(`Password: ${password}`);
  console.log('--------------------------');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
