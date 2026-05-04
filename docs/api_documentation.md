# التوثيق الشامل والرسمي لمشروع Z-Speed (API & Architecture Documentation) 🚀

---

## 1. تفاصيل المشروع والبنية التحتية (Infrastructure & Security)

### أ. التقنيات المستخدمة (Tech Stack):
* **الخادم (Backend):** Node.js بإطار عمل NestJS (TypeScript).
* **قاعدة البيانات (Database):** PostgreSQL باستخدام Prisma ORM.
* **الكاش والـ Rate Limiting:** Redis + @nestjs/throttler.
* **المهام بالخلفية (Background Jobs):** BullMQ لمعالجة الإشعارات والتقارير.
* **الريال تايم (Real-time):** WebSockets عبر Socket.IO لتتبع السائقين وحالة الطلب.
* **تخزين الملفات (Storage):** AWS S3 (أو Supabase Storage).

### ب. التشفير والحماية (Security & Encryption):
1. **تشفير كلمات المرور:** استخدام `bcrypt` (Salt Rounds = 10) لتشفير كلمات المرور في قاعدة البيانات. لا يتم حفظ أي كلمة مرور بنص واضح.
2. **إدارة الجلسات (Sessions):** 
   * نظام `JWT` (JSON Web Tokens).
   * الـ `Access Token`: صلاحيته 15 دقيقة (مُشفر بخوارزمية HS256 مع Secret Key معقد).
   * الـ `Refresh Token`: صلاحيته 7 أيام (يتم تشفير الـ Hash الخاص به وحفظه في الـ DB لمنع سرقته).
3. **حماية الدفع (Payment Security):**
   * عدم تخزين أرقام البطاقات (PAN) أو الـ CVV في قاعدة البيانات نهائياً.
   * الاعتماد الكامل على الـ **Tokenization** عبر بوابة الدفع (CyberSource).
4. **حماية الـ Endpoints:** 
   * `Helmet` لحماية الـ HTTP Headers.
   * `CORS` مقيد بالدومينات المسموحة فقط.

### ج. بوابة الدفع (Payment Gateway - AAIB CyberSource):
بناءً على التوجيهات، سيتم دمج بوابة **CyberSource (Flex Microform / Secure Acceptance)** المقدمة من بنك AAIB.
**البيانات الإلزامية التي سيتم طلبها من العميل (أو سحبها تلقائياً من جهازه) وإرسالها لبوابة الدفع (لضمان نجاح نظام Payer Authentication / 3DS):**
* `deviceInformation.ipAddress` (IP العميل).
* `deviceInformation.httpBrowserScreenHeight` & `httpBrowserScreenWidth` (أبعاد الشاشة، تُسحب من الـ Frontend).
* `orderInformation.billTo.firstName` & `lastName` & `email` & `phoneNumber`.
* `orderInformation.billTo.country` & `locality` (City) & `administrativeArea` (State) & `address1` & `postalCode`.

---

## 2. تفاصيل نقاط النهاية (API Endpoints Details)

**الرابط الأساسي (Base URL):** `https://api.z-speed.com/api/v1`
**نظام المصادقة (Auth Header):** `Authorization: Bearer <Access_Token>`

---

### 🪪 1. المصادقة (Auth Module)

#### 1.1 إنشاء حساب جديد (Register)
* **المسار:** `POST /auth/register`
* **الحماية:** عام (Public)
* **الـ Body (JSON):**
  * `email` (String, Required) - مثال: `user@example.com`
  * `password` (String, Required) - يجب ألا يقل عن 8 أحرف.
  * `name` (String, Required)
  * `phone` (String, Optional)
  * `role` (Enum, Required) - القيم: `CUSTOMER`, `VENDOR`, `DRIVER`.
* **الرد (Response 201 Created):**
  ```json
  {
    "accessToken": "eyJhbG...",
    "refreshToken": "eyJhbG...",
    "user": { "id": "uuid", "name": "...", "role": "CUSTOMER" }
  }
  ```

#### 1.2 تسجيل الدخول (Login)
* **المسار:** `POST /auth/login`
* **الـ Body:** `email` (Required), `password` (Required).
* **الرد (200 OK):** نفس رد التسجيل.

#### 1.3 تجديد التوكن (Refresh Token)
* **المسار:** `POST /auth/refresh`
* **الـ Body:** `refreshToken` (Required).

#### 1.4 تسجيل الخروج (Logout)
* **المسار:** `POST /auth/logout`
* **الحماية:** يتطلب Access Token.
* **الوصف:** يقوم بمسح الـ Refresh Token من قاعدة البيانات.

---

### 👤 2. المستخدمين والمحفظة (Users & Wallet)

#### 2.1 جلب البروفايل (Get Me)
* **المسار:** `GET /users/me`
* **الرد:** بيانات المستخدم، الـ `walletBalance`، والـ `loyaltyPoints`.

#### 2.2 تحديث البروفايل (Update Profile)
* **المسار:** `PATCH /users/me`
* **الـ Body (كل الحقول Optional):**
  * `name` (String)
  * `phone` (String)
  * `profileImage` (String URL)
  * `fcmTokens` (Array of Strings) - لتحديث توكن الإشعارات للموبايل.

#### 2.3 إدارة العناوين (Customer Addresses)
* **إضافة عنوان:** `POST /users/addresses`
  * **الـ Body:** `street` (Req), `city` (Req), `latitude` (Float, Req), `longitude` (Float, Req), `building` (Opt), `type` (Opt: home/work).
* **جلب العناوين:** `GET /users/addresses`
* **حذف عنوان:** `DELETE /users/addresses/:id`

---

### 🍔 3. المطاعم (Restaurants - Vendor Side)

#### 3.1 إنشاء مطعم (Create Restaurant)
* **المسار:** `POST /vendor/restaurants`
* **الحماية:** Vendor Role فقط.
* **الـ Body:**
  * `name` (String, Req)
  * `nameAr` (String, Opt)
  * `latitude` (Float, Req)
  * `longitude` (Float, Req)
  * `address` (String, Req)
  * `documentUrls` (JSON, Req) - { "commercialReg": "url", "healthCert": "url" }
* **الرد (201):** يتم الإنشاء بحالة `PENDING_VERIFICATION` وينتظر موافقة الـ Admin.

#### 3.2 تحديث إعدادات التوصيل للمطعم
* **المسار:** `PATCH /vendor/restaurants/:id/delivery-settings`
* **الـ Body:**
  * `deliveryRadiusKm` (Float, Opt)
  * `deliveryFeeMode` (Enum: FIXED, DISTANCE, Opt)
  * `deliveryFee` (Float, Opt)
  * `deliveryFeeTiers` (JSON, Opt) - للمسافات المختلفة.
  * `minimumOrder` (Float, Opt)

#### 3.3 إدارة المنيو (Menu Sections & Items)
* **إضافة قسم:** `POST /vendor/menu-sections` 
  * **Body:** `restaurantId` (Req), `name` (Req), `nameAr` (Opt).
* **إضافة وجبة:** `POST /vendor/food-items`
  * **Body:** 
    * `sectionId` (Req)
    * `name` (Req), `description` (Opt), `price` (Float, Req), `imageUrl` (Opt).
    * `addons` (JSON, Opt) - مثال: `[{"name": "Extra Cheese", "price": 10}]`

---

### 💳 4. بوابة الدفع والطلبات (Orders & CyberSource Checkout)

هنا تم دمج متطلبات **CyberSource** بالكامل.

#### 4.1 إنشاء طلب الدفع المسبق (Initiate Checkout)
* **المسار:** `POST /orders/checkout`
* **الحماية:** Customer فقط.
* **الوصف:** هذا الـ Endpoint يستقبل سلة العميل، وينشئ الطلب، ويرسل البيانات المطلوبة لـ CyberSource إذا كان الدفع إلكترونياً.
* **الـ Body:**
  * `restaurantId` (String, Req)
  * `deliveryAddressId` (String, Req) - ID العنوان المحفوظ.
  * `paymentMethod` (Enum: CASH, CYBERSOURCE_CARD, WALLET) - **مطلوب**
  * `customerNote` (String, Opt)
  * **(حقول CyberSource الإلزامية - يجب إرسالها من الـ Frontend إذا كان الدفع بالبطاقة):**
    * `deviceInformation`: 
      * `ipAddress` (String, Req)
      * `httpBrowserScreenHeight` (String, Req)
      * `httpBrowserScreenWidth` (String, Req)
    * `billingInformation`: (إذا كان مختلفاً عن عنوان التوصيل)
      * `firstName` (String, Req)
      * `lastName` (String, Req)
      * `email` (String, Req)
      * `phoneNumber` (String, Req)
      * `city` (String, Req)
      * `country` (String, Req) - مثال: "EG"
      * `postalCode` (String, Req)
      * `address1` (String, Req)
* **الرد (200 OK):**
  * إذا كان `CASH`: يعيد بيانات الـ Order وحالته `PENDING`.
  * إذا كان `CYBERSOURCE_CARD`: يعيد `paymentUrl` أو `flexToken` ليقوم الـ Frontend بفتح واجهة الدفع (Secure Acceptance / Microform).

#### 4.2 تأكيد الدفع (Webhook / Callback from CyberSource)
* **المسار:** `POST /orders/payment/callback`
* **الحماية:** بدون توكن، ولكن يجب التحقق من توقيع (Signature) البنك.
* **العملية:** يتم التأكد من الرد، تحويل حالة الطلب إلى `CONFIRMED`، وبدء إرسال إشعار للمطعم.

#### 4.3 جلب طلبات العميل
* **المسار:** `GET /orders/my`
* **الرد:** قائمة الطلبات مع حالاتها (PENDING, CONFIRMED, DELIVERED...).

---

### 🛵 5. السائقين والتتبع (Drivers & Tracking)

#### 5.1 تقديم طلب كابتن (Driver Apply)
* **المسار:** `POST /drivers/apply`
* **Body:** `nationalId` (Req), `nationalIdUrl` (Req), `driverLicenseUrl` (Req), `vehicleType` (Req), `payoutPhoneNumber` (Req).

#### 5.2 تحديث الموقع (Location Update)
* **المسار:** `PATCH /drivers/location` (يمكن أيضاً عبر Socket.IO لتقليل الضغط على السيرفر HTTP).
* **Body:** `currentLat` (Float), `currentLng` (Float).

#### 5.3 قبول/رفض طلب توصيل (Delivery Requests)
عندما يصبح الطلب `READY`، يتم توليد `DeliveryRequest` للسائقين القريبين.
* **المسار:** `PATCH /drivers/delivery-requests/:id/accept`
* **الرد:** تعيين السائق للطلب، وتحويل الطلب لـ `IN_PROGRESS`.

#### 5.4 إنهاء الطلب
* **المسار:** `PATCH /orders/:id/deliver`
* **الحماية:** Driver فقط.
* **العملية:** تغيير الحالة إلى `DELIVERED` وإضافة قيمة التوصيل إلى `walletBalance` الخاص بالسائق وإنشاء سجل في الـ `Ledger`.

---

### 🛡️ 6. الإدارة (Admin & SuperAdmin)

#### 6.1 حظر مستخدم (Soft Delete / Ban)
* **المسار:** `PATCH /admin/users/:id/status`
* **Body:** `status` (Enum: BANNED, SUSPENDED).

#### 6.2 طلب حذف مستخدم نهائياً (ينتظر SuperAdmin)
* **المسار:** `POST /admin/users/:id/hard-delete`
* **العملية:** لا يحذف المستخدم، بل ينشئ سجل في جدول `PendingApproval`.

#### 6.3 الموافقة على مطعم
* **المسار:** `PATCH /admin/restaurants/:id/approve`
* **الرد:** يتغير حالة المطعم إلى `ACTIVE`.

#### 6.4 (SuperAdmin) مراجعة الموافقات المعلقة
* **المسار:** `GET /superadmin/pending-approvals`
* **المسار:** `PATCH /superadmin/pending-approvals/:id/approve`
* **العملية:** يقوم النظام بقراءة الـ `payload` وتطبيق الحذف النهائي أو التعديل الحساس وتسجيل ذلك في `AuditLog`.

#### 6.5 (SuperAdmin) إنشاء أدمن جديد
* **المسار:** `POST /superadmin/admins`
* **Body:** `email`, `password`, `name`.

---

### 🧾 7. السجلات المالية والمحافظ (Ledger & Wallets)

#### 7.1 جلب سجل العمليات للسائق/المطعم
* **المسار:** `GET /wallet/ledger`
* **الرد:**
  ```json
  [
    {
      "id": "uuid",
      "type": "EARNING", // أو PAYOUT, REFUND, FEE
      "amount": 25.50,
      "orderId": "uuid",
      "status": "completed",
      "createdAt": "2026-02-18T10:00:00Z"
    }
  ]
  ```

#### 7.2 طلب سحب رصيد (Payout Request)
* **المسار:** `POST /wallet/payout`
* **الـ Body:** `amount` (Float, Req).
* **العملية:** يتم خصم المبلغ من `walletBalance` ووضعه في حالة `PENDING` حتى يوافق الإدمن على التحويل.

---

هذا التوثيق يغطي حرفياً كل تفصيلة من التشفير إلى الـ Database وإلى بوابة AAIB CyberSource. هل ترغب الآن في البدء في كتابة كود الـ NestJS وتوليد الـ Controllers الخاصة بهذه النقاط؟
