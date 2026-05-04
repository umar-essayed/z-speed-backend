# Z-Speed — Full Backend Documentation (Part 1: Architecture & Auth)

---

## 1. Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend Framework | NestJS (TypeScript) |
| Database | PostgreSQL via Prisma ORM |
| Auth | Internal JWT (Access 15min + Refresh 7d) via Supabase/PostgreSQL |
| Identity Provider | Firebase Auth (Email/Password, Phone OTP, Google, Apple) |
| Realtime | Socket.IO |
| Cache / Rate Limiting | Redis + @nestjs/throttler |
| Background Jobs | BullMQ |
| File Storage | AWS S3 / Supabase Storage |
| Payment Gateway | CyberSource (AAIB) — Secure Acceptance + Flex Microform |
| Push Notifications | Firebase Cloud Messaging (FCM) |

---

## 2. Project Folder Structure

```
src/
├── auth/
│   ├── strategies/       # jwt, jwt-refresh, local, google
│   ├── guards/           # jwt-auth, roles, google-auth
│   └── dto/              # login.dto, register.dto
├── users/
├── restaurants/
├── food/
├── orders/
│   └── order-state-machine.service.ts
├── cart/
├── addresses/
├── drivers/
│   └── location-tracking.service.ts
├── vehicles/
├── reviews/
├── categories/
├── notifications/
│   └── fcm.service.ts
├── promotions/
├── disputes/
├── wallet/
├── admin/
├── superadmin/
├── gateway/              # Socket.IO realtime
├── queues/               # BullMQ processors
├── common/
│   ├── decorators/       # @Roles(), @CurrentUser()
│   ├── guards/
│   ├── interceptors/     # AuditInterceptor
│   └── pipes/
└── main.ts
```

---

## 3. Base URL & Auth Header

```
Base URL:  https://api.z-speed.com/api/v1
Auth:      Authorization: Bearer <AccessToken>
```

---

## 4. RBAC Matrix

| Action | SUPERADMIN | ADMIN | VENDOR | DRIVER | CUSTOMER |
|--------|-----------|-------|--------|--------|----------|
| Hard Delete | ✅ | ❌ (يطلب فقط) | ❌ | ❌ | ❌ |
| Soft Delete | ✅ | ✅ | ❌ | ❌ | ❌ |
| Ban مستخدم | ✅ | 🔄 يطلب SuperAdmin | ❌ | ❌ | ❌ |
| قبول Driver | ✅ | ✅ | ❌ | ❌ | ❌ |
| قبول Restaurant | ✅ | ✅ | ❌ | ❌ | ❌ |
| إنشاء Admin | ✅ | ❌ | ❌ | ❌ | ❌ |
| الموافقة على pending_approvals | ✅ | ❌ | ❌ | ❌ | ❌ |
| إدارة Menu | ✅ | ✅ | ✅ (مطعمه فقط) | ❌ | ❌ |
| إنشاء طلب | ❌ | ❌ | ❌ | ❌ | ✅ |
| تحديث الموقع | ❌ | ❌ | ❌ | ✅ | ❌ |
| Audit Log | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 5. Security Architecture

1. **Identity:** Firebase Auth manages credentials, passwords, and OTP verification securely on the client.
2. **Backend Auth:** No passwords are saved in the PostgreSQL DB. Instead, `firebaseUid`, `email`, and provider details (`googleId`, `appleId`, etc.) are saved.
3. **JWT:** Access Token (HS256, 15min) + Refresh Token (hash مُشفر في DB, 7d) are generated internally by NestJS after verifying the Firebase `idToken`.
3. **Payment:** لا يُخزن أي PAN أو CVV — يعتمد كلياً على CyberSource Tokenization.
4. **HTTP:** Helmet headers + CORS مقيد بالدومينات.
5. **Rate Limiting:** Redis + @nestjs/throttler.

---

## 6. Auth Module — Endpoints

### POST /auth/firebase
**Public** — The single entry point for all auth providers (Email/Password, Phone, Google, Apple).

**Body:**
```json
{
  "idToken": "eyJhbG...",
  "role": "CUSTOMER", 
  "fcmToken": "optional_device_token"
}
```

**Response 200/201:**
```json
{
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG...",
  "isNewUser": true,
  "user": { "id": "uuid", "firebaseUid": "...", "name": "Ahmed Ali", "role": "CUSTOMER" }
}
```

**Flow:**
```
1. Verify Firebase idToken using firebase-admin SDK.
2. Extract user details: uid, email, phone_number, sign_in_provider, email_verified, identities.
3. Upsert User in PostgreSQL (by firebaseUid, email, or phone).
4. If DRIVER → create DriverProfile (applicationStatus=PENDING).
5. Generate internal JWT pair → hash refresh token → save to DB → return.
```

---

### POST /auth/refresh
**Public**

**Body:**
```json
{ "refreshToken": "eyJhbG..." }
```

**Response 200:**
```json
{ "accessToken": "eyJhbG...", "refreshToken": "eyJhbG..." }
```

**Flow:**
```
1. Decode refresh token → extract userId
2. Find user → compare hash(incomingToken) == storedHash
3. If match → generate new pair → update DB → return
4. If mismatch → 401 Unauthorized (token reuse attack)
```

---

### POST /auth/logout
**Protected (JWT)**

**Flow:**
```
1. Extract userId from internal JWT
2. Set refreshTokenHash = null in DB
3. Return 200 OK
```

---

### POST /auth/link-provider
**Protected (JWT)**

**Body:** `{ "firebaseIdToken": "NEW_PROVIDER_TOKEN" }`

**Flow:**
```
1. Verify new idToken via firebase-admin.
2. Update existing PostgreSQL user with new provider details (googleId, appleId, phone).
3. Update emailVerified/phoneVerified statuses.
4. Return updated user.
```

---

## 7. Registration Flows by Role

### 7.1 Customer Registration Flow

```
Flutter Client: Registers with Firebase Auth -> Gets idToken
POST /auth/firebase { idToken, role: "CUSTOMER" }
  ↓
User created (status: ACTIVE immediately)
  ↓
Can browse restaurants → add to cart → place orders
```

---

### 7.2 Vendor (Restaurant Owner) Registration Flow

```
Step 1: Flutter Client Registers Vendor with Firebase Auth -> Gets idToken
POST /auth/firebase { idToken, role: "VENDOR" }
  ↓ User created (status: ACTIVE)

Step 2: POST /vendor/restaurants
  Body: { name, nameAr, latitude, longitude, address, documentUrls }
  ↓ Restaurant created (status: PENDING_VERIFICATION)
  ↓ Admin gets notified via FCM + Socket.IO event

Step 3: ADMIN reviews documents
  PATCH /admin/restaurants/:id/approve
  ↓ Restaurant status → ACTIVE
  ↓ Vendor gets FCM notification

Step 4: Vendor can now:
  - Add menu sections: POST /vendor/menu-sections
  - Add food items:    POST /vendor/food-items
  - Set schedule:      PATCH /vendor/restaurants/:id/delivery-settings
  - Go online:         PATCH /vendor/restaurants/:id/toggle-open
```

**Required documentUrls:**
```json
{
  "commercialReg": "https://storage.../commercial_reg.pdf",
  "healthCert": "https://storage.../health_cert.pdf",
  "taxReg": "https://storage.../tax_reg.pdf",
  "businessLicense": "https://storage.../license.pdf"
}
```

---

### 7.3 Driver Registration Flow

```
Step 1: Flutter Client Registers Driver with Firebase Auth -> Gets idToken
POST /auth/firebase { idToken, role: "DRIVER" }
  ↓ User created (status: ACTIVE)
  ↓ DriverProfile created (applicationStatus: PENDING)

Step 2: POST /drivers/apply
  Body: {
    nationalId, nationalIdUrl, driverLicenseUrl,
    vehicleType, payoutPhoneNumber,
    vehicle: { type, make, model, year, plateNumber, color, registrationDocUrl }
  }
  ↓ DriverProfile updated (applicationStatus: PENDING → UNDER_REVIEW)
  ↓ Admin gets notified

Step 3: ADMIN reviews application
  PATCH /admin/drivers/:id/approve   → applicationStatus: APPROVED
  PATCH /admin/drivers/:id/reject    → applicationStatus: REJECTED + rejectionReason

Step 4 (if approved): Driver can
  PATCH /drivers/availability { isAvailable: true }
  PATCH /drivers/location { lat, lng }   (or via Socket.IO)
  Receive delivery requests
```

---

## 8. User Profile Endpoints

### GET /users/me
**Protected**

**Response:**
```json
{
  "id": "uuid",
  "name": "Ahmed Ali",
  "email": "ahmed@example.com",
  "phone": "01012345678",
  "role": "CUSTOMER",
  "status": "ACTIVE",
  "walletBalance": 150.00,
  "loyaltyPoints": 320,
  "profileImage": "https://...",
  "addresses": [],
  "fcmTokens": [],
  "createdAt": "2026-01-01T00:00:00Z"
}
```

---

### PATCH /users/me
**Protected**

**Body (all optional):**
```json
{
  "name": "New Name",
  "phone": "01099999999",
  "profileImage": "https://...",
  "fcmTokens": ["device_token_1"],
  "notificationPrefs": { "orderUpdates": true, "promotions": false }
}
```

---

### POST /users/addresses
**Protected (CUSTOMER)**

**Body:**
```json
{
  "label": "Home",
  "street": "15 Tahrir St",
  "building": "5",
  "floor": "3",
  "apartment": "12",
  "city": "Cairo",
  "latitude": 30.0444,
  "longitude": 31.2357,
  "type": "home",
  "instructions": "Ring bell twice"
}
```

### GET /users/addresses — List addresses
### PATCH /users/addresses/:id — Update address
### DELETE /users/addresses/:id — Delete address
### PATCH /users/addresses/:id/default — Set as default

---

## 9. Background Jobs (BullMQ)

| Job | Schedule | Purpose |
|-----|----------|---------|
| cleanup-rate-limits | Every 1h | Delete expired rate limit records |
| update-daily-stats | 00:00 UTC daily | Generate daily stats snapshot |
| cleanup-soft-deleted | Sunday 02:00 | Hard delete records soft-deleted 30+ days ago |
| cleanup-expired-cache | 03:00 daily | Clear expired cache entries |
| send-fcm-notification | on-demand | Push FCM notifications to devices |
| sync-user-data | on-demand | Sync user name in active orders |
| sync-restaurant-data | on-demand | Sync restaurant data in active orders |

---

## 10. Firebase → NestJS Migration Map

| Firebase Trigger | NestJS Equivalent |
|-----------------|-------------------|
| onUserUpdate | UsersService → OrdersService.syncUserName() |
| onRestaurantUpdate | RestaurantsService → OrdersService.syncRestaurantData() |
| onOrderCreate | OrdersService.handleCreate() + NotificationsService |
| onOrderUpdate | OrdersService.handleStatusChange() + Socket.IO |
| onOrderCreatedNotify | NotificationsService.notifyVendor() |
| onOrderStatusChanged | NotificationsService.notifyCustomer() |
| onOrderReady | NotificationsService.notifyAvailableDrivers() |
| onDriverAssigned | NotificationsService.notifyCustomerDriverAssigned() |
| onDeliveryCompleted | NotificationsService.notifyReviewRequest() |
| cleanupRateLimits | BullMQ cron job |
| updateDailyStats | BullMQ cron job |
