import { PrismaClient, Role, ApplicationStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = 'shimaamosa289@gmail.com';
  console.log(`🚀 Promoting user ${email} to DRIVER with PENDING application and full vehicle details...`);

  // Find user
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`❌ User with email ${email} not found!`);
    return;
  }

  // Update role to DRIVER
  await prisma.user.update({
    where: { id: user.id },
    data: { role: Role.DRIVER }
  });

  // Create or update DriverProfile with full realistic application data
  const profile = await prisma.driverProfile.upsert({
    where: { userId: user.id },
    update: {
      nationalId: '29801234567890',
      nationalIdUrl: 'https://images.unsplash.com/photo-1554774853-aae0a22c8aa4',
      driverLicenseUrl: 'https://images.unsplash.com/photo-1554774853-aae0a22c8aa4',
      policeClearanceUrl: 'https://images.unsplash.com/photo-1554774853-aae0a22c8aa4',
      dateOfBirth: new Date('1998-05-18'),
      applicationStatus: ApplicationStatus.PENDING,
      canTransport: true, // Transport enabled!
      canDeliver: false, // strictly mutually exclusive!
    },
    create: {
      userId: user.id,
      nationalId: '29801234567890',
      nationalIdUrl: 'https://images.unsplash.com/photo-1554774853-aae0a22c8aa4',
      driverLicenseUrl: 'https://images.unsplash.com/photo-1554774853-aae0a22c8aa4',
      policeClearanceUrl: 'https://images.unsplash.com/photo-1554774853-aae0a22c8aa4',
      dateOfBirth: new Date('1998-05-18'),
      applicationStatus: ApplicationStatus.PENDING,
      canTransport: true, // Transport enabled!
      canDeliver: false, // strictly mutually exclusive!
    }
  });

  // Create or update Vehicle record
  await prisma.vehicle.upsert({
    where: { driverProfileId: profile.id },
    update: {
      type: 'car',
      make: 'Toyota',
      model: 'Corolla',
      year: 2022,
      color: 'White',
      plateNumber: 'أ ب ج ١٢٣٤',
    },
    create: {
      driverProfileId: profile.id,
      type: 'car',
      make: 'Toyota',
      model: 'Corolla',
      year: 2022,
      color: 'White',
      plateNumber: 'أ ب ج ١٢٣٤',
    }
  });

  console.log(`✅ User promoted successfully with all vehicle & document details! Profile ID: ${profile.id}`);
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
