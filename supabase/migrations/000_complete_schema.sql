-- ================================================================
-- Z-SPEED: COMPLETE DATABASE SCHEMA
-- Run this in Supabase SQL Editor to create/verify ALL tables
-- This uses IF NOT EXISTS so it's safe to re-run
-- ================================================================

-- =======================
-- ENUMS
-- =======================
DO $$ BEGIN
  CREATE TYPE "Role" AS ENUM ('SUPERADMIN', 'ADMIN', 'VENDOR', 'DRIVER', 'CUSTOMER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION', 'BANNED', 'PENDING_SUSPENSION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'IN_PROGRESS', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentState" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DeliveryRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "LedgerType" AS ENUM ('EARNING', 'PAYOUT', 'REFUND', 'FEE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =======================
-- USERS
-- =======================
CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "firebaseUid" TEXT,
  "email" TEXT NOT NULL,
  "googleId" TEXT,
  "appleId" TEXT,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "role" "Role" NOT NULL DEFAULT 'CUSTOMER',
  "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
  "walletBalance" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
  "fcmTokens" JSONB,
  "notificationPrefs" JSONB,
  "profileImage" TEXT,
  "refreshTokenHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "users_firebaseUid_key" ON "users"("firebaseUid");
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "users_googleId_key" ON "users"("googleId");
CREATE UNIQUE INDEX IF NOT EXISTS "users_appleId_key" ON "users"("appleId");
CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_key" ON "users"("phone");

-- =======================
-- ADDRESSES
-- =======================
CREATE TABLE IF NOT EXISTS "addresses" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "label" TEXT,
  "street" TEXT NOT NULL,
  "building" TEXT,
  "floor" TEXT,
  "apartment" TEXT,
  "city" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "type" TEXT NOT NULL DEFAULT 'home',
  "instructions" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "addresses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- =======================
-- DRIVER PROFILES
-- =======================
CREATE TABLE IF NOT EXISTS "driver_profiles" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "nationalId" TEXT,
  "nationalIdUrl" TEXT,
  "driverLicenseUrl" TEXT,
  "dateOfBirth" TIMESTAMP(3),
  "bankInfo" JSONB,
  "applicationStatus" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
  "rejectionReason" TEXT,
  "acceptanceRate" DOUBLE PRECISION NOT NULL DEFAULT 100.0,
  "rating" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "ratingCount" INTEGER NOT NULL DEFAULT 0,
  "totalTrips" INTEGER NOT NULL DEFAULT 0,
  "totalAccepted" INTEGER NOT NULL DEFAULT 0,
  "totalRejected" INTEGER NOT NULL DEFAULT 0,
  "totalEarnings" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "currentLat" DOUBLE PRECISION,
  "currentLng" DOUBLE PRECISION,
  "geohash" TEXT,
  "lastPingAt" TIMESTAMP(3),
  "payoutMethod" TEXT,
  "payoutPhoneNumber" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "driver_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "driver_profiles_userId_key" ON "driver_profiles"("userId");

-- =======================
-- VEHICLES
-- =======================
CREATE TABLE IF NOT EXISTS "vehicles" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "driverProfileId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "make" TEXT,
  "model" TEXT,
  "year" INTEGER,
  "plateNumber" TEXT,
  "color" TEXT,
  "registrationDocUrl" TEXT,
  "insuranceDocUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vehicles_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "vehicles_driverProfileId_key" ON "vehicles"("driverProfileId");

-- =======================
-- RESTAURANTS
-- =======================
CREATE TABLE IF NOT EXISTS "restaurants" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "ownerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameAr" TEXT,
  "description" TEXT,
  "descriptionAr" TEXT,
  "logoUrl" TEXT,
  "coverImageUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isOpen" BOOLEAN NOT NULL DEFAULT false,
  "status" "AccountStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
  "vendorType" TEXT,
  "address" TEXT,
  "city" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "geohash" TEXT,
  "deliveryRadiusKm" DOUBLE PRECISION,
  "deliveryTimeMin" INTEGER,
  "deliveryTimeMax" INTEGER,
  "deliveryFeeMode" TEXT,
  "deliveryFee" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "deliveryFeeFormula" JSONB,
  "deliveryFeeTiers" JSONB,
  "minimumOrder" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "rating" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "ratingCount" INTEGER NOT NULL DEFAULT 0,
  "walletBalance" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "totalEarnings" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "payoutPhoneNumber" TEXT,
  "bankInfo" JSONB,
  "workingHours" JSONB,
  "documentUrls" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "restaurants_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- =======================
-- CUISINE TYPES
-- =======================
CREATE TABLE IF NOT EXISTS "cuisine_types" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "nameAr" TEXT,
  "imageUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "cuisine_types_pkey" PRIMARY KEY ("id")
);

-- =======================
-- CATEGORIES
-- =======================
CREATE TABLE IF NOT EXISTS "categories" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "nameAr" TEXT,
  "description" TEXT,
  "imageUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- =======================
-- RESTAURANT CATEGORIES (join)
-- =======================
CREATE TABLE IF NOT EXISTS "restaurant_categories" (
  "restaurantId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  CONSTRAINT "restaurant_categories_pkey" PRIMARY KEY ("restaurantId", "categoryId"),
  CONSTRAINT "restaurant_categories_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "restaurant_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- =======================
-- RESTAURANT CUISINES (join)
-- =======================
CREATE TABLE IF NOT EXISTS "restaurant_cuisines" (
  "restaurantId" TEXT NOT NULL,
  "cuisineTypeId" TEXT NOT NULL,
  CONSTRAINT "restaurant_cuisines_pkey" PRIMARY KEY ("restaurantId", "cuisineTypeId"),
  CONSTRAINT "restaurant_cuisines_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "restaurant_cuisines_cuisineTypeId_fkey" FOREIGN KEY ("cuisineTypeId") REFERENCES "cuisine_types"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- =======================
-- MENU SECTIONS
-- =======================
CREATE TABLE IF NOT EXISTS "menu_sections" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "restaurantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameAr" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "menu_sections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "menu_sections_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- =======================
-- FOOD ITEMS
-- =======================
CREATE TABLE IF NOT EXISTS "food_items" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "sectionId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "imageUrl" TEXT,
  "price" DOUBLE PRECISION NOT NULL,
  "originalPrice" DOUBLE PRECISION,
  "isOnSale" BOOLEAN NOT NULL DEFAULT false,
  "isAvailable" BOOLEAN NOT NULL DEFAULT true,
  "addons" JSONB,
  "allergens" TEXT[] DEFAULT '{}',
  "prepTimeMin" INTEGER NOT NULL DEFAULT 10,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "food_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "food_items_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "menu_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- =======================
-- CARTS
-- =======================
CREATE TABLE IF NOT EXISTS "carts" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "customerId" TEXT NOT NULL,
  "restaurantId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "carts_customerId_key" ON "carts"("customerId");

-- =======================
-- CART ITEMS
-- =======================
CREATE TABLE IF NOT EXISTS "cart_items" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "cartId" TEXT NOT NULL,
  "foodItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unitPrice" DOUBLE PRECISION NOT NULL,
  "selectedAddons" JSONB,
  "specialNote" TEXT,
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cart_items_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "food_items"("id") ON UPDATE CASCADE
);

-- =======================
-- ORDERS
-- =======================
CREATE TABLE IF NOT EXISTS "orders" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "customerId" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "driverId" TEXT,
  "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
  "subtotal" DOUBLE PRECISION NOT NULL,
  "deliveryFee" DOUBLE PRECISION NOT NULL,
  "serviceFee" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "tax" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "discount" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "total" DOUBLE PRECISION NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "paymentState" "PaymentState" NOT NULL DEFAULT 'PENDING',
  "deliveryAddress" TEXT NOT NULL,
  "deliveryLat" DOUBLE PRECISION NOT NULL,
  "deliveryLng" DOUBLE PRECISION NOT NULL,
  "customerNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3),
  "preparingAt" TIMESTAMP(3),
  "readyAt" TIMESTAMP(3),
  "driverAssignedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON UPDATE CASCADE,
  CONSTRAINT "orders_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON UPDATE CASCADE,
  CONSTRAINT "orders_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles"("id") ON UPDATE CASCADE
);

-- =======================
-- ORDER ITEMS
-- =======================
CREATE TABLE IF NOT EXISTS "order_items" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "orderId" TEXT NOT NULL,
  "foodItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPrice" DOUBLE PRECISION NOT NULL,
  "selectedAddons" JSONB,
  "specialNote" TEXT,
  CONSTRAINT "order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_items_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "food_items"("id") ON UPDATE CASCADE
);

-- =======================
-- ORDER DISPUTES
-- =======================
CREATE TABLE IF NOT EXISTS "order_disputes" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "orderId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "details" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "adminResolution" TEXT,
  "resolvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_disputes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_disputes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_disputes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON UPDATE CASCADE
);

-- =======================
-- DELIVERY REQUESTS
-- =======================
CREATE TABLE IF NOT EXISTS "delivery_requests" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "orderId" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "status" "DeliveryRequestStatus" NOT NULL DEFAULT 'PENDING',
  "deliveryFee" DOUBLE PRECISION NOT NULL,
  "estimatedDistance" DOUBLE PRECISION,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_requests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "delivery_requests_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- =======================
-- REVIEWS
-- =======================
CREATE TABLE IF NOT EXISTS "reviews" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "orderId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "restaurantRating" DOUBLE PRECISION NOT NULL,
  "driverRating" DOUBLE PRECISION,
  "comment" TEXT,
  "vendorReply" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reviews_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reviews_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reviews_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- =======================
-- LEDGERS
-- =======================
CREATE TABLE IF NOT EXISTS "ledgers" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "orderId" TEXT,
  "type" "LedgerType" NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledgers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ledgers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON UPDATE CASCADE,
  CONSTRAINT "ledgers_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON UPDATE CASCADE
);

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
INSERT INTO "system_configs" ("id") VALUES ('default') ON CONFLICT ("id") DO NOTHING;

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

-- ================================================================
-- VERIFICATION QUERY
-- ================================================================
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
