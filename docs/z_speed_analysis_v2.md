# Z-Speed — NestJS Backend Plan v2 (SuperAdmin Edition)

---

## 1. أدوار المستخدمين (5 أدوار)

| الدور | الصلاحية |
|-------|----------|
| `superadmin` | يملك كل شيء — الموافقة على عمليات الحذف النهائي + مراجعة تعديلات الـ admin |
| `admin` | إدارة يومية — soft delete فقط — يطلب موافقة superadmin للحذف النهائي |
| `vendor` | إدارة مطعمه وقائمته |
| `driver` | استقبال الطلبات وتحديث الموقع |
| `customer` | تصفح وطلب طعام |

---

## 2. نظام الموافقات (Approval Workflow)

### المبدأ الأساسي:
```
Admin يعمل أي action → ينشئ record في جدول pending_approvals → SuperAdmin يوافق/يرفض
```

### ما يحتاج موافقة SuperAdmin:
| Action | من يطلب | ما يحدث قبل الموافقة |
|--------|---------|----------------------|
| حذف نهائي (hard delete) | Admin | السجل soft-deleted فقط |
| تغيير role مستخدم | Admin | التغيير معلق |
| تعليق مستخدم (ban) | Admin | الحالة `pending_suspension` |
| رفض مطعم نهائياً | Admin | الحالة `pending_rejection` |
| تعديل بيانات نظام حساسة | Admin | التعديل معلق |

### ما يستطيع Admin فعله مباشرة (بدون موافقة):
- قبول/رفض مبدئي لطلبات Driver
- قبول/رفض مبدئي لطلبات Restaurant
- تعديل categories
- عرض كل الإحصاءات والتقارير
- إرسال إشعارات للمستخدمين
- soft delete لأي سجل
- حل النزاعات (disputes)
- إضافة/تعديل promotions

---

## 3. وظائف Admin بالتفصيل

### 3.1 إدارة المستخدمين
```
GET    /admin/users                    -- قائمة كل المستخدمين + فلتر بالنوع/الحالة
GET    /admin/users/:id                -- تفاصيل مستخدم
PATCH  /admin/users/:id/status         -- تغيير الحالة (active/inactive/suspended)
POST   /admin/users/:id/hard-delete    -- طلب حذف نهائي → ينتظر SuperAdmin
POST   /admin/users/:id/notify         -- إرسال إشعار لمستخدم
```

### 3.2 قبول/رفض السائقين (Driver Onboarding)
```
GET    /admin/drivers/applications     -- طلبات الانضمام (pending/underReview)
GET    /admin/drivers/applications/:id -- تفاصيل الطلب + الوثائق
PATCH  /admin/drivers/:id/approve      -- قبول السائق → يغير applicationStatus=approved
PATCH  /admin/drivers/:id/reject       -- رفض مع سبب → يغير applicationStatus=rejected
PATCH  /admin/drivers/:id/review       -- وضع underReview
GET    /admin/drivers/active           -- السائقين النشطين حالياً
GET    /admin/drivers/locations        -- مواقع السائقين real-time
```

**عند القبول:** يُرسل إشعار FCM + يُحدَّث applicationStatus + يُسمح للسائق بالدخول للداشبورد

**عند الرفض:** يُرسل إشعار مع السبب + يُحفظ rejectionReason

### 3.3 قبول/رفض المطاعم (Restaurant Onboarding)
```
GET    /admin/restaurants/pending      -- المطاعم تنتظر المراجعة
GET    /admin/restaurants/:id/docs     -- مستندات المطعم (رخص/ضرائب/صحة)
PATCH  /admin/restaurants/:id/approve  -- قبول → status=approved + إشعار للـ vendor
PATCH  /admin/restaurants/:id/reject   -- رفض مبدئي مع سبب
POST   /admin/restaurants/:id/hard-reject -- رفض نهائي → ينتظر SuperAdmin
PATCH  /admin/restaurants/:id/suspend  -- تعليق مطعم
```

### 3.4 إدارة الطلبات
```
GET    /admin/orders                   -- كل الطلبات مع فلتر
GET    /admin/orders/:id               -- تفاصيل طلب
PATCH  /admin/orders/:id/status        -- تعديل حالة يدوياً (حالات طارئة)
POST   /admin/orders/:id/reassign-driver -- تغيير السائق
POST   /admin/orders/:id/refund        -- معالجة استرداد
```

### 3.5 إدارة النزاعات (Disputes)
```
GET    /admin/disputes                 -- قائمة النزاعات
GET    /admin/disputes/:id             -- تفاصيل نزاع
PATCH  /admin/disputes/:id/resolve     -- حل النزاع (في صالح من + ملاحظة)
PATCH  /admin/disputes/:id/escalate    -- تصعيد للـ SuperAdmin
```

### 3.6 التصنيفات والمحتوى
```
POST   /admin/categories               -- إضافة تصنيف
PATCH  /admin/categories/:id           -- تعديل
DELETE /admin/categories/:id           -- soft delete
POST   /admin/promotions               -- إضافة عرض
PATCH  /admin/promotions/:id           -- تعديل
DELETE /admin/promotions/:id           -- إلغاء
```

### 3.7 الإحصاءات والتقارير
```
GET    /admin/stats/daily              -- إحصاءات يوم معين
GET    /admin/stats/range              -- إحصاءات فترة زمنية
GET    /admin/stats/restaurants        -- أداء المطاعم
GET    /admin/stats/drivers            -- أداء السائقين
GET    /admin/stats/revenue            -- تقرير الإيرادات
```

---

## 4. وظائف SuperAdmin

```
GET    /superadmin/pending-approvals         -- كل الطلبات المعلقة
GET    /superadmin/pending-approvals/:id     -- تفاصيل طلب
PATCH  /superadmin/pending-approvals/:id/approve -- موافقة وتنفيذ الـ action
PATCH  /superadmin/pending-approvals/:id/reject  -- رفض الطلب وإعادته

POST   /superadmin/admins                   -- إنشاء admin جديد
DELETE /superadmin/admins/:id               -- إزالة admin
GET    /superadmin/admins/activity          -- سجل نشاط الـ admins

GET    /superadmin/system/config            -- إعدادات النظام
PATCH  /superadmin/system/config            -- تعديل الإعدادات
GET    /superadmin/audit-log                -- كامل سجل العمليات
```

---

## 5. Supabase Tables (بنفس أسماء Firestore Collections)

> كل الجداول تحتفظ بنفس أسماء collections الـ Firestore

```sql
-- ====== COLLECTION: users ======
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  google_id TEXT,
  type TEXT CHECK(type IN ('superadmin','admin','vendor','customer','driver')) NOT NULL,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive','suspended','pendingVerification','banned','pending_suspension')),
  phone TEXT,
  address TEXT,
  profile_image TEXT,
  date_of_birth DATE,
  national_id TEXT,
  driver_license_url TEXT,
  national_id_url TEXT,
  vehicle_id UUID,
  bank_name TEXT,
  bank_account_holder TEXT,
  bank_iban TEXT,
  application_status TEXT CHECK(application_status IN ('pending','underReview','approved','rejected')),
  rejection_reason TEXT,
  applied_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  fcm_token TEXT,
  refresh_token_hash TEXT,
  is_available BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  updated_at TIMESTAMPTZ,
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID
);

-- ====== COLLECTION: restaurants ======
CREATE TABLE restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  logo_url TEXT,
  cover_image_url TEXT,
  rating NUMERIC DEFAULT 0,
  rating_count INT DEFAULT 0,
  total_orders INT DEFAULT 0,
  total_reviews INT DEFAULT 0,
  delivery_time INT DEFAULT 30,
  delivery_fee NUMERIC DEFAULT 0,
  categories TEXT[],
  cuisine_types TEXT[],
  is_open BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','suspended','pending_rejection')),
  rejection_reason TEXT,
  address TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  menu_ids TEXT[],
  owner_name TEXT,
  owner_phone TEXT,
  owner_email TEXT,
  commercial_reg_number TEXT,
  business_license_url TEXT,
  health_certificate_url TEXT,
  tax_registration_url TEXT,
  bank_name TEXT,
  bank_account_holder TEXT,
  bank_iban TEXT,
  operating_hours JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  updated_at TIMESTAMPTZ,
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID
);

-- ====== COLLECTION: foods ======
CREATE TABLE foods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID REFERENCES restaurants(id),
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  price NUMERIC NOT NULL,
  original_price NUMERIC,
  is_on_sale BOOLEAN DEFAULT false,
  category TEXT,
  available BOOLEAN DEFAULT true,
  addons JSONB DEFAULT '[]',
  allergens TEXT[],
  preparation_time INT DEFAULT 10,
  rating NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  updated_at TIMESTAMPTZ,
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID
);

-- ====== COLLECTION: orders ======
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES users(id),
  customer_name TEXT,
  customer_phone TEXT,
  restaurant_id UUID REFERENCES restaurants(id),
  restaurant_name TEXT,
  driver_id UUID REFERENCES users(id),
  driver_name TEXT,
  vendor_id UUID,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','confirmed','preparing','ready','inProgress','outForDelivery','delivered','cancelled')),
  items JSONB NOT NULL,
  item_count INT,
  subtotal NUMERIC,
  delivery_fee NUMERIC,
  tax NUMERIC,
  total NUMERIC,
  discount NUMERIC,
  promo_code TEXT,
  pickup_address TEXT,
  delivery_address TEXT,
  restaurant_latitude NUMERIC,
  restaurant_longitude NUMERIC,
  delivery_latitude NUMERIC,
  delivery_longitude NUMERIC,
  notes TEXT,
  payment_method TEXT,
  is_paid BOOLEAN DEFAULT false,
  estimated_delivery TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  rating NUMERIC,
  review TEXT,
  updated_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- ====== COLLECTION: carts ======
CREATE TABLE carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES users(id) UNIQUE,
  restaurant_id UUID REFERENCES restaurants(id),
  items JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- ====== COLLECTION: addresses ======
CREATE TABLE addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  label TEXT,
  street TEXT NOT NULL,
  building TEXT,
  floor TEXT,
  apartment TEXT,
  city TEXT NOT NULL,
  district TEXT,
  postal_code TEXT,
  latitude NUMERIC NOT NULL,
  longitude NUMERIC NOT NULL,
  is_default BOOLEAN DEFAULT false,
  type TEXT DEFAULT 'home' CHECK(type IN ('home','work','other')),
  instructions TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  updated_at TIMESTAMPTZ,
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID
);

-- ====== COLLECTION: vehicles ======
CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID REFERENCES users(id),
  type TEXT CHECK(type IN ('car','motorcycle','bicycle','van')),
  make TEXT,
  model TEXT,
  year INT,
  plate_number TEXT,
  color TEXT,
  registration_doc_url TEXT,
  insurance_doc_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  updated_at TIMESTAMPTZ,
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID
);

-- ====== COLLECTION: reviews ======
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  customer_id UUID REFERENCES users(id),
  customer_name TEXT,
  restaurant_id UUID REFERENCES restaurants(id),
  restaurant_name TEXT,
  driver_id UUID REFERENCES users(id),
  driver_name TEXT,
  restaurant_rating NUMERIC NOT NULL,
  driver_rating NUMERIC,
  comment TEXT,
  vendor_reply TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- ====== COLLECTION: categories ======
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT 'category',
  color TEXT,
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID
);

-- ====== COLLECTION: paymentMethods ======
CREATE TABLE "paymentMethods" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  name TEXT,
  type TEXT CHECK(type IN ('visa','mastercard','amex','cash','paypal','applePay','googlePay','wallet')),
  last4 TEXT,
  cardholder_name TEXT,
  expiry_month TEXT,
  expiry_year TEXT,
  brand TEXT,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- ====== COLLECTION: notifications ======
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ====== COLLECTION: promotions ======
CREATE TABLE promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE,
  description TEXT,
  discount_type TEXT CHECK(discount_type IN ('percentage','fixed')),
  discount_value NUMERIC,
  min_order_value NUMERIC DEFAULT 0,
  max_uses INT,
  used_count INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID
);

-- ====== COLLECTION: disputes ======
CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  customer_id UUID REFERENCES users(id),
  vendor_id UUID REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'open' CHECK(status IN ('open','under_review','resolved','escalated')),
  resolution TEXT,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- ====== COLLECTION: trips ======
CREATE TABLE trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  driver_id UUID REFERENCES users(id),
  restaurant_id UUID REFERENCES restaurants(id),
  status TEXT DEFAULT 'assigned' CHECK(status IN ('assigned','pickedUp','delivered','cancelled')),
  pickup_lat NUMERIC,
  pickup_lng NUMERIC,
  delivery_lat NUMERIC,
  delivery_lng NUMERIC,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- ====== COLLECTION: driverLocations ======
CREATE TABLE "driverLocations" (
  driver_id UUID PRIMARY KEY REFERENCES users(id),
  latitude NUMERIC NOT NULL,
  longitude NUMERIC NOT NULL,
  heading NUMERIC,
  speed NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ====== COLLECTION: price_history ======
CREATE TABLE price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT CHECK(entity_type IN ('food','delivery_fee')),
  entity_id UUID NOT NULL,
  old_price NUMERIC,
  new_price NUMERIC,
  change_reason TEXT,
  changed_by UUID,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ====== COLLECTION: daily_stats ======
CREATE TABLE daily_stats (
  date DATE PRIMARY KEY,
  total_orders INT DEFAULT 0,
  delivered_orders INT DEFAULT 0,
  cancelled_orders INT DEFAULT 0,
  total_revenue NUMERIC DEFAULT 0,
  average_order_value NUMERIC DEFAULT 0,
  new_users INT DEFAULT 0,
  active_drivers INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ====== COLLECTION: rate_limits ======
CREATE TABLE rate_limits (
  id TEXT PRIMARY KEY,
  count INT DEFAULT 0,
  reset_at TIMESTAMPTZ,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- ====== جديد: pending_approvals ======
CREATE TABLE pending_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL,
  -- مثال: 'hard_delete_user', 'ban_user', 'reject_restaurant', 'change_role'
  target_table TEXT NOT NULL,
  target_id UUID NOT NULL,
  payload JSONB,          -- البيانات الجديدة المطلوب تطبيقها
  requested_by UUID REFERENCES users(id),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ====== جديد: audit_log ======
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  user_role TEXT,
  action TEXT NOT NULL,
  target_table TEXT,
  target_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 6. نظام الصلاحيات الكامل (RBAC Matrix)

| Action | superadmin | admin | vendor | driver | customer |
|--------|-----------|-------|--------|--------|----------|
| Hard Delete أي سجل | ✅ | ❌ (يطلب فقط) | ❌ | ❌ | ❌ |
| Soft Delete أي سجل | ✅ | ✅ | ❌ | ❌ | ❌ |
| Ban مستخدم | ✅ | 🔄 يطلب موافقة | ❌ | ❌ | ❌ |
| تغيير Role مستخدم | ✅ | 🔄 يطلب موافقة | ❌ | ❌ | ❌ |
| قبول Driver | ✅ | ✅ | ❌ | ❌ | ❌ |
| قبول Restaurant | ✅ | ✅ | ❌ | ❌ | ❌ |
| رفض Restaurant نهائي | ✅ | 🔄 يطلب موافقة | ❌ | ❌ | ❌ |
| إنشاء Admin | ✅ | ❌ | ❌ | ❌ | ❌ |
| الموافقة على pending_approvals | ✅ | ❌ | ❌ | ❌ | ❌ |
| إدارة Categories | ✅ | ✅ | ❌ | ❌ | ❌ |
| إدارة Promotions | ✅ | ✅ | ❌ | ❌ | ❌ |
| حل Disputes | ✅ | ✅ | ❌ | ❌ | ❌ |
| عرض إحصاءات | ✅ | ✅ | ✅ (مطعمه فقط) | ❌ | ❌ |
| تعديل قائمة الطعام | ✅ | ✅ | ✅ (مطعمه فقط) | ❌ | ❌ |
| إنشاء طلب | ❌ | ❌ | ❌ | ❌ | ✅ |
| تحديث الموقع | ❌ | ❌ | ❌ | ✅ | ❌ |
| تحديث حالة الطلب | ✅ | ✅ | ✅ (confirmed→ready) | ✅ (inProgress→delivered) | ✅ (cancel) |
| عرض Audit Log | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 7. Order Status Machine

```
pending → confirmed → preparing → ready → inProgress → outForDelivery → delivered
         ↘ cancelled (customer أو vendor أو admin)
```

---

## 8. NestJS Modules المطلوبة

```
auth/           -- JWT + Passport (Local + Google + JWT-Refresh)
users/          -- CRUD + status management
restaurants/    -- CRUD + onboarding + approval
foods/          -- Menu management + price history
orders/         -- Order lifecycle + state machine
cart/           -- Shopping cart
addresses/      -- User addresses
drivers/        -- Driver management + location
vehicles/       -- Vehicle CRUD
reviews/        -- Review + vendor reply
categories/     -- Food categories
notifications/  -- FCM + in-app notifications
promotions/     -- Promo codes
disputes/       -- Dispute management
admin/          -- Admin-specific endpoints
superadmin/     -- SuperAdmin-only endpoints
audit/          -- Audit log interceptor
gateway/        -- Socket.IO (realtime)
queues/         -- Bull Queue (cron jobs)
supabase/       -- Supabase client service
common/         -- Guards, Decorators, Pipes, Interceptors
```

---

## 9. Pending Approval Flow (مثال: حذف نهائي)

```
1. Admin → DELETE /admin/users/:id/hard-delete
2. OrdersService يعمل soft-delete (deleted_at = NOW())
3. يُنشئ record في pending_approvals:
   { action_type: 'hard_delete_user', target_table: 'users', target_id, requested_by: adminId }
4. يُرسل إشعار للـ SuperAdmin
5. SuperAdmin → PATCH /superadmin/pending-approvals/:id/approve
6. النظام يطبق الـ hard delete فعلياً ويسجل في audit_log
```

---

## 10. Real-time Events (Socket.IO)

| Event | الاتجاه | من يستمع |
|-------|---------|---------|
| `order:new` | Server→Vendor | Vendor Dashboard |
| `order:status_changed` | Server→Customer | Customer App |
| `order:assigned` | Server→Driver | Driver App |
| `driver:location_update` | Driver→Server | السائق يرسل |
| `driver:location` | Server→Customer | Customer يتابع السائق |
| `approval:new` | Server→SuperAdmin | SuperAdmin Dashboard |

---

## 11. Background Jobs (Bull Queue)

| Job | الجدول | الوظيفة |
|-----|--------|---------|
| `cleanup-rate-limits` | كل ساعة | حذف rate_limits منتهية |
| `update-daily-stats` | 00:00 UTC | إحصاءات أمس |
| `cleanup-soft-deleted` | الأحد 02:00 | حذف سجلات +30 يوم |
| `cleanup-expired-cache` | 03:00 يومياً | تنظيف Cache |
| `send-fcm-notification` | on-demand | إرسال إشعارات |
| `sync-user-data` | on-demand | مزامنة بيانات المستخدم |
| `sync-restaurant-data` | on-demand | مزامنة بيانات المطعم |
