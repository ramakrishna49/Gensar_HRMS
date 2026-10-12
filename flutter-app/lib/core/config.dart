/// Single place to point the app at your backend.
/// Android emulator -> 10.0.2.2 maps to host localhost.
/// Real device / Play build -> https://api.yourdomain
class AppConfig {
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000',
  );
  static const String appVersion = '1.0.0';
}
