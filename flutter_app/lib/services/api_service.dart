import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';
import '../config/app_config.dart';
import '../models/video_info.dart';
import '../models/download_status.dart';
import '../models/file_item.dart';
import '../models/review.dart';

/// Custom exception carrying the HTTP status code and a human-readable message.
class ApiException implements Exception {
  final int statusCode;
  final String message;

  const ApiException(this.statusCode, this.message);

  @override
  String toString() => 'ApiException($statusCode): $message';
}

/// Centralized HTTP client for the YOT Downloader FastAPI backend.
///
/// All methods throw [ApiException] on HTTP errors, or rethrow
/// [SocketException] / [HttpException] on network failures.
class ApiService {
  ApiService._();
  static final ApiService instance = ApiService._();

  String get _base => AppConfig.baseUrl;

  // ── Cookie / session management ──────────────────────────────────────────

  final Map<String, String> _cookies = {};

  /// Load persisted session cookies from storage.
  Future<void> loadCookies() async {
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString('session_cookies');
    if (stored != null) {
      try {
        final map = json.decode(stored) as Map<String, dynamic>;
        _cookies.clear();
        map.forEach((k, v) => _cookies[k] = v.toString());
      } catch (_) {}
    }
  }

  /// Persist cookies to storage.
  Future<void> _saveCookies() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('session_cookies', json.encode(_cookies));
  }

  /// Clear all session cookies (logout).
  Future<void> clearCookies() async {
    _cookies.clear();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('session_cookies');
  }

  bool get hasSession => _cookies.containsKey('session');

  Map<String, String> get _cookieHeaders {
    if (_cookies.isEmpty) return {};
    return {'Cookie': _cookies.entries.map((e) => '${e.key}=${e.value}').join('; ')};
  }

  void _updateCookies(http.Response res) {
    final raw = res.headers['set-cookie'];
    if (raw == null) return;
    bool changed = false;
    // Each cookie entry starts with name=value, followed by "; " separated
    // attributes (Path, Domain, Expires, etc.).  Multiple Set-Cookie headers
    // are concatenated by the http package with ", " but "Expires" values also
    // contain commas.  We split only on sequences that look like the start of a
    // new cookie (alphanumeric name followed by "=").
    final entries = raw.split(RegExp(r',\s*(?=[A-Za-z][A-Za-z0-9_\-]*=)'));
    for (final entry in entries) {
      final nameVal = entry.split(';').first.trim();
      final eq = nameVal.indexOf('=');
      if (eq <= 0) continue;
      final key = nameVal.substring(0, eq).trim();
      final val = nameVal.substring(eq + 1).trim();
      if (_cookies[key] != val) {
        _cookies[key] = val;
        changed = true;
      }
    }
    if (changed) _saveCookies();
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  Uri _uri(String path, [Map<String, String>? query]) {
    final base = _base;
    // Support both http:// and https:// base URLs.
    final Uri parsed;
    if (base.startsWith('https://')) {
      parsed = Uri.https(base.replaceFirst('https://', ''), path, query);
    } else {
      final hostPort = base.replaceFirst('http://', '');
      parsed = Uri.http(hostPort, path, query);
    }
    return parsed;
  }

  Future<dynamic> _parseResponse(http.Response res) async {
    _updateCookies(res);
    final ct = res.headers['content-type'] ?? '';
    if (ct.contains('application/json')) {
      final body = json.decode(res.body) as Map<String, dynamic>;
      if (res.statusCode >= 400) {
        final msg = (body['error'] ?? body['detail'] ?? 'Request failed').toString();
        throw ApiException(res.statusCode, msg);
      }
      return body;
    }
    if (res.statusCode >= 400) {
      // Include a snippet of the response body to help with debugging.
      final snippet = res.body.length > 200 ? res.body.substring(0, 200) : res.body;
      throw ApiException(res.statusCode, 'Request failed (${res.statusCode}): $snippet');
    }
    return res;
  }

  Future<Map<String, dynamic>> _get(String path, [Map<String, String>? query]) async {
    final res = await http.get(_uri(path, query));
    return (await _parseResponse(res)) as Map<String, dynamic>;
  }

  /// Authenticated GET that includes the session cookie.
  Future<Map<String, dynamic>> _getAuth(String path, [Map<String, String>? query]) async {
    final res = await http.get(_uri(path, query), headers: _cookieHeaders);
    return (await _parseResponse(res)) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> _postJson(String path, Map<String, dynamic> body) async {
    final res = await http.post(
      _uri(path),
      headers: {'Content-Type': 'application/json'},
      body: json.encode(body),
    );
    return (await _parseResponse(res)) as Map<String, dynamic>;
  }

  /// Authenticated POST JSON that includes the session cookie.
  Future<Map<String, dynamic>> _postJsonAuth(String path, Map<String, dynamic> body) async {
    final headers = {..._cookieHeaders, 'Content-Type': 'application/json'};
    final res = await http.post(
      _uri(path),
      headers: headers,
      body: json.encode(body),
    );
    return (await _parseResponse(res)) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> _postForm(String path, Map<String, String?> fields) async {
    final req = http.MultipartRequest('POST', _uri(path));
    fields.forEach((k, v) {
      if (v != null) req.fields[k] = v;
    });
    final streamed = await req.send();
    final res = await http.Response.fromStream(streamed);
    return (await _parseResponse(res)) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> _delete(String path) async {
    final res = await http.delete(_uri(path));
    return (await _parseResponse(res)) as Map<String, dynamic>;
  }

  // ── Health ─────────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getHealth() => _get('/health');

  Future<Map<String, dynamic>> getStats() => _get('/stats');

  // ── Video info & download ──────────────────────────────────────────────────

  /// Fetch metadata for [url]. Returns a [VideoInfo] instance.
  Future<VideoInfo> getVideoInfo(String url) async {
    final req = http.MultipartRequest('POST', _uri('/video_info'));
    req.fields['url'] = url;
    final streamed = await req.send();
    final res = await http.Response.fromStream(streamed);
    final data = (await _parseResponse(res)) as Map<String, dynamic>;
    return VideoInfo.fromJson(data);
  }

  /// Start downloading [url] with the given [format], output [ext], and
  /// optional [sessionId].  Returns the download ID and initial title.
  Future<Map<String, dynamic>> startDownload({
    required String url,
    String format = 'best',
    String ext = 'mp4',
    String sessionId = '',
  }) async {
    return _postForm('/start_download', {
      'url': url,
      'format': format,
      'ext': ext,
      'session_id': sessionId.isNotEmpty ? sessionId : null,
    });
  }

  /// Poll the status of a download.
  Future<DownloadStatus> getStatus(String downloadId) async {
    final data = await _get('/status/$downloadId');
    return DownloadStatus.fromJson(downloadId, data);
  }

  /// Cancel a specific download.
  Future<void> cancelDownload(String downloadId) async {
    await http.post(_uri('/cancel/$downloadId'));
  }

  /// Cancel all in-progress downloads.
  Future<void> cancelAll() async {
    await http.post(_uri('/cancel_all'));
  }

  /// Get all currently active downloads.
  Future<List<Map<String, dynamic>>> getActiveDownloads() async {
    final data = await _get('/active_downloads');
    final list = data['downloads'];
    if (list is List) {
      return list.whereType<Map<String, dynamic>>().toList();
    }
    return [];
  }

  // ── Files ──────────────────────────────────────────────────────────────────

  /// List files in the downloads folder.
  Future<List<FileItem>> listFiles({String sessionId = ''}) async {
    final query = sessionId.isNotEmpty ? {'session_id': sessionId} : null;
    final data = await _get('/files', query);
    final files = data['files'];
    if (files is List) {
      return files.whereType<Map<String, dynamic>>().map(FileItem.fromJson).toList();
    }
    return [];
  }

  /// Delete a single downloaded file by [filename].
  Future<void> deleteFile(String filename) async {
    await http.delete(_uri('/delete/${Uri.encodeComponent(filename)}'));
  }

  /// Delete the entire session and its files.
  Future<void> deleteSession(String sessionId) async {
    await http.delete(_uri('/session/${Uri.encodeComponent(sessionId)}'));
  }

  /// Returns the URL to stream/preview a file directly.
  String streamUrl(String filename) =>
      '$_base/stream/${Uri.encodeComponent(filename)}';

  /// Returns the URL to download a file directly.
  String downloadUrl(String filename) =>
      '$_base/downloads/${Uri.encodeComponent(filename)}';

  // ── Bulk download ──────────────────────────────────────────────────────────

  /// Download multiple files as a ZIP archive.  Returns the raw [Uint8List]
  /// bytes of the ZIP so the caller can save / share it.
  Future<Uint8List> downloadZip(List<String> filenames) async {
    final req = http.MultipartRequest('POST', _uri('/download_zip'));
    req.fields['filenames'] = json.encode(filenames);
    final streamed = await req.send();
    if (streamed.statusCode >= 400) {
      throw ApiException(streamed.statusCode, 'Failed to create ZIP');
    }
    return streamed.stream.toBytes();
  }

  // ── Reviews ────────────────────────────────────────────────────────────────

  /// Fetch all published reviews.
  Future<List<Review>> getReviews() async {
    final data = await _get('/reviews');
    final list = data['reviews'];
    if (list is List) {
      return list.whereType<Map<String, dynamic>>().map(Review.fromJson).toList();
    }
    return [];
  }

  /// Check whether the current visitor may submit a review.
  Future<bool> canSubmitReview() async {
    final data = await _get('/reviews/can_submit');
    return (data['can_submit'] as bool?) ?? false;
  }

  /// Submit a review.  [rating] must be 1–5.
  Future<void> submitReview({
    required int rating,
    required String comment,
    required String name,
  }) async {
    await _postJson('/reviews', {'rating': rating, 'comment': comment, 'name': name});
  }

  // ── CV Generator ───────────────────────────────────────────────────────────

  /// Generate a CV PDF and return the raw bytes.
  ///
  /// [fields] keys: name, email, phone, location, link, summary, experience,
  ///   education, skills, projects, publications.
  /// [theme] is one of: classic, modern, minimal, executive, creative, tech,
  ///   elegant, vibrant.
  /// [logoFile] is an optional image [File] to embed as the CV logo.
  Future<Uint8List> generateCv({
    required Map<String, String> fields,
    String theme = 'classic',
    File? logoFile,
  }) async {
    final req = http.MultipartRequest('POST', _uri('/api/cv/generate'));
    fields.forEach((k, v) {
      if (v.isNotEmpty) req.fields[k] = v;
    });
    req.fields['theme'] = theme;
    if (logoFile != null) {
      req.files.add(await http.MultipartFile.fromPath(
        'logo',
        logoFile.path,
        filename: p.basename(logoFile.path),
      ));
    }
    final streamed = await req.send();
    if (streamed.statusCode >= 400) {
      final body = await streamed.stream.bytesToString();
      String msg = 'CV generation failed';
      try {
        final decoded = json.decode(body) as Map<String, dynamic>;
        msg = (decoded['error'] ?? decoded['detail'] ?? msg).toString();
      } catch (_) {}
      throw ApiException(streamed.statusCode, msg);
    }
    return streamed.stream.toBytes();
  }

  /// Extract CV fields from an existing PDF or DOCX file.
  Future<Map<String, dynamic>> extractCv(File file) async {
    final req = http.MultipartRequest('POST', _uri('/api/cv/extract'));
    req.files.add(await http.MultipartFile.fromPath(
      'file',
      file.path,
      filename: p.basename(file.path),
    ));
    final streamed = await req.send();
    final res = await http.Response.fromStream(streamed);
    final data = (await _parseResponse(res)) as Map<String, dynamic>;
    return (data['fields'] as Map<String, dynamic>?) ?? data;
  }

  // ── Document Converter ─────────────────────────────────────────────────────

  /// Convert [file] to [target] format.  Returns the converted file bytes.
  ///
  /// [target] values: pdf, word, excel, powerpoint, jpeg, png.
  Future<Uint8List> convertDocument(File file, String target) async {
    final req = http.MultipartRequest('POST', _uri('/api/doc/convert'));
    req.fields['target'] = target;
    req.files.add(await http.MultipartFile.fromPath(
      'file',
      file.path,
      filename: p.basename(file.path),
    ));
    final streamed = await req.send();
    if (streamed.statusCode >= 400) {
      final body = await streamed.stream.bytesToString();
      String msg = 'Conversion failed';
      try {
        final decoded = json.decode(body) as Map<String, dynamic>;
        msg = (decoded['error'] ?? decoded['detail'] ?? msg).toString();
      } catch (_) {}
      throw ApiException(streamed.statusCode, msg);
    }
    return streamed.stream.toBytes();
  }

  // ── Ride Sharing ──────────────────────────────────────────────────────────

  /// Return all visible rides (open + taken).
  Future<List<Map<String, dynamic>>> listRides() async {
    final res = await http.get(_uri('/api/rides/list'));
    final data = (await _parseResponse(res)) as Map<String, dynamic>;
    return List<Map<String, dynamic>>.from(data['rides'] as List);
  }

  /// Post a new shared ride.
  Future<String> postRide({
    required String origin,
    required String destination,
    required String departure,
    required int seats,
    String notes = '',
    double? originLat,
    double? originLng,
  }) async {
    final body = <String, dynamic>{
      'origin': origin,
      'destination': destination,
      'departure': departure,
      'seats': seats,
      'notes': notes,
    };
    if (originLat != null) body['origin_lat'] = originLat;
    if (originLng != null) body['origin_lng'] = originLng;

    final res = await http.post(
      _uri('/api/rides/post'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode(body),
    );
    final data = (await _parseResponse(res)) as Map<String, dynamic>;
    return data['ride_id'] as String;
  }

  /// Mark a ride as taken (poster only).
  Future<void> takeRide(String rideId) async {
    final res = await http.post(
      _uri('/api/rides/$rideId/take'),
      headers: {'Content-Type': 'application/json'},
      body: '{}',
    );
    await _parseResponse(res);
  }

  /// Cancel a ride (poster only).
  Future<void> cancelRide(String rideId) async {
    final res = await http.delete(_uri('/api/rides/$rideId'));
    await _parseResponse(res);
  }

  // ── Airport Pickup ────────────────────────────────────────────────────────

  /// Search for available drivers near an airport, auto-calculating the fare.
  Future<Map<String, dynamic>> searchAirportPickup({
    required String airport,
    required String destination,
  }) async {
    final res = await http.get(_uri('/api/rides/list', {
      'origin': airport,
      'destination': destination,
    }));
    return (await _parseResponse(res)) as Map<String, dynamic>;
  }

  /// Calculate the estimated fare between two coordinates.
  Future<double> calculateFare({
    required double originLat,
    required double originLng,
    required double destLat,
    required double destLng,
  }) async {
    final res = await _get('/api/rides/calculate_fare', {
      'origin_lat': originLat.toString(),
      'origin_lng': originLng.toString(),
      'dest_lat': destLat.toString(),
      'dest_lng': destLng.toString(),
    });
    return (res['fare'] as num).toDouble();
  }

  // ── Driver Registration & Tracking ───────────────────────────────────────

  /// Submit a driver registration application.
  Future<void> registerDriver({
    required String name,
    required String phone,
    required String vehicle,
    required String plate,
    int seats = 4,
  }) async {
    final res = await http.post(
      _uri('/api/driver/register'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({
        'name': name,
        'phone': phone,
        'vehicle': vehicle,
        'plate': plate,
        'seats': seats,
      }),
    );
    await _parseResponse(res);
  }

  /// Broadcast the driver's current location to the server.
  ///
  /// Only verified drivers can call this endpoint successfully.
  Future<void> broadcastDriverLocation({
    required int seats,
    double? lat,
    double? lng,
  }) async {
    final body = <String, dynamic>{'seats': seats};
    if (lat != null) body['lat'] = lat;
    if (lng != null) body['lng'] = lng;
    final res = await http.post(
      _uri('/api/driver/location'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode(body),
    );
    await _parseResponse(res);
  }

  /// Fetch all active verified driver locations.
  Future<List<Map<String, dynamic>>> getDriverLocations() async {
    final res = await http.get(_uri('/api/driver/locations'));
    final data = (await _parseResponse(res)) as Map<String, dynamic>;
    return List<Map<String, dynamic>>.from(data['drivers'] as List? ?? []);
  }

  // ── Real Estate Properties ────────────────────────────────────────────────

  /// List properties, optionally filtered by [status] ('active', 'sold', 'rented').
  Future<List<Map<String, dynamic>>> listProperties({String? status}) async {
    final params = <String, String>{};
    if (status != null && status.isNotEmpty) params['status'] = status;
    final res = await http.get(_uri('/api/properties', params));
    final data = (await _parseResponse(res)) as Map<String, dynamic>;
    return List<Map<String, dynamic>>.from(data['properties'] as List? ?? []);
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  /// Login with email and password.  Stores the session cookie on success.
  Future<Map<String, dynamic>> login({
    required String email,
    required String password,
    bool rememberMe = true,
  }) async {
    return _postJson('/api/auth/login', {
      'email': email,
      'password': password,
      'remember_me': rememberMe,
    });
  }

  /// Logout the current user and clear stored cookies.
  Future<void> logout() async {
    try {
      await _postJsonAuth('/api/auth/logout', {});
    } finally {
      await clearCookies();
    }
  }

  /// Return the currently authenticated user's profile, or null if not logged in.
  Future<Map<String, dynamic>?> getCurrentUser() async {
    try {
      return await _getAuth('/api/auth/me');
    } on ApiException catch (e) {
      if (e.statusCode == 401 || e.statusCode == 404) return null;
      rethrow;
    }
  }

  // ── Ride Chat ─────────────────────────────────────────────────────────────

  /// Fetch the ride chat inbox for the current user.
  Future<List<Map<String, dynamic>>> getRideChatInbox() async {
    final data = await _getAuth('/api/rides/chat/inbox');
    final list = data['conversations'] ?? data['inbox'] ?? data;
    if (list is List) {
      return list.whereType<Map<String, dynamic>>().toList();
    }
    return [];
  }

  /// Fetch messages for a specific ride's chat.
  Future<List<Map<String, dynamic>>> getRideChatMessages(String rideId) async {
    final data = await _getAuth('/api/rides/${Uri.encodeComponent(rideId)}/chat');
    final list = data['messages'];
    if (list is List) {
      return list.whereType<Map<String, dynamic>>().toList();
    }
    return [];
  }

  /// Confirm journey participation for a ride.
  Future<void> confirmJourney(String rideId, String realName, String contact) async {
    await _postJsonAuth(
      '/api/rides/${Uri.encodeComponent(rideId)}/confirm_journey',
      {'real_name': realName, 'contact': contact},
    );
  }

  // ── Direct Messages ───────────────────────────────────────────────────────

  /// List DM conversations, optionally filtering by [search] (username).
  Future<List<Map<String, dynamic>>> getDmConversations({String? search}) async {
    final query = <String, String>{};
    if (search != null && search.isNotEmpty) query['search'] = search;
    final data = await _getAuth('/api/dm/conversations', query.isNotEmpty ? query : null);
    final list = data['conversations'] ?? data;
    if (list is List) {
      return list.whereType<Map<String, dynamic>>().toList();
    }
    return [];
  }

  /// Fetch messages for a DM conversation.
  Future<List<Map<String, dynamic>>> getDmMessages(String convId) async {
    final data =
        await _getAuth('/api/dm/conversations/${Uri.encodeComponent(convId)}/messages');
    final list = data['messages'];
    if (list is List) {
      return list.whereType<Map<String, dynamic>>().toList();
    }
    return [];
  }

  /// Send a DM message.
  Future<Map<String, dynamic>> sendDmMessage({
    required String convId,
    required String content,
    String? replyToId,
  }) async {
    return _postJsonAuth('/api/dm/messages', {
      'conv_id': convId,
      'content': content,
      if (replyToId != null) 'reply_to_id': replyToId,
    });
  }

  /// Start or retrieve a DM conversation with another user.
  Future<Map<String, dynamic>> startDmConversation(String otherUserId) async {
    return _postJsonAuth('/api/dm/conversations', {'other_user_id': otherUserId});
  }

  /// Mark a DM conversation as read.
  Future<void> markDmRead(String convId) async {
    try {
      await _postJsonAuth(
          '/api/dm/conversations/${Uri.encodeComponent(convId)}/read', {});
    } catch (_) {}
  }

  /// Fetch users that the current user has previously chatted with (DM contacts).
  Future<List<Map<String, dynamic>>> getDmContacts() async {
    try {
      final data = await _getAuth('/api/dm/contacts');
      final list = data['contacts'] ?? data;
      if (list is List) {
        return list.whereType<Map<String, dynamic>>().toList();
      }
    } catch (_) {}
    return [];
  }

  /// Returns the full URL for a user's avatar given a relative or absolute path.
  String avatarUrl(String? path) {
    if (path == null || path.isEmpty) return '';
    if (path.startsWith('http')) return path;
    return '$_base$path';
  }
}
