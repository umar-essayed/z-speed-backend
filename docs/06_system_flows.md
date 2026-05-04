# Z-Speed System Flows & Diagrams 🚀

This document illustrates the complete end-to-end flows for the **Z-Speed** application. We use Mermaid diagrams to provide a visual, structured understanding of the system's architecture, user journeys, and internal processing logic.

---

## 1. Authentication & Onboarding Flow 🔐

This flow explains how users (Customers, Vendors, Drivers) authenticate using Firebase, and how the backend manages secure sessions using JWT.

```mermaid
sequenceDiagram
    participant Client as Frontend (App/Web)
    participant FB as Firebase Auth
    participant API as Z-Speed Backend
    participant DB as PostgreSQL

    Client->>FB: Login/Register (Email, Google, Apple)
    FB-->>Client: Returns Firebase `idToken`
    Client->>API: POST /auth/login (with `idToken`)
    API->>FB: Verify `idToken` via Firebase Admin
    FB-->>API: User UID & Email Verified
    API->>DB: Check if user exists (by email/UID)
    alt User exists
        DB-->>API: Return User Profile
    else User is new (Registration)
        API->>DB: Create new User (role: CUSTOMER/VENDOR/DRIVER)
    end
    API->>API: Generate `accessToken` & `refreshToken`
    API->>DB: Store hashed `refreshToken`
    API-->>Client: Return `{ accessToken, refreshToken, user }`
    Note over Client,API: All subsequent requests include `Bearer accessToken`
```

---

## 2. Restaurant Creation & Approval Flow 🏪

Vendors must apply to create a restaurant. The system ensures an Admin manually verifies documents before the restaurant becomes active on the platform.

```mermaid
stateDiagram-v2
    [*] --> PENDING_VERIFICATION: Vendor Submits POST /vendor/restaurants
    
    state PENDING_VERIFICATION {
        direction LR
        AdminReviews --> VerifyDocuments
    }
    
    PENDING_VERIFICATION --> ACTIVE: Admin Approves
    PENDING_VERIFICATION --> REJECTED: Admin Rejects (Reason provided)
    PENDING_VERIFICATION --> SUSPENDED: Admin Suspends active restaurant

    ACTIVE --> [*]: Visible to Customers
    REJECTED --> PENDING_VERIFICATION: Vendor updates documents & resubmits
```

```mermaid
sequenceDiagram
    participant Vendor
    participant API as Backend
    participant Admin
    participant DB

    Vendor->>API: POST /vendor/restaurants (Location, Docs, Info)
    API->>DB: Create Restaurant (Status: PENDING_VERIFICATION)
    API->>Admin: Emit Notification (New Restaurant Application)
    Admin->>API: Review Application (Docs, Bank Info)
    alt Approved
        Admin->>API: PATCH /admin/restaurants/:id/approve
        API->>DB: Update Status -> ACTIVE
        API->>Vendor: Push Notification (Approved)
    else Rejected
        Admin->>API: PATCH /admin/restaurants/:id/reject
        API->>DB: Update Status -> REJECTED
        API->>Vendor: Push Notification (Action Required)
    end
```

---

## 3. Driver Application & Onboarding Flow 🛵

Similar to restaurants, drivers must submit an application containing their National ID, Driver's License, and Vehicle info.

```mermaid
sequenceDiagram
    participant Driver
    participant API as Backend
    participant Admin
    participant DB

    Driver->>API: POST /drivers/apply (Docs, Vehicle Info)
    API->>DB: Update DriverProfile (Status: UNDER_REVIEW)
    API->>DB: Upsert Vehicle details
    API->>Admin: Emit Notification (New Driver Application)
    Admin->>API: Review Driver Documents
    alt Approved
        Admin->>API: PATCH /admin/drivers/:id/approve
        API->>DB: Update Status -> APPROVED
        API->>Driver: Push Notification (Welcome aboard)
    else Rejected
        Admin->>API: PATCH /admin/drivers/:id/reject
        API->>DB: Update Status -> REJECTED
        API->>Driver: Push Notification (Reason)
    end
```

---

## 4. End-to-End Order & Delivery Flow 📦

This is the core flow of the system. It covers cart checkout, payment, vendor preparation, real-time driver matching (scoring algorithm), and delivery.

```mermaid
stateDiagram-v2
    [*] --> PENDING: Customer Checkout
    PENDING --> CONFIRMED: Vendor Accepts
    PENDING --> CANCELLED: Vendor Rejects / Customer Cancels
    CONFIRMED --> PREPARING: Vendor starts cooking
    PREPARING --> READY: Food is ready
    READY --> IN_PROGRESS: Driver Matches & Accepts
    IN_PROGRESS --> OUT_FOR_DELIVERY: Driver Picks up food
    OUT_FOR_DELIVERY --> DELIVERED: Handed to Customer
    DELIVERED --> [*]: Flow Ends (Earnings Distributed)
```

### Detailed Order Sequence

```mermaid
sequenceDiagram
    actor Customer
    participant API as Backend
    participant CyberSource as Payment Gateway
    participant Vendor
    participant Redis as Redis (Geospatial)
    actor Driver

    Customer->>API: POST /orders/checkout (Cart, Payment Method)
    API->>API: Validate Geofencing, Stock, Promos
    
    alt Card Payment
        API->>CyberSource: Create Payment Session
        CyberSource-->>API: Token
        API-->>Customer: Proceed to 3D Secure
    else Cash/Wallet
        API->>API: Process directly
    end

    API->>Vendor: Emit `order:new` via Socket.IO
    Vendor->>API: Accept Order (Status: CONFIRMED -> PREPARING -> READY)
    
    rect rgb(240, 248, 255)
        Note right of API: Driver Matching Algorithm
        API->>Redis: Get nearby drivers within delivery radius
        Redis-->>API: Drivers & Distances
        API->>API: Calculate Score (Distance + Rating + Acceptance + Vehicle Size)
        API->>Driver: Send `DeliveryRequest` to Top Drivers
    end

    Driver->>API: Accept Delivery Request
    API->>Customer: Emit `order:assigned` & Driver Tracking
    Driver->>API: Update Status -> IN_PROGRESS -> OUT_FOR_DELIVERY
    
    loop Realtime Tracking
        Driver->>Redis: Update Location (Geospatial)
        Redis-->>Customer: Broadcast `driver:location` via Socket.IO
    end

    Driver->>API: Status -> DELIVERED
    API->>API: Distribute Earnings (Vendor & Driver Wallets)
    API->>API: Award Loyalty Points to Customer
```

---

## 5. Wallet & Payout Flow 💰

When a driver or vendor accumulates earnings, they reside in the system's digital wallet. They can request payouts to external banks/wallets.

```mermaid
sequenceDiagram
    participant User as Vendor / Driver
    participant API as Backend
    participant DB as PostgreSQL Ledger
    participant SuperAdmin

    Note over API, DB: Earnings automatically added upon DELIVERED order
    User->>API: GET /wallet/ledger (Check Balance)
    User->>API: POST /wallet/payout (Amount: X)
    API->>API: Verify X <= `walletBalance`
    API->>DB: Deduct X from `walletBalance`
    API->>DB: Create Ledger entry (Type: PAYOUT, Status: PENDING)
    API->>DB: Create `PendingApproval` record
    API->>SuperAdmin: Notify (New Payout Request)
    
    SuperAdmin->>API: Execute Approval
    API->>DB: Update Ledger Status -> COMPLETED
    API->>DB: Log to AuditLog
    API->>User: Notify (Payout Transferred to Bank)
```

---

## 6. Realtime Communication Architecture (WebSockets & BullMQ) ⚡

How background jobs (like push notifications) and real-time events (like map tracking) work.

```mermaid
graph TD
    Client[Mobile/Web Client] -->|WebSocket (Socket.IO)| Gateway[Realtime Gateway]
    Gateway -->|Authentication| JWT[JWT Auth Guard]
    
    subgraph Rooms
        Gateway --> C_Room[Customer Room]
        Gateway --> V_Room[Vendor Room]
        Gateway --> D_Room[Driver Room]
        Gateway --> A_Room[Admin Room]
    end
    
    Services[Backend Services] -->|Emit Events| Gateway
    Services -->|Add Jobs| Queue[BullMQ / Redis]
    
    Queue --> Worker1[Notification Processor (FCM)]
    Queue --> Worker2[Email Processor]
    Queue --> Worker3[Stats / Cleanup Processor]
```

### Key Realtime Events
- `order:new` ➔ Sent to Vendor room.
- `order:status_changed` ➔ Sent to Customer room.
- `order:new_request` ➔ Sent to Driver room.
- `driver:location` ➔ Sent to Customer room (Live Tracking).
- `approval:new` ➔ Sent to Admin/SuperAdmin rooms.
