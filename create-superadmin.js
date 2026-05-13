const { PrismaClient } = require('@prisma/client');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const prisma = new PrismaClient();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createSuperAdmin() {
  const email = 'superadmin@zspeed.app';
  const password = 'SuperAdmin123!';
  const name = 'Z-SPEED Boss';

  console.log(`Creating Super Admin: ${email}`);

  try {
    // 1. Create in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: { name, role: 'SUPERADMIN' }
    });

    let supabaseId;

    if (authError) {
      if (authError.message.includes('already been registered')) {
        console.log('User already exists in Supabase, fetching ID...');
        const { data: existingUsers } = await supabase.auth.admin.listUsers();
        const existing = existingUsers.users.find(u => u.email === email);
        supabaseId = existing.id;
        
        // Update password just in case
        await supabase.auth.admin.updateUserById(supabaseId, { password });
      } else {
        throw authError;
      }
    } else {
      supabaseId = authData.user.id;
    }

    // 2. Create or Update in PostgreSQL
    const existingDbUser = await prisma.user.findUnique({ where: { email } });

    if (existingDbUser) {
      await prisma.user.update({
        where: { email },
        data: { role: 'SUPERADMIN', supabaseId, status: 'ACTIVE' }
      });
      console.log('Updated existing user in Database to SUPERADMIN');
    } else {
      await prisma.user.create({
        data: {
          email,
          name,
          role: 'SUPERADMIN',
          supabaseId,
          status: 'ACTIVE',
          emailVerified: true,
          authProvider: 'email'
        }
      });
      console.log('Created new SUPERADMIN in Database');
    }

    console.log('\n✅ Super Admin created successfully!');
    console.log('-----------------------------------');
    console.log(`📧 Email: ${email}`);
    console.log(`🔑 Password: ${password}`);
    console.log('-----------------------------------\n');

  } catch (error) {
    console.error('Failed to create Super Admin:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createSuperAdmin();
