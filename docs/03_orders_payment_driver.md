# Z-Speed — Part 3: Orders, Payment Gateway & Driver Flow

---

## 1. Order Status State Machine

```
PENDING
  ↓ (vendor confirms)
CONFIRMED
  ↓ (vendor starts preparing)
PREPARING
  ↓ (food ready for pickup)
READY
  ↓ (driver accepts delivery request)
IN_PROGRESS
  ↓ (driver picks up from restaurant)
OUT_FOR_DELIVERY
  ↓ (driver delivers to customer)
DELIVERED

Any state → CANCELLED (customer / vendor / admin)
```

**Who can change which status:**

| From → To | Who |
|-----------|-----|
| PENDING → CONFIRMED | VENDOR |
| CONFIRMED → PREPARING | VENDOR |
| PREPARING → READY | VENDOR |
| READY → IN_PROGRESS | System (on driver accept) |
| IN_PROGRESS → OUT_FOR_DELIVERY | DRIVER |
| OUT_FOR_DELIVERY → DELIVERED | DRIVER |
| Any → CANCELLED | CUSTOMER (before CONFIRMED), VENDOR, ADMIN |

---

## 2. Checkout & Order Creation

### POST /orders/checkout
**Role: CUSTOMER**

**Body:**
```json
{
  "restaurantId": "uuid",
  "deliveryAddressId": "uuid",
  "paymentMethod": "CYBERSOURCE_CARD",
  "promoCode": "WELCOME20",
  "customerNote": "Extra napkins please",

  "deviceInformation": {
    "ipAddress": "197.45.1.100",
    "httpBrowserScreenHeight": "900",
    "httpBrowserScreenWidth": "1440",
    "httpBrowserLanguage": "ar-EG",
    "httpBrowserJavaEnabled": "false",
    "httpBrowserJavaScriptEnabled": "true",
    "httpBrowserColorDepth": "24",
    "httpBrowserTimeDifference": "-120"
  },

  "billingInformation": {
    "firstName": "Ahmed",
    "lastName": "Ali",
    "email": "ahmed@example.com",
    "phoneNumber": "01012345678",
    "address1": "15 Tahrir St",
    "city": "Cairo",
    "administrativeArea": "CAI",
    "country": "EG",
    "postalCode": "11511"
  }
}
```

**paymentMethod values:** `CASH` | `CYBERSOURCE_CARD` | `WALLET`

---

**Internal Flow:**
```
1. Validate customer cart is not empty
2. Load restaurant → verify status=ACTIVE, isOpen=true
3. Verify deliveryAddressId belongs to customer
4. Calculate pricing:
   - subtotal = sum(item.price * qty + selectedAddons)
   - deliveryFee = calculateByMode(restaurant.deliveryFeeMode, distance)
   - discount = applyPromo(promoCode, subtotal)
   - serviceFee = subtotal * 0.02  (2% platform fee)
   - total = subtotal + deliveryFee + serviceFee - discount

5. If WALLET:
   - Check walletBalance >= total
   - Deduct balance → create Order (paymentState=PAID)

6. If CASH:
   - Create Order (paymentState=PENDING) → return order data

7. If CYBERSOURCE_CARD:
   - Send to CyberSource API (see section below)
   - Return { transactionId, paymentUrl } to frontend

8. Clear cart after successful order creation
9. Notify vendor via FCM + Socket.IO event: order:new
```

---

**Response (CASH):**
```json
{
  "orderId": "uuid",
  "status": "PENDING",
  "paymentState": "PENDING",
  "total": 213.50,
  "estimatedDelivery": "2026-04-27T23:00:00Z"
}
```

**Response (CYBERSOURCE_CARD):**
```json
{
  "orderId": "uuid",
  "status": "PENDING",
  "paymentState": "PENDING",
  "cybersource": {
    "transactionId": "7058102392870000",
    "flexToken": "eyJraWQiOiJ...",
    "captureContext": "...",
    "paymentUrl": "https://testsecureacceptance.cybersource.com/pay"
  }
}
```

---

## 3. CyberSource Integration (AAIB Gateway)

### Integration Type: Secure Acceptance Hosted Checkout + Flex Microform

**Reference Docs (from AAIB email):**
- Secure Acceptance: https://apps.cybersource.com/library/documentation/dev_guides/Secure_Acceptance_Hosted_Checkout/Secure_Acceptance_Hosted_Checkout.pdf
- Flex Microform (App): https://developer.cybersource.com/content/dam/docs/cybs/en-us/digital-accept-flex/developer/all/rest/digital-accept-flex.pdf

---

### 3.1 Required Fields (Mandatory for Payer Authentication / 3DS)

| CyberSource Field | Source | Notes |
|------------------|--------|-------|
| `deviceInformation.ipAddress` | Frontend (client IP) | Mandatory for browser transactions |
| `deviceInformation.httpBrowserScreenHeight` | Frontend JS | `window.screen.height` |
| `deviceInformation.httpBrowserScreenWidth` | Frontend JS | `window.screen.width` |
| `deviceInformation.httpBrowserLanguage` | Frontend JS | `navigator.language` |
| `orderInformation.billTo.firstName` | User profile | |
| `orderInformation.billTo.lastName` | User profile | |
| `orderInformation.billTo.email` | User profile | |
| `orderInformation.billTo.phoneNumber` | User profile | |
| `orderInformation.billTo.address1` | Billing address | |
| `orderInformation.billTo.locality` | City | Required for US/CA/CN, recommended elsewhere |
| `orderInformation.billTo.administrativeArea` | State/Gov | |
| `orderInformation.billTo.country` | 2-letter ISO | e.g., "EG" |
| `orderInformation.billTo.postalCode` | Postal code | |

---

### 3.2 Backend Call to CyberSource

```typescript
// payments.service.ts
async initiatePayment(order: Order, deviceInfo: DeviceInfo, billingInfo: BillingInfo) {
  const payload = {
    clientReferenceInformation: {
      code: order.id
    },
    processingInformation: {
      actionList: ["CONSUMER_AUTHENTICATION"],
      actionTokenTypes: ["customer", "paymentInstrument"]
    },
    orderInformation: {
      amountDetails: {
        totalAmount: order.total.toString(),
        currency: "EGP"
      },
      billTo: {
        firstName: billingInfo.firstName,
        lastName: billingInfo.lastName,
        email: billingInfo.email,
        phoneNumber: billingInfo.phoneNumber,
        address1: billingInfo.address1,
        locality: billingInfo.city,
        administrativeArea: billingInfo.administrativeArea,
        postalCode: billingInfo.postalCode,
        country: billingInfo.country
      }
    },
    deviceInformation: {
      ipAddress: deviceInfo.ipAddress,
      httpBrowserScreenHeight: deviceInfo.httpBrowserScreenHeight,
      httpBrowserScreenWidth: deviceInfo.httpBrowserScreenWidth,
      httpBrowserLanguage: deviceInfo.httpBrowserLanguage,
      httpBrowserJavaEnabled: deviceInfo.httpBrowserJavaEnabled,
      httpBrowserJavaScriptEnabled: deviceInfo.httpBrowserJavaScriptEnabled,
      httpBrowserColorDepth: deviceInfo.httpBrowserColorDepth,
      httpBrowserTimeDifference: deviceInfo.httpBrowserTimeDifference
    }
  };

  // POST to CyberSource REST API
  const response = await this.cybersourceClient.post('/pts/v2/payments', payload);
  return response.data;
}
```

---

### 3.3 Payment Callback (Webhook)

### POST /orders/payment/callback
**Public (no JWT)** — Called by CyberSource servers

**Security:** Validate HMAC signature from CyberSource before processing.

```typescript
// Verify signature
const isValid = this.verifySignature(req.body, req.headers['v-c-signature']);
if (!isValid) throw new UnauthorizedException('Invalid webhook signature');
```

**Flow:**
```
1. Parse CyberSource callback body
2. Verify HMAC signature
3. Extract orderId from clientReferenceInformation.code
4. Check decision field:
   - "ACCEPT" → paymentState=PAID, orderStatus=CONFIRMED
   - "DECLINE" / "ERROR" → paymentState=FAILED, notify customer
5. If PAID:
   a. Update Order in DB
   b. Notify Vendor (FCM + Socket.IO: order:confirmed)
   c. Notify Customer (FCM: "Order confirmed!")
   d. Log to AuditLog
6. Return HTTP 200 to CyberSource (important!)
```

---

## 4. Order Endpoints

### GET /orders/my
**Role: CUSTOMER**

**Query:** `?status=DELIVERED&page=1&limit=10`

**Response:** Paginated list of orders with restaurant name, total, status, items count.

---

### GET /orders/:id
**Role: CUSTOMER (own) / VENDOR (own restaurant) / DRIVER (assigned) / ADMIN**

**Response:**
```json
{
  "id": "uuid",
  "status": "IN_PROGRESS",
  "paymentState": "PAID",
  "paymentMethod": "CYBERSOURCE_CARD",
  "subtotal": 178.0,
  "deliveryFee": 15.0,
  "serviceFee": 3.56,
  "discount": 0,
  "total": 196.56,
  "customerNote": "Extra napkins",
  "deliveryAddress": "15 Tahrir St, Cairo",
  "deliveryLat": 30.0444,
  "deliveryLng": 31.2357,
  "restaurant": { "id": "uuid", "name": "Burger House", "phone": "..." },
  "driver": { "id": "uuid", "name": "Mohamed", "phone": "...", "currentLat": 30.05, "currentLng": 31.24 },
  "items": [
    {
      "name": "Classic Burger",
      "quantity": 2,
      "unitPrice": 89.0,
      "selectedAddons": [{ "name": "Extra Cheese", "price": 10 }],
      "lineTotal": 198.0
    }
  ],
  "createdAt": "2026-04-27T20:00:00Z",
  "acceptedAt": "2026-04-27T20:02:00Z",
  "estimatedDelivery": "2026-04-27T20:35:00Z"
}
```

---

### GET /orders/restaurant/:restaurantId
**Role: VENDOR**

**Query:** `?status=PENDING&date=2026-04-27`

---

### PATCH /orders/:id/status
**Role: VENDOR / DRIVER / ADMIN** (RBAC enforced)

**Body:** `{ "status": "PREPARING" }`

**Side Effects per status:**
- `CONFIRMED` → Notify customer FCM
- `PREPARING` → Notify customer FCM
- `READY` → **Create DeliveryRequests** for nearby available drivers
- `OUT_FOR_DELIVERY` → Start real-time tracking events
- `DELIVERED` → Add earnings to driver wallet, add revenue to restaurant wallet, prompt customer to review
- `CANCELLED` → Refund if PAID (initiate CyberSource reversal)

---

### PATCH /orders/:id/cancel
**Role: CUSTOMER** (only if status = PENDING or CONFIRMED)

**Body:** `{ "reason": "Changed my mind" }`

---

### POST /orders/:id/dispute
**Role: CUSTOMER**

**Body:** `{ "reason": "Food was wrong", "details": "I ordered classic but got spicy" }`

---

## 5. Driver Endpoints

### POST /drivers/apply
**Role: DRIVER**

**Body:**
```json
{
  "nationalId": "12345678901234",
  "nationalIdUrl": "https://storage.../national_id.jpg",
  "driverLicenseUrl": "https://storage.../license.jpg",
  "dateOfBirth": "1990-01-01T00:00:00Z",
  "bankInfo": {
    "bankName": "Banque Misr",
    "accountHolderName": "Mohamed Ali",
    "accountNumber": "1234567890123456",
    "iban": "EG120002000000000123456789012"
  },
  "payoutPhoneNumber": "01012345678",
  "vehicle": {
    "type": "motorcycle",
    "make": "Honda",
    "model": "Wave",
    "year": 2022,
    "plateNumber": "123-ABC",
    "color": "Red",
    "registrationDocUrl": "https://storage.../reg.jpg",
    "insuranceDocUrl": "https://storage.../insurance.jpg"
  }
}
```

**Response 201:** `{ "applicationStatus": "UNDER_REVIEW", "message": "Application submitted" }`

---

### PATCH /drivers/availability
**Role: DRIVER (approved only)**

**Body:** `{ "isAvailable": true }`

---

### PATCH /drivers/location
**Role: DRIVER**

**Body:** `{ "currentLat": 30.0444, "currentLng": 31.2357 }`

> Prefer Socket.IO for frequent updates — HTTP endpoint for one-time/backup sync.

---

### GET /drivers/delivery-requests
**Role: DRIVER** — Pending delivery requests assigned to this driver

---

### PATCH /drivers/delivery-requests/:id/accept
**Role: DRIVER**

**Flow:**
```
1. Find DeliveryRequest → verify status=PENDING, not expired
2. Update DeliveryRequest status=ACCEPTED
3. Update Order: driverId=driver, status=IN_PROGRESS, driverAssignedAt=now()
4. Cancel other pending DeliveryRequests for same order
5. Notify customer: "Driver assigned!"
6. Emit Socket.IO: order:assigned to customer room
7. Return order details with pickup location
```

---

### PATCH /drivers/delivery-requests/:id/reject
**Role: DRIVER**

**Body:** `{ "reason": "Too far" }`

**Flow:**
```
1. Mark DeliveryRequest as REJECTED
2. Increment driver.totalRejected
3. Recalculate acceptanceRate
4. If no other drivers → try next available driver or escalate to admin
```

---

### GET /drivers/my-orders
**Role: DRIVER** — Completed and active deliveries

---

### GET /drivers/earnings
**Role: DRIVER**

**Response:**
```json
{
  "totalEarnings": 1250.00,
  "walletBalance": 320.00,
  "todayEarnings": 85.00,
  "thisWeekEarnings": 420.00,
  "completedTrips": 47
}
```

---

## 6. Delivery Request Assignment Logic

When order status changes to `READY`:

```typescript
// orders.service.ts → handleReady()
async assignDriversToOrder(orderId: string, restaurantLat: number, restaurantLng: number) {
  // 1. Find available drivers within radius (use geohash or PostGIS)
  const nearbyDrivers = await this.findNearbyDrivers(restaurantLat, restaurantLng, radiusKm = 5);

  // 2. Sort by distance + acceptanceRate
  const sorted = nearbyDrivers.sort((a, b) => a.distance - b.distance);

  // 3. Create DeliveryRequest for each (max 5 drivers)
  for (const driver of sorted.slice(0, 5)) {
    await this.prisma.deliveryRequest.create({
      data: {
        orderId,
        driverId: driver.id,
        deliveryFee: order.deliveryFee,
        estimatedDistance: driver.distance,
        expiresAt: new Date(Date.now() + 60000) // 60 seconds to accept
      }
    });

    // 4. Notify via FCM + Socket.IO
    await this.notificationsService.notifyDriver(driver.userId, order);
    this.gateway.emitToDriver(driver.id, 'order:new_request', orderDetails);
  }
}
```

---

## 7. Wallet & Ledger Endpoints

### GET /wallet/ledger
**Role: DRIVER / VENDOR**

**Query:** `?type=EARNING&page=1&limit=20`

**Response:**
```json
{
  "walletBalance": 320.00,
  "transactions": [
    {
      "id": "uuid",
      "type": "EARNING",
      "amount": 25.50,
      "orderId": "uuid",
      "status": "completed",
      "createdAt": "2026-04-27T20:00:00Z"
    }
  ]
}
```

**Ledger Types:** `EARNING` | `PAYOUT` | `REFUND` | `FEE`

---

### POST /wallet/payout
**Role: DRIVER / VENDOR**

**Body:** `{ "amount": 200.0 }`

**Flow:**
```
1. Verify amount <= walletBalance
2. Deduct amount from walletBalance
3. Create Ledger record (type=PAYOUT, status=PENDING)
4. Create PendingApproval → admin reviews and executes transfer
5. Return { payoutId, status: "PENDING", expectedTime: "1-2 business days" }
```

---

## 8. Notifications Endpoints

### GET /notifications
**Role: Any authenticated user**

**Query:** `?read=false&page=1&limit=20`

---

### PATCH /notifications/:id/read
Mark single notification as read.

### PATCH /notifications/read-all
Mark all as read.

### DELETE /notifications/:id

### POST /admin/notifications/push
**Role: ADMIN/SUPERADMIN**

**Body:**
```json
{
  "userIds": ["uuid1", "uuid2"],
  "title": "New Feature!",
  "body": "Check out our new loyalty program",
  "data": { "screen": "loyalty" }
}
```

---

## 9. Real-time Socket.IO Events

**Connection:** `wss://api.z-speed.com` with JWT in handshake auth.

```typescript
// Client connection
const socket = io('wss://api.z-speed.com', {
  auth: { token: 'Bearer eyJhbG...' }
});
```

### Events Table

| Event | Direction | Listener | Payload |
|-------|-----------|----------|---------|
| `order:new` | Server→Vendor | Vendor App | Full order object |
| `order:confirmed` | Server→Customer | Customer App | `{ orderId, status }` |
| `order:status_changed` | Server→Customer | Customer App | `{ orderId, status, message }` |
| `order:new_request` | Server→Driver | Driver App | Order + pickup location |
| `order:assigned` | Server→Customer | Customer App | Driver info + ETA |
| `driver:location_update` | Driver→Server | Server stores in DB | `{ lat, lng }` |
| `driver:location` | Server→Customer | Customer App | `{ lat, lng, heading }` |
| `approval:new` | Server→SuperAdmin | Admin Dashboard | PendingApproval object |

### Room Strategy

```
customer:{userId}   ← customer receives order updates
vendor:{restaurantId} ← vendor receives new orders
driver:{driverProfileId} ← driver receives delivery requests
admin:{adminRoom}   ← admins receive new applications
superadmin          ← superadmin receives pending approvals
```
