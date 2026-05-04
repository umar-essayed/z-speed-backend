# Z-SPEED Production Deployment Guide

This document outlines the final steps to move the backend to a production environment.

## 1. Database Setup
The schema has been updated to include robust `PromotionUsage` tracking and `BankInfo` for vendors/drivers.
Run the following to sync your production database:
```bash
npx prisma migrate deploy
```

## 2. Infrastructure Requirements
- **Redis**: Required for BullMQ (Queues) and Real-time Driver Tracking.
- **PostgreSQL**: Primary database.
- **Firebase Admin SDK**: Required for Hybrid Auth and File Uploads.
- **CyberSource**: Required for Card Payments.

## 3. Environment Variables (.env)
Ensure these are set in your production environment (Railway/AWS/Heroku):

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_HOST`/`PORT` | Redis connection info |
| `FIREBASE_PROJECT_ID` | From Firebase Console |
| `FIREBASE_PRIVATE_KEY`| From Service Account JSON |
| `FIREBASE_CLIENT_EMAIL`| From Service Account JSON |
| `JWT_SECRET` | Strong secret for access tokens |
| `JWT_REFRESH_SECRET` | Strong secret for refresh tokens |
| `CYBERSOURCE_MERCHANT_ID` | From CyberSource Business Center |
| `CLOUDOTP_API_KEY` | For real SMS (if using CloudOTP) |

## 4. Deployment on Railway
The project includes a `railway.json` file. Simply:
1. Connect your GitHub repo to Railway.
2. Add the Environment Variables.
3. Railway will automatically detect the `railway.json` and start the build.
4. Health check is available at `/api/v1/health`.

## 5. Security Checklist
- [x] Wallet signatures are enabled (HMAC-SHA256).
- [x] Velocity checks for payouts are active (1/24h).
- [x] Audit Interceptor is logging all mutating actions.
- [x] Rate limiting is recommended at the Reverse Proxy level (Nginx/Cloudflare).

## 6. Testing the Flow
Use the provided Postman collection in `/postman` to verify the full flow:
1. `Auth`: Firebase Login → JWT.
2. `Driver`: Update Location → Redis GEOADD.
3. `Order`: Checkout → Driver Notification.
4. `Wallet`: Payout Request → Signature Verification.
