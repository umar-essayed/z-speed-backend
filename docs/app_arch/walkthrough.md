# Feature Walkthrough: Multi-Vendor Support + Excel Bulk Import

This document describes every change made to implement two features:

1. **Multi-Vendor Expansion** — extend the platform beyond restaurants to support Supermarkets and Pharmacies (Option B: keep internal model name `Restaurant`, add a `vendorType` field).
2. **Excel Bulk Import** — allow any vendor to download a template Excel file, fill it in offline, and bulk-import menu items in one go.

---

## Part 1 — Multi-Vendor Expansion

### Design decision

Rather than renaming the `Restaurant` Dart class everywhere (which would touch hundreds of files), a `vendorType` field was added to the existing model. The `Restaurant` class continues to represent all vendor types internally; the `vendorType` field distinguishes Supermarkets and Pharmacies at runtime.

---

### `lib/core/enums/user_enums.dart`

**What changed:** Added the `VendorType` enum and its `VendorTypeX` extension at the bottom of the file.

```dart
enum VendorType { restaurant, supermarket, pharmacy }

extension VendorTypeX on VendorType {
  String get label {
    switch (this) {
      case VendorType.restaurant:  return 'Restaurant';
      case VendorType.supermarket: return 'Supermarket';
      case VendorType.pharmacy:    return 'Pharmacy';
    }
  }
  String get key => name;
  static VendorType fromKey(String key) => VendorType.values
      .firstWhere((e) => e.name == key, orElse: () => VendorType.restaurant);
}
```

**Why:** Central, type-safe representation of vendor kinds used across the whole codebase.

---

### `lib/core/enums/enums.dart`

**What changed:** Added `export 'driver_enums.dart';` to the barrel file so the driver enums are re-exported consistently alongside the other enum files.

---

### `lib/features/restaurant/model/restaurant.dart`

**What changed:** Added `vendorType` to the `Restaurant` model.

| Location | Change |
|---|---|
| Field | `final VendorType vendorType;` (default `VendorType.restaurant`) |
| `fromMap` | `vendorType: VendorTypeX.fromKey(map['vendorType'] as String? ?? 'restaurant')` |
| `toMap` | `'vendorType': vendorType.key` |
| `copyWith` | Added `VendorType? vendorType` parameter |
| `props` | Added `vendorType` |

**Why:** All Firestore `restaurants` documents now carry a `vendorType` string. Old documents without the field default to `'restaurant'` gracefully.

---

### `lib/features/restaurant_owner/widgets/vendor_type_selection_step.dart` *(NEW)*

A new onboarding step widget that lets an applicant choose their vendor type before filling in business details.

**UI:** Three full-width cards arranged vertically, each with a gradient icon, title, and subtitle:

| Card | Icon | Title | Subtitle |
|---|---|---|---|
| Restaurant | 🍽️ | Restaurant | Full-service dining & takeaway |
| Supermarket | 🛒 | Supermarket | Groceries & household items |
| Pharmacy | 💊 | Pharmacy | Medicines & personal care |

Tapping a card calls `onTypeSelected(type)` and highlights the card with an orange border glow.

**Constructor:**
```dart
VendorTypeSelectionStep({
  required VendorType selectedType,
  required void Function(VendorType) onTypeSelected,
})
```

---

### `lib/features/restaurant_owner/cubit/restaurant_application_state.dart`

**What changed:**

- `totalSteps` bumped from `7` → `8` (new vendor-type step added as step 0).
- New field `final VendorType vendorType` (default `VendorType.restaurant`).
- `copyWith`, `props` updated accordingly.

---

### `lib/features/restaurant_owner/cubit/restaurant_application_cubit.dart`

**What changed:**

- `getStepLabels()` — `'Vendor Type'` inserted as the first entry.
- New method:
  ```dart
  void setVendorType(VendorType type) {
    emit(state.copyWith(vendorType: type, selectedCuisines: []));
  }
  ```
  Clears selected cuisines because cuisine selection only applies to restaurants.
- `submitApplication()` — `formData` map now includes `'vendorType': state.vendorType.name`.

---

### `lib/features/restaurant_owner/view/restaurant_application_form.dart`

**What changed:**

- `_buildStep()` switch: new case 0 renders `VendorTypeSelectionStep`; old cases 0–6 are shifted to 1–7.
- `BusinessInfoStep` call passes `vendorType: state.vendorType`.
- `_validateAndAdvance()` case 0 is always valid (any vendor type selection is valid); case 2 conditionally requires cuisine selection only for `VendorType.restaurant`:
  ```dart
  case 2:
    final formValid = _businessFormKey.currentState?.validate() ?? false;
    final needsCuisine = state.vendorType == VendorType.restaurant;
    final cuisineValid = !needsCuisine || state.selectedCuisines.isNotEmpty;
    valid = formValid && cuisineValid;
  ```

---

### `lib/features/restaurant_owner/widgets/business_info_step.dart`

**What changed:** The cuisines selection UI block is now conditionally rendered:

```dart
if (vendorType == VendorType.restaurant) ...[
  // cuisine chips, loading state, error message
]
```

Supermarket and pharmacy applicants skip this section entirely.

---

### `lib/features/admin/repository/application_repository_impl.dart`

**What changed:** `approveApplication()` now writes `vendorType` to the new Firestore `restaurants` document:

```dart
'vendorType': formData['vendorType'] ?? 'restaurant',
```

**Why:** Without this, approved non-restaurant vendors would appear as `VendorType.restaurant` in the app.

---

### `lib/features/auth/view/user_type_selection_screen.dart`

**What changed:** The vendor role card text was updated:

| Before | After |
|---|---|
| Title: `'Restaurant Owner'` | Title: `'Vendor / Partner'` |
| Subtitle: `'Manage your restaurant'` | Subtitle: `'Restaurant, Supermarket or Pharmacy'` |

---

### `lib/features/restaurant_owner/view/restaurant_hub_screen.dart`

**What changed:**

- App title changed from `'Restaurant Dashboard'` → `'Vendor Dashboard'`.
- AppBar leading icon now uses a helper:
  ```dart
  IconData _iconForVendorType(VendorType? type) {
    switch (type) {
      case VendorType.supermarket: return Icons.shopping_cart_outlined;
      case VendorType.pharmacy:    return Icons.local_pharmacy_outlined;
      default:                     return Icons.restaurant;
    }
  }
  ```

---

### `lib/features/restaurant_owner/widgets/restaurant_drawer.dart`

**What changed:** Same `_iconForVendorType()` helper added; replaces the hard-coded `Icons.restaurant` in two places inside the drawer header.

---

### `lib/features/admin/cubit/admin_restaurants_state.dart`

**What changed:** Added `VendorType? vendorTypeFilter` field with `clearVendorTypeFilter` flag in `copyWith`.

---

### `lib/features/admin/cubit/admin_restaurants_cubit.dart`

**What changed:**

- New method `setVendorTypeFilter(VendorType? type)` — filters the displayed list by vendor type.
- Refactored `_mapRestaurants()` to call `_applyFilter()`:
  ```dart
  List<AdminRestaurant> _applyFilter(List<Restaurant> restaurants, VendorType? filter) {
    final source = filter == null
        ? restaurants
        : restaurants.where((r) => r.vendorType == filter).toList();
    return source.map((r) => AdminRestaurant(
      ...
      category: r.cuisineTypes.isNotEmpty
          ? r.cuisineTypes.first
          : r.vendorType.label,   // ← falls back to vendor type label
      ...
    )).toList();
  }
  ```

---

### `lib/features/admin/view/admin_restaurants_view.dart`

**What changed:** Filter chip row added above the vendor list:

```
[ All ]  [ Restaurant ]  [ Supermarket ]  [ Pharmacy ]
```

Selecting a chip calls `cubit.setVendorTypeFilter(type)`. Active chip is highlighted orange.

---

## Part 2 — Excel Bulk Import

### Overview of the flow

```
Menu Manager
    └── [ Import ] button
            └── ExcelImportDialog
                    ├── Phase 1: Landing
                    │       ├── [ Download Template ] → generates .xlsx, shares via system share sheet
                    │       └── [ Upload Excel File ] → picks .xlsx, parses rows
                    ├── Phase 2: Preview
                    │       ├── DataTable of all rows (errors highlighted red)
                    │       ├── Summary badge: "N valid  M errors (skipped)"
                    │       └── [ Import N Items ] → Phase 3
                    └── Phase 3: Progress
                            └── LinearProgressIndicator + "Importing item X of N…"
```

---

### `pubspec.yaml`

Two new packages added under `dependencies`:

```yaml
excel: ^4.0.6       # read/write .xlsx files
file_picker: ^8.1.2 # pick files from device storage
```

`share_plus` and `path_provider` were already present.

---

### `lib/features/restaurant_owner/services/menu_excel_service.dart` *(NEW)*

#### `VendorSections` — predefined section lists

```
Supermarket (12):  Fruits & Vegetables, Dairy & Eggs, Bakery, Meat & Seafood,
                   Beverages, Snacks & Confectionery, Frozen Foods, Household,
                   Personal Care, Baby Care, Pet Supplies, Other

Pharmacy (9):      Prescription Medicines, OTC Medicines, Vitamins & Supplements,
                   Personal Care, Baby Care, Medical Devices, First Aid,
                   Cosmetics & Skincare, Other

Restaurant:        null — sections come from active CuisineTypes in Firestore
```

`VendorSections.forType(VendorType type)` returns the correct list (or `null` for restaurants).

#### `MenuExcelService.generateTemplate()`

Produces a two-sheet `.xlsx` file as `List<int>` bytes:

**Sheet 1 — "Menu Items"**

| Col | Header | Required? |
|---|---|---|
| A | Name (EN) | ✓ |
| B | Name (AR) | |
| C | Description (EN) | ✓ |
| D | Description (AR) | |
| E | Price (EGP) | ✓ |
| F | Discounted Price | |
| G | Section | ✓ |
| H | Available (yes/no) | |
| I | Calories | |

- Row 1: subtitle/instructions (merged, italic, grey)
- Row 2: column headers (bold, orange background `#E65100`)
- Rows 3–5: 3 greyed-out example rows (italic, deletable)

**Sheet 2 — "Sections"** — one row per valid section name (reference only; the excel package version used does not support dropdown data validation, so users refer to this sheet manually).

#### `MenuExcelService.parseImport()`

Reads the "Menu Items" sheet and validates each row:

| Field | Validation |
|---|---|
| Name (EN) | Required |
| Description (EN) | Required |
| Price | Required, must be a positive number |
| Section | Required, must match a valid section name (case-insensitive) |
| Discounted Price | Optional; if present, must be < regular price |
| Calories | Optional; must be an integer if provided |

Returns `List<Map<String, dynamic>>`. Invalid rows include an `'error'` key; valid rows do not.

---

### `lib/features/restaurant_owner/widgets/excel_import_dialog.dart` *(NEW)*

`ExcelImportDialog` is a `StatefulWidget` dialog.

**Constructor:**
```dart
ExcelImportDialog({
  required RestaurantMenuCubit cubit,
  required VendorType vendorType,
  required List<String> sectionNames,
})
```

**Phases:**

| Phase | Trigger | Key action |
|---|---|---|
| `landing` | Dialog opens | Show how-it-works card, section chips preview, download + upload buttons |
| `preview` | File parsed successfully | Show `DataTable` of all rows; errors highlighted red |
| `importing` | User taps "Import N Items" | Iterates `_validRows`, calls `cubit.createItemFromMap(row, vendorType)` per row |
| `done` | All rows imported | Show snackbar, close dialog |

**Download template:**
```dart
final bytes = MenuExcelService.generateTemplate(
  sectionNames: widget.sectionNames,
  vendorTypeLabel: widget.vendorType.label,
);
// Write to temp dir, share via system share sheet:
await SharePlus.instance.share(
  ShareParams(files: [XFile(path)], subject: '...'),
);
```

**Upload & parse:**
```dart
final result = await FilePicker.platform.pickFiles(
  type: FileType.custom, allowedExtensions: ['xlsx'], withData: true,
);
final parsed = MenuExcelService.parseImport(
  bytes: result.files.first.bytes!,
  validSectionNames: widget.sectionNames,
);
```

---

### `lib/features/restaurant_owner/cubit/restaurant_menu_cubit.dart`

**What changed:** New method `createItemFromMap(Map<String, dynamic> row, VendorType vendorType)`.

**Logic:**

```
For VendorType.restaurant:
  1. Find CuisineType in state.cuisineTypes whose name matches row['section']
  2. Call _ensureSectionForCuisineType(ct.id)
     → creates the MenuSection if it doesn't exist yet

For supermarket / pharmacy:
  1. Look for existing MenuSection in state.sections with matching name
  2. If not found → create new MenuSection with a UUID via _repository.createSection()

Then build MenuItem with all fields from the row map (imageUrl = '', no addon groups)
and call _repository.createItem().
```

Errors during a single row import are logged with `debugPrint` and silently skipped so the rest of the batch continues.

---

### `lib/features/restaurant_owner/widgets/menu_manager.dart`

**What changed:** `_buildAppBarContent` now renders the title and an "Import" button side-by-side:

```
┌─────────────────────────────────────────────┐
│  Menu Manager                  [ ⊞ Import ] │
└─────────────────────────────────────────────┘
```

New `_showImportDialog()` method:

```dart
void _showImportDialog(BuildContext context, RestaurantMenuCubit cubit) {
  final vendorType = context.read<RestaurantProfileCubit>()
      .state.restaurant?.vendorType ?? VendorType.restaurant;

  final sectionNames = vendorType == VendorType.restaurant
      ? cubit.state.cuisineTypes.map((ct) => ct.name).toList()
      : VendorSections.forType(vendorType) ?? [];

  showDialog(
    context: context,
    builder: (_) => ExcelImportDialog(
      cubit: cubit,
      vendorType: vendorType,
      sectionNames: sectionNames,
    ),
  );
}
```

---

## File Summary

| File | Status | Purpose |
|---|---|---|
| `lib/core/enums/user_enums.dart` | Modified | Added `VendorType` enum + extension |
| `lib/core/enums/enums.dart` | Modified | Barrel export fix |
| `lib/features/restaurant/model/restaurant.dart` | Modified | Added `vendorType` field |
| `lib/features/restaurant_owner/widgets/vendor_type_selection_step.dart` | **New** | Step 0 of onboarding |
| `lib/features/restaurant_owner/cubit/restaurant_application_state.dart` | Modified | `vendorType` field, `totalSteps` 7→8 |
| `lib/features/restaurant_owner/cubit/restaurant_application_cubit.dart` | Modified | `setVendorType()`, `formData` update |
| `lib/features/restaurant_owner/view/restaurant_application_form.dart` | Modified | Step 0 wired, conditional cuisine validation |
| `lib/features/restaurant_owner/widgets/business_info_step.dart` | Modified | Cuisine section conditional on `vendorType` |
| `lib/features/admin/repository/application_repository_impl.dart` | Modified | Persists `vendorType` on approval |
| `lib/features/auth/view/user_type_selection_screen.dart` | Modified | Role card copy updated |
| `lib/features/restaurant_owner/view/restaurant_hub_screen.dart` | Modified | Dynamic icon, "Vendor Dashboard" title |
| `lib/features/restaurant_owner/widgets/restaurant_drawer.dart` | Modified | Dynamic icon in drawer header |
| `lib/features/admin/cubit/admin_restaurants_state.dart` | Modified | `vendorTypeFilter` field |
| `lib/features/admin/cubit/admin_restaurants_cubit.dart` | Modified | `setVendorTypeFilter()`, filter logic |
| `lib/features/admin/view/admin_restaurants_view.dart` | Modified | Filter chip row in admin panel |
| `pubspec.yaml` | Modified | Added `excel`, `file_picker` |
| `lib/features/restaurant_owner/services/menu_excel_service.dart` | **New** | Template generation + file parsing |
| `lib/features/restaurant_owner/widgets/excel_import_dialog.dart` | **New** | 3-phase import dialog |
| `lib/features/restaurant_owner/cubit/restaurant_menu_cubit.dart` | Modified | `createItemFromMap()` |
| `lib/features/restaurant_owner/widgets/menu_manager.dart` | Modified | "Import" button in header |
