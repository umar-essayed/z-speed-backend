# Translation & Localization (L10n) Guide

This document explains how the translation process works in the Z_Speed_app and provides a step-by-step guide on how to fix untranslated sentences in the frontend.

## 1. How the Translation Flow Works

The app's localization is built using **Flutter's native `gen-l10n` tool** combined with **Cubit** for state management.

### Key Components

*   **ARB Files (`lib/l10n/`)**:
    *   `app_en.arb`: The base template file containing English strings and metadata about placeholders.
    *   `app_ar.arb`: The Arabic translation file.
*   **Code Generation**:
    *   The `l10n.yaml` file configures the `gen-l10n` tool.
    *   Whenever you modify the `.arb` files, Flutter automatically generates a Dart class called `AppLocalizations` (usually found in `.dart_tool/flutter_gen/gen_l10n/` or `lib/l10n/app_localizations.dart` depending on the exact generated setup).
*   **State Management (`LocaleCubit`)**:
    *   Located at `lib/core/localization/locale_cubit.dart`.
    *   It holds the current `Locale` state (either `en` or `ar`).
    *   It uses `SharedPreferences` to save the user's language choice on the device.
    *   Whenever `changeLanguage()` or `toggleLanguage()` is called, the `MaterialApp` rebuilds, pulling the correct strings from `AppLocalizations`.

---

## 2. How to Fix an Untranslated Sentence

If you see a hardcoded, untranslated English sentence in the frontend (e.g., a button saying `"Submit Order"` instead of adapting to Arabic), follow these steps to fix it.

### Step 1: Add the key to the English ARB file
Open `lib/l10n/app_en.arb` and add a new key-value pair for the text. Use camelCase for the key.

```json
{
  "@@locale": "en",
  "appTitle": "Z_Speed",
  "welcomeMessage": "Welcome back, {name}!",
  
  "submitOrder": "Submit Order"
}
```
*(Make sure to add a comma to the previous line if it isn't the last one in the JSON object).*

### Step 2: Add the translation to the Arabic ARB file
Open `lib/l10n/app_ar.arb` and add the **exact same key** with the Arabic translation.

```json
{
  "@@locale": "ar",
  "appTitle": "زد سبيد",
  "welcomeMessage": "أهلاً بك مجدداً، {name}!",
  
  "submitOrder": "تأكيد الطلب"
}
```

### Step 3: Trigger Code Generation (if needed)
Normally, saving the `.arb` files triggers Flutter to automatically regenerate `AppLocalizations`. If your IDE isn't picking up the new key:
1. Run this command in your terminal:
   ```bash
   flutter gen-l10n
   ```

### Step 4: Replace the hardcoded string in the UI
Find the Flutter widget where the text is hardcoded.

**Before:**
```dart
ElevatedButton(
  onPressed: () {},
  child: const Text('Submit Order'), // Hardcoded string
)
```

**After:**
Replace the hardcoded string with the auto-generated localized string using `AppLocalizations.of(context)!`.

```dart
import 'package:flutter_gen/gen_l10n/app_localizations.dart'; // Ensure it's imported (path may vary slightly)

ElevatedButton(
  onPressed: () {},
  child: Text(AppLocalizations.of(context)!.submitOrder), // Dynamic translation
)
```
*(Note: Remove `const` from `Text` or parent widgets if you are injecting `AppLocalizations.of(context)`, as it requires context evaluation at runtime).*

### Step 5: Test the changes
Switch the app language to Arabic and navigate to the screen. You should now see `"تأكيد الطلب"` instead of `"Submit Order"`.
