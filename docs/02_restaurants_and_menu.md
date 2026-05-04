# Z-Speed — Part 2: Restaurants, Menu & Vendor Endpoints

---

## 1. Public Restaurant Endpoints

### GET /restaurants
**Public** — Browse all active restaurants

**Query Params:**
```
?city=Cairo
?lat=30.044&lng=31.235&radius=5    # geo-filter
?cuisineType=pizza
?search=burger
?isOpen=true
?page=1&limit=20
```

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Burger House",
      "nameAr": "بيت البرجر",
      "logoUrl": "https://...",
      "coverImageUrl": "https://...",
      "rating": 4.5,
      "ratingCount": 120,
      "deliveryTimeMin": 20,
      "deliveryTimeMax": 35,
      "deliveryFee": 15.0,
      "minimumOrder": 50.0,
      "isOpen": true,
      "address": "15 Tahrir St, Cairo",
      "cuisineTypes": ["burgers", "american"]
    }
  ],
  "total": 45,
  "page": 1
}
```

---

### GET /restaurants/:id
**Public** — Single restaurant details

**Response includes:** Full restaurant data + workingHours + menuSections (overview).

---

### GET /restaurants/:id/menu
**Public** — Full menu with sections and items

**Response:**
```json
{
  "sections": [
    {
      "id": "uuid",
      "name": "Burgers",
      "nameAr": "برجر",
      "sortOrder": 1,
      "items": [
        {
          "id": "uuid",
          "name": "Classic Burger",
          "description": "...",
          "price": 89.0,
          "originalPrice": 110.0,
          "isOnSale": true,
          "imageUrl": "https://...",
          "isAvailable": true,
          "addons": [
            { "name": "Extra Cheese", "price": 10 },
            { "name": "Bacon", "price": 15 }
          ],
          "allergens": ["gluten", "dairy"],
          "prepTimeMin": 10
        }
      ]
    }
  ]
}
```

---

## 2. Vendor — Restaurant Management

### POST /vendor/restaurants
**Role: VENDOR**

**Body:**
```json
{
  "name": "Burger House",
  "nameAr": "بيت البرجر",
  "description": "Best burgers in Cairo",
  "descriptionAr": "أفضل برجر في القاهرة",
  "latitude": 30.0444,
  "longitude": 31.2357,
  "address": "15 Tahrir St, Cairo",
  "city": "Cairo",
  "vendorType": "food",
  "documentUrls": {
    "commercialReg": "https://...",
    "healthCert": "https://...",
    "taxReg": "https://...",
    "businessLicense": "https://..."
  },
  "bankInfo": {
    "bankName": "CIB",
    "accountHolderName": "Burger House LLC",
    "accountNumber": "100020003000",
    "iban": "EG450002000000000123456789012"
  },
  "payoutPhoneNumber": "01012345678"
}
```

**Response 201:**
```json
{
  "id": "uuid",
  "name": "Burger House",
  "status": "PENDING_VERIFICATION",
  "message": "Restaurant submitted for admin review"
}
```

> **Side Effect:** Sends FCM notification to all Admin users + emits `restaurant:new_application` Socket.IO event.

---

### PATCH /vendor/restaurants/:id
**Role: VENDOR (owner only)**

**Body (all optional):**
```json
{
  "name": "New Name",
  "description": "...",
  "logoUrl": "https://...",
  "coverImageUrl": "https://...",
  "workingHours": {
    "monday": { "open": "09:00", "close": "23:00", "isOpen": true },
    "tuesday": { "open": "09:00", "close": "23:00", "isOpen": true },
    "friday": { "open": "14:00", "close": "00:00", "isOpen": true },
    "saturday": { "isOpen": false }
  }
}
```

---

### PATCH /vendor/restaurants/:id/delivery-settings
**Role: VENDOR (owner only)**

**Body:**
```json
{
  "deliveryRadiusKm": 5.0,
  "deliveryTimeMin": 20,
  "deliveryTimeMax": 40,
  "deliveryFeeMode": "FIXED",
  "deliveryFee": 15.0,
  "minimumOrder": 50.0,
  "deliveryFeeTiers": [
    { "maxKm": 2, "fee": 10 },
    { "maxKm": 5, "fee": 15 },
    { "maxKm": 10, "fee": 25 }
  ]
}
```

---

### PATCH /vendor/restaurants/:id/toggle-open
**Role: VENDOR (owner only)**

**Body:** `{ "isOpen": true }`

---

### GET /vendor/restaurants/my
**Role: VENDOR**

Returns all restaurants owned by the logged-in vendor.

---

### GET /vendor/restaurants/:id/stats
**Role: VENDOR (owner only)**

**Response:**
```json
{
  "totalOrders": 450,
  "totalEarnings": 12500.00,
  "walletBalance": 3200.00,
  "rating": 4.5,
  "ratingCount": 120,
  "todayOrders": 23,
  "todayRevenue": 1850.00
}
```

---

## 3. Vendor — Menu Management

### POST /vendor/menu-sections
**Role: VENDOR (owner of restaurant)**

**Body:**
```json
{
  "restaurantId": "uuid",
  "name": "Burgers",
  "nameAr": "برجر",
  "sortOrder": 1
}
```

---

### PATCH /vendor/menu-sections/:id
**Role: VENDOR**

**Body:** `{ "name": "...", "nameAr": "...", "isActive": true, "sortOrder": 2 }`

---

### DELETE /vendor/menu-sections/:id
**Role: VENDOR** — Soft delete (hides section + all its items)

---

### POST /vendor/food-items
**Role: VENDOR**

**Body:**
```json
{
  "sectionId": "uuid",
  "name": "Classic Burger",
  "description": "Juicy beef patty...",
  "price": 89.0,
  "originalPrice": 110.0,
  "isOnSale": true,
  "imageUrl": "https://...",
  "isAvailable": true,
  "prepTimeMin": 12,
  "allergens": ["gluten", "dairy"],
  "addons": [
    {
      "groupName": "Extras",
      "required": false,
      "multiSelect": true,
      "options": [
        { "name": "Extra Cheese", "price": 10 },
        { "name": "Bacon", "price": 15 },
        { "name": "Jalapenos", "price": 5 }
      ]
    },
    {
      "groupName": "Size",
      "required": true,
      "multiSelect": false,
      "options": [
        { "name": "Regular", "price": 0 },
        { "name": "Large", "price": 20 }
      ]
    }
  ]
}
```

> **Side Effect:** If price changed from existing item → creates record in `price_history`.

---

### PATCH /vendor/food-items/:id
**Role: VENDOR**

Same body as POST (all fields optional).

---

### DELETE /vendor/food-items/:id
**Role: VENDOR** — Soft delete

---

### PATCH /vendor/food-items/:id/availability
**Role: VENDOR** — Quick toggle

**Body:** `{ "isAvailable": false }`

---

## 4. Cart Endpoints

### GET /cart
**Role: CUSTOMER**

**Response:**
```json
{
  "id": "uuid",
  "restaurantId": "uuid",
  "restaurantName": "Burger House",
  "items": [
    {
      "id": "uuid",
      "foodItemId": "uuid",
      "name": "Classic Burger",
      "quantity": 2,
      "unitPrice": 89.0,
      "selectedAddons": [{ "name": "Extra Cheese", "price": 10 }],
      "specialNote": "No pickles please",
      "lineTotal": 198.0
    }
  ],
  "subtotal": 198.0
}
```

---

### POST /cart/items
**Role: CUSTOMER**

**Body:**
```json
{
  "foodItemId": "uuid",
  "quantity": 2,
  "selectedAddons": [{ "name": "Extra Cheese", "price": 10 }],
  "specialNote": "No pickles"
}
```

> **Validation:** If cart has items from a different restaurant → return 409 "Cart has items from another restaurant. Clear cart first?"

---

### PATCH /cart/items/:id
**Body:** `{ "quantity": 3, "selectedAddons": [...] }`

### DELETE /cart/items/:id — Remove one item
### DELETE /cart — Clear entire cart

---

## 5. Categories (Public + Admin)

### GET /categories
**Public**

**Response:**
```json
[
  { "id": "uuid", "name": "Burgers", "nameAr": "برجر", "imageUrl": "https://...", "sortOrder": 1 }
]
```

### POST /admin/categories — **Role: ADMIN/SUPERADMIN**
**Body:** `{ "name": "...", "nameAr": "...", "imageUrl": "...", "sortOrder": 0 }`

### PATCH /admin/categories/:id — Update
### DELETE /admin/categories/:id — Soft delete

---

## 6. Reviews

### POST /reviews
**Role: CUSTOMER** — Only after order is DELIVERED

**Body:**
```json
{
  "orderId": "uuid",
  "restaurantRating": 4.5,
  "driverRating": 5.0,
  "comment": "Great food, fast delivery!"
}
```

**Flow:**
```
1. Verify order belongs to customer and status=DELIVERED
2. Check no review exists for this orderId yet (one review per order)
3. Create review
4. Recalculate restaurant.rating = avg(restaurantRating) for restaurant
5. Recalculate driverProfile.rating = avg(driverRating)
6. Return 201
```

---

### GET /reviews/restaurant/:id
**Public**

**Response:** Paginated list of reviews with customer name + comment + ratings.

---

### PATCH /reviews/:id/reply
**Role: VENDOR (owner of reviewed restaurant)**

**Body:** `{ "vendorReply": "Thank you for your feedback!" }`

---

## 7. Promotions / Promo Codes

### POST /admin/promotions
**Role: ADMIN/SUPERADMIN**

**Body:**
```json
{
  "code": "WELCOME20",
  "description": "20% off first order",
  "discountType": "percentage",
  "discountValue": 20,
  "minOrderValue": 100,
  "maxUses": 1000,
  "startsAt": "2026-01-01T00:00:00Z",
  "expiresAt": "2026-12-31T23:59:59Z"
}
```

### PATCH /admin/promotions/:id
### DELETE /admin/promotions/:id

### POST /orders/validate-promo
**Role: CUSTOMER**
**Body:** `{ "code": "WELCOME20", "subtotal": 150 }`
**Response:** `{ "valid": true, "discountAmount": 30, "finalTotal": 120 }`
