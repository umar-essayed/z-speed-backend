# Z_Speed Codebase Audit — Full Issue Report

> **Audit Date:** March 11, 2026  
> **Codebase Size:** 96,665 lines across 401 source files (excluding generated/l10n)  
> **Test Files:** 8 (626 lines total) — ~1.7% file coverage  
> **Production Readiness:** 4/10

---

## 🔴 CRITICAL Issues

### C1 — Unprotected Firestore Collections

Two Firestore collections accessed from **client-side Dart code** have **zero security rules**:

| Collection | Client Usage | Risk |
|---|---|---|
| `sys_settings` | Admin settings reads/writes | Any authenticated user can read/write global app config |
| `driverWalletTransactions` | Driver wallet screen | Drivers or attackers can forge wallet transactions |

Five additional collections used only in Cloud Functions (Admin SDK) also have no rules.  
These are lower risk but would be exposed if client code ever queries them:

- `paymentIntents`
- `emailVerifications`
- `rateLimits`
- `ledger`
- `refund_queue`

**Files:**
- `firestore.rules` — missing `match` blocks for the above collections

---

### C2 — Payment Webhook Has No Signature Verification

`functions/lib/webhooks/paymentWebhook.js` is a publicly accessible `onRequest` HTTP endpoint.  
The webhook signature validation is commented out with a `// TODO`:

```javascript
// TODO: Validate webhook signature using Gateway secret
// const signature = req.headers['x-paymob-signature'];
```

**Impact:** Anyone can POST `{ orderId: "...", status: "SUCCESS" }` and mark any order as paid without actually paying.

---

### C3 — `createPaymentIntent` Callable Has No Authentication

`functions/lib/callable/createPaymentIntent.js` never checks `request.auth`.  
Compare to `placeOrder.js` which properly validates:

```javascript
// placeOrder.js (correct)
const uid = request.auth?.uid;
if (!uid) throw new HttpsError("unauthenticated", "...");

// createPaymentIntent.js (missing)
const { amount, currency, orderId } = request.data;  // no auth check
```

**Impact:** Unauthenticated callers can create payment intents for arbitrary orders.

---

### C4 — `requestDispatch` Callable Has No Authentication

`functions/lib/callable/requestDispatch.js` also lacks an `request.auth` check.  

**Impact:** Anyone can trigger driver dispatch for any order ID.

---

### C5 — Firebase App Check Debug Token Enabled in Production

`web/index.html` line 49:

```html
self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
```

**Impact:** Attackers can bypass App Check attestation and spoof legitimate clients.

---

### C6 — `firebase_database` Listed Twice (Comment Says Removed)

`pubspec.yaml` line 30 says:
```yaml
# firebase_database removed in Phase 8.10 - not used anywhere
```
But line 76 still declares:
```yaml
firebase_database: ^11.3.10
```

Used in only 3 files. Adds the entire Realtime Database SDK (~5+ MB) to every build.

**Files using it:**
- `lib/features/restaurant_owner/view/driver_tracking_screen.dart`
- `lib/features/customer/widgets/customer_live_tracking_map.dart`
- `lib/features/driver/datasource/driver_firebase_datasource.dart`

---

## 🟠 MAJOR Issues

### M1 — No Design System (690 Hardcoded Colors, 1,412 Inline TextStyles)

| Metric | Count |
|---|---|
| Hardcoded `Color(0x...)` outside theme | 690 |
| Inline `TextStyle(...)` constructors | 1,412 |
| `Theme.of(context)` references | 45 |

Theme files (`lib/core/theme/light_mode.dart` and `dark_mode.dart`) are only **12 lines each**.  
They define `colorScheme` with 5 colors and a font family — no `TextTheme`, no `AppBarTheme`, no spacing constants.

**Impact:** Branding changes require editing hundreds of files. Dark mode is inconsistent.

---

### M2 — Navigation is 100% Imperative (No Routing Framework)

| Pattern | Count |
|---|---|
| `Navigator.push()` (direct MaterialPageRoute) | 44 |
| `Navigator.pushNamed()` / `pushReplacementNamed()` | 14 |
| Total `Navigator.*` calls | 306 |
| GoRouter / declarative routing | 0 |

**Impact:** No deep-link support, no route guards, no per-screen analytics, extremely difficult to refactor.

---

### M3 — Monolithic View Files

| File | Lines | Classes |
|---|---|---|
| `lib/features/restaurant_owner/view/restaurant_profile_page.dart` | 1,235 | 14 |
| `lib/features/admin/view/admin_settings_view.dart` | 985 | 11 |
| `lib/features/restaurant_owner/view/restaurant_overview_screen.dart` | 957 | — |
| `lib/components/map_location_picker.dart` | 937 | — |
| `lib/features/restaurant_owner/view/restaurant_analytics_screen.dart` | 869 | — |
| `lib/features/driver/screens/restaurant_driver_assignment_screen.dart` | 836 | — |
| `lib/features/admin/view/admin_user_detail_view.dart` | 810 | — |
| `lib/features/admin/view/admin_application_detail_view.dart` | 788 | — |

Files contain 10–14 private sub-classes, inline dialogs, and mixed business logic with UI.

---

### M4 — Test Coverage at ~1.7%

| Aspect | Detail |
|---|---|
| Source files | 401 |
| Test files | 8 |
| Test lines | 626 |
| Tested modules | auth model, auth cubit, cart cubit, saved address model, checkout screen, checkout cubit, driver dashboard |
| **Untested** | All repositories, all datasources, all services, admin module, restaurant owner module, payment module, notification module, order lifecycle, delivery fee calculation |

---

### M5 — Dead Legacy Code in `lib/pages/`

| File | Lines | Status |
|---|---|---|
| `lib/pages/login_page.dart` | 484 | Duplicate of `features/auth/view/login_screen.dart` |
| `lib/pages/full_cart_page.dart` | 283 | Duplicate of `features/cart/view/full_cart_screen.dart` |
| `lib/pages/customer_app.dart` | 136 | Only imports `full_cart_page.dart` internally |

None of these are imported from `main.dart` or any active code path. **903 lines of dead code.**

---

### M6 — Static Analysis: 87 Analyzer Warnings

| Type | Count | Examples |
|---|---|---|
| Unnecessary casts | 14 | Admin cubits: `result.error as Failure?` |
| Unused imports | 22+ | Scattered across auth, admin, order modules |
| Duplicate imports | 8 | `flutter_bloc`, `injectable` imported twice |
| Dead code / unreachable | 8 | Always-true null checks, unused functions |
| Unused variables | 5 | `_brandOrange`, `changedFiles`, etc. |

---

### M7 — Service Locator Anti-Pattern in Business Layer

`getIt<>()` is called **directly** inside repositories and widgets instead of constructor injection:

| File | Direct `getIt<>` Call |
|---|---|
| `restaurant_menu_repository_impl.dart:36` | `getIt<OfflineQueueService>()` |
| `restaurant_menu_repository_impl.dart:37` | `getIt<ConnectivityCubit>()` |
| `driver_assignment_dialog.dart:37` | `getIt<DriverRepository>()` |
| `order_tracking_screen.dart:39` | `getIt<OrderTrackingCubit>()` |
| `order_tracking_screen.dart:42` | `getIt<PaymentCubit>()` |
| `driver_application_form.dart:134` | `getIt<DriverApplicationCubit>()` |
| `notification_list_page.dart:123` | `getIt<ApplicationRepository>()` |

**Impact:** Makes these classes untestable without the full DI container.

---

## 🟡 MODERATE Issues

### O1 — Offline Queue Never Replays

`OfflineQueueService` can enqueue and remove actions, but **nothing ever replays the queue**.  
`ConnectivityCubit` emits `online`/`offline` states, but no listener triggers queue flush.  
Actions stored in `SharedPreferences` persist forever and are never executed.

---

### O2 — Error Handling Uses `debugPrint` Only (No Crashlytics in Catch Blocks)

All 117 `catch (e)` blocks use `debugPrint()` or `log()`.  
**None** report to Crashlytics from within catch blocks.  
Crashlytics only catches **unhandled** errors via `runZonedGuarded`.

Critical services affected:
- FCM token save/remove failures
- Offline queue operations
- Form persistence errors
- Repository data fetch failures

---

### O3 — Storage Rules Allow Any User to Upload Cuisine Images

`storage.rules` lines 25–30:

```
match /cuisine_types/{allPaths=**} {
  allow write: if request.auth != null  // any logged-in user, not admin-only
```

**Impact:** A regular customer account could upload arbitrary images to cuisine type entries.

---

### O4 — Duplicate Annotations in DI Configuration

`lib/core/services/connectivity_cubit.dart` lines 3–4 and 10–11:

```dart
import 'package:injectable/injectable.dart';
import 'package:injectable/injectable.dart';  // duplicate

@lazySingleton
@lazySingleton  // duplicate
class ConnectivityCubit extends Cubit<ConnectivityStatus> {
```

---

### O5 — Deprecated Flutter API Usage

| API | Replacement | Occurrences |
|---|---|---|
| `Color.withOpacity()` | `Color.withValues(alpha: x)` | 7 |
| `WillPopScope` | `PopScope` | ~1 |

---

### O6 — Environment Config Scattered Across Widgets

`dotenv.env['LOCATION_IQ_API_KEY']` is called directly in **8 different map widget files**:

- `driver_tracking_screen.dart` (×2)
- `customer_live_tracking_map.dart` (×2)
- `active_trip_map.dart` (×2)
- `driver_tracking_screen.dart` (×2, driver module)
- `map_location_picker.dart` (×1)

Should be abstracted into a single `EnvironmentConfig` service.

---

### O7 — Missing Firestore Composite Indexes

Queries in code that combine multiple `.where()` + `.orderBy()` without matching indexes in `firestore.indexes.json`:

| Query Pattern | File | Missing Index |
|---|---|---|
| `users` where `type` + `status` + date range | `admin_firebase_datasource.dart` | `users {type, status, createdAt}` |
| `notifications` where `userId` + `read == false` | `notification_firebase_datasource.dart` | `notifications {userId, read}` |
| `driverProfiles` where `status == online` | `driver_firebase_datasource.dart` | `driverProfiles {status}` |

---

## ✅ What's Working Well

- **Firestore security rules** — 224 lines with field-level validation (Phase 8.10)
- **Cloud Functions rate limiting** — Implemented via `rateLimits` collection
- **Environment variables** — API keys properly externalized via `.env` + `flutter_dotenv`
- **Repository pattern** — Clean data layer abstraction in most features
- **Crashlytics global error handler** — `runZonedGuarded` + `CrashlyticsService`
- **App Check** — Properly enforced across platforms (except web debug token issue)
- **Storage rules** — Proper owner-scoped writes with 10MB size limits and content-type checks
- **Localization** — Full Arabic + English via Flutter gen-l10n (7,381 lines of generated translations)
- **Form validation** — 60 `validator:` callbacks on 52 `TextFormField` widgets (good coverage)
- **Stream subscription management** — All `StreamSubscription` declarations have matching `.cancel()` calls
