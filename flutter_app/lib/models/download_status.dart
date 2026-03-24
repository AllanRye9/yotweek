/// Progress / result snapshot for a single download, polled from
/// ``GET /status/{download_id}``.
class DownloadStatus {
  final String id;
  final String state; // queued | downloading | merging | done | error
  final String title;
  final double progress; // 0.0 – 1.0
  final String? speed;
  final String? eta;
  final String? filename;
  final String? error;
  final String? filesizeHr;

  const DownloadStatus({
    required this.id,
    required this.state,
    required this.title,
    required this.progress,
    this.speed,
    this.eta,
    this.filename,
    this.error,
    this.filesizeHr,
  });

  factory DownloadStatus.fromJson(String id, Map<String, dynamic> json) {
    final rawProgress = json['progress'];
    double progress = 0.0;
    if (rawProgress is num) {
      progress = rawProgress.toDouble().clamp(0.0, 100.0) / 100.0;
    }
    return DownloadStatus(
      id: id,
      state: (json['state'] as String?) ?? 'queued',
      title: (json['title'] as String?) ?? 'Downloading…',
      progress: progress,
      speed: json['speed'] as String?,
      eta: json['eta'] as String?,
      filename: json['filename'] as String?,
      error: json['error'] as String?,
      filesizeHr: json['file_size_hr'] as String?,
    );
  }

  bool get isDone => state == 'done';
  bool get isError => state == 'error';
  bool get isActive => !isDone && !isError;

  DownloadStatus copyWith({String? state, double? progress, String? speed, String? eta, String? filename, String? error}) {
    return DownloadStatus(
      id: id,
      state: state ?? this.state,
      title: title,
      progress: progress ?? this.progress,
      speed: speed ?? this.speed,
      eta: eta ?? this.eta,
      filename: filename ?? this.filename,
      error: error ?? this.error,
      filesizeHr: filesizeHr,
    );
  }
}
