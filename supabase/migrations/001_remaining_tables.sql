-- ================================================================
-- Z-SPEED: REMAINING TABLES (notifications, promotions, system_configs,
--          pending_approvals, audit_log)
-- NOTE: enums, users, addresses, driver_profiles, vehicles, restaurants,
--       cuisine_types, categories, restaurant_categories, restaurant_cuisines,
--       menu_sections, food_items, carts, cart_items, orders, order_items,
--       order_disputes, delivery_requests, reviews, ledgers
--       were ALREADY created via Supabase MCP migrations.
-- ================================================================

-- =======================
-- NOTIFICATIONS
-- =======================
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "data" JSONB,
  "type" TEXT,
  "read" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "notifications_userId_idx" ON "notifications"("userId");
CREATE INDEX IF NOT EXISTS "notifications_read_idx" ON "notifications"("read");

-- =======================
-- PROMOTIONS
-- =======================
CREATE TABLE IF NOT EXISTS "promotions" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "code" TEXT NOT NULL,
  "description" TEXT,
  "discountType" TEXT NOT NULL,
  "discountValue" DOUBLE PRECISION NOT NULL,
  "maxDiscount" DOUBLE PRECISION,
  "minOrderAmount" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "usageLimit" INTEGER,
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "userUsageLimit" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "promotions_code_key" ON "promotions"("code");

-- =======================
-- SYSTEM CONFIG
-- =======================
CREATE TABLE IF NOT EXISTS "system_configs" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "platformFeePercent" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
  "defaultDeliveryRadiusKm" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
  "maxDeliveryRadiusKm" DOUBLE PRECISION NOT NULL DEFAULT 20.0,
  "driverRequestExpirySeconds" INTEGER NOT NULL DEFAULT 60,
  "maxDriverRequestsPerOrder" INTEGER NOT NULL DEFAULT 5,
  "loyaltyPointsPerEGP" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "loyaltyPointsRedeemRate" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
);

-- Insert default system config row
INSERT INTO "system_configs" ("id") VALUES ('default')
ON CONFLICT ("id") DO NOTHING;

-- =======================
-- PENDING APPROVALS (SuperAdmin)
-- =======================
CREATE TABLE IF NOT EXISTS "pending_approvals" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "actionType" TEXT NOT NULL,
  "targetTable" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "payload" JSONB,
  "requestedById" TEXT NOT NULL,
  "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "rejectionReason" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pending_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pending_approvals_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON UPDATE CASCADE,
  CONSTRAINT "pending_approvals_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "pending_approvals_status_idx" ON "pending_approvals"("status");

-- =======================
-- AUDIT LOG
-- =======================
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT,
  "userRole" TEXT,
  "action" TEXT NOT NULL,
  "targetTable" TEXT,
  "targetId" TEXT,
  "oldData" JSONB,
  "newData" JSONB,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "audit_log_userId_idx" ON "audit_log"("userId");
CREATE INDEX IF NOT EXISTS "audit_log_createdAt_idx" ON "audit_log"("createdAt" DESC);

-- =======================
-- PRISMA MIGRATIONS TABLE (for Prisma compatibility)
-- =======================
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMP WITH TIME ZONE,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMP WITH TIME ZONE,
  "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
);

-- Mark as already migrated by Supabase
INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "finished_at", "applied_steps_count")
VALUES (
  gen_random_uuid()::varchar,
  'supabase_managed',
  '20260428_init_supabase',
  now(),
  1
) ON CONFLICT DO NOTHING;
