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

  const uid = 'If4718WxvAOdRpbHYPsnltSDIF93';
  const pgUuid = 'ef6a8ac3-b836-4857-af1c-b707326f4a16';

  const userDoc = await db.collection('users').doc(uid).get();
  const restDocByPg = await db.collection('restaurants').doc(pgUuid).get();
  const restDocByUid = await db.collection('restaurants').doc(uid).get();
  const debugLogDoc = await db.collection('debug_logs').doc(uid).get();

  const sectionsSnapshot = await db.collection('restaurants').doc(pgUuid).collection('menuSections').get();
  const sectionsList = [];
  for (const secDoc of sectionsSnapshot.docs) {
    const secData = secDoc.data();
    const itemsSnapshot = await secDoc.ref.collection('items').get();
    const itemsList = itemsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    sectionsList.push({
      id: secDoc.id,
      ...secData,
      items: itemsList
    });
  }

  const result = {
    userDoc: userDoc.exists ? userDoc.data() : null,
    restDocByPg: restDocByPg.exists ? restDocByPg.data() : null,
    restDocByUid: restDocByUid.exists ? restDocByUid.data() : null,
    debugLogDoc: debugLogDoc.exists ? debugLogDoc.data() : null,
    pgUuidSections: sectionsList
  };

  fs.writeFileSync('db_query_result.json', JSON.stringify(result, null, 2));
  console.log('Query complete, wrote to db_query_result.json');
}

main().catch(console.error);
