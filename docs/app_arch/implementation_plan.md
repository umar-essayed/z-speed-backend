# Post-Migration Phase Plan

This document outlines the comprehensive phased plan to address the remaining business logic gaps and architectural weaknesses identified in the codebase evaluation. As requested, the payment integration is excluded and deferred to a later time.

## Phase 1: Dependency Injection & App Stability (Immediate Fixes)
**Objective**: Fix the current app-breaking crashes (specifically the [AuthFirebaseDatasource](file:///root/Z_Speed_app/lib/features/auth/datasource/auth_firebase_datasource.dart#16-431) GetIt error) and ensure all dependencies are correctly scoped.

### Proposed Changes
*   **Fix [AuthFirebaseDatasource](file:///root/Z_Speed_app/lib/features/auth/datasource/auth_firebase_datasource.dart#16-431)**: Add the missing `@lazySingleton` (or equivalent `injectable` annotation) to [AuthFirebaseDatasource](file:///root/Z_Speed_app/lib/features/auth/datasource/auth_firebase_datasource.dart#16-431) in [lib/features/auth/datasource/auth_firebase_datasource.dart](file:///root/Z_Speed_app/lib/features/auth/datasource/auth_firebase_datasource.dart).
*   **Audit Injectable Annotations**: Review all `Cubit` and `DataSource`/`Repository` classes across the `lib/features` directory to ensure they have the correct `@injectable` annotations.
    *   **Crucial Rule**: Cubits meant for specific UI screens (e.g., `CheckoutCubit`, `ItemDetailCubit`) must be registered as **Factories** (`@injectable`), NOT Singletons. If they are Singletons, opening the same screen twice will share or overwrite state incorrectly.
*   **Run Build Runner**: Execute `flutter pub run build_runner build --delete-conflicting-outputs` to regenerate `injection.config.dart` with all missing dependencies.

### Verification Plan
*   **Manual Testing**: Relaunch the application and verify that the Red Screen of Death ("Bad state: GetIt...") no longer appears.
*   **Code Review**: Manually inspect `injection.config.dart` to ensure `AuthFirebaseDatasource` is registered properly.

---

## Phase 2: Error Handling & Localization
**Objective**: Replace raw exceptions with user-friendly, localized error messages.

### Proposed Changes
*   **Refactor Failure Classes**: Ensure `Failure` classes in `lib/core/error/failures.dart` support passing localization keys or structured error types instead of raw `Exception` strings from Firebase.
*   **Map Exceptions to Localizations**: Update UI components (like `BlocListener`s) to map API/Firebase exceptions to specific `AppLocalizations` strings (e.g., "Network error, please try again" instead of `SocketException`).

---

## Phase 3: Backend Dispatching & Security (Cloud Functions & Firestore Rules)
**Objective**: Build a robust, self-healing assignment backend and block rogue client-side writes.

### Proposed Changes

#### 3.1: Smart Dispatch Engine (Using LocationIQ & Firebase)
*   **LocationIQ Nearest API Matrix Hooks**: Create a Cloud Callable Function that offloads dummy dispatch data. Use LocationIQ `Nearest` to evaluate the travel time of nearby drivers mathematically and instantly push the request to the nearest available driver.
*   **Auto-Expiration Cron Queue**: Implement a worker hook at `expiresAt`. If the assigned driver does not accept an order request within 5 minutes, mark the `DeliveryRequest` payload as `expired`.
*   **Re-broadcasting Trigger (`onDeliveryRequestExpired.ts`)**: Implement an event listener to bounce rejected/expired requests. It fetches the *next* best driver from the LocationIQ payload and creates a new fresh delivery request.
*   *(Future Enhancement)* **Optimize API**: Add support for route optimization when drivers handle multi-order grouping.

#### 3.2: Status Sync & Transaction Ledger
*   **Robust Sync Aggregator (`onOrderDriverStatusUpdated.ts`)**: When driver status changes to `PickedUp`, recalculate the broader pool. Atomically shift the parent `Order` status strictly based on its linked dependencies (if `Count(PickedUp) == Count(Total Drivers)`).
*   **Split Ledger Tracking**: Setup a Firestore hook to partition multi-driver fees correctly and calculate potential partial failure refunds inside a `refund_queue` collection.

#### 3.3: Firestore Security Rules Hardening
*   **Enforce RBAC Policies**: Strip simplistic client validations and enforce rigorous logic into `[firestore.rules](firestore.rules)`.
    1.  Only users with `UserType.driver` can alter their specific `DeliveryRequest`.
    2.  `UserType.customer` accounts get strict Read-Only projection to prevent manipulation of statuses.
    3.  Orders transition rules are exclusively manipulated down by Backend Service Service Accounts.

#### 3.4: UI/UX Dispatch Adjustments
*   **Driver Request Timers**: Update the driver's incoming request UI to visualize the 5-minute auto-expiration countdown.
*   **Customer Status Visualization**: Improve the customer's order tracking screen to show "Searching for a driver..." vs "Driver assigned" states reflecting the smart dispatch engine's real-time events.
*   **Map Updates**: Ensure LocationIQ-driven routing updates are properly rendered on the live tracking map using smooth polyline updates.

---

## Phase 4: Offline Resilience
**Objective**: Allow the app to gracefully handle drops in internet connectivity, specifically for Restaurant Owners managing menus in low-signal areas (e.g., kitchens).

### Proposed Changes

#### 4.1: Robust Offline Sync Infrastructure
*   **OfflineQueueService**: Create a dedicated core service (`lib/core/services/offline_queue_service.dart`) utilizing `SharedPreferences` as an agnostic, cross-platform persistence layer for queued writes.
*   **JSON Serialization**: Define an `OfflineAction` model that stores the action type, path/ID, payload, and timestamp.

#### 4.2: Connectivity Hook & Auto-Sync
*   **Sync Listener**: Connect the `OfflineQueueService` to the `ConnectivityCubit`. Upon detecting a transition from `offline` to `online`, automatically pop actions from the queue and re-attempt applying them to `Firestore`.

#### 4.3: Intercepting Critical Operations (Restaurant Menu)
*   **RestaurantMenuRepositoryImpl integration**: When performing critical operations (`toggleItemAvailability`, `updateItem`), check network state or catch network failures.
*   **Queueing**: If offline, serialize the mutation as an `OfflineAction` and push it to the `OfflineQueueService`, updating the local cache immediately so the UI reflects the change (Optimistic UI).

#### 4.4: UI Indicators
*   **Offline Toasts / Banners**: Show users a visual notification ("Working offline. Changes will sync when reconnected") so they are aware their changes are queued.

---

---

## Phase 5: Testing Infrastructure
**Objective**: Prevent regressions and ensure logic is solid without relying entirely on manual QA.

### Proposed Changes
*   **Unit Tests (`bloc_test`)**: Write comprehensive unit tests for core Cubits (e.g., Auth, Cart, Checkout) leveraging the `bloc_test` package to simulate state transitions and verify logic.
*   **Widget Tests**: Develop widget tests for critical user flows like the Login Page, Driver Dashboard, and Restaurant Order List to ensure the UI paints correctly depending on different Cubit states.

> [!NOTE]
> **Payment Integration (Excluded)**: As requested, the payment integration portion (Stripe/Paymob) is intentionally excluded from this phased plan and will be addressed at a later date.

---

## Phase 6: UI Decomposition & Admin Data Hardening
**Objective**: Extract legacy monolithic UI files into modular features and replace hardcoded mock Admin data with real Firestore integration.

### Proposed Changes
*   **Refactor Legacy Monolithic Pages**: Decompose the massive files found in `lib/pages/` (e.g., `settings_page.dart` (516 lines), `customer_app.dart` (640 lines), and `delivery_app.dart` (560 lines)) into atomic `lib/features/` components using our Cubit architecture.
*   **Remove Hardcoded Admin Dummy Data**: Rip out the `// Mock existing data` structures within `AdminApp` and `admin/` blocs, wiring the actual Admin UI up to the real Firestore collections (Orders, Users, Categories).

---

## Phase 7: Resolving Production Codebase TODOs
**Objective**: Address the literal `// TODO:` feature flags hidden within the codebase that block a fully acceptable production release.

### Proposed Changes
*   **Location Picker Widget**: Implement the robust Location Picker using the LocationIQ API (addressing `checkout_page.dart // TODO: Implement location picker`).
*   **Re-activate OTP Flow**: Re-enable the real production OTP input and "verified banner" flows found currently bypassed in `login_page.dart`.
*   **Order Receipts**: Implement the "download or share receipt" functionality for finished orders (`order_history_page.dart`).

---

## Phase 8: Backend Finalization & External APIs
**Objective**: Complete the integrations that have placeholder structure within our Firebase v2 Cloud Functions.

### Proposed Changes
*   **LocationIQ API Integration in Functions**: Replace the `// Placeholder for LocationIQ Nearest API call` and `mock` comments inside the existing `requestDispatch.ts` and `onDeliveryRequestExpired.ts` files with actual HTTP requests for true smart dispatching.
*   **Prepare Payment Structures**: Establish the specific API endpoints, backend webhooks, and `CheckoutCubit` handlers needed for the eventual Payment Gateway integration (Stripe/Paymob).

---

## Phase 9: Navigation Unification & Deprecation Cleanup
**Objective**: Finalize the removal of legacy routing and navigation files to prevent architectural regressions.

### Proposed Changes
*   **Remove Deprecated Navigation**: Delete `page_navigation.dart`, `my_drawer.dart`, and `home_drawer.dart` completely. Ensure the app uses `NavigationPolicy` and the unified `AppDrawer` everywhere.
*   **Deep Linking Support**: Configure `AppRoutes.routeMap` and Flutter Router to accept deep links seamlessly (e.g., matching notifications directly to `OrderTracking` pages).
*   **Unauthenticated Guards**: Enhance `RouteGuard` so that certain pages aggressively push users to the `/login` screen if AuthCubit emits an unauthenticated state unexpectedly (e.g., token expiry).

---

## Phase 10: Database Optimization & Write Hardening
**Objective**: Address Firestore scalability risks by throttling excessive writes, mitigating read-heavy operations, and enforcing backend truth.

### Proposed Changes
*   **Checkout Price Re-validation**: In `CheckoutCubit` and the matching Cloud Function, perform a server-side look-up of the `MenuItem` costs at the exact moment the order is placed to prevent stale cart pricing manipulation.
*   **Driver Location Throttling (Realtime DB)**: Shift driver GPS coordinate updates from Firestore queries to Firebase Realtime Database (RTDB) to prevent massive billing spikes on driver status pulses.
*   **Aggressive Caching**: Implement `source: Source.cache` for restaurant browse menus to drastically reduce repetitive document reads when users flip between items.

---

## Phase 11: Real-time UX & Push Notifications
**Objective**: Guarantee that all status changes (customer order updates, driver incoming requests) provide immediate device-level feedback.

### Proposed Changes
*   **Firebase Messaging Pipeline**: Implement `firebase_messaging` hooks in `NotificationService`. Wire up topic subscriptions based on the user's role (e.g., `driver_orders_${city}`).
*   **Cloud Function Push Triggers**: When `DeliveryRequest` or `Order` statuses mutate in Firestore, trigger push notifications to the respective customer or driver tokens.
*   **Live Tracking Enhancements**: Update the driver/customer map overlays to actively track the newly configured Realtime Database driver coordinates, drawing live polylines using LocationIQ.

---

## Phase 12: Pre-Production Security Polish
**Objective**: Ensure the system is completely locked down and structured for production deployment (excluding payment pipelines).

### Proposed Changes
*   **App Check Enforcement**: Integrate Firebase App Check (reCaptcha Enterprise / Play Integrity) to prohibit non-app clients from querying the backend.
*   **Final Widget Test Coverage**: Enforce Widget rendering tests over `driver_dashboard` and `customer_checkout` using the mocked Cubits provided in Phase 5.
*   **CI/CD Pipeline Readying**: Setup a localized `.github/workflows/main.yml` baseline script that runs `flutter analyze` and `flutter test` upon pull requests.
