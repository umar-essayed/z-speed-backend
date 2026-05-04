# Z Speed App

A Flutter food delivery application with multi-role support: customer, driver, restaurant, admin, and superAdmin.

---

## Roles

| Role | Description |
|------|-------------|
| `customer` | Browse restaurants, place orders, track delivery |
| `driver` | Accept delivery requests, update order status |
| `restaurant` | Manage menu, accept/prepare orders |
| `admin` | Full dashboard access (users, orders, restaurants, analytics, reports, settings) |
| `superAdmin` | Admin Management only — create and manage admin accounts |

---

## SuperAdmin Setup

### 1. Create Firebase Auth account

Go to **Firebase Console → Authentication → Users → Add user**

- Email: `superadmin@gmail.com`
- Password: `Test1234@`

### 2. Create Firestore document

Go to **Firebase Console → Firestore → users collection → Add document**

- Document ID: (use the UID from the Auth user above)
- Fields:

```json
{
  "name": "Super Admin",
  "email": "superadmin@gmail.com",
  "type": "superAdmin",
  "status": "active",
  "createdAt": "<Timestamp now>",
  "phone": "",
  "savedAddresses": []
}
```

---

## SuperAdmin Feature — Implementation Plan

### Context

Added a 5th role `superAdmin` with its own UI/logic, restricted the existing `admin` dashboard, and created a mechanism for superAdmin to add admin users.

### Tab Visibility

- **admin**: sees 9 tabs (Dashboard, User Management, Order Management, Restaurant Management, Analytics & Reports, Report Generation, Review Drivers, Review Restaurants, System Settings)
- **superAdmin**: sees 1 tab only (Admin Management)

---

### Step 1: Add `superAdmin` to UserType enum

**File**: `lib/core/enums/user_enums.dart`

- Added `superAdmin` to enum: `enum UserType { admin, superAdmin, restaurant, customer, driver }`
- Added label: `case UserType.superAdmin: return 'Super Admin';`

### Step 2: Update user model extensions

**File**: `lib/features/auth/model/user_model.dart`

- Added `superAdmin` cases in `displayName`, `icon`, `color` extensions

### Step 3: Fix exhaustive switch statements

- `lib/main.dart` — added `case UserType.superAdmin: appContent = const AdminApp();`
- `lib/features/admin/view/admin_analytics_view.dart` — added superAdmin color case

### Step 4: Update PageIdentity & NavigationPolicy

- `lib/core/constants/page_identity.dart` — added `adminManagement` constant + superAdmin pages
- `lib/core/navigation/navigation_policy.dart` — added superAdmin handling

### Step 5: Create Admin Management datasource/repository methods

- `lib/features/admin/datasource/admin_firebase_datasource.dart` — added `createAdminUser()` using secondary FirebaseApp to avoid signing out current superAdmin
- `lib/features/admin/repository/admin_repository.dart` — added abstract method
- `lib/features/admin/repository/admin_repository_impl.dart` — implemented method

### Step 6: Create AdminManagementCubit

- **New**: `lib/features/admin/cubit/admin_management_cubit.dart`
- **New**: `lib/features/admin/cubit/admin_management_state.dart`
- State: `isBusy`, `hasError`, `admins`, `searchQuery`, `isCreating`, `createError`, `createSuccess`
- Methods: `loadAdmins()`, `createAdmin()`, `setSearchQuery()`

### Step 7: Create Admin Management View

- **New**: `lib/features/admin/view/admin_manage_admins_view.dart`
- Same UI pattern as `AdminUsersView` (table on desktop, cards on mobile)
- "Add Admin" dialog with fields: name, email, password
- Search bar with live filtering

### Step 8: Modify AdminApp for role-based tabs

**File**: `lib/features/admin/view/admin_app_screen.dart`

- Replaced fixed `_views` list with dynamic `_TabDescriptor` system
- `_isSuperAdmin` flag controls which tabs are shown
- Admin Management tab only visible to superAdmin

### Step 9: Conditional "Add User" button

**File**: `lib/features/admin/view/admin_users_view.dart`

- "Add User" button only visible to superAdmin

### Step 10: Bug fixes

- `lib/main.dart` — fixed login/logout navigation bug: `AuthenticatedApp.build()` now reads user from `AuthCubit` reactively
- `lib/features/admin/widgets/admin_shell.dart` — fixed `BottomNavigationBar` crash when only 1 tab exists
- `lib/features/admin/view/admin_manage_admins_view.dart` — fixed `ProviderNotFoundException` in dialog by wrapping with `BlocProvider.value`
- `lib/features/notification/cubit/notification_cubit.dart` — added `cancelStreams()` to stop Firestore listeners on logout
- `lib/features/admin/cubit/admin_dashboard_cubit.dart` — added `isClosed` guards before emit

---

## Firestore Rules

SuperAdmin additions to security rules:

- Added `isSuperAdmin()` helper function
- `users` collection: superAdmin can create, update, delete
- All other collections: superAdmin has same permissions as admin
- `notifications`: fixed query permissions with `resource == null` check

---

## Files Modified

| File | Action |
|------|--------|
| `lib/core/enums/user_enums.dart` | Add superAdmin enum |
| `lib/features/auth/model/user_model.dart` | Add superAdmin extensions |
| `lib/main.dart` | Add superAdmin routing + fix login bug + cancel streams on logout |
| `lib/core/constants/page_identity.dart` | Add superAdmin pages |
| `lib/core/navigation/navigation_policy.dart` | Add superAdmin handling |
| `lib/features/admin/view/admin_app_screen.dart` | Dynamic role-based tabs |
| `lib/features/admin/view/admin_users_view.dart` | Conditional Add User button |
| `lib/features/admin/view/admin_analytics_view.dart` | Add superAdmin switch case |
| `lib/features/admin/datasource/admin_firebase_datasource.dart` | Add createAdminUser |
| `lib/features/admin/repository/admin_repository.dart` | Add abstract method |
| `lib/features/admin/repository/admin_repository_impl.dart` | Implement method |
| `lib/features/admin/widgets/admin_shell.dart` | Fix BottomNavigationBar crash |
| `lib/features/admin/cubit/admin_dashboard_cubit.dart` | Add isClosed guards |
| `lib/features/notification/cubit/notification_cubit.dart` | Add cancelStreams() |
| `lib/features/admin/cubit/admin_management_cubit.dart` | New file |
| `lib/features/admin/cubit/admin_management_state.dart` | New file |
| `lib/features/admin/view/admin_manage_admins_view.dart` | New file |
