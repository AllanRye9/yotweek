import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
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

  Future<Map<String, dynamic>> _postJson(String path, Map<String, dynamic> body) async {
    final res = await http.post(
      _uri(path),
      headers: {'Content-Type': 'application/json'},
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
}
