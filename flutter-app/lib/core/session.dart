import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'api_client.dart';

/// Minimal auth state: tokens in secure storage, user map in memory.
class Session extends ChangeNotifier {
  final ApiClient api;
  final FlutterSecureStorage storage;
  Map<String, dynamic>? user;
  bool loading = false;
  String? error;

  Session({ApiClient? api, FlutterSecureStorage? storage})
      : api = api ?? ApiClient(),
        storage = storage ?? const FlutterSecureStorage();

  bool get loggedIn => user != null;

  Future<bool> checkVersionGate() async {
    try {
      final res = await api.get('/api/mobile/app-config');
      final minV = (res.data?['min_app_version'] ?? '1.0.0').toString();
      return _cmpVersion('1.0.0', minV) >= 0;
    } catch (_) {
      return true; // fail-open in dev; gate enforced in release via Remote Config later
    }
  }

  int _cmpVersion(String a, String b) {
    final pa = a.split('.').map((e) => int.tryParse(e) ?? 0).toList();
    final pb = b.split('.').map((e) => int.tryParse(e) ?? 0).toList();
    for (var i = 0; i < 3; i++) {
      final d = (i < pa.length ? pa[i] : 0) - (i < pb.length ? pb[i] : 0);
      if (d != 0) return d;
    }
    return 0;
  }

  Future<bool> login(String id, String password) async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      final res = await api.post('/api/auth/login', data: {
        'employee_id': id,
        'password': password,
        'portal': 'employee',
      });
      final token = res.data?['token'] as String?;
      final refresh = res.data?['refresh_token'] as String?;
      if (token == null) {
        error = (res.data?['message'] ?? 'Login failed').toString();
        return false;
      }
      await storage.write(key: 'access_token', value: token);
      if (refresh != null) await storage.write(key: 'refresh_token', value: refresh);
      user = Map<String, dynamic>.from(res.data?['user'] ?? {});
      return true;
    } catch (e) {
      error = 'Network/server error. Check API_BASE_URL.';
      return false;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    await storage.delete(key: 'access_token');
    await storage.delete(key: 'refresh_token');
    user = null;
    notifyListeners();
  }
}
