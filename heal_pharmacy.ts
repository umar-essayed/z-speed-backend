import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

async function initFirebase() {
  const keyPaths = [
    path.join(process.cwd(), 'FIREBASE-KEY.json'),
    path.join(process.cwd(), '..', 'FIREBASE-KEY.json'),
    '/home/omar/Desktop/Z-SPEED/FIREBASE-KEY.json',
  ];

  let serviceAccount = null;
  for (const keyPath of keyPaths) {
    if (fs.existsSync(keyPath)) {
      serviceAccount = require(keyPath);
      console.log(`Found Firebase key at ${keyPath}`);
      break;
    }
  }

  if (!admin.apps.length) {
    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
      console.log('Initializing Firebase via Environment Variables');
      let privateKey = process.env.FIREBASE_PRIVATE_KEY;
      if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.substring(1, privateKey.length - 1);
      }
      privateKey = privateKey.replace(/\\n/g, '\n');

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: privateKey,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });
    } else {
      throw new Error('No Firebase credentials found!');
    }
  }
}

async function main() {
  await initFirebase();
  const db = admin.firestore();

  const sourceId = 'ef6a8ac3-b836-4857-af1c-b707326f4a16';
  const targetId = 'If4718WxvAOdRpbHYPsnltSDIF93';

  console.log(`Copying restaurant data from ${sourceId} to ${targetId}...`);

  const sourceRestDoc = await db.collection('restaurants').doc(sourceId).get();
  if (!sourceRestDoc.exists) {
    console.error(`Source restaurant ${sourceId} does not exist!`);
    return;
  }

  const sourceData = sourceRestDoc.data()!;
  // Copy base restaurant data to targetId, updating id to targetId
  const targetData = {
    ...sourceData,
    id: targetId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await db.collection('restaurants').doc(targetId).set(targetData, { merge: true });
  console.log(`Base restaurant document copied.`);

  // Copy menuSections
  const sectionsSnapshot = await db.collection('restaurants').doc(sourceId).collection('menuSections').get();
  for (const secDoc of sectionsSnapshot.docs) {
    const secData = secDoc.data();
    const targetSecRef = db.collection('restaurants').doc(targetId).collection('menuSections').doc(secDoc.id);
    await targetSecRef.set({
      ...secData,
      restaurantId: targetId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log(`Copied section: ${secDoc.id}`);

    // Copy items in this section
    const itemsSnapshot = await secDoc.ref.collection('items').get();
    for (const itemDoc of itemsSnapshot.docs) {
      const itemData = itemDoc.data();
      await targetSecRef.collection('items').doc(itemDoc.id).set({
        ...itemData,
        restaurantId: targetId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      console.log(`  Copied item: ${itemDoc.id}`);
    }
  }

  // Delete source restaurant document and its subcollections
  console.log(`Deleting duplicate source restaurant ${sourceId}...`);
  const batch = db.batch();
  for (const secDoc of sectionsSnapshot.docs) {
    const itemsSnapshot = await secDoc.ref.collection('items').get();
    for (const itemDoc of itemsSnapshot.docs) {
      batch.delete(itemDoc.ref);
    }
    batch.delete(secDoc.ref);
  }
  batch.delete(db.collection('restaurants').doc(sourceId));
  await batch.commit();
  console.log(`Successfully deleted duplicate restaurant ${sourceId}.`);

  console.log('Heal complete!');
}

main().catch(console.error);
