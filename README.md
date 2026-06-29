# Z-SPEED Backend API Server 🚀

Welcome to the **Z-SPEED Backend API Server**! This server is built using the [NestJS](https://nestjs.com/) framework in TypeScript, providing a scalable, robust, and highly secure infrastructure for the Z-SPEED food delivery and logistics platform.

---

## 🛠️ Tech Stack & Core Infrastructure

* **Framework**: [NestJS](https://nestjs.com/) (Node.js MVC framework)
* **Language**: TypeScript
* **Database ORM**: [Prisma ORM](https://www.prisma.io/)
* **Databases**:
  * **PostgreSQL**: Primary transactional database (users, orders, wallets, logs, etc.)
  * **Firebase Firestore**: Realtime client-facing synchronization (driver tracking, live orders, active chats).
* **Realtime Channels**: [Socket.io](https://socket.io/) (for live driver GPS coordinates and order status events).
* **Notifications**: Firebase Cloud Messaging (FCM) push notifications.
* **Payment Gateway**: CyberSource Payment Gateway integration.
* **Hosting / Deployment**: Docker / Railway.

---

## 🏗️ Folder Structure Overview

```bash
BACKEND/
├── docs/             # (Ignored) Technical architecture documents
├── prisma/           # Prisma schema, migrations, and seed scripts
├── scratch/          # (Ignored) Developer temporary scripts and logs
├── scripts/          # (Ignored) Production maintenance and syncing scripts
├── src/              # NestJS Application Source Code
│   ├── admin/        # Admin panel services and routes
│   ├── auth/         # Hybrid Firebase Auth & local auth strategies
│   ├── cart/         # Shopping cart operations
│   ├── categories/   # Menu categories/sections management
│   ├── common/       # Middleware, guards, filters, interceptors, and helpers
│   ├── disputes/     # Customer dispute and ticket handling
│   ├── drivers/      # Driver registration, status, and matchmaking
│   ├── favorites/    # Favorite items/vendors for customers
│   ├── firebase/     # Firestore sync and Firebase Admin SDK handlers
│   ├── food/         # Food items management
│   ├── gateway/      # Socket.io gateway for real-time channels
│   ├── mailer/       # Mail templates (handlebars) and SMTP services
│   ├── notifications/# FCM push notification triggers
│   ├── onboarding/   # Vendor & driver onboarding pipelines
│   ├── orders/       # Order processing and state machine logic
│   ├── payments/     # CyberSource payment integration handlers
│   ├── promotions/   # Coupon codes and discount rules
│   ├── redis/        # Redis modules (optional caching/queues)
│   ├── restaurants/  # Restaurant and vendor configuration
│   ├── reviews/      # Customer ratings and comments
│   ├── superadmin/   # SuperAdmin controls and authorization workflows
│   ├── wallet/       # Driver/vendor digital wallets and payout requests
│   └── main.ts       # Application entry point
├── test/             # (Ignored) Newman and Jest E2E test suites
├── Dockerfile        # Docker container definition
├── docker-compose.yml# Local multi-service environment (Postgres, Redis)
└── railway.json      # Railway deployment configuration
```

---

## 🔐 Core System Flows

### 1. Hybrid Authentication Flow
The server uses a hybrid approach combining Firebase Auth with PostgreSQL:
1. The user authenticates on the client app using Firebase Auth.
2. The client sends the Firebase ID token in the `Authorization: Bearer <token>` header.
3. The NestJS server intercepts the request, validates the token using `firebase-admin`, and checks if the user exists in PostgreSQL.
4. If the user doesn't exist, a synchronization service creates the user profile in Postgres with the correct role (Customer, Driver, or Vendor).

### 2. Order State Machine
Orders progress through a strict, auditable lifecycle:
* `PENDING` ➡️ `PAID` (or `FAILED`)
* `ACCEPTED_BY_VENDOR` ➡️ `PREPARING` ➡️ `READY_FOR_PICKUP`
* `ASSIGNED_TO_DRIVER` ➡️ `PICKED_UP` ➡️ `DELIVERED` (or `CANCELLED`)

Each transition is guarded by Role-Based Access Control (RBAC) to ensure only authorized entities trigger state changes.

### 3. Realtime Driver Matchmaking
1. Once an order is marked `READY_FOR_PICKUP`, the system searches for the nearest active drivers using geohashing.
2. The system sends an dispatch invitation via Socket.io/FCM.
3. If the driver does not accept within 60 seconds, the invitation times out, and the system attempts to invite the next closest driver.

### 4. CyberSource Payment Gateway
Supports credit card payments with high security:
* **Flex Microform**: Bypasses PCI compliance requirements by sending card tokens directly.
* **Webhooks**: Handles authorization, capture, reversals, and refunds securely with cryptographic signature verification.

---

## 🚀 Installation & Local Running

### Prerequisites
* Node.js (v18+)
* PostgreSQL
* Redis (optional, for task queues)

### 1. Project Setup
```bash
# Install dependencies
npm install
```

### 2. Configure Environment Variables
Create a `.env` file at the root of `BACKEND` using `.env.example` as a template:
```env
PORT=3000
DATABASE_URL="postgresql://user:password@localhost:5432/zspeed"
JWT_SECRET="your_jwt_secret"
FIREBASE_PROJECT_ID="your-firebase-project-id"
# ... (see .env.example for all variables)
```

### 3. Run Database Migrations
```bash
# Apply Prisma migrations to your Postgres instance
npx prisma migrate dev
```

### 4. Start the Application
```bash
# Start in development mode (watch mode)
npm run start:dev

# Start in production mode
npm run start:prod
```

---

## 🧪 Running Tests (Local Only)

All test suites (`test/`) reside locally on your machine and are excluded from the repository.

```bash
# Run NestJS Unit Tests
npm run test

# Run Jest E2E Integration Tests
npm run test:e2e
```

---

## 📄 License
This project is licensed under the MIT License.
