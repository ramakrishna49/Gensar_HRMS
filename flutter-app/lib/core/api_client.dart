import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'config.dart';

/// Dio client with JWT attach + single-flight refresh on 401.
/// Storage keys are shared with Session provider below.
class ApiClient {
  static const _kAccess = 'access_token';
  static const _kRefresh = 'refresh_token';

  final Dio dio;
  final FlutterSecureStorage storage;
  bool _refreshing = false;

  ApiClient({Dio? dio, FlutterSecureStorage? storage})
      : dio = dio ?? Dio(BaseOptions(baseUrl: AppConfig.apiBaseUrl)),
        storage = storage ?? const FlutterSecureStorage() {
    this.dio.interceptors.add(InterceptorsWrapper(
      onRequest: (o, h) async {
        final t = await this.storage.read(key: _kAccess);
        if (t != null && t.isNotEmpty) o.headers['Authorization'] = 'Bearer $t';
        h.next(o);
      },
      onError: (e, h) async {
        if (e.response?.statusCode == 401 && !_isAuthCall(e.requestOptions.path)) {
          final ok = await _tryRefresh();
          if (ok) {
            final t = await storage.read(key: _kAccess);
            e.requestOptions.headers['Authorization'] = 'Bearer $t';
            try {
              final r = await this.dio.fetch(e.requestOptions);
              return h.resolve(r);
            } catch (_) {}
          }
        }
        h.next(e);
      },
    ));
  }

  bool _isAuthCall(String path) =>
      path.contains('/api/auth/login') || path.contains('/api/auth/refresh');

  Future<bool> _tryRefresh() async {
    if (_refreshing) return false;
    _refreshing = true;
    try {
      final rt = await storage.read(key: _kRefresh);
      if (rt == null || rt.isEmpty) return false;
      final res = await Dio(BaseOptions(baseUrl: AppConfig.apiBaseUrl))
          .post('/api/auth/refresh', data: {'refresh_token': rt});
      final token = res.data?['token'] as String?;
      if (token == null) return false;
      await storage.write(key: _kAccess, value: token);
      return true;
    } catch (_) {
      return false;
    } finally {
      _refreshing = false;
    }
  }

  Future<Response> get(String path, {Map<String, dynamic>? query}) =>
      dio.get(path, queryParameters: query);
  Future<Response> post(String path, {Object? data}) =>
      dio.post(path, data: data);
}
