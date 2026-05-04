# Z-Speed — Part 4: Admin, SuperAdmin & Approval Workflow

---

## 1. Admin Endpoints

**All require:** `Role: ADMIN` or `Role: SUPERADMIN`

---

### 1.1 User Management

### GET /admin/users
**Query:** `?role=DRIVER&status=ACTIVE&search=ahmed&page=1&limit=20`

**Response:** Paginated list with id, name, email, role, status, createdAt.

---

### GET /admin/users/:id
Full user details including driverProfile (if DRIVER) or ownedRestaurants (if VENDOR).

---

### PATCH /admin/users/:id/status
**Body:** `{ "status": "SUSPENDED" }`

**Status values:** `ACTIVE` | `INACTIVE` | `SUSPENDED` | `BANNED` | `PENDING_SUSPENSION`

> **If BANNED:** Creates PendingApproval → waits for SuperAdmin confirmation.
> **If SUSPENDED:** Applied immediately (Admin can do directly).

---

### POST /admin/users/:id/hard-delete
**Creates PendingApproval, does NOT delete yet.**

**Body:** `{ "reason": "Fraudulent activity" }`

**Flow:**
```
1. Soft delete user (deletedAt = NOW())
2. Create PendingApproval:
   { actionType: 'hard_delete_user', targetTable: 'users', targetId, requestedBy: adminId }
3. Emit Socket.IO: approval:new to superadmin room
4. Return 202 Accepted
```

---

### POST /admin/users/:id/notify
Send FCM notification to specific user.

**Body:** `{ "title": "...", "body": "...", "data": {} }`

---

### 1.2 Driver Application Management

### GET /admin/drivers/applications
**Query:** `?status=PENDING&page=1`

**Response:** List of driver applications with document URLs.

---

### GET /admin/drivers/applications/:id
Full driver application details + vehicle info + document URLs.

---

### PATCH /admin/drivers/:id/approve
**Flow:**
```
1. Update DriverProfile.applicationStatus = APPROVED
2. Update User.status = ACTIVE (if not already)
3. Send FCM to driver: "Your application has been approved! 🎉"
4. Log to AuditLog
```

---

### PATCH /admin/drivers/:id/reject
**Body:** `{ "reason": "License expired" }`

**Flow:**
```
1. Update DriverProfile.applicationStatus = REJECTED
2. Save rejectionReason
3. Send FCM to driver: "Application rejected: License expired"
4. Log to AuditLog
```

---

### PATCH /admin/drivers/:id/review
Move to UNDER_REVIEW status (pending document verification).

---

### GET /admin/drivers/active
List of currently online/available drivers with last known location.

---

### GET /admin/drivers/locations
Real-time driver locations for map view.

**Response:**
```json
[
  {
    "driverId": "uuid",
    "name": "Mohamed",
    "currentLat": 30.044,
    "currentLng": 31.235,
    "isAvailable": true,
    "lastPingAt": "2026-04-27T20:05:00Z",
    "activeOrderId": "uuid or null"
  }
]
```

---

### 1.3 Restaurant Management

### GET /admin/restaurants/pending
Restaurants with status=PENDING_VERIFICATION.

---

### GET /admin/restaurants/:id/docs
Returns full documentUrls object for review.

---

### PATCH /admin/restaurants/:id/approve
**Flow:**
```
1. Update Restaurant.status = ACTIVE
2. Send FCM to vendor: "Your restaurant has been approved! 🎉"
3. Log to AuditLog
```

---

### PATCH /admin/restaurants/:id/reject
**Body:** `{ "reason": "Missing health certificate" }`

Direct rejection (non-final) — vendor can resubmit.

---

### POST /admin/restaurants/:id/hard-reject
Final rejection → Creates PendingApproval → waits for SuperAdmin.

---

### PATCH /admin/restaurants/:id/suspend
**Body:** `{ "reason": "Multiple customer complaints" }`

Immediate suspension — no SuperAdmin needed.

---

### GET /admin/restaurants
All restaurants with filters.
**Query:** `?status=ACTIVE&city=Cairo&page=1`

---

### 1.4 Order Management

### GET /admin/orders
**Query:** `?status=PENDING&restaurantId=uuid&driverId=uuid&date=2026-04-27&page=1`

---

### GET /admin/orders/:id
Full order details including all relations.

---

### PATCH /admin/orders/:id/status
Admin can force-change order status in emergency situations.

**Body:** `{ "status": "CANCELLED", "reason": "Restaurant closed" }`

---

### POST /admin/orders/:id/reassign-driver
**Body:** `{ "driverId": "uuid" }`

---

### POST /admin/orders/:id/refund
**Body:** `{ "amount": 196.56, "reason": "Order never arrived" }`

**Flow:**
```
1. Call CyberSource Reversal API if paymentMethod=CYBERSOURCE_CARD
2. Or credit walletBalance if paymentMethod=WALLET
3. Create Ledger record (type=REFUND)
4. Update Order.paymentState = REFUNDED
5. Notify customer via FCM
```

---

### 1.5 Disputes Management

### GET /admin/disputes
**Query:** `?status=open&page=1`

---

### GET /admin/disputes/:id
Full dispute details with order + customer + vendor info.

---

### PATCH /admin/disputes/:id/resolve
**Body:**
```json
{
  "resolution": "in_favor_of_customer",
  "note": "Food was missing items",
  "refundAmount": 50.0
}
```

---

### PATCH /admin/disputes/:id/escalate
Escalate to SuperAdmin.

---

### 1.6 Statistics & Reports

### GET /admin/stats/daily
**Query:** `?date=2026-04-27`

**Response:**
```json
{
  "date": "2026-04-27",
  "totalOrders": 156,
  "deliveredOrders": 140,
  "cancelledOrders": 16,
  "totalRevenue": 18500.00,
  "averageOrderValue": 118.58,
  "newUsers": 12,
  "activeDrivers": 28
}
```

---

### GET /admin/stats/range
**Query:** `?from=2026-04-01&to=2026-04-27`

---

### GET /admin/stats/restaurants
Top restaurants by orders / revenue.

---

### GET /admin/stats/drivers
Driver performance: trips, ratings, earnings.

---

### GET /admin/stats/revenue
Revenue breakdown: platform fees, delivery fees, total.

---

## 2. SuperAdmin Endpoints

**All require:** `Role: SUPERADMIN`

---

### 2.1 Pending Approvals

### GET /superadmin/pending-approvals
**Query:** `?actionType=hard_delete_user&status=PENDING&page=1`

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "actionType": "hard_delete_user",
      "targetTable": "users",
      "targetId": "uuid",
      "payload": { "reason": "Fraudulent activity" },
      "requestedBy": { "id": "uuid", "name": "Admin Ahmed" },
      "status": "PENDING",
      "createdAt": "2026-04-27T19:00:00Z"
    }
  ]
}
```

---

### GET /superadmin/pending-approvals/:id
Full details with target record data.

---

### PATCH /superadmin/pending-approvals/:id/approve
**Body (optional):** `{ "note": "Confirmed — proceed" }`

**Internal Execution by actionType:**

```typescript
switch (approval.actionType) {
  case 'hard_delete_user':
    await prisma.user.delete({ where: { id: approval.targetId } });
    break;

  case 'ban_user':
    await prisma.user.update({
      where: { id: approval.targetId },
      data: { status: 'BANNED' }
    });
    break;

  case 'hard_reject_restaurant':
    await prisma.restaurant.delete({ where: { id: approval.targetId } });
    break;

  case 'change_role':
    await prisma.user.update({
      where: { id: approval.targetId },
      data: { role: approval.payload.newRole }
    });
    break;
}

// Always after execution:
await prisma.pendingApproval.update({
  where: { id: approval.id },
  data: {
    status: 'APPROVED',
    reviewedById: superadminId,
    reviewedAt: new Date()
  }
});

await prisma.auditLog.create({
  data: {
    userId: superadminId,
    userRole: 'SUPERADMIN',
    action: `approved:${approval.actionType}`,
    targetTable: approval.targetTable,
    targetId: approval.targetId,
    newData: approval.payload
  }
});
```

---

### PATCH /superadmin/pending-approvals/:id/reject
**Body:** `{ "reason": "Insufficient evidence" }`

**Flow:**
```
1. Update PendingApproval status=REJECTED, rejectionReason
2. Reverse any preliminary changes (e.g., unset deletedAt if was soft-deleted)
3. Notify requesting Admin via FCM
4. Log to AuditLog
```

---

### 2.2 Admin Management

### POST /superadmin/admins
Create a new Admin account.

**Body:**
```json
{
  "name": "Omar Admin",
  "email": "omar@z-speed.com",
  "password": "SecurePass123!"
}
```

**Flow:**
```
1. Create User with role=ADMIN, status=ACTIVE
2. Send welcome email with credentials
3. Log to AuditLog
```

---

### DELETE /superadmin/admins/:id
Hard delete Admin account immediately (SuperAdmin can do this directly).

---

### GET /superadmin/admins/activity
Log of all actions taken by each Admin.

**Response:** Paginated AuditLog filtered by userRole=ADMIN.

---

### 2.3 System Configuration

### GET /superadmin/system/config
**Response:**
```json
{
  "platformFeePercent": 2,
  "defaultDeliveryRadiusKm": 10,
  "maxDeliveryRadiusKm": 20,
  "driverRequestExpirySeconds": 60,
  "maxDriverRequestsPerOrder": 5,
  "loyaltyPointsPerEGP": 1,
  "loyaltyPointsRedeemRate": 0.01
}
```

---

### PATCH /superadmin/system/config
**Body:** `{ "platformFeePercent": 2.5 }`

> Changes logged to AuditLog automatically.

---

### 2.4 Audit Log

### GET /superadmin/audit-log
**Query:** `?userId=uuid&action=hard_delete_user&from=2026-04-01&to=2026-04-27&page=1`

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "user": { "id": "uuid", "name": "Admin Ahmed", "role": "ADMIN" },
      "action": "approved:hard_delete_user",
      "targetTable": "users",
      "targetId": "uuid",
      "oldData": null,
      "newData": { "reason": "Fraud" },
      "ipAddress": "197.45.1.100",
      "createdAt": "2026-04-27T20:00:00Z"
    }
  ]
}
```

---

## 3. Full Approval Workflow Example (Hard Delete User)

```
Step 1: Admin → POST /admin/users/:id/hard-delete { reason: "Fraud" }
  ↓
Step 2: System soft-deletes user (deletedAt = NOW())
  ↓
Step 3: Creates PendingApproval record:
  {
    actionType: "hard_delete_user",
    targetTable: "users",
    targetId: userId,
    payload: { reason: "Fraud" },
    requestedById: adminId,
    status: "PENDING"
  }
  ↓
Step 4: Emits Socket.IO: approval:new → SuperAdmin dashboard
         Sends FCM to SuperAdmin
  ↓
Step 5: SuperAdmin reviews → GET /superadmin/pending-approvals/:id
  ↓
Step 6a (Approve): PATCH /superadmin/pending-approvals/:id/approve
  → System executes prisma.user.delete()
  → Creates AuditLog
  → Notifies Admin: "Request approved"
  ↓
Step 6b (Reject): PATCH /superadmin/pending-approvals/:id/reject
  → Reverses soft-delete (deletedAt = null)
  → Updates PendingApproval status=REJECTED
  → Notifies Admin: "Request rejected: Insufficient evidence"
```

---

## 4. All Action Types for PendingApproval

| actionType | Triggered By | What Happens on Approve |
|-----------|-------------|------------------------|
| `hard_delete_user` | Admin | prisma.user.delete() |
| `ban_user` | Admin | user.status = BANNED |
| `change_role` | Admin | user.role = payload.newRole |
| `hard_reject_restaurant` | Admin | prisma.restaurant.delete() |
| `suspend_restaurant` | Admin | restaurant.status = SUSPENDED |
| `payout_request` | Driver/Vendor | Execute bank transfer |

---

## 5. Health Check

### GET /health
**Public**

**Response:**
```json
{
  "status": "ok",
  "database": "connected",
  "redis": "connected",
  "timestamp": "2026-04-27T20:00:00Z",
  "uptime": 86400
}
```
