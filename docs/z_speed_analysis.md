# Z-Speed App — تحليل شامل + خطة Backend بـ NestJS

## 1. نظرة عامة على المشروع

**Z Speed Delivery** — تطبيق Flutter لتوصيل الطعام بـ 4 أدوار مستخدمين:

| الدور | الوصف |
|-------|-------|
| `admin` | إدارة كاملة للنظام |
| `vendor` | صاحب مطعم — يدير القائمة والطلبات |
| `driver` | سائق التوصيل |
| `customer` | العميل الذي يطلب الطعام |

**Stack الحالي:** Flutter + Firebase Auth + Firestore + Firebase Functions (TypeScript) + FCM

---

## 2. تحليل Firebase Functions (الباك اند الحالي)

### 📦 الـ Functions المُصدَّرة (18 function)

#### أ) Firestore Triggers (Event-Driven)

| Function | Trigger | المهمة |
|----------|---------|--------|
| `onUserUpdate` | `users/{userId}` onUpdate | sync اسم المستخدم في الـ orders والـ restaurants |
| `onRestaurantUpdate` | `restaurants/{restaurantId}` onUpdate | sync بيانات المطعم في الـ orders النشطة |
| `onOrderCreate` | `orders/{orderId}` onCreate | إنشاء subcollections في user/restaurant |
| `onOrderUpdate` | `orders/{orderId}` onUpdate | sync الـ status في subcollections + driver assignment |
| `onFoodUpdate` | `foods/{foodId}` onUpdate | تسجيل price_history عند تغيير السعر |
| `onOrderCreatedNotify` | `orders/{orderId}` onCreate | إشعار FCM للـ vendor بطلب جديد |
| `onOrderStatusChanged` | `orders/{orderId}` onUpdate | إشعار FCM للعميل بتغيير الحالة |
| `onOrderReady` | `orders/{orderId}` onUpdate | إشعار FCM لكل السائقين المتاحين |
| `onDriverAssigned` | `orders/{orderId}` onUpdate | إشعار FCM للعميل بالسائق المُعيَّن |
| `onDeliveryCompleted` | `orders/{orderId}` onUpdate | إشعار FCM للعميل "قيّم تجربتك" |
| `sendOrderStatusNotification` | `orders/{orderId}` onUpdate | إشعار FCM موحد (legacy) |

#### ب) Scheduled Functions (Cron)

| Function | الجدول | المهمة |
|----------|--------|--------|
| `cleanupRateLimits` | كل ساعة | حذف rate_limits منتهية الصلاحية |
| `updateDailyStats` | كل يوم منتصف الليل | إحصاءات اليومية (orders/revenue) |
| `cleanupSoftDeleted` | الأحد 2 صباحاً | حذف Documents محذوفة soft منذ 30 يوم |
| `cleanupExpiredCache` | كل يوم 3 صباحاً | تنظيف cache منتهي الصلاحية |

#### ج) Callable Functions (HTTP)

| Function | Rate Limit | المهمة |
|----------|-----------|--------|
| `sendPushNotification` | 50 req/min | إرسال إشعار FCM لمستخدم معين |
| `updateOrderStatus` | 100 req/min | تحديث حالة الطلب مع صلاحيات |

#### د) HTTP Endpoints

| Function | Method | المهمة |
|----------|--------|--------|
| `healthCheck` | GET | فحص صحة الخدمات |

---

## 3. نظام Distributed Rate Limiting

- **آلية:** Firestore transactions + in-memory cache (5s TTL)
- **Pattern:** Sliding window counter
- **Collections:** `rate_limits/{docId}`
- **في NestJS:** سيُستبدل بـ `@nestjs/throttler` + Redis

---

## 4. تحليل Data Models

### AppUser
```
id, name, email, type (admin/vendor/customer/driver)
phone, address, profileImage, status (active/inactive/suspended/pendingVerification/banned)
-- Driver fields: dateOfBirth, nationalId, driverLicenseUrl, nationalIdUrl, vehicleId
-- Banking: bankName, bankAccountHolder, bankIban
-- Application: applicationStatus (pending/underReview/approved/rejected), rejectionReason, appliedAt, approvedAt
-- Audit: createdAt, createdBy, updatedAt, updatedBy, deletedAt, deletedBy
```

### Order
```
id, customerId, customerName, customerPhone
restaurantId, restaurantName, driverId, driverName
status: pending→confirmed→preparing→ready→inProgress→outForDelivery→delivered|cancelled
items: [{id, foodId, name, quantity, price, imageUrl, addons, notes}]
subtotal, deliveryFee, tax, total, discount, promoCode
pickupAddress, deliveryAddress, lat/lng for both
notes, paymentMethod, isPaid
createdAt, updatedAt, estimatedDelivery, deliveredAt
rating, review
```

### Restaurant
```
id, name, description, ownerId
logoUrl, coverImageUrl, rating, ratingCount
deliveryTime (minutes), deliveryFee
categories[], cuisineTypes[]
isOpen, status (pending/approved/rejected/suspended), rejectionReason
address, latitude, longitude
menuIds[]
-- Onboarding: ownerName, ownerPhone, ownerEmail
-- Documents: commercialRegNumber, businessLicenseUrl, healthCertificateUrl, taxRegistrationUrl
-- Banking: bankName, bankAccountHolder, bankIban
-- operatingHours: {monday: {open, close}, ...}
-- Audit + SoftDelete fields
```

### FoodModel
```
id, name, description, imageUrl, price, originalPrice, isOnSale
category, available, addons[], allergens[], preparationTime (min)
restaurantId, rating
-- Audit + SoftDelete fields
```

### Vehicle (Driver)
```
id, driverId, type (car/motorcycle/bicycle/van)
make, model, year, plateNumber, color
registrationDocUrl, insuranceDocUrl
-- Audit + SoftDelete fields
```

### Address
```
id, userId, label, street, building, floor, apartment
city, district, postalCode, latitude, longitude
isDefault, type (home/work/other), instructions
-- Audit + SoftDelete fields
```

### PaymentMethod
```
id, userId, name, type (visa/mastercard/amex/cash/paypal/applePay/googlePay/wallet)
last4, cardholderName, expiryMonth, expiryYear, brand
isDefault, isActive, createdAt, updatedAt
```

### Review
```
id, orderId, customerId, customerName
restaurantId, restaurantName, driverId, driverName
restaurantRating, driverRating, comment, vendorReply
createdAt, updatedAt
```

### Other Collections (من Firestore Rules)
- `carts/{cartId}` — سلة تسوق العميل
- `disputes/{disputeId}` — نزاعات العملاء
- `trips/{tripId}` — رحلات التوصيل
- `categories/{categoryId}` — تصنيفات الأكل
- `driverLocations/{driverId}` — تتبع السائق real-time
- `notifications/{notificationId}` — الإشعارات
- `promotions/{promoId}` — العروض والكوبونات
- `price_history` — سجل تغييرات الأسعار
- `daily_stats` — الإحصاءات اليومية
- `rate_limits` — حدود الطلبات

---

## 5. RBAC (نظام الصلاحيات)

| Action | admin | vendor | driver | customer |
|--------|-------|--------|--------|----------|
| قراءة أي مستخدم | ✅ | ❌ | ❌ | ❌ (نفسه فقط) |
| إنشاء/إدارة مطعم | ✅ | ✅ (ownerId) | ❌ | ❌ |
| إنشاء طلب | ✅ | ❌ | ❌ | ✅ (active فقط) |
| تحديث حالة الطلب | ✅ | ✅ (confirmed→ready) | ✅ (inProgress→delivered) | ✅ (cancel فقط) |
| إدارة التصنيفات | ✅ | ❌ | ❌ | ❌ |
| قراءة المطاعم | ✅ | ✅ | ✅ | ✅ |
| تحديث location | ❌ | ❌ | ✅ (نفسه) | ❌ |

---

## 6. خطة NestJS Backend

### Tech Stack
```
NestJS + TypeScript
Supabase (PostgreSQL + Storage + Realtime)
JWT (Access Token 15min + Refresh Token 7d)
Passport.js (Local + Google OAuth2)
@nestjs/throttler + Redis (Rate Limiting)
Socket.IO (Real-time: driver location + order status)
Bull Queue (Background jobs بدل Cron)
Multer + Supabase Storage (File uploads)
```

### هيكل المشروع
```
src/
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── strategies/
│   │   ├── jwt.strategy.ts
│   │   ├── jwt-refresh.strategy.ts
│   │   ├── local.strategy.ts
│   │   └── google.strategy.ts
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   ├── roles.guard.ts
│   │   └── google-auth.guard.ts
│   └── dto/
│       ├── login.dto.ts
│       ├── register.dto.ts
│       └── google-auth.dto.ts
├── users/
│   ├── users.module.ts
│   ├── users.controller.ts
│   ├── users.service.ts
│   └── dto/
├── restaurants/
│   ├── restaurants.module.ts
│   ├── restaurants.controller.ts
│   ├── restaurants.service.ts
│   └── dto/
├── food/
│   ├── food.module.ts
│   ├── food.controller.ts
│   ├── food.service.ts
│   └── dto/
├── orders/
│   ├── orders.module.ts
│   ├── orders.controller.ts
│   ├── orders.service.ts
│   ├── order-state-machine.service.ts
│   └── dto/
├── cart/
├── addresses/
├── payments/
├── reviews/
├── categories/
├── drivers/
│   ├── drivers.module.ts
│   ├── drivers.service.ts
│   └── location-tracking.service.ts
├── notifications/
│   ├── notifications.module.ts
│   ├── notifications.service.ts
│   └── fcm.service.ts
├── admin/
│   ├── admin.module.ts
│   ├── admin.controller.ts
│   └── stats.service.ts
├── common/
│   ├── decorators/
│   │   ├── roles.decorator.ts
│   │   └── current-user.decorator.ts
│   ├── guards/
│   ├── interceptors/
│   │   └── audit.interceptor.ts
│   └── pipes/
├── gateway/
│   └── realtime.gateway.ts   ← Socket.IO
├── queues/
│   ├── cleanup.processor.ts
│   ├── stats.processor.ts
│   └── notification.processor.ts
├── supabase/
│   └── supabase.service.ts
└── main.ts
```

---

## 7. REST API Endpoints

### Auth
```
POST   /auth/register              -- تسجيل جديد
POST   /auth/login                 -- تسجيل دخول (email/password)
POST   /auth/google                -- Google OAuth
POST   /auth/refresh               -- تجديد Access Token
POST   /auth/logout                -- إلغاء Refresh Token
POST   /auth/forgot-password       -- طلب reset password
POST   /auth/reset-password        -- تأكيد reset
```

### Users
```
GET    /users/me                   -- بيانات المستخدم الحالي
PATCH  /users/me                   -- تعديل البيانات
DELETE /users/me                   -- soft delete
GET    /users/:id            [A]   -- Admin: عرض أي مستخدم
PATCH  /users/:id/status    [A]   -- Admin: تغيير حالة المستخدم
GET    /users                [A]   -- Admin: قائمة المستخدمين
```

### Restaurants
```
GET    /restaurants                -- قائمة المطاعم (public)
GET    /restaurants/:id            -- تفاصيل مطعم (public)
POST   /restaurants         [V]   -- إنشاء مطعم
PATCH  /restaurants/:id    [V/A]  -- تعديل بيانات
DELETE /restaurants/:id    [A]    -- حذف
PATCH  /restaurants/:id/status [A] -- تغيير الحالة (approve/reject)
GET    /restaurants/:id/menu       -- قائمة الطعام
```

### Food
```
GET    /food                       -- قائمة أصناف (filter by restaurant/category)
GET    /food/:id                   -- تفاصيل صنف
POST   /food              [V]      -- إضافة صنف
PATCH  /food/:id          [V]      -- تعديل صنف
DELETE /food/:id          [V/A]   -- حذف
```

### Orders
```
POST   /orders            [C]      -- إنشاء طلب
GET    /orders/my         [C]      -- طلبات العميل
GET    /orders/:id                 -- تفاصيل طلب
PATCH  /orders/:id/status          -- تحديث الحالة (RBAC)
GET    /orders/restaurant/:id [V]  -- طلبات المطعم
GET    /orders/driver/my   [D]     -- طلبات السائق
GET    /orders            [A]      -- Admin: كل الطلبات
```

### Cart
```
GET    /cart              [C]      -- عرض السلة
POST   /cart/items        [C]      -- إضافة عنصر
PATCH  /cart/items/:id    [C]      -- تعديل كمية
DELETE /cart/items/:id    [C]      -- حذف عنصر
DELETE /cart              [C]      -- تفريغ السلة
```

### Addresses
```
GET    /addresses         [C]      -- قائمة العناوين
POST   /addresses         [C]      -- إضافة عنوان
PATCH  /addresses/:id     [C]      -- تعديل
DELETE /addresses/:id     [C]      -- حذف
PATCH  /addresses/:id/default [C]  -- تعيين افتراضي
```

### Drivers
```
GET    /drivers/available           -- السائقين المتاحين (system)
PATCH  /drivers/availability [D]   -- تغيير حالة التوفر
PATCH  /drivers/location    [D]    -- تحديث الموقع
POST   /drivers/apply       [D]    -- تقديم طلب انضمام
GET    /drivers/applications [A]   -- Admin: طلبات السائقين
PATCH  /drivers/:id/approve [A]   -- قبول/رفض طلب
```

### Notifications
```
GET    /notifications     [Auth]   -- قائمة الإشعارات
PATCH  /notifications/:id/read     -- تحديد كمقروء
DELETE /notifications/:id          -- حذف
POST   /notifications/push [A]     -- إرسال إشعار (Admin)
```

### Reviews
```
POST   /reviews           [C]      -- إضافة تقييم
GET    /reviews/restaurant/:id     -- تقييمات مطعم
PATCH  /reviews/:id/reply [V]      -- رد الـ vendor
```

### Categories
```
GET    /categories                 -- قائمة التصنيفات (public)
POST   /categories        [A]      -- إضافة
PATCH  /categories/:id    [A]      -- تعديل
DELETE /categories/:id    [A]      -- حذف
```

### Admin
```
GET    /admin/stats/daily  [A]     -- إحصاءات يومية
GET    /admin/stats/summary [A]    -- ملخص عام
GET    /admin/disputes     [A]     -- النزاعات
PATCH  /admin/disputes/:id [A]     -- حل نزاع
```

### Health
```
GET    /health                     -- health check
```

**Legend:** [A]=Admin, [V]=Vendor, [D]=Driver, [C]=Customer

---

## 8. Supabase Tables Schema

```sql
-- users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  google_id TEXT,
  type TEXT CHECK(type IN ('admin','vendor','customer','driver')),
  status TEXT DEFAULT 'active',
  phone TEXT, address TEXT, profile_image TEXT,
  -- driver
  date_of_birth DATE, national_id TEXT,
  driver_license_url TEXT, national_id_url TEXT,
  vehicle_id UUID, bank_name TEXT, bank_iban TEXT,
  -- application
  application_status TEXT, rejection_reason TEXT,
  applied_at TIMESTAMPTZ, approved_at TIMESTAMPTZ,
  fcm_token TEXT, refresh_token TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ
);

-- restaurants
CREATE TABLE restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES users(id),
  name TEXT NOT NULL, description TEXT,
  logo_url TEXT, cover_image_url TEXT,
  rating NUMERIC DEFAULT 0, rating_count INT DEFAULT 0,
  delivery_time INT, delivery_fee NUMERIC,
  categories TEXT[], cuisine_types TEXT[],
  is_open BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'pending',
  rejection_reason TEXT,
  address TEXT, latitude NUMERIC, longitude NUMERIC,
  operating_hours JSONB,
  commercial_reg_number TEXT, business_license_url TEXT,
  health_certificate_url TEXT, tax_registration_url TEXT,
  bank_name TEXT, bank_iban TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ
);

-- food_items
CREATE TABLE food_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID REFERENCES restaurants(id),
  name TEXT NOT NULL, description TEXT, image_url TEXT,
  price NUMERIC NOT NULL, original_price NUMERIC,
  is_on_sale BOOLEAN DEFAULT false,
  category TEXT, available BOOLEAN DEFAULT true,
  addons JSONB DEFAULT '[]',
  allergens TEXT[], preparation_time INT DEFAULT 10,
  rating NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ
);

-- orders
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES users(id),
  restaurant_id UUID REFERENCES restaurants(id),
  driver_id UUID REFERENCES users(id),
  status TEXT DEFAULT 'pending',
  items JSONB NOT NULL,
  item_count INT, subtotal NUMERIC, delivery_fee NUMERIC,
  tax NUMERIC, total NUMERIC, discount NUMERIC, promo_code TEXT,
  pickup_address TEXT, delivery_address TEXT,
  restaurant_lat NUMERIC, restaurant_lng NUMERIC,
  delivery_lat NUMERIC, delivery_lng NUMERIC,
  notes TEXT, payment_method TEXT, is_paid BOOLEAN DEFAULT false,
  estimated_delivery TIMESTAMPTZ, delivered_at TIMESTAMPTZ,
  rating NUMERIC, review TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- addresses, vehicles, reviews, categories,
-- payment_methods, notifications, promotions,
-- disputes, driver_locations, price_history, daily_stats
```

---

## 9. Real-time Events (Socket.IO Gateway)

| Event | Direction | الوصف |
|-------|-----------|-------|
| `order:status_changed` | Server→Client | تغيير حالة الطلب |
| `driver:location_update` | Client→Server | السائق يرسل موقعه |
| `driver:location` | Server→Client | العميل يستقبل موقع السائق |
| `order:new` | Server→Vendor | طلب جديد للمطعم |
| `order:assigned` | Server→Driver | طلب معيّن للسائق |

---

## 10. Background Jobs (Bull Queue)

| Job | الجدول | بديل عن |
|-----|--------|---------|
| `cleanup-rate-limits` | كل ساعة | `cleanupRateLimits` |
| `update-daily-stats` | منتصف الليل | `updateDailyStats` |
| `cleanup-soft-deleted` | الأحد 2 صباحاً | `cleanupSoftDeleted` |
| `cleanup-expired-cache` | 3 صباحاً | `cleanupExpiredCache` |
| `send-notification` | on-demand | FCM push notifications |
| `sync-user-data` | on-demand | `onUserUpdate` |

---

## 11. Auth Flow

```
1. Register → hash password (bcrypt) → save user → return JWT
2. Login (email/pass) → Passport Local Strategy → JWT access + refresh
3. Google OAuth → Passport Google Strategy → upsert user → JWT
4. Protected Route → JWT Guard → extract user → Roles Guard → controller
5. Refresh → validate refresh token (hashed in DB) → new access token
```

---

## 12. Mapping Firebase → NestJS

| Firebase Trigger | NestJS Equivalent |
|-----------------|-------------------|
| `onUserUpdate` | OrdersService.syncUserName() called after PATCH /users/me |
| `onRestaurantUpdate` | OrdersService.syncRestaurantData() |
| `onOrderCreate` | OrdersService.onCreate() internal method |
| `onOrderUpdate` | OrdersService.onStatusChange() + Socket.IO emit |
| `onOrderCreatedNotify` | NotificationsService triggered in orders.service |
| `onOrderStatusChanged` | NotificationsService triggered on status update |
| `onOrderReady` | NotificationsService.notifyAvailableDrivers() |
| `onDriverAssigned` | NotificationsService triggered on driver assignment |
| `onDeliveryCompleted` | NotificationsService triggered on delivered status |
| Rate Limiting | @nestjs/throttler + Redis |
| Scheduled cleanup | Bull Queue cron jobs |
