# Localization Progress — Z Speed App

## How to resume

اكتب اسم الـ feature بالإنجليزي فقط وأنا هكمل.

مثال:
```
payment
```
أو
```
settings
```

---

## Workflow (per feature)

1. اقرأ كل الـ Dart files في `lib/features/<feature>/`
2. استخرج كل الـ hardcoded English strings
3. أضف المفاتيح المفقودة لـ `app_en.arb` و `app_ar.arb`
4. شغّل `flutter gen-l10n`
5. استبدل كل الـ strings في الـ Dart files بـ `AppLocalizations.of(context)!.key`

---

## Status

| Feature            | Status      |
|--------------------|-------------|
| auth               | ✅ Done      |
| admin              | ✅ Done      |
| cart               | ✅ Done      |
| customer           | ✅ Done      |
| driver             | ✅ Done      |
| help_support       | ✅ Done      |
| home               | ✅ Done      |
| notification       | ✅ Done      |
| order              | ✅ Done      |
| payment            | ⬜ Pending   |
| payment_settings   | ⬜ Pending   |
| privacy            | ⬜ Pending   |
| restaurant         | ⬜ Pending   |
| restaurant_owner   | ⬜ Pending   |
| review             | ⬜ Pending   |
| settings           | ⬜ Pending   |
| shared             | ⬜ Pending   |
