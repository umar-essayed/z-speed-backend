# Vendor Expansion Implementation Plan

## Goal Description
Expand the current food delivery platform to also support Supermarkets and Pharmacies. This requires making the existing "Restaurant" concept more generic (a "Vendor") by adding a `vendorType` field. The onboarding flow, dashboards, and app navigation will dynamically adapt based on this type.

## User Review Required

> [!WARNING]
> **Model Naming Decision:** Before we begin, we need to decide whether to rename the [Restaurant](file:///root/Z_Speed_app/lib/features/restaurant/model/restaurant.dart#8-270) model and related Firestore collections to `Vendor`, or to keep the name [Restaurant](file:///root/Z_Speed_app/lib/features/restaurant/model/restaurant.dart#8-270) under the hood and just add a `vendorType` field.
> - **Option A (Refactor to Vendor):** Cleaner long-term, but requires modifying almost every file in the `features/restaurant...` directories and migrating existing Firestore data.
> - **Option B (Keep 'Restaurant' name + add type):** Much faster to implement, but leaves us with technical debt where a 'Pharmacy' is stored as a [Restaurant](file:///root/Z_Speed_app/lib/features/restaurant/model/restaurant.dart#8-270) object in the code.

> [!IMPORTANT]
> **Categories vs Cuisines:** Restaurants currently have `cuisineTypes`. Should Supermarkets and Pharmacies also select from a list of 'Categories' during signup (e.g., a supermarket might select "Groceries" and "Fresh Produce"), or does the `vendorType` itself sufficiently categorize them?

## Proposed Changes

### Core Data Models
Add the `vendorType` to the core models and update serialization logic.

#### [MODIFY] [user_model.dart](file:///root/Z_Speed_app/lib/features/auth/model/user_model.dart)
- Update the [UserType](file:///root/Z_Speed_app/lib/features/auth/view/user_type_selection_screen.dart#5-154) enum or add a specific `vendorType` if `type` remains `UserType.restaurant`.

#### [MODIFY] [restaurant.dart](file:///root/Z_Speed_app/lib/features/restaurant/model/restaurant.dart)
- Add a defining field for the vendor type (e.g., `final VendorType vendorType;` where `enum VendorType { restaurant, supermarket, pharmacy }`).
- Update `fromMap` and [toMap](file:///root/Z_Speed_app/lib/features/restaurant/model/restaurant.dart#288-293) to serialize this new field.
- If we rename [Restaurant](file:///root/Z_Speed_app/lib/features/restaurant/model/restaurant.dart#8-270) to `Vendor`, rename the class itself.

---

### Authentication & Onboarding
Update the sign-up flow to ask the user what type of vendor they are joining as.

#### [MODIFY] [user_type_selection_screen.dart](file:///root/Z_Speed_app/lib/features/auth/view/user_type_selection_screen.dart)
- Change the card title from "Restaurant" to "Vendor / Partner".
- Change the icon and description to include stores and pharmacies.

#### [NEW] [vendor_type_selection_step.dart](file:///root/Z_Speed_app/lib/features/restaurant_owner/widgets/vendor_type_selection_step.dart)
- Add a new initial step to the [RestaurantApplicationForm](file:///root/Z_Speed_app/lib/features/restaurant_owner/view/restaurant_application_form.dart#25-32) before 'Business Info' to let the user pick: Restaurant, Supermarket, or Pharmacy.

#### [MODIFY] [restaurant_application_form.dart](file:///root/Z_Speed_app/lib/features/restaurant_owner/view/restaurant_application_form.dart)
- Integrate the new vendor type selection step.
- Update [submitApplication](file:///root/Z_Speed_app/lib/features/restaurant_owner/cubit/restaurant_application_cubit.dart#178-289) to pass the `vendorType` down to the repository.

#### [MODIFY] [restaurant_application_cubit.dart](file:///root/Z_Speed_app/lib/features/restaurant_owner/cubit/restaurant_application_cubit.dart)
- Hold the selected `vendorType` in the state.
- Make the "Cuisines" fetch dynamic based on the `vendorType` (fetch Cuisines for Restaurant, fetch corresponding categories for others).

#### [MODIFY] [business_info_step.dart](file:///root/Z_Speed_app/lib/features/restaurant_owner/widgets/business_info_step.dart)
- Only show the 'Cuisines' section if the selected `vendorType` requires it, or dynamically load 'Supermarket Categories' depending on the selected type.

---

### Dashboards & Admin Views
Update the UI to reflect the dynamic vendor type instead of hardcoding "Restaurant".

#### [MODIFY] [restaurant_dashboard]
- (Files like `restaurant_overview_screen.dart`, `restaurant_drawer.dart`)
- Make titles dynamic: `${vendorType} Dashboard` instead of hardcoded `Restaurant Dashboard`.

#### [MODIFY] [admin_restaurants_view.dart](file:///root/Z_Speed_app/lib/features/admin/view/admin_restaurants_view.dart)
- Update the admin panel to allow filtering by `vendorType`, or duplicate the views to have a dedicated `AdminSupermarketsView` and `AdminPharmaciesView` powered by the same underlying logic.

## Verification Plan

### Automated Tests
- Run `flutter test` to ensure no existing business logic is broken by the model modifications. (Note: currently tests seem to be concentrated in `test/features/`).

### Manual Verification
1. **Launch App:** Run the application locally or via an emulator.
2. **Sign Up Flow Check:** Go to "Join as a Restaurant/Vendor" from the login screen and confirm there is a step to select the vendor type.
3. **Application Verification:** Check that the application saves successfully into Firebase with the correct `vendorType` field attached.
4. **Dashboard Check:** Log in with the newly created vendor account and confirm the dashboard reflects the correct type in its titles and text.
