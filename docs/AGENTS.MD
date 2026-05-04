# Z-Speed Backend — Agent Instructions & TODO (Part 1)

> **هام:** اقرأ الملفات دي قبل أي حاجة:
> - `docs/01_architecture_and_auth.md`
> - `docs/02_restaurants_and_menu.md`
> - `docs/03_orders_payment_driver.md`
> - `docs/04_admin_superadmin.md`
> - `docs/05_gateway_integration_and_index.md`
> - `prisma/schema.prisma`

---

## PHASE 0 — Project Initialization

### [ ] 0.1 Create NestJS Project
```bash
npx @nestjs/cli new z-speed-backend --package-manager npm
cd z-speed-backend
```

### [ ] 0.2 Install All Dependencies
```bash
npm install \
  @nestjs/passport @nestjs/jwt @nestjs/throttler @nestjs/bull \
  @nestjs/websockets @nestjs/platform-socket.io \
  passport passport-local passport-jwt passport-google-oauth20 \
  @prisma/client prisma \
  bcrypt class-validator class-transformer \
  socket.io bull \
  firebase-admin \
  @aws-sdk/client-s3 \
  helmet crypto-js \
  google-auth-library \
  @nestjs/config \
  redis ioredis

npm install -D \
  @types/passport-local @types/passport-jwt @types/passport-google-oauth20 \
  @types/bcrypt prisma
```

### [ ] 0.3 Copy Prisma Schema
```bash
# Copy prisma/schema.prisma to project
npx prisma generate
npx prisma migrate dev --name init
```

### [ ] 0.4 Setup .env File
```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://...
JWT_SECRET=...
JWT_REFRESH_SECRET=...
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
REDIS_URL=redis://localhost:6379
CYBERSOURCE_MERCHANT_ID=...
CYBERSOURCE_API_KEY=...
CYBERSOURCE_API_SECRET=...
CYBERSOURCE_SECRET_KEY=...
CYBERSOURCE_BASE_URL=https://apitest.cybersource.com
FIREBASE_PROJECT_ID=...
FIREBASE_PRIVATE_KEY=...
FIREBASE_CLIENT_EMAIL=...
```

### [ ] 0.5 Setup main.ts
```typescript
// Enable: ValidationPipe, Helmet, CORS, prefix 'api/v1'
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
app.use(helmet());
app.setGlobalPrefix('api/v1');
app.enableCors({ origin: process.env.ALLOWED_ORIGINS?.split(',') });
```

---

## PHASE 1 — Common Module

**Path:** `src/common/`

### [ ] 1.1 Decorators
- `src/common/decorators/roles.decorator.ts` — `@Roles(...roles: Role[])`
- `src/common/decorators/current-user.decorator.ts` — `@CurrentUser()`

### [ ] 1.2 Guards
- `src/common/guards/roles.guard.ts` — checks JWT user role against `@Roles()`
- `src/common/guards/jwt-auth.guard.ts` — extends AuthGuard('jwt')

### [ ] 1.3 Interceptors
- `src/common/interceptors/audit.interceptor.ts`
  - Logs every mutating request (POST/PATCH/DELETE) to `AuditLog` table
  - Captures: userId, userRole, action, targetTable, ipAddress, oldData, newData

### [ ] 1.4 Filters
- `src/common/filters/http-exception.filter.ts`
  - Returns standardized error shape: `{ statusCode, error, message, timestamp, path }`

### [ ] 1.5 Pipes
- `src/common/pipes/parse-uuid.pipe.ts`

### [ ] 1.6 Prisma Module
- `src/prisma/prisma.service.ts` — extends PrismaClient, calls `$connect()` on init
- `src/prisma/prisma.module.ts` — Global module, exports PrismaService

---

## PHASE 2 — Auth Module

**Path:** `src/auth/`

### [ ] 2.1 DTOs
- `register.dto.ts`:
  ```typescript
  name: string (NotEmpty)
  email: string (IsEmail)
  password: string (MinLength 8)
  phone?: string
  role: Role (IsEnum: CUSTOMER | VENDOR | DRIVER)
  ```
- `login.dto.ts`: `email`, `password`
- `refresh-token.dto.ts`: `refreshToken`
- `forgot-password.dto.ts`: `email`
- `reset-password.dto.ts`: `token`, `newPassword`

### [ ] 2.2 Strategies
- `src/auth/strategies/jwt.strategy.ts` — extracts Bearer token, returns `{ userId, role }`
- `src/auth/strategies/jwt-refresh.strategy.ts` — extracts refresh token, validates hash in DB
- `src/auth/strategies/firebase.strategy.ts` — verifies Firebase ID Token (for Google/Apple/Email login)

### [ ] 2.3 Auth Service Methods
```
firebaseAuth(idToken)  → verify via Firebase Admin → upsert User by firebaseUid/email → return tokens
register(dto)          → create User → if DRIVER create DriverProfile → return tokens (Firebase handled)
login(idToken)         → verify → generate tokens → hash refresh → save to DB
refresh(userId, token) → compare hash → generate new pair → update DB
logout(userId)         → set refreshTokenHash = null
```

### [ ] 2.4 Auth Controller
```
POST /auth/register
POST /auth/login
POST /auth/google
POST /auth/refresh
POST /auth/logout          [JWT Guard]
POST /auth/forgot-password
POST /auth/reset-password
```

### [ ] 2.5 Token Generation Helper
```typescript
generateTokens(userId: string, role: Role) {
  const accessToken = jwt.sign({ sub: userId, role }, JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ sub: userId }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
  const refreshHash = bcrypt.hashSync(refreshToken, 10);
  return { accessToken, refreshToken, refreshHash };
}
```

---

## PHASE 3 — Users Module

**Path:** `src/users/`

### [ ] 3.1 DTOs
- `update-profile.dto.ts`: `name?`, `phone?`, `profileImage?`, `fcmTokens?`, `notificationPrefs?`
- `create-address.dto.ts`: `label?`, `street`, `city`, `latitude`, `longitude`, `building?`, `floor?`, `apartment?`, `type?`, `instructions?`
- `update-address.dto.ts`: Partial of create

### [ ] 3.2 Users Service Methods
```
findById(id)                    → return user with addresses
updateProfile(userId, dto)      → update User fields → if name changed → syncUserNameInOrders()
syncUserNameInOrders(userId)    → update all active orders with new customerName
addAddress(userId, dto)         → if isDefault=true → unset other defaults first
getAddresses(userId)
updateAddress(userId, addressId, dto)
deleteAddress(userId, addressId)
setDefaultAddress(userId, addressId)
```

### [ ] 3.3 Users Controller
```
GET    /users/me              [JWT]
PATCH  /users/me              [JWT]
POST   /users/addresses       [JWT, CUSTOMER]
GET    /users/addresses       [JWT]
PATCH  /users/addresses/:id   [JWT]
DELETE /users/addresses/:id   [JWT]
PATCH  /users/addresses/:id/default [JWT]
```

---

## PHASE 4 — Restaurants Module

**Path:** `src/restaurants/`

### [ ] 4.1 DTOs
- `create-restaurant.dto.ts`: `name`, `nameAr?`, `latitude`, `longitude`, `address`, `documentUrls`, `vendorType?`, `payoutPhoneNumber?`
- `update-restaurant.dto.ts`: Partial (name, description, logoUrl, coverImageUrl, workingHours)
- `delivery-settings.dto.ts`: `deliveryRadiusKm?`, `deliveryTimeMin?`, `deliveryTimeMax?`, `deliveryFeeMode?`, `deliveryFee?`, `minimumOrder?`, `deliveryFeeTiers?`

### [ ] 4.2 Restaurants Service Methods
```
create(ownerId, dto)            → create with status=PENDING_VERIFICATION → notify admins
findAll(filters)                → filter by city/location/cuisine/isOpen
findById(id)
findByOwner(ownerId)
update(id, ownerId, dto)        → verify ownership
updateDeliverySettings(id, dto)
toggleOpen(id, ownerId, isOpen)
approve(id, adminId)            → status=ACTIVE → notify vendor FCM
reject(id, adminId, reason)     → notify vendor FCM
suspend(id, adminId, reason)
getStats(restaurantId)          → totalOrders, totalEarnings, walletBalance, today stats
```

### [ ] 4.3 Restaurants Controller
```
GET    /restaurants                      [Public]
GET    /restaurants/:id                  [Public]
GET    /restaurants/:id/menu             [Public]
GET    /vendor/restaurants/my            [VENDOR]
POST   /vendor/restaurants               [VENDOR]
PATCH  /vendor/restaurants/:id           [VENDOR]
PATCH  /vendor/restaurants/:id/delivery-settings [VENDOR]
PATCH  /vendor/restaurants/:id/toggle-open       [VENDOR]
GET    /vendor/restaurants/:id/stats             [VENDOR]
```

---

## PHASE 5 — Food Module

**Path:** `src/food/`

### [ ] 5.1 DTOs
- `create-menu-section.dto.ts`: `restaurantId`, `name`, `nameAr?`, `sortOrder?`
- `create-food-item.dto.ts`: `sectionId`, `name`, `price`, `description?`, `imageUrl?`, `originalPrice?`, `isOnSale?`, `prepTimeMin?`, `allergens?`, `addons?`

### [ ] 5.2 Food Service Methods
```
createSection(ownerId, dto)      → verify restaurant ownership
updateSection(id, ownerId, dto)
deleteSection(id, ownerId)
createFoodItem(ownerId, dto)     → if price changed from existing → log price_history
updateFoodItem(id, ownerId, dto)
deleteFoodItem(id, ownerId)
toggleAvailability(id, ownerId, isAvailable)
getMenuByRestaurant(restaurantId) → sections with items (isActive=true)
```

### [ ] 5.3 Food Controller
```
POST   /vendor/menu-sections              [VENDOR]
PATCH  /vendor/menu-sections/:id          [VENDOR]
DELETE /vendor/menu-sections/:id          [VENDOR]
POST   /vendor/food-items                 [VENDOR]
PATCH  /vendor/food-items/:id             [VENDOR]
DELETE /vendor/food-items/:id             [VENDOR]
PATCH  /vendor/food-items/:id/availability [VENDOR]
```

---

## PHASE 6 — Cart Module

**Path:** `src/cart/`

### [ ] 6.1 DTOs
- `add-cart-item.dto.ts`: `foodItemId`, `quantity`, `selectedAddons?`, `specialNote?`
- `update-cart-item.dto.ts`: `quantity?`, `selectedAddons?`

### [ ] 6.2 Cart Service Methods
```
getCart(customerId)
addItem(customerId, dto)
  → if cart has items from different restaurant → throw 409
  → upsert CartItem
updateItem(customerId, itemId, dto)
removeItem(customerId, itemId)
clearCart(customerId)
calculateTotals(cartId)   → sum(qty * unitPrice + addons)
```

### [ ] 6.3 Cart Controller
```
GET    /cart              [CUSTOMER]
POST   /cart/items        [CUSTOMER]
PATCH  /cart/items/:id    [CUSTOMER]
DELETE /cart/items/:id    [CUSTOMER]
DELETE /cart              [CUSTOMER]
```

---

## PHASE 7 — Orders Module

**Path:** `src/orders/`

### [ ] 7.1 Order State Machine
```typescript
// src/orders/order-state-machine.service.ts
allowedTransitions = {
  PENDING:         ['CONFIRMED', 'CANCELLED'],
  CONFIRMED:       ['PREPARING', 'CANCELLED'],
  PREPARING:       ['READY', 'CANCELLED'],
  READY:           ['IN_PROGRESS'],
  IN_PROGRESS:     ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY:['DELIVERED'],
  DELIVERED:       [],
  CANCELLED:       [],
}

canTransition(from, to, userRole): boolean
```

### [ ] 7.2 DTOs
- `checkout.dto.ts`: `restaurantId`, `deliveryAddressId`, `paymentMethod`, `promoCode?`, `customerNote?`, `deviceInformation?`, `billingInformation?`
- `update-order-status.dto.ts`: `status`, `reason?`

### [ ] 7.3 Orders Service Methods
```
checkout(customerId, dto)
  → validate cart not empty
  → load restaurant (ACTIVE + isOpen)
  → verify deliveryAddressId ownership
  → validate PromoCode (if provided) → check usage limit, expiry, minOrder
  → calculate: subtotal, deliveryFee, serviceFee, discount, total
  → calculate LoyaltyPoints to earn (based on SystemConfig rate)
  → if WALLET: check balance → deduct → create Order(paymentState=PAID)
  → if CASH: create Order(paymentState=PENDING)
  → if CYBERSOURCE_CARD: create Order → call PaymentsService → return flexToken
  → clear cart → notify vendor

validatePromo(code, subtotal) → verify code exists, active, and applicable
getFlexToken()                → call CyberSource /microform/v2/sessions
handlePaymentCallback(body, sig) → verify sig → update paymentState → notify

getMyOrders(customerId, filters)
getOrderById(id, userId, role)     → RBAC ownership check
getVendorOrders(restaurantId, vendorId, filters)
getDriverOrders(driverId)

updateStatus(orderId, status, userId, role)
  → validate via StateMachine
  → update order + timestamps
  → side effects per status (see below)

cancelOrder(orderId, customerId, reason)
assignDriversToOrder(orderId)      → find nearby drivers → create DeliveryRequests → notify
deliver(orderId, driverId)         → status=DELIVERED → add earnings → add loyalty points
createDispute(orderId, customerId, dto) → create OrderDispute record → notify admins
```

### [ ] 7.4 Status Side Effects
```
CONFIRMED     → emit order:confirmed → FCM customer "Order confirmed"
PREPARING     → emit order:status_changed → FCM customer "Being prepared"
READY         → call assignDriversToOrder() → FCM nearby drivers
IN_PROGRESS   → emit order:assigned → FCM customer "Driver on the way"
OUT_FOR_DELIVERY → start real-time tracking
DELIVERED     → addEarningToDriverWallet() → addRevenueToRestaurantWallet()
               → Ledger records → emit order:delivered → FCM "Rate your experience"
CANCELLED     → if paymentState=PAID → initiateRefund()
```

### [ ] 7.5 Orders Controller
```
POST   /orders/checkout                  [CUSTOMER]
POST   /orders/validate-promo            [CUSTOMER]
GET    /orders/payment/flex-token        [CUSTOMER]
POST   /orders/payment/callback          [Public - no JWT]
GET    /orders/my                        [CUSTOMER]
GET    /orders/:id                       [JWT]
PATCH  /orders/:id/cancel                [CUSTOMER]
POST   /orders/:id/dispute               [CUSTOMER]
PATCH  /vendor/orders/:id/status         [VENDOR]
GET    /vendor/orders                    [VENDOR]
```

# Z-Speed Backend — Agent Instructions & TODO (Part 2)

---

## PHASE 8 — Payments Module (CyberSource)

**Path:** `src/payments/`

### [ ] 8.1 Payments Service Methods
```
initiateSecureAcceptance(order, deviceInfo, billingInfo)
  → build signed fields map
  → sign with HMAC-SHA256 using CYBERSOURCE_SECRET_KEY
  → return { paymentUrl, signedFields }

initiateFlexPayment(order, transientToken)
  → POST /pts/v2/payments with transientToken
  → handle 3DS stepUpUrl if returned

getFlexCaptureContext()
  → POST /microform/v2/sessions
  → return captureContext JWT

verifyWebhookSignature(payload, signature)
  → HMAC-SHA256 compare (timingSafeEqual)

handleCallback(body)
  → if decision=ACCEPT → paymentState=PAID → updateOrder → notifyVendor
  → if DECLINE/ERROR  → paymentState=FAILED → cancel order → notifyCustomer

processReversal(transactionId, amount)
  → POST /pts/v2/payments/:id/reversals
```

### [ ] 8.2 CyberSource HTTP Client Setup
```typescript
// Use axios with HMAC-SHA256 authentication headers
// Headers required: v-c-merchant-id, Date, Host, Digest, Signature
// Signature = HMAC-SHA256(request-target + date + host + digest)
```

---

## PHASE 9 — Drivers Module

**Path:** `src/drivers/`

### [ ] 9.1 DTOs
- `apply-driver.dto.ts`: `nationalId`, `nationalIdUrl`, `driverLicenseUrl`, `payoutPhoneNumber`, `vehicle: CreateVehicleDto`
- `update-location.dto.ts`: `currentLat`, `currentLng`
- `create-vehicle.dto.ts`: `type`, `make?`, `model?`, `year?`, `plateNumber?`, `color?`, `registrationDocUrl?`

### [ ] 9.2 Drivers Service Methods
```
applyDriver(userId, dto)
  → update DriverProfile: nationalId, nationalIdUrl, etc. → status=UNDER_REVIEW
  → create Vehicle record
  → notify admins FCM + Socket.IO

toggleAvailability(userId, isAvailable)
  → update DriverProfile is_available field (add this to schema if missing)

updateLocation(userId, lat, lng)
  → update DriverProfile: currentLat, currentLng, geohash, lastPingAt

getDeliveryRequests(driverProfileId)
  → find PENDING requests not expired

acceptRequest(driverProfileId, requestId)
  → validate PENDING + not expired
  → update DeliveryRequest=ACCEPTED
  → update Order: driverId, status=IN_PROGRESS, driverAssignedAt=now()
  → cancel other PENDING requests for same order
  → emit Socket.IO: order:assigned to customer
  → FCM customer: "Driver is on the way!"

rejectRequest(driverProfileId, requestId, reason)
  → DeliveryRequest=REJECTED
  → increment totalRejected → recalc acceptanceRate

getMyOrders(driverProfileId, filters)
getEarnings(driverProfileId)
findNearbyDrivers(lat, lng, radiusKm)   → use geohash or PostGIS
```

### [ ] 9.3 Drivers Controller
```
POST   /drivers/apply                         [DRIVER]
PATCH  /drivers/availability                  [DRIVER]
PATCH  /drivers/location                      [DRIVER]
GET    /drivers/delivery-requests             [DRIVER]
PATCH  /drivers/delivery-requests/:id/accept  [DRIVER]
PATCH  /drivers/delivery-requests/:id/reject  [DRIVER]
GET    /drivers/my-orders                     [DRIVER]
GET    /drivers/earnings                      [DRIVER]
```

---

## PHASE 10 — Wallet Module

**Path:** `src/wallet/`

### [ ] 10.1 Wallet Service Methods
```
getLedger(userId, filters)           → Ledger records with pagination
requestPayout(userId, amount)
  → verify amount <= walletBalance
  → deduct walletBalance
  → Ledger(type=PAYOUT, status=pending)
  → create PendingApproval(actionType=payout_request)
  → notify admin

addEarning(userId, orderId, amount)  → walletBalance += amount → Ledger(EARNING)
addFee(userId, orderId, amount)      → walletBalance -= amount → Ledger(FEE)
processRefund(userId, orderId, amount) → walletBalance += amount → Ledger(REFUND)
```

### [ ] 10.2 Wallet Controller
```
GET    /wallet/ledger    [DRIVER | VENDOR]
POST   /wallet/payout   [DRIVER | VENDOR]
```

---

## PHASE 11 — Notifications Module

**Path:** `src/notifications/`

### [ ] 11.1 FCM Service
```typescript
// src/notifications/fcm.service.ts
// Initialize Firebase Admin SDK
sendToTokens(tokens: string[], title: string, body: string, data?: object)
sendToTopic(topic: string, title: string, body: string, data?: object)
```

### [ ] 11.2 Notifications Service Methods
```
createNotification(userId, title, body, type?, data?)  → save to DB + send FCM
getNotifications(userId, filters)
markRead(userId, notificationId)
markAllRead(userId)
deleteNotification(userId, notificationId)
sendPush(userIds[], title, body, data)                 → admin bulk send
notifyVendor(restaurantId, orderId)                    → order:new
notifyCustomer(userId, status, orderId)                → order status update
notifyAvailableDrivers(driverIds[], order)             → delivery request
notifyAdmins(title, body)                              → new application
notifySuperAdmin(approval)                             → pending approval
```

### [ ] 11.3 Notifications Controller
```
GET    /notifications           [JWT]
PATCH  /notifications/:id/read  [JWT]
PATCH  /notifications/read-all  [JWT]
DELETE /notifications/:id       [JWT]
POST   /admin/notifications/push [ADMIN]
```

---

## PHASE 12 — Realtime Gateway (Socket.IO)

**Path:** `src/gateway/`

### [ ] 12.1 Gateway Setup
```typescript
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/' })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  // Authenticate via JWT on handshake
  handleConnection(client: Socket) {
    const token = client.handshake.auth.token;
    // verify → join room customer:{userId} or vendor:{restaurantId} or driver:{driverId}
  }
}
```

### [ ] 12.2 Events to Implement
```
Server → Client:
  order:new              → vendor:{restaurantId}
  order:confirmed        → customer:{userId}
  order:status_changed   → customer:{userId}
  order:new_request      → driver:{driverProfileId}
  order:assigned         → customer:{userId}
  driver:location        → customer:{userId}
  approval:new           → superadmin room

Client → Server:
  driver:location_update → { lat, lng } → update DB + broadcast to active order customers
```

### [ ] 12.3 Emit Helper Methods (used by other services)
```
emitToCustomer(userId, event, data)
emitToVendor(restaurantId, event, data)
emitToDriver(driverProfileId, event, data)
emitToAdmins(event, data)
emitToSuperAdmin(event, data)
```

---

## PHASE 13 — BullMQ Queues

**Path:** `src/queues/`

### [ ] 13.1 Queue Definitions
```typescript
// src/queues/queues.module.ts
BullModule.registerQueue(
  { name: 'notifications' },
  { name: 'cleanup' },
  { name: 'stats' },
  { name: 'email' }
)
```

### [ ] 13.2 Processors
- `notification.processor.ts` — on-demand FCM sends
- `email.processor.ts` — password reset emails, welcome emails
- `cleanup.processor.ts`:
  - `@Cron` every 1h → delete expired rate_limits
  - `@Cron` Sunday 02:00 → hard delete soft-deleted records older than 30 days
  - `@Cron` 03:00 daily → clean expired cache
- `stats.processor.ts`:
  - `@Cron` 00:00 daily → compute daily_stats and save to DB

---

## PHASE 14 — Reviews Module

**Path:** `src/reviews/`

### [ ] 14.1 Reviews Service Methods
```
create(customerId, dto)
  → verify order belongs to customer + status=DELIVERED
  → verify no existing review for orderId
  → create Review
  → recalculate restaurant.rating (AVG restaurantRating)
  → recalculate driverProfile.rating (AVG driverRating)

getByRestaurant(restaurantId, pagination)
replyToReview(reviewId, vendorId, reply)   → verify restaurant ownership
```

### [ ] 14.2 Reviews Controller
```
POST   /reviews                      [CUSTOMER]
GET    /reviews/restaurant/:id        [Public]
PATCH  /reviews/:id/reply            [VENDOR]
```

---

## PHASE 15 — Admin Module

**Path:** `src/admin/`

### [ ] 15.1 Admin Service Methods
```
-- Users
listUsers(filters)
getUserDetails(id)
updateUserStatus(id, status, adminId)     → if BANNED → create PendingApproval
requestHardDelete(targetId, adminId, reason)
  → softDelete → create PendingApproval → notify SuperAdmin

-- Drivers
listDriverApplications(filters)
getDriverApplication(id)
approveDriver(driverId, adminId)          → FCM driver
rejectDriver(driverId, adminId, reason)   → FCM driver

-- Restaurants
listRestaurants(filters)
getPendingRestaurants()
getRestaurantDocs(restaurantId)
approveRestaurant(restaurantId, adminId)  → FCM vendor
rejectRestaurant(restaurantId, adminId, reason)
hardRejectRestaurant(restaurantId, adminId, reason) → create PendingApproval
suspendRestaurant(restaurantId, adminId, reason)

-- Orders
listOrders(filters)
getOrder(id)
forceUpdateOrderStatus(orderId, status, adminId)
reassignDriver(orderId, driverId, adminId)
processRefund(orderId, amount, reason)

-- Disputes
listDisputes(filters)
resolveDispute(disputeId, resolution, adminId)
escalateDispute(disputeId)

-- Stats
getDailyStats(date)
getStatsRange(from, to)
getRestaurantStats()
getDriverStats()
getRevenueReport()
```

### [ ] 15.2 Admin Controller
```
GET/PATCH/POST /admin/users/*
GET/PATCH       /admin/drivers/*
GET/PATCH/POST  /admin/restaurants/*
GET/PATCH/POST  /admin/orders/*
GET/PATCH       /admin/disputes/*
POST            /admin/categories/* (CRUD)
POST            /admin/promotions/* (CRUD)
POST            /admin/notifications/push
GET             /admin/stats/*
```

---

## PHASE 16 — SuperAdmin Module

**Path:** `src/superadmin/`

### [ ] 16.1 SuperAdmin Service Methods
```
listPendingApprovals(filters)
getApprovalDetails(id)
executeApproval(approvalId, superadminId)
  → switch actionType → execute DB operation
  → update PendingApproval=APPROVED
  → create AuditLog → notify requesting admin

rejectApproval(approvalId, superadminId, reason)
  → revert preliminary changes
  → update PendingApproval=REJECTED → notify admin

createAdmin(dto)      → User(role=ADMIN) → send welcome email
deleteAdmin(id)       → hard delete immediately
getAdminActivity(adminId)
-- System Config
getSystemConfig()          → returns global fees, radii, loyalty rates
updateSystemConfig(dto)    → update global settings

getAuditLog(filters)       → filter by userId, action, table, date
```

### [ ] 16.2 SuperAdmin Controller
```
GET/PATCH /superadmin/pending-approvals/*
POST/DELETE /superadmin/admins/*
GET /superadmin/admins/activity
GET/PATCH /superadmin/system/config
GET /superadmin/audit-log
```

---

## PHASE 17 — Additional Modules

### [ ] 17.1 Categories Module
- `src/categories/`
- **DTOs**: `create-category.dto.ts` (name, nameAr, iconUrl, type)
- **Service**: CRUD operations, `listActive()`
- **Controller**:
  ```
  GET  /categories              [Public]
  POST /admin/categories        [ADMIN]
  PATCH /admin/categories/:id   [ADMIN]
  DELETE /admin/categories/:id  [ADMIN]
  ```

### [ ] 17.2 Promotions Module
- `src/promotions/`
- **DTOs**: `create-promo.dto.ts` (code, discountType, value, minOrder, maxDiscount, expiry, usageLimit)
- **Service**: `validate(code, subtotal)`, `incrementUsage(id)`, `listPromos()`
- **Controller**:
  ```
  POST /orders/validate-promo   [CUSTOMER]
  GET  /admin/promotions        [ADMIN]
  POST /admin/promotions        [ADMIN]
  PATCH /admin/promotions/:id   [ADMIN]
  DELETE /admin/promotions/:id  [ADMIN]
  ```

### [ ] 17.3 Disputes Module
- `src/disputes/`
- **DTOs**: `create-dispute.dto.ts` (orderId, reason, description, evidenceUrls)
- **Service**: `createDispute()`, `resolveDispute(id, resolution, adminId)`, `escalate(id)`
- **Controller**:
  ```
  POST /orders/:id/dispute           [CUSTOMER]
  GET  /admin/disputes               [ADMIN]
  PATCH /admin/disputes/:id/resolve  [ADMIN]
  PATCH /admin/disputes/:id/escalate [ADMIN]
  ```

### [ ] 17.4 Loyalty Module
- `src/loyalty/`
- **Logic**: Calculate points on DELIVERED, spend points on checkout as discount.
- **Service**: `getPoints(userId)`, `addPoints(userId, amount)`, `redeemPoints(userId, amount)`

---

## PHASE 18 — Testing

### [ ] 18.1 Unit Tests (Jest)
```bash
# Test files go alongside source files: *.spec.ts
npm run test
```

**Files to test:**
- `auth.service.spec.ts` — register, login, refresh, logout
- `orders.service.spec.ts` — checkout, state machine transitions, pricing calc
- `order-state-machine.service.spec.ts` — all allowed/blocked transitions
- `payments.service.spec.ts` — signature generation, callback verification
- `drivers.service.spec.ts` — apply, accept/reject request, location update
- `restaurants.service.spec.ts` — create, approve, reject, delivery fee calc

**Key assertions per service:**
```typescript
// auth.service.spec.ts
it('should hash password on register')
it('should throw if email already exists')
it('should throw if account is BANNED on login')
it('should invalidate old refresh token on new refresh')

// orders.service.spec.ts
it('should throw 409 if cart is empty')
it('should throw if restaurant is closed')
it('should correctly calculate subtotal + delivery + service fee')
it('should throw if WALLET balance insufficient')
it('should clear cart after successful checkout')

// order-state-machine.service.spec.ts
it('should allow PENDING → CONFIRMED')
it('should not allow DELIVERED → PREPARING')
it('should allow CUSTOMER to cancel PENDING')
it('should not allow DRIVER to confirm order')

// payments.service.spec.ts
it('should generate valid HMAC-SHA256 signature')
it('should reject invalid webhook signatures')
it('should update order to PAID on ACCEPT callback')
it('should cancel order on DECLINE callback')
```

### [ ] 18.2 E2E Tests (Supertest)
```bash
npm run test:e2e
```

**Test flows:**
```
auth.e2e.spec.ts
  → register customer → login → get /users/me → logout

vendor.e2e.spec.ts
  → register vendor → create restaurant → add menu → verify PENDING status

driver.e2e.spec.ts
  → register driver → apply → verify UNDER_REVIEW

order-flow.e2e.spec.ts
  → customer creates order (CASH)
  → vendor confirms → preparing → ready
  → driver accepts request
  → driver marks OUT_FOR_DELIVERY → DELIVERED
  → customer leaves review

payment.e2e.spec.ts
  → checkout with CYBERSOURCE_CARD
  → simulate CyberSource callback (ACCEPT)
  → verify order paymentState=PAID

admin.e2e.spec.ts
  → approve restaurant → verify vendor notified
  → approve driver → verify driver can go online
  → request hard delete → verify PendingApproval created

superadmin.e2e.spec.ts
  → list pending approvals
  → approve hard delete → verify user deleted
  → verify AuditLog entry created
```

### [ ] 18.3 API Contract Testing
```bash
# Use: newman (Postman CLI runner)
newman run z-speed.postman_collection.json --environment production.json
```

**Postman Collection structure:**
```
Auth/
  Register Customer
  Register Vendor
  Register Driver
  Login
  Refresh Token
  Logout

Vendor/
  Create Restaurant
  Add Menu Section
  Add Food Item
  Toggle Open

Customer/
  Add to Cart
  Checkout (Cash)
  Get My Orders

Driver/
  Apply
  Accept Delivery Request
  Mark Delivered

Admin/
  Approve Restaurant
  Approve Driver
  View Stats

SuperAdmin/
  List Pending Approvals
  Approve Hard Delete
```

---

## PHASE 19 — Deployment

### [ ] 19.1 Docker Setup
```dockerfile
# Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npx prisma generate
RUN npm run build
EXPOSE 3000
CMD ["node", "dist/main"]
```

```yaml
# docker-compose.yml
services:
  api:
    build: .
    ports: ["3000:3000"]
    env_file: .env
    depends_on: [postgres, redis]
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: zspeed
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
  redis:
    image: redis:7-alpine
```

### [ ] 19.2 Pre-deploy Checklist
```
[ ] All unit tests pass: npm run test
[ ] E2E tests pass: npm run test:e2e
[ ] Build succeeds: npm run build
[ ] Prisma migrations applied: npx prisma migrate deploy
[ ] All env vars set in production
[ ] CyberSource credentials switched to production URL
[ ] Firebase production project configured
[ ] CORS configured with production domains only
[ ] Rate limiting tuned for production load
[ ] Health check endpoint responds 200
```

---

## Build Order Summary

```
Phase 0  → Project Init + Prisma Setup
Phase 1  → Common (Guards, Decorators, Interceptors, Filters)
Phase 2  → Auth Module (most critical — everything depends on JWT)
Phase 3  → Users Module
Phase 4  → Restaurants Module (public endpoints)
Phase 5  → Food Module (menu management)
Phase 6  → Cart Module
Phase 7  → Orders Module (state machine first)
Phase 8  → Payments Module (CyberSource)
Phase 9  → Drivers Module
Phase 10 → Wallet Module
Phase 11 → Notifications Module (FCM)
Phase 12 → Realtime Gateway (Socket.IO)
Phase 13 → BullMQ Queues
Phase 14 → Reviews Module
Phase 15 → Admin Module
Phase 16 → SuperAdmin Module
Phase 17 → Categories, Promotions, Disputes, Health
Phase 18 → Testing (Unit + E2E + Contract)
Phase 19 → Docker + Deployment
```

---

## Critical Rules (يجب الالتزام بها)

1. **Schema:** لا تغيير في `prisma/schema.prisma` إلا بعد مراجعة الـ docs.
2. **DTOs:** كل input يمر بـ `class-validator` — لا raw objects.
3. **Auth:** كل endpoint محمي لازم عليه `@UseGuards(JwtAuthGuard)` + `@Roles()`.
4. **Ownership:** الـ VENDOR والـ DRIVER يشوفوا بياناتهم فقط — دايماً verify ownership.
5. **Soft Delete:** لا حذف مباشر من قاعدة البيانات — `deletedAt = NOW()` دايماً.
6. **Hard Delete:** لا يتم إلا بعد موافقة SuperAdmin عبر PendingApproval.
7. **AuditLog:** كل mutation حساسة تتسجل عبر `AuditInterceptor`.
8. **Transactions:** Order checkout يستخدم `prisma.$transaction()` لضمان atomicity.
9. **Secrets:** لا hardcode لأي secret — كل حاجة من `.env` عبر `ConfigService`.
10. **CyberSource Webhook:** لازم verify signature قبل معالجة أي callback.
