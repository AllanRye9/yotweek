import 'dart:async';
import 'package:flutter/foundation.dart';
import '../models/download_status.dart';
import '../services/api_service.dart';

/// State for a single tracked download.
class DownloadEntry {
  final String id;
  DownloadStatus status;

  DownloadEntry({required this.id, required this.status});
}

/// Manages all active and recently-completed downloads.
///
/// Polls ``/status/{id}`` for each active download every 1 second and
/// notifies listeners on every change.
class DownloadsProvider extends ChangeNotifier {
  final Map<String, DownloadEntry> _entries = {};
  Timer? _pollTimer;

  List<DownloadEntry> get all => _entries.values.toList();
  List<DownloadEntry> get active =>
      _entries.values.where((e) => e.status.isActive).toList();
  List<DownloadEntry> get completed =>
      _entries.values.where((e) => e.status.isDone).toList();
  List<DownloadEntry> get failed =>
      _entries.values.where((e) => e.status.isError).toList();

  int get activeCount => active.length;

  /// Begin tracking a new download returned by the API.
  void add(String id, String title) {
    _entries[id] = DownloadEntry(
      id: id,
      status: DownloadStatus(
        id: id,
        state: 'queued',
        title: title,
        progress: 0.0,
      ),
    );
    notifyListeners();
    _startPolling();
  }

  /// Remove a completed/failed download from the list.
  void remove(String id) {
    _entries.remove(id);
    notifyListeners();
    if (_entries.values.every((e) => !e.status.isActive)) {
      _stopPolling();
    }
  }

  void _startPolling() {
    _pollTimer ??= Timer.periodic(const Duration(seconds: 1), (_) => _poll());
  }

  void _stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  Future<void> _poll() async {
    final activeIds = _entries.values
        .where((e) => e.status.isActive)
        .map((e) => e.id)
        .toList();

    if (activeIds.isEmpty) {
      _stopPolling();
      return;
    }

    for (final id in activeIds) {
      try {
        final status = await ApiService.instance.getStatus(id);
        final entry = _entries[id];
        if (entry != null) {
          entry.status = status;
          notifyListeners();
        }
      } catch (_) {
        // Network blip – ignore and retry next cycle.
      }
    }
  }

  Future<void> cancel(String id) async {
    try {
      await ApiService.instance.cancelDownload(id);
      final entry = _entries[id];
      if (entry != null) {
        entry.status = entry.status.copyWith(state: 'error', error: 'Cancelled');
        notifyListeners();
      }
    } catch (_) {}
  }

  @override
  void dispose() {
    _stopPolling();
    super.dispose();
  }
}
