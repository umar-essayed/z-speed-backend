const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log("=== CHECKING SUPABASE AUTH ===");
  const { data: { users }, error } = await supabase.auth.admin.listUsers();
  
  if (error) {
    console.error("Error listing users:", error.message);
    return;
  }
  
  console.log(`Found ${users.length} users in Supabase Auth:`);
  users.forEach(u => {
    console.log(JSON.stringify({
      id: u.id,
      email: u.email,
      phone: u.phone,
      role: u.role,
      created_at: u.created_at,
      user_metadata: u.user_metadata
    }, null, 2));
  });
}

main().catch(console.error);
