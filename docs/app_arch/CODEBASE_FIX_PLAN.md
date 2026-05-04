# Z_Speed Fix Plan — Phased Remediation Roadmap

> **Based on:** [CODEBASE_AUDIT_ISSUES.md](CODEBASE_AUDIT_ISSUES.md)  
> **Created:** March 11, 2026  
> **Priority:** Security → Stability → Architecture → Quality

---

## Phase 0 — Emergency Security Fixes

**Goal:** Close all exploitable vulnerabilities immediately.  
**Scope:** Critical-severity items only.  
**Risk if skipped:** Financial fraud, data breach, unauthorized access.

### 0.1 — Fix Payment Webhook Signature Verification
- **Issue:** C2
- **File:** `functions/src/triggers/` → rebuild to `functions/lib/webhooks/paymentWebhook.js`
- **Action:**
  1. Add HMAC signature verification using the payment gateway's webhook secret
  2. Store the secret in Firebase Functions config (`firebase functions:config:set paymob.webhook_secret="..."`)
  3. Reject requests where `req.headers['x-paymob-hmac']` does not match computed HMAC
  4. Add IP allowlist check if the payment provider publishes webhook source IPs

### 0.2 — Add Auth Checks to Callable Functions
- **Issue:** C3, C4
- **Files:**
  - `functions/src/callable/createPaymentIntent.ts`
  - `functions/src/callable/requestDispatch.ts`
- **Action:** Add at the top of each function:
  ```typescript
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "User must be logged in.");
  }
  ```
- **Rebuild:** `cd functions && npm run build`

### 0.3 — Add Firestore Rules for Client-Accessible Collections
- **Issue:** C1
- **File:** `firestore.rules`
- **Action:** Add rules for:
  ```
  match /sys_settings/{docId} {
    allow read: if isAuth();
    allow write: if isAdmin();
  }

  match /driverWalletTransactions/{txId} {
    allow read: if isAuth() && (isAdmin() || isOwner(resource.data.driverId));
    allow write: if isAdmin();  // only backend/admin can create transactions
  }
  ```
- **Deploy:** `firebase deploy --only firestore:rules`

### 0.4 — Remove App Check Debug Token
- **Issue:** C5
- **File:** `web/index.html`
- **Action:** Delete line 49: `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;`

### 0.5 — Restrict Cuisine Type Storage Uploads to Admin
- **Issue:** O3
- **File:** `storage.rules`
- **Action:** Replace the `cuisine_types` rule:
  ```
  match /cuisine_types/{allPaths=**} {
    allow read: if request.auth != null;
    allow write: if request.auth != null
                 && getUserType() == 'admin'   // add admin-only check
                 && request.resource.size < 10 * 1024 * 1024
                 && request.resource.contentType.matches('image/.*');
  }
  ```
  > Note: Storage rules cannot call Firestore `get()`. If admin check via Firestore lookup is not feasible in storage rules, move cuisine image uploads to a Cloud Function endpoint instead.

**Phase 0 Deliverables:**
- [ ] Payment webhook validates signatures
- [ ] `createPaymentIntent` and `requestDispatch` require auth
- [ ] `sys_settings` and `driverWalletTransactions` have security rules
- [ ] App Check debug token removed from web build
- [ ] Cuisine image uploads restricted

---

## Phase 1 — Code Cleanup & Lint Zero

**Goal:** Eliminate all 87 analyzer warnings and remove dead code.  
**Scope:** Issues M6, M5, O4, O5, C6.

### 1.1 — Run `dart fix --apply`
- Auto-fixes deprecated APIs, unnecessary casts, and simple lint issues
- Manually review changes before committing

### 1.2 — Remove Duplicate Imports & Annotations
- **Issue:** O4
- **Files to fix:**
  - `lib/core/services/connectivity_cubit.dart` — remove duplicate `import` and `@lazySingleton`
  - `lib/features/cart/view/full_cart_screen.dart` — remove duplicate import
  - `lib/core/core.dart` — remove duplicate export (line 19)
  - All files flagged by `dart analyze` for `duplicate_import`

### 1.3 — Remove Unused Imports
- Fix all 22+ `unused_import` warnings flagged by `dart analyze`
- Target files in auth, admin, cart, customer, order modules

### 1.4 — Remove Dead Legacy Code
- **Issue:** M5
- **Action:** Delete the entire `lib/pages/` directory (903 lines, zero references from active code)

### 1.5 — Clean Up `firebase_database` Dependency
- **Issue:** C6
- **Action:**
  - Either remove `firebase_database: ^11.3.10` from `pubspec.yaml` and migrate the 3 files to use Firestore
  - Or remove the misleading comment on line 30 and keep it if driver location pings need Realtime DB

### 1.6 — Fix Deprecated APIs
- **Issue:** O5
- Replace 7 occurrences of `Color.withOpacity()` → `Color.withValues(alpha: x)`
- Replace `WillPopScope` → `PopScope` (1 occurrence)

**Phase 1 Deliverables:**
- [ ] `dart analyze` returns 0 warnings
- [ ] `lib/pages/` deleted
- [ ] No duplicate imports or annotations
- [ ] `firebase_database` resolved (removed or intentionally kept)

---

## Phase 2 — Design System Foundation

**Goal:** Centralize styling so branding changes are one-file edits.  
**Scope:** Issue M1.

### 2.1 — Create `AppColors` Constants
- **New file:** `lib/core/theme/app_colors.dart`
- Define all brand colors as `static const`:
  ```dart
  class AppColors {
    static const brandOrange = Color(0xFFFF5722);
    static const surfaceLight = Color(0xFFFFFFFF);
    static const textPrimary = Color(0xFF212121);
    static const textSecondary = Color(0xFF757575);
    // ... extract from the 690 hardcoded Color() usages
  }
  ```

### 2.2 — Create `AppTextStyles` Constants
- **New file:** `lib/core/theme/app_text_styles.dart`
- Define reusable text styles referencing `AppColors`
- Map to a proper `TextTheme` in the theme definition

### 2.3 — Create `AppSpacing` Constants
- **New file:** `lib/core/theme/app_spacing.dart`
- Define standard spacing values (4, 8, 12, 16, 24, 32, etc.)

### 2.4 — Expand Theme Definitions
- **Files:** `lib/core/theme/light_mode.dart`, `dark_mode.dart`
- Add `textTheme`, `appBarTheme`, `cardTheme`, `inputDecorationTheme`, `elevatedButtonTheme`
- Reference `AppColors` throughout

### 2.5 — Migrate Hardcoded Styles (Incremental)
- Start with the most-edited feature screens
- Replace `Color(0x...)` → `AppColors.xxx`
- Replace inline `TextStyle(...)` → `Theme.of(context).textTheme.xxx` or `AppTextStyles.xxx`
- Target: reduce 690 → <100 hardcoded colors per sprint

**Phase 2 Deliverables:**
- [ ] `AppColors`, `AppTextStyles`, `AppSpacing` files created
- [ ] `light_mode.dart` and `dark_mode.dart` expanded with full theme data
- [ ] Top 10 highest-traffic screens migrated to use design system

---

## Phase 3 — Error Handling & Observability

**Goal:** Stop silently swallowing errors; get telemetry on all failures.  
**Scope:** Issues O1, O2.

### 3.1 — Add Crashlytics Reporting to Catch Blocks
- **Issue:** O2
- Audit all 117 `catch (e)` blocks
- For **critical services** (payments, orders, auth, FCM), add:
  ```dart
  } catch (e, stackTrace) {
    debugPrint('...: $e');
    CrashlyticsService.recordError(e, stackTrace);
  }
  ```
- For **non-critical** (form persistence, UI helpers), `debugPrint` is acceptable

### 3.2 — Implement Offline Queue Replay
- **Issue:** O1
- **File:** `lib/core/services/offline_queue_service.dart`
- **Action:**
  1. Add a `replayQueue()` method that iterates pending actions and executes them
  2. Listen to `ConnectivityCubit` state changes
  3. When state transitions from `offline` → `online`, call `replayQueue()`
  4. Remove successfully replayed actions; retry failures with exponential backoff
  5. Add a max retry count (e.g., 5) before marking an action as permanently failed

### 3.3 — Add Structured Logging
- Replace raw `debugPrint()` with a lightweight logger that tags messages by module
- Consider `package:logging` or a simple custom logger

**Phase 3 Deliverables:**
- [ ] Critical catch blocks report to Crashlytics
- [ ] Offline queue automatically replays on reconnection
- [ ] Structured logging in core services

---

## Phase 4 — Architecture: Navigation

**Goal:** Introduce declarative routing with deep-link support.  
**Scope:** Issue M2.

### 4.1 — Add GoRouter Dependency
- Add `go_router: ^14.x` to `pubspec.yaml`

### 4.2 — Define Route Configuration
- **New file:** `lib/core/navigation/app_router.dart`
- Define all app routes in a single `GoRouter` configuration
- Implement redirect guards for authentication state
- Group routes by feature module

### 4.3 — Migrate Screens Incrementally
- Start with the **auth flow** (login, register, logout) — 14 named route calls
- Then migrate **main app shell** (home, customer browse, cart, checkout)
- Then migrate **admin**, **restaurant owner**, **driver** flows
- Replace `Navigator.push(context, MaterialPageRoute(...))` with `context.go('/path')`

### 4.4 — Add Deep Link Configuration
- Configure `android/app/src/main/AndroidManifest.xml` for App Links
- Configure `ios/Runner/Runner.entitlements` for Universal Links
- Test deep links for order tracking, restaurant pages

**Phase 4 Deliverables:**
- [ ] `GoRouter` configured with all routes
- [ ] Auth flow using declarative routing with guards
- [ ] 306 `Navigator.*` calls migrated to `context.go()` / `context.push()`
- [ ] Deep links working for key screens

---

## Phase 5 — Architecture: Component Decomposition

**Goal:** Break monolithic view files into maintainable, testable widgets.  
**Scope:** Issue M3.

### 5.1 — Split `restaurant_profile_page.dart` (1,235 lines → ~14 files)
- Extract each of the 14 private classes into `lib/features/restaurant_owner/widgets/`:
  - `profile_cover_and_logo.dart`
  - `profile_status_toggle.dart`
  - `profile_section_card.dart`
  - `profile_operating_hours_card.dart`
  - `profile_branding_card.dart`
  - `profile_documents_section.dart`
  - `profile_editable_field.dart`
  - `profile_location_field.dart`
  - etc.

### 5.2 — Split `admin_settings_view.dart` (985 lines → ~6 files)
- Extract dialogs: `add_cuisine_type_dialog.dart`, `edit_cuisine_type_dialog.dart`
- Extract sections: `cuisine_types_section.dart`, `admin_settings_item.dart`

### 5.3 — Split Remaining Large Files
- `restaurant_overview_screen.dart` (957 lines)
- `map_location_picker.dart` (937 lines)
- `restaurant_analytics_screen.dart` (869 lines)
- Target: no file exceeds 500 lines

### 5.4 — Fix Service Locator Anti-Pattern
- **Issue:** M7
- Refactor the 7 files using direct `getIt<>()` calls
- Inject dependencies via constructor parameters instead
- Register the injection chain properly in `injection.config.dart`

**Phase 5 Deliverables:**
- [ ] No view file exceeds 500 lines
- [ ] All private sub-classes extracted to named widget files
- [ ] Zero direct `getIt<>()` calls in repositories, widgets, or cubits

---

## Phase 6 — Environment & Configuration

**Goal:** Centralize all config access and remove scattered dotenv calls.  
**Scope:** Issue O6.

### 6.1 — Create `EnvironmentConfig` Service
- **New file:** `lib/core/config/environment_config.dart`
- Single injectable service that loads `.env` values once at boot:
  ```dart
  @lazySingleton
  class EnvironmentConfig {
    final String locationIqApiKey;
    final String firebaseAndroidApiKey;
    final String firebaseIosApiKey;
    final String firebaseWebApiKey;

    EnvironmentConfig()
      : locationIqApiKey = dotenv.env['LOCATION_IQ_API_KEY'] ?? '',
        firebaseAndroidApiKey = dotenv.env['FIREBASE_ANDROID_API_KEY'] ?? '',
        firebaseIosApiKey = dotenv.env['FIREBASE_IOS_API_KEY'] ?? '',
        firebaseWebApiKey = dotenv.env['FIREBASE_WEB_API_KEY'] ?? '';
  }
  ```

### 6.2 — Replace All Direct `dotenv.env[]` Calls
- Replace the 15+ raw `dotenv.env['LOCATION_IQ_API_KEY']` calls across 8 files
- Inject `EnvironmentConfig` via constructor

**Phase 6 Deliverables:**
- [ ] `EnvironmentConfig` registered in DI
- [ ] Zero direct `dotenv.env[]` calls outside of `EnvironmentConfig`

---

## Phase 7 — Testing Infrastructure

**Goal:** Reach meaningful test coverage for critical business logic.  
**Scope:** Issue M4.

### 7.1 — Unit Tests for Core Business Logic
- **Cart merging logic** — `cart_cubit.dart`, `cart_repository_impl.dart`
- **Delivery fee calculation** — fee computation in checkout
- **Order state machine** — valid status transitions
- **Payment status transitions** — payment lifecycle
- **Promo code validation** — discount calculation

### 7.2 — Unit Tests for Repositories
- Test all `*_repository_impl.dart` files using `fake_cloud_firestore`
- Test error handling paths (network failures, permission denied)

### 7.3 — Unit Tests for Cubits
- Test state transitions for all cubits
- Verify error states are properly emitted
- Mock repository layer using `mocktail`

### 7.4 — Widget Tests for Critical Screens
- Checkout screen — order summary, payment method selection
- Login/Register — form validation, error display
- Order tracking — status updates, map rendering

### 7.5 — Integration Test Foundation
- Set up `integration_test/` directory
- Create a basic end-to-end flow: login → browse → add to cart → checkout

**Phase 7 Deliverables:**
- [ ] Core business logic: 90%+ line coverage
- [ ] All repositories tested with mock Firestore
- [ ] All cubits tested for state transitions
- [ ] Critical screens have widget tests
- [ ] At least 1 integration test for happy path

---

## Phase 8 — Missing Firestore Indexes

**Goal:** Ensure all Firestore queries have matching composite indexes.  
**Scope:** Issue O7.

### 8.1 — Add Missing Indexes
- **File:** `firestore.indexes.json`
- Add:
  ```json
  {
    "collectionGroup": "users",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "type", "order": "ASCENDING" },
      { "fieldPath": "status", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" }
    ]
  },
  {
    "collectionGroup": "notifications",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "userId", "order": "ASCENDING" },
      { "fieldPath": "read", "order": "ASCENDING" }
    ]
  },
  {
    "collectionGroup": "driverProfiles",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "status", "order": "ASCENDING" }
    ]
  }
  ```
- **Deploy:** `firebase deploy --only firestore:indexes`

**Phase 8 Deliverables:**
- [ ] All queries matching indexes verified
- [ ] `firestore.indexes.json` deployed

---

## Timeline Summary

| Phase | Scope | Priority | Blocked By |
|---|---|---|---|
| **Phase 0** | Security fixes | 🔴 Immediate | Nothing |
| **Phase 1** | Lint zero + dead code | 🟠 High | Nothing |
| **Phase 2** | Design system | 🟡 Medium | Phase 1 |
| **Phase 3** | Error handling + offline | 🟠 High | Nothing |
| **Phase 4** | Navigation | 🟡 Medium | Phase 1 |
| **Phase 5** | Component decomposition | 🟡 Medium | Phase 1 |
| **Phase 6** | Environment config | 🟢 Low | Phase 1 |
| **Phase 7** | Testing | 🟠 High | Phases 5, 6 |
| **Phase 8** | Firestore indexes | 🟢 Low | Nothing |

**Parallel execution possible:**
- Phase 0 + Phase 1 + Phase 3 + Phase 8 can all run simultaneously
- Phase 2, 4, 5, 6 can run in parallel after Phase 1
- Phase 7 should run after Phase 5 and 6 (cleaner code = easier tests)
