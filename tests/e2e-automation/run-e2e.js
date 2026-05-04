const newman = require('newman');
const path = require('path');
const fs = require('fs');

// Configuration
const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api/v1';
const POSTMAN_DIR = path.join(__dirname, '../../../postman');
const REPORT_DIR = path.join(__dirname, 'reports');

// Create reports directory if it doesn't exist
if (!fs.existsSync(REPORT_DIR)) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

const collections = [
  '01_Auth_Users.postman_collection.json',
  '02_Restaurant_Food_Cart.postman_collection.json',
  '03_Orders_Drivers_Wallet.postman_collection.json',
  '04_Admin_SuperAdmin_Notif_Reviews.postman_collection.json'
];

/**
 * Runs a single Postman collection
 */
function runCollection(collectionName, iterationData = null) {
  return new Promise((resolve, reject) => {
    console.log(`\n🚀 Running Collection: ${collectionName}...`);
    
    newman.run({
      collection: path.join(POSTMAN_DIR, collectionName),
      environment: {
        id: 'z-speed-env',
        name: 'Z-Speed Production Test Env',
        values: [
          { key: 'baseUrl', value: BASE_URL, enabled: true },
          // Add more environment variables here if needed
        ]
      },
      reporters: ['cli', 'htmlextra'],
      reporter: {
        htmlextra: {
          export: path.join(REPORT_DIR, `${collectionName.replace('.json', '')}-report.html`),
          title: `Z-SPEED API Test Report - ${collectionName}`,
          browserTitle: 'Z-SPEED Test Dashboard',
          showEnvironmentData: true,
          showFolderDescription: true,
          showOnlyFails: false,
          logs: true,
        }
      }
    }, function (err, summary) {
      if (err) {
        console.error(`❌ Collection ${collectionName} failed:`, err);
        return reject(err);
      }
      
      const failures = summary.run.failures;
      if (failures.length > 0) {
        console.log(`⚠️ Completed with ${failures.length} failures.`);
      } else {
        console.log(`✅ Collection ${collectionName} completed successfully!`);
      }
      resolve(summary);
    });
  });
}

/**
 * Master Execution Flow
 */
async function runAllTests() {
  console.log('================================================');
  console.log('🏁 STARTING FULL Z-SPEED E2E SYSTEM TEST');
  console.log(`🕒 Timestamp: ${new Date().toLocaleString()}`);
  console.log(`🌐 Target: ${BASE_URL}`);
  console.log('================================================');

  try {
    for (const collection of collections) {
      await runCollection(collection);
    }
    
    console.log('\n================================================');
    console.log('🎉 ALL COLLECTIONS PROCESSED!');
    console.log(`📁 Reports generated in: ${REPORT_DIR}`);
    console.log('================================================');
  } catch (error) {
    console.error('\n💥 TEST SUITE CRASHED:', error);
    process.exit(1);
  }
}

runAllTests();
