const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("=== STARTING ATOMIC DATABASE MIGRATION ===");
  
  const realUserId = 'fa37afd9-674b-4927-b32d-63853131e601';
  const mockUserId = 'QPBzlOR8WKb8APfi8iBflXHh2ml2';
  const activeRestId = 'ef6a8ac3-b836-4857-af1c-b707326f4a16';
  const duplicateRestId = '7ff36fbe-667d-4a26-9a2a-4ef14b523fb4';
  const correctFirebaseUid = 'QPBzlOR8WKb8APfi8iBflXHh2ml2';

  // 1. Double check users exist
  const realUser = await prisma.user.findUnique({ where: { id: realUserId } });
  const mockUser = await prisma.user.findUnique({ where: { id: mockUserId } });

  if (!realUser) {
    throw new Error(`Real user with ID ${realUserId} not found!`);
  }
  console.log(`Found real user: ${realUser.email} (firebaseUid currently: ${realUser.firebaseUid})`);

  // We run all DB changes inside a Prisma transaction
  await prisma.$transaction(async (tx) => {
    
    // 2. Delete duplicate restaurant if it exists
    const duplicateRest = await tx.restaurant.findUnique({ where: { id: duplicateRestId } });
    if (duplicateRest) {
      console.log(`Deleting duplicate restaurant: ${duplicateRestId}`);
      await tx.restaurant.delete({ where: { id: duplicateRestId } });
      console.log("Duplicate restaurant deleted successfully.");
    } else {
      console.log("Duplicate restaurant not found (already deleted).");
    }

    // 3. Delete audit logs associated with mock user to prevent foreign key issues
    console.log(`Deleting audit logs for mock user: ${mockUserId}`);
    await tx.auditLog.deleteMany({ where: { userId: mockUserId } });
    console.log("Audit logs deleted successfully.");

    // 4. If the mock user exists, we transfer any useful info and delete it
    if (mockUser) {
      console.log(`Deleting mock user: ${mockUserId}`);
      // If mock user has FCM tokens, we merge them into real user's FCM tokens
      let mergedFcmTokens = realUser.fcmTokens || [];
      if (Array.isArray(mergedFcmTokens)) {
        if (mockUser.fcmTokens && Array.isArray(mockUser.fcmTokens)) {
          mockUser.fcmTokens.forEach(t => {
            if (!mergedFcmTokens.includes(t)) {
              mergedFcmTokens.push(t);
            }
          });
        }
      } else {
        mergedFcmTokens = mockUser.fcmTokens || null;
      }

      // Temporarily set the active restaurant ownerId to null or dummy if needed, but since we delete mockUser in same transaction,
      // we must update restaurant owner to realUser first!
      console.log(`Transferring restaurant ownership of ${activeRestId} to real user: ${realUserId}`);
      await tx.restaurant.update({
        where: { id: activeRestId },
        data: {
          ownerId: realUserId,
          firebaseId: correctFirebaseUid
        }
      });

      // Now delete the mock user
      await tx.user.delete({ where: { id: mockUserId } });
      console.log("Mock user deleted successfully.");

      // Update real user with correct firebaseUid and merged FCM tokens
      console.log(`Updating real user ${realUserId} with correct firebaseUid: ${correctFirebaseUid}`);
      await tx.user.update({
        where: { id: realUserId },
        data: {
          firebaseUid: correctFirebaseUid,
          fcmTokens: mergedFcmTokens
        }
      });
    } else {
      console.log("Mock user not found, checking if active restaurant needs ownership update...");
      await tx.restaurant.update({
        where: { id: activeRestId },
        data: {
          ownerId: realUserId,
          firebaseId: correctFirebaseUid
        }
      });

      await tx.user.update({
        where: { id: realUserId },
        data: {
          firebaseUid: correctFirebaseUid
        }
      });
    }

    console.log("✅ Transaction completed successfully!");
  });

  console.log("\n=== POST-MIGRATION VERIFICATION ===");
  const finalUser = await prisma.user.findUnique({
    where: { id: realUserId },
    include: { ownedRestaurants: true }
  });
  console.log("Real user state now:");
  console.log(JSON.stringify({
    id: finalUser.id,
    email: finalUser.email,
    firebaseUid: finalUser.firebaseUid,
    ownedRestaurantsCount: finalUser.ownedRestaurants.length,
    ownedRestaurants: finalUser.ownedRestaurants.map(r => ({
      id: r.id,
      name: r.name,
      ownerId: r.ownerId,
      firebaseId: r.firebaseId,
      isActive: r.isActive
    }))
  }, null, 2));

  console.log("\n=== ATOMIC DATABASE MIGRATION FINISHED ===");
}

main()
  .catch((err) => {
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
