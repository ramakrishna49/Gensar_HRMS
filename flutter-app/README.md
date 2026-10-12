# Gensar HRMS Android app (Flutter, MVP)

Backend wiring: `AppConfig.apiBaseUrl`
- Emulator: `http://10.0.2.2:3000` (default, maps to host localhost)
- Real device / release: `--dart-define=API_BASE_URL=https://api.yourdomain`

## Prereqs (Windows)
1. Install Flutter SDK 3.22+: https://docs.flutter.dev/get-started/install/windows
   `flutter doctor`, accept Android licenses, install Android Studio + SDK + emulator.
2. Firebase (Phase-2 push): `flutterfire configure` — MVP builds without it
   (register-device stores token; FCM send comes in Phase-2).

## Run (MVP)
```bash
cd flutter-app
flutter pub get
# backend must be running: node server/index.js (in repo root, .env set)
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000
# test login: APPTEST001 / Test@123
```

## Release (Play Store)
```bash
keytool -genkey -v -keystore android/app/upload-keystore.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
# android/key.properties + android/app/build.gradle signingConfigs (release)
flutter build appbundle --release --dart-define=API_BASE_URL=https://api.yourdomain
# upload build/app/outputs/bundle/release/app-release.aab to Play Console
```

## MVP scope
Login (+refresh), Dashboard, Attendance (GPS check-in/out), Leave (apply+my),
More (holidays/announcements/profile). Phase-2: WFH/Regularization, Payroll PDFs,
Projects, Tickets, Manager approvals, FCM push, offline queue, photo check-in.
