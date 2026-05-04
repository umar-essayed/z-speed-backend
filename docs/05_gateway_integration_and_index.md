# Z-Speed — Part 5: CyberSource Deep Integration & Complete Endpoint Index

---

## 1. CyberSource Integration Architecture

### Integration Modes

| Mode | Use Case | Flow |
|------|----------|------|
| **Secure Acceptance Hosted Checkout** | Web browser payments | Backend signs params → Frontend redirects to CyberSource page |
| **Flex Microform** | Mobile app / in-app card entry | Frontend collects card via Microform → sends token to backend |

---

### 1.1 Secure Acceptance Flow (Web)

```
1. Customer clicks "Pay"
2. Frontend sends checkout data to: POST /orders/checkout
3. Backend:
   a. Calculates order totals
   b. Creates Order record (status=PENDING, paymentState=PENDING)
   c. Signs required fields with HMAC-SHA256 using CyberSource Secret Key
   d. Returns signed_field_names + signature + paymentUrl
4. Frontend redirects customer to CyberSource hosted page
5. Customer enters card details on CyberSource domain (PCI compliant)
6. CyberSource processes payment
7. CyberSource POSTs to: POST /orders/payment/callback
8. Backend verifies signature + updates order
9. Customer redirected to success/fail page
```

**Signed Fields Required:**
```
access_key, profile_id, transaction_uuid, signed_date_time,
signed_field_names, unsigned_field_names, transaction_type,
reference_number, amount, currency, locale,
bill_to_forename, bill_to_surname, bill_to_email,
bill_to_phone, bill_to_address_line1, bill_to_address_city,
bill_to_address_country, bill_to_address_postal_code
```

**Backend Signing (NestJS):**
```typescript
signFields(fields: Record<string, string>, secretKey: string): string {
  const signedFieldNames = Object.keys(fields).join(',');
  const dataToSign = Object.keys(fields)
    .map(key => `${key}=${fields[key]}`)
    .join(',');
  return crypto
    .createHmac('sha256', secretKey)
    .update(dataToSign)
    .digest('base64');
}
```

---

### 1.2 Flex Microform Flow (Mobile App)

```
1. App calls: GET /orders/payment/flex-token
   → Backend calls CyberSource: POST /microform/v2/sessions
   → Returns captureContext (JWT signed by CyberSource)

2. App uses Flex Microform SDK with captureContext
   → Customer enters card in native secure field
   → Flex SDK returns transientToken

3. App sends transientToken to: POST /orders/checkout (with transientToken field)

4. Backend:
   → Uses transientToken to create payment via CyberSource REST API
   → Handles 3DS / Payer Authentication
   → Returns result

5. If 3DS required → CyberSource returns stepUpUrl
   → App opens WebView for bank OTP
   → CyberSource calls backend webhook on completion
```

**Backend: Get Flex Capture Context**
```typescript
// GET /orders/payment/flex-token
async getFlexCaptureContext(): Promise<string> {
  const response = await this.cybersourceClient.post(
    '/microform/v2/sessions',
    {
      targetOrigins: ['https://app.z-speed.com'],
      allowedCardNetworks: ['VISA', 'MASTERCARD', 'AMEX'],
      clientVersion: 'v2.0'
    }
  );
  return response.data.keyId; // captureContext JWT
}
```

---

### 1.3 Payment State Machine

```
PENDING (order created)
  ↓ CyberSource ACCEPT webhook
PAID (order confirmed)

PENDING
  ↓ CyberSource DECLINE / ERROR
FAILED (order cancelled, notify customer)

PAID
  ↓ Admin initiates refund
REFUNDED (CyberSource reversal processed)
```

---

### 1.4 CyberSource Callback Signature Verification

```typescript
// POST /orders/payment/callback
verifyWebhookSignature(payload: string, signature: string, secretKey: string): boolean {
  const expected = crypto
    .createHmac('sha256', secretKey)
    .update(payload)
    .digest('base64');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

---

### 1.5 Payment Reversal (Refund)

```typescript
// Called when admin issues refund or order cancelled after payment
async reversalPayment(transactionId: string, amount: number) {
  return this.cybersourceClient.post(`/pts/v2/payments/${transactionId}/reversals`, {
    clientReferenceInformation: { code: `reversal-${transactionId}` },
    reversalInformation: {
      amountDetails: {
        totalAmount: amount.toString(),
        currency: 'EGP'
      },
      reason: 'CUSTOMER_REQUEST'
    }
  });
}
```

---

## 2. Environment Variables

```env
# App
NODE_ENV=production
PORT=3000
API_BASE_URL=https://api.z-speed.com/api/v1

# Database
DATABASE_URL=postgresql://user:pass@host:5432/zspeed

# JWT
JWT_SECRET=your_super_secret_key_256bit
JWT_REFRESH_SECRET=your_refresh_secret_256bit
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Redis
REDIS_URL=redis://localhost:6379

# CyberSource (AAIB)
CYBERSOURCE_MERCHANT_ID=your_merchant_id
CYBERSOURCE_API_KEY=your_api_key
CYBERSOURCE_API_SECRET=your_api_secret
CYBERSOURCE_PROFILE_ID=your_profile_id
CYBERSOURCE_ACCESS_KEY=your_access_key
CYBERSOURCE_SECRET_KEY=your_secret_key_for_hmac
CYBERSOURCE_BASE_URL=https://api.cybersource.com
# For testing use: https://apitest.cybersource.com

# Firebase (FCM)
FIREBASE_PROJECT_ID=zspeed-firebase
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@zspeed.iam.gserviceaccount.com

# Storage
AWS_S3_BUCKET=zspeed-uploads
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=eu-central-1

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=noreply@z-speed.com
SMTP_PASS=...

# Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

---

## 3. Database Models Summary (Prisma)

| Model | Table | Key Fields |
|-------|-------|-----------|
| User | users | id, email, passwordHash, role, status, walletBalance, loyaltyPoints |
| Address | addresses | userId, street, city, lat, lng, isDefault, type |
| DriverProfile | driver_profiles | userId, applicationStatus, acceptanceRate, rating, currentLat, currentLng |
| Vehicle | vehicles | driverProfileId, type, make, model, plateNumber |
| Restaurant | restaurants | ownerId, name, status, isOpen, deliveryFee, rating, walletBalance |
| MenuSection | menu_sections | restaurantId, name, sortOrder, isActive |
| FoodItem | food_items | sectionId, name, price, addons, allergens, isAvailable |
| Cart | carts | customerId, restaurantId |
| CartItem | cart_items | cartId, foodItemId, quantity, selectedAddons |
| Order | orders | customerId, restaurantId, driverId, status, paymentState, total |
| OrderItem | order_items | orderId, foodItemId, quantity, unitPrice |
| DeliveryRequest | delivery_requests | orderId, driverId, status, expiresAt |
| Review | reviews | orderId, customerId, restaurantId, restaurantRating, driverRating |
| Ledger | ledgers | userId, orderId, type, amount, status |
| Notification | notifications | userId, title, body, read |
| PendingApproval | pending_approvals | actionType, targetTable, targetId, requestedById, status |
| AuditLog | audit_log | userId, action, targetTable, oldData, newData |

---

## 4. Complete Endpoint Index

### Auth
```
POST   /auth/register
POST   /auth/login
POST   /auth/google
POST   /auth/refresh
POST   /auth/logout
POST   /auth/forgot-password
POST   /auth/reset-password
```

### Users
```
GET    /users/me
PATCH  /users/me
POST   /users/addresses
GET    /users/addresses
PATCH  /users/addresses/:id
DELETE /users/addresses/:id
PATCH  /users/addresses/:id/default
```

### Restaurants (Public)
```
GET    /restaurants
GET    /restaurants/:id
GET    /restaurants/:id/menu
```

### Vendor
```
GET    /vendor/restaurants/my
POST   /vendor/restaurants
PATCH  /vendor/restaurants/:id
PATCH  /vendor/restaurants/:id/delivery-settings
PATCH  /vendor/restaurants/:id/toggle-open
GET    /vendor/restaurants/:id/stats
POST   /vendor/menu-sections
PATCH  /vendor/menu-sections/:id
DELETE /vendor/menu-sections/:id
POST   /vendor/food-items
PATCH  /vendor/food-items/:id
DELETE /vendor/food-items/:id
PATCH  /vendor/food-items/:id/availability
GET    /vendor/orders                             ← orders for vendor's restaurant
PATCH  /vendor/orders/:id/status                 ← confirm/preparing/ready
```

### Cart
```
GET    /cart
POST   /cart/items
PATCH  /cart/items/:id
DELETE /cart/items/:id
DELETE /cart
```

### Orders
```
POST   /orders/checkout
POST   /orders/validate-promo
GET    /orders/payment/flex-token
POST   /orders/payment/callback          ← CyberSource webhook (public)
GET    /orders/my
GET    /orders/:id
PATCH  /orders/:id/cancel
POST   /orders/:id/dispute
```

### Drivers
```
POST   /drivers/apply
PATCH  /drivers/availability
PATCH  /drivers/location
GET    /drivers/delivery-requests
PATCH  /drivers/delivery-requests/:id/accept
PATCH  /drivers/delivery-requests/:id/reject
GET    /drivers/my-orders
GET    /drivers/earnings
```

### Wallet
```
GET    /wallet/ledger
POST   /wallet/payout
```

### Reviews
```
POST   /reviews
GET    /reviews/restaurant/:id
PATCH  /reviews/:id/reply
```

### Notifications
```
GET    /notifications
PATCH  /notifications/:id/read
PATCH  /notifications/read-all
DELETE /notifications/:id
```

### Categories (Public)
```
GET    /categories
```

### Promotions
```
GET    /promotions/:code/validate
```

### Admin
```
GET    /admin/users
GET    /admin/users/:id
PATCH  /admin/users/:id/status
POST   /admin/users/:id/hard-delete
POST   /admin/users/:id/notify

GET    /admin/drivers/applications
GET    /admin/drivers/applications/:id
PATCH  /admin/drivers/:id/approve
PATCH  /admin/drivers/:id/reject
PATCH  /admin/drivers/:id/review
GET    /admin/drivers/active
GET    /admin/drivers/locations

GET    /admin/restaurants
GET    /admin/restaurants/pending
GET    /admin/restaurants/:id/docs
PATCH  /admin/restaurants/:id/approve
PATCH  /admin/restaurants/:id/reject
POST   /admin/restaurants/:id/hard-reject
PATCH  /admin/restaurants/:id/suspend

GET    /admin/orders
GET    /admin/orders/:id
PATCH  /admin/orders/:id/status
POST   /admin/orders/:id/reassign-driver
POST   /admin/orders/:id/refund

GET    /admin/disputes
GET    /admin/disputes/:id
PATCH  /admin/disputes/:id/resolve
PATCH  /admin/disputes/:id/escalate

POST   /admin/categories
PATCH  /admin/categories/:id
DELETE /admin/categories/:id

POST   /admin/promotions
PATCH  /admin/promotions/:id
DELETE /admin/promotions/:id

POST   /admin/notifications/push

GET    /admin/stats/daily
GET    /admin/stats/range
GET    /admin/stats/restaurants
GET    /admin/stats/drivers
GET    /admin/stats/revenue
```

### SuperAdmin
```
GET    /superadmin/pending-approvals
GET    /superadmin/pending-approvals/:id
PATCH  /superadmin/pending-approvals/:id/approve
PATCH  /superadmin/pending-approvals/:id/reject

POST   /superadmin/admins
DELETE /superadmin/admins/:id
GET    /superadmin/admins/activity

GET    /superadmin/system/config
PATCH  /superadmin/system/config
GET    /superadmin/audit-log
```

### System
```
GET    /health
```

---

## 5. Error Response Format

All errors follow this format:
```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "details": [
    { "field": "email", "message": "email must be a valid email" }
  ],
  "timestamp": "2026-04-27T20:00:00Z",
  "path": "/auth/register"
}
```

**Common Status Codes:**
| Code | Meaning |
|------|---------|
| 200 | OK |
| 201 | Created |
| 202 | Accepted (async operation started) |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (invalid/expired token) |
| 403 | Forbidden (wrong role) |
| 404 | Not Found |
| 409 | Conflict (e.g., email exists, cart from different restaurant) |
| 422 | Unprocessable Entity (business logic error) |
| 429 | Too Many Requests (rate limit) |
| 500 | Internal Server Error |

---

## 6. NestJS Modules Architecture

```
AppModule
├── AuthModule         # JWT, Passport, Google OAuth
├── UsersModule        # User CRUD + Address management
├── RestaurantsModule  # Restaurant CRUD + Vendor management
├── FoodModule         # Menu sections + Food items
├── CartModule         # Shopping cart
├── OrdersModule       # Order lifecycle + State machine
│   └── PaymentsService   # CyberSource integration
├── DriversModule      # Driver profiles + Location tracking
├── VehiclesModule     # Vehicle management
├── ReviewsModule      # Customer reviews
├── CategoriesModule   # Food categories
├── PromotionsModule   # Promo codes
├── DisputesModule     # Dispute management
├── NotificationsModule # FCM + In-app notifications
├── WalletModule       # Ledger + Payouts
├── AdminModule        # Admin-specific controllers
├── SuperAdminModule   # SuperAdmin controllers
├── AuditModule        # AuditLog interceptor
├── GatewayModule      # Socket.IO realtime gateway
├── QueuesModule       # BullMQ background jobs
├── PrismaModule       # Prisma ORM client
└── CommonModule       # Guards, Decorators, Pipes, Filters
```
