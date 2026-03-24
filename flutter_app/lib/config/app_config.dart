import 'package:shared_preferences/shared_preferences.dart';

/// Global application configuration.
///
/// The base URL can be changed at run time through Settings so the app can
/// connect to any YOT Downloader FastAPI backend instance.
class AppConfig {
  static const String _kBaseUrl = 'base_url';

  /// Default backend URL – change this to your deployed server address.
  static const String defaultBaseUrl = 'http://localhost:8000';

  static String _baseUrl = defaultBaseUrl;

  /// The current FastAPI backend base URL (no trailing slash).
  static String get baseUrl => _baseUrl;

  /// Load persisted configuration from device storage.
  static Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    _baseUrl = prefs.getString(_kBaseUrl) ?? defaultBaseUrl;
  }

  /// Persist a new base URL.
  static Future<void> setBaseUrl(String url) async {
    _baseUrl = url.trim().replaceAll(RegExp(r'/$'), '');
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kBaseUrl, _baseUrl);
  }
}
