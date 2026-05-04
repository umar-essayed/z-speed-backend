# Arabic Localization (L10n) Implementation Plan using Cubit & ARB Files

Applying Arabic language support requires text translation (Internationalization/l10n), adapting the UI for Right-to-Left (RTL) reading (Directionality), and managing the active language state globally. This document outlines the highly detailed phases to implement localization using the robust **Bloc/Cubit** state management pattern combined with **ARB (Application Resource Bundle)** files.

## Phase 1: Dependencies and Environment Setup ⚙️
**Goal:** Integrate necessary packages and set up the foundation for code generation and state management.
1. **Add Required Packages:**
   Update `pubspec.yaml` with the following dependencies:
   ```yaml
   dependencies:
     flutter_localizations:
       sdk: flutter
     intl: ^0.19.0
     flutter_bloc: ^8.1.5       # For Cubit State Management
     shared_preferences: ^2.2.2 # If not already present, for persisting selection
   ```
2. **Configure Code Generation (`l10n.yaml`):**
   Create an `l10n.yaml` file in the project root to automate generating the `AppLocalizations` class.
   ```yaml
   arb-dir: lib/l10n
   template-arb-file: app_en.arb
   output-localization-file: app_localizations.dart
   ```
3. **Enable Generation in `pubspec.yaml`:**
   Ensure the `generate: true` flag is set beneath the `flutter:` block.

## Phase 2: Translation Assets (ARB Files) 📄
**Goal:** Create translation files for English and Arabic. ARB files are preferred in Flutter natively over JSON because they integrate directly with Flutter's built-in `gen-l10n` tool.
1. **Create Directory Structure:** Create the folder `lib/l10n/`.
2. **Create Base English File (`lib/l10n/app_en.arb`):**
   This acts as the template. It contains keys and English values, along with metadata.
   ```json
   {
     "@@locale": "en",
     "appTitle": "Z_Speed",
     "@appTitle": {
       "description": "The main application title shown in the app bar"
     },
     "welcomeMessage": "Welcome back, {name}!",
     "@welcomeMessage": {
       "description": "Greeting on the home screen",
       "placeholders": {
         "name": {
           "type": "String",
           "example": "John"
         }
       }
     }
   }
   ```
3. **Create Arabic Translation File (`lib/l10n/app_ar.arb`):**
   ```json
   {
     "@@locale": "ar",
     "appTitle": "زد سبيد",
     "welcomeMessage": "أهلاً بك مجدداً، {name}!"
   }
   ```

## Phase 3: Cubit State Management Implementation 🧠
**Goal:** Create a globally accessible Cubit to manage, persist, and broadcast the active application locale.
1. **Create `LocaleCubit` (`lib/core/localization/locale_cubit.dart`):**
   - **State:** The state will literally be a `Locale` object (e.g., `Locale('ar')` or `Locale('en')`).
   - **Persistence:** Inject `SharedPreferences` to save and load the `language_code` string on disk.
   ```dart
   import 'package:flutter/material.dart';
   import 'package:flutter_bloc/flutter_bloc.dart';
   import 'package:shared_preferences/shared_preferences.dart';

   class LocaleCubit extends Cubit<Locale> {
     static const _langKey = 'selected_language';
     final SharedPreferences _prefs;

     LocaleCubit(this._prefs) : super(const Locale('en')) {
       _loadSavedLocale();
     }

     void _loadSavedLocale() {
       final langCode = _prefs.getString(_langKey);
       if (langCode != null) {
         emit(Locale(langCode));
       }
     }

     Future<void> changeLanguage(String languageCode) async {
       await _prefs.setString(_langKey, languageCode);
       emit(Locale(languageCode));
     }

     void toggleLanguage() {
       final newCode = state.languageCode == 'en' ? 'ar' : 'en';
       changeLanguage(newCode);
     }
   }
   ```

2. **Wrap Application with BlocProvider & BlocBuilder (`lib/main.dart`):**
   Inject the `LocaleCubit` at the top of the widget tree so the `MaterialApp` rebuilds whenever the state (language) changes.
   ```dart
   void main() async {
     WidgetsFlutterBinding.ensureInitialized();
     final prefs = await SharedPreferences.getInstance();
     runApp(MyApp(prefs: prefs));
   }

   class MyApp extends StatelessWidget {
     final SharedPreferences prefs;
     const MyApp({super.key, required this.prefs});

     @override
     Widget build(BuildContext context) {
       return BlocProvider(
         create: (_) => LocaleCubit(prefs),
         child: BlocBuilder<LocaleCubit, Locale>(
           builder: (context, locale) {
             return MaterialApp(
               locale: locale, // Tightly coupled to the Cubit State
               localizationsDelegates: AppLocalizations.localizationsDelegates,
               supportedLocales: AppLocalizations.supportedLocales,
               // ... rest of setup
             );
           },
         ),
       );
     }
   }
   ```

## Phase 4: Hardcoded String Replacement (Refactoring) 🔄
**Goal:** Replace all static text strings in the UI with the auto-generated dynamic keys via `AppLocalizations.of(context)`.
*Example Refactor:*
**Before:** `Text('Login to your account')`
**After:** `Text(AppLocalizations.of(context)!.loginPrompt)`

*To maintain sanity, this phase must be chunked into specific domains:*
- **Phase 4.1:** Global navigation items and common buttons (Login, Submit, Cancel).
- **Phase 4.2:** Authentication flows (Splash, Sign Up, OTP).
- **Phase 4.3:** Customer-facing screens (Home Feed, Cart, Profile).
- **Phase 4.4:** Driver & Admin portals.

## Phase 5: RTL Layout Refactoring ◀️
**Goal:** Ensure the app looks correct when running in Right-to-Left mode (Arabic). Flutter handles much of this automatically if built correctly, but specific geometry widgets must be updated.
1. **Directional Insets:** 
   Replace `EdgeInsets.only(left: 16)` with `EdgeInsetsDirectional.only(start: 16)`. This ensures padding swaps automatically from left to right in Arabic mode.
2. **Positioning & Alignment:** 
   Replace `Alignment.centerLeft` with `AlignmentDirectional.centerStart`.
   Replace `Positioned(left: 0)` inside Stack widgets with `Positioned.directional(textDirection: Directionality.of(context), start: 0)`.
3. **Flipping Icons:** 
   Use `Icons.arrow_back_ios_new` instead of hardcoded directional icons where the system doesn't automatically mirror them. You can also wrap custom SVG icons in a `Transform.scale(scaleX: -1)` conditionally based on `Directionality.of(context)`.

## Phase 6: Dynamic Database Localization 🗄️
**Goal:** Ensure backend data from Firestore (like categories, restaurant names, and menu items) is presented in the correct language.
1. **Firestore Schema Update:** Modify data structures.
   *Example:*
   ```json
   {
     "categoryId": "123",
     "name_en": "Fast Food",
     "name_ar": "وجبات سريعة"
   }
   ```
2. **Model Updating (`lib/models/`):** Update Dart models to grab the correct field based on a passed language code, or evaluate it at runtime in the UI layer.
3. **Database Migration:** Update existing production/testing collections manually or via script to include the `_ar` fields.

## Phase 7: UI Controls & Settings ⚙️
**Goal:** Provide the user a way to trigger the language toggle inside the app.
1. Add a "Change Language" toggle or dropdown inside the Customer, Driver, and Restaurant Owner Profile/Settings pages.
2. When tapped, simply call: `context.read<LocaleCubit>().changeLanguage('ar');`

## Phase 8: Testing & Quality Assurance 🧪
**Goal:** Verify translations and ensure UI/UX stability.
- **RTL Bug Hunt:** Specifically look for custom widgets (like horizontal scrolling lists, charts, or custom progress bars) that might render backwards in RTL mode.
- **Text Overflow:** Arabic characters often have different vertical height requirements and horizontal densities than English. Check for clipping inside constrained boxes (like `SizedBox` with a fixed height containing a `Text` widget).
- **Translation Context Check:** Have an Arabic speaker verify the conversational tone inside `app_ar.arb`.
