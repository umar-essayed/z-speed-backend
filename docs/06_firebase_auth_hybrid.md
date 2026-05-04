# Z-Speed — Firebase Hybrid Auth Architecture

---

## 1. المبدأ الأساسي

**Firebase Auth = Identity Provider (Frontend)**  
**NestJS JWT = API Authorization (Backend)**

```
Mobile App (Flutter)
    │
    ├── Firebase Auth SDK
    │   ├── Email/Password + Email Verification (OTP)
    │   ├── Phone + SMS OTP Verification
    │   ├── Google Sign-In
    │   └── Apple Sign-In
    │
    ▼ (Firebase ID Token)
    │
NestJS Backend
    ├── POST /auth/firebase  ← يستقبل Firebase ID Token
    │   ├── firebase-admin.verifyIdToken(token)
    │   ├── Upsert user in PostgreSQL
    │   ├── Generate internal JWT (access + refresh)
    │   └── Return { accessToken, refreshToken, user }
    │
    └── All other endpoints ← تستخدم internal JWT فقط
```

---

## 2. لماذا Hybrid وليس Firebase فقط؟

| السبب | التفاصيل |
|-------|----------|
| التحكم الكامل | RBAC, Audit Logs, PendingApprovals كلها في PostgreSQL |
| أمان أعلى | Refresh token مُشفر في DB + تحكم بالإلغاء |
| مرونة | لو غيّرت Firebase بأي provider تاني، الباقي ما يتأثر |
| Performance | JWT verification محلي بدل ما تسأل Firebase كل request |

---

## 3. Auth Endpoints (المُعدّلة)

### POST /auth/firebase ← **الـ Endpoint الأساسي**
**Public — يستقبل Firebase ID Token من أي provider**

**Body:**
```json
{
  "idToken": "FIREBASE_ID_TOKEN",
  "role": "CUSTOMER",
  "fcmToken": "device_fcm_token_optional"
}
```

**Backend Flow:**
```
1. firebase-admin.auth().verifyIdToken(idToken)
   → يرجع: { uid, email, phone_number, name, picture, sign_in_provider,
              email_verified, firebase.identities }

2. Determine provider:
   → sign_in_provider = "password"       → Email/Password
   → sign_in_provider = "phone"          → Phone OTP
   → sign_in_provider = "google.com"     → Google
   → sign_in_provider = "apple.com"      → Apple

3. Upsert User in PostgreSQL:
   → Find by firebaseUid OR email OR phone
   → If exists: update (emailVerified, phoneVerified, googleId, appleId, name, profileImage)
   → If not exists: create new User with role from DTO

4. If role=DRIVER && no DriverProfile → create DriverProfile(applicationStatus=PENDING)

5. Generate internal JWT pair:
   → accessToken (15min) = { sub: user.id, role: user.role }
   → refreshToken (7d) = { sub: user.id }
   → Hash refresh → save to DB

6. Return { accessToken, refreshToken, user }
```

**Response 200:**
```json
{
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG...",
  "isNewUser": true,
  "user": {
    "id": "uuid",
    "firebaseUid": "firebase_uid_123",
    "email": "ahmed@example.com",
    "phone": "01012345678",
    "name": "Ahmed Ali",
    "role": "CUSTOMER",
    "status": "ACTIVE",
    "emailVerified": true,
    "phoneVerified": false,
    "profileImage": "https://..."
  }
}
```



### POST /auth/refresh ← **نفس الآلية**
```json
{ "refreshToken": "eyJhbG..." }
```

### POST /auth/logout ← **نفس الآلية**
**JWT Protected**

---

## 4. Phone OTP Verification Flow

```
┌─────────────────────────────────────────────┐
│ Flutter App                                  │
│                                              │
│ 1. FirebaseAuth.verifyPhoneNumber("+20...")   │
│    → Firebase sends SMS OTP                  │
│                                              │
│ 2. User enters OTP code                      │
│                                              │
│ 3. FirebaseAuth.signInWithCredential(         │
│      PhoneAuthProvider.credential(            │
│        verificationId, smsCode              │
│      )                                       │
│    )                                         │
│    → Firebase returns UserCredential          │
│                                              │
│ 4. Get ID Token:                             │
│    firebaseUser.getIdToken()                 │
│                                              │
│ 5. POST /auth/firebase {                     │
│      idToken: "...",                         │
│      role: "CUSTOMER"                        │
│    }                                         │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│ NestJS Backend                               │
│                                              │
│ verifyIdToken(idToken) → {                   │
│   uid: "...",                                │
│   phone_number: "+201012345678",             │
│   sign_in_provider: "phone"                  │
│ }                                            │
│                                              │
│ Upsert user:                                 │
│   phone = "+201012345678"                    │
│   phoneVerified = true                       │
│   firebaseUid = uid                          │
│                                              │
│ Return { accessToken, refreshToken, user }   │
└─────────────────────────────────────────────┘
```

---

## 5. Email Verification Flow

```
Flutter App:
  1. FirebaseAuth.createUserWithEmailAndPassword(email, password)
  2. firebaseUser.sendEmailVerification()  ← Firebase sends verification email
  3. User clicks link in email
  4. firebaseUser.reload() → emailVerified = true
  5. firebaseUser.getIdToken(forceRefresh: true)
  6. POST /auth/firebase { idToken, role }

Backend:
  verifyIdToken → email_verified = true
  Upsert user → emailVerified = true
```

---

## 6. Apple Sign-In Flow

```
Flutter App:
  1. SignInWithApple.getAppleIDCredential(scopes: [email, fullName])
  2. OAuthProvider('apple.com').credential(idToken, rawNonce)
  3. FirebaseAuth.signInWithCredential(credential)
  4. firebaseUser.getIdToken()
  5. POST /auth/firebase { idToken, role }

Backend:
  verifyIdToken → {
    uid: "...",
    email: "user@privaterelay.appleid.com",
    sign_in_provider: "apple.com",
    firebase.identities: { "apple.com": ["000123.xxx"] }
  }
  
  Upsert user:
    appleId = firebase.identities["apple.com"][0]
    email = decoded.email
    name = dto.name || decoded.name || "Apple User"
```

---

## 7. Google Sign-In Flow

```
Flutter App:
  1. GoogleSignIn().signIn()
  2. GoogleSignInAuthentication → accessToken, idToken
  3. GoogleAuthProvider.credential(idToken, accessToken)
  4. FirebaseAuth.signInWithCredential(credential)
  5. firebaseUser.getIdToken()
  6. POST /auth/firebase { idToken, role }

Backend:
  verifyIdToken → {
    uid: "...",
    email: "user@gmail.com",
    name: "Ahmed Ali",
    picture: "https://lh3...",
    sign_in_provider: "google.com",
    firebase.identities: { "google.com": ["123456789"] }
  }
  
  Upsert user:
    googleId = firebase.identities["google.com"][0]
    profileImage = decoded.picture
```

---

## 8. Link Multiple Providers (ربط حسابات)

```
POST /auth/link-provider
JWT Protected

Body:
{ "firebaseIdToken": "NEW_PROVIDER_TOKEN" }

Flow:
  1. verifyIdToken → get new provider data
  2. Find user by JWT userId
  3. Update: add googleId/appleId/phone as applicable
  4. Update emailVerified/phoneVerified
  5. Return updated user
```

---

## 9. Firebase Admin Setup (NestJS)

```typescript
// src/firebase/firebase.module.ts
import * as admin from 'firebase-admin';

@Module({
  providers: [{
    provide: 'FIREBASE_ADMIN',
    useFactory: () => {
      return admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });
    },
  }],
  exports: ['FIREBASE_ADMIN'],
})
export class FirebaseModule {}
```

```typescript
// src/auth/firebase-auth.service.ts
@Injectable()
export class FirebaseAuthService {
  constructor(@Inject('FIREBASE_ADMIN') private app: admin.app.App) {}

  async verifyIdToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
    return this.app.auth().verifyIdToken(idToken, true);
  }
}
```

---

## 10. .env Variables (إضافات)

```env
# Firebase Admin
FIREBASE_PROJECT_ID=z-speed-xxxxx
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@z-speed-xxxxx.iam.gserviceaccount.com
```

---

## 11. ملخص الـ Endpoints النهائية

| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /auth/firebase` | Public | **الأساسي** — يستقبل Firebase ID Token |
| `POST /auth/register-email` | Public | Fallback — تسجيل بدون Firebase (اختياري) |
| `POST /auth/refresh` | Public | تجديد tokens |
| `POST /auth/logout` | JWT | تسجيل خروج |
| `POST /auth/link-provider` | JWT | ربط provider إضافي |

> **Forgot/Reset Password:** يتم عبر `FirebaseAuth.sendPasswordResetEmail()` في Flutter — مش محتاج endpoint في الباك.
