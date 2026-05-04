# Z_Speed_app Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-17

## Active Technologies
- Dart 3.5+ (Flutter 3.x) for the client; TypeScript on Node 20 for Cloud Functions (backend). (002-cybersource-payment)
- Cloud Firestore — reuses existing `orders/{orderId}` collection and adds a subcollection `orders/{orderId}/paymentAttempts/{attemptId}` plus a top-level `paymentReconciliationJobs` collection for fallback polling state. Secrets (merchant ID, Secure Acceptance access/profile/secret keys) are stored in Firebase / GCP Secret Manager, never in the client build and never in Firestore. (002-cybersource-payment)

- Dart / Flutter 3.x + flutter_bloc ^8.1.5, firebase_auth, get_it / injectable (marge-payment-flow)

## Project Structure

```text
src/
tests/
```

## Commands

# Add commands for Dart / Flutter 3.x

## Code Style

Dart / Flutter 3.x: Follow standard conventions

## Recent Changes
- 002-cybersource-payment: Added Dart 3.5+ (Flutter 3.x) for the client; TypeScript on Node 20 for Cloud Functions (backend). webview_flutter ^4.4.0 for hosted checkout webview; crypto ^3.0.3 for SHA-256 hashing; Secret Manager-backed signing (credentials never in client).

- marge-payment-flow: Added Dart / Flutter 3.x + flutter_bloc ^8.1.5, firebase_auth, get_it / injectable

<!-- MANUAL ADDITIONS START -->
- 002-cybersource-payment: webview_flutter ^4.4.0, crypto ^3.0.3 added to pubspec.yaml; backend: jest, firebase-functions-test, axios, zod added to functions/package.json
<!-- MANUAL ADDITIONS END -->
