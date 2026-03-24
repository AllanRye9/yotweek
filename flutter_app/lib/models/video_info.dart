/// Represents lightweight video / audio information returned by the
/// ``/video_info`` endpoint.
class VideoInfo {
  final String title;
  final String? thumbnail;
  final String? uploader;
  final int? duration;
  final int? viewCount;
  final String? description;
  final List<VideoFormat> formats;

  const VideoInfo({
    required this.title,
    this.thumbnail,
    this.uploader,
    this.duration,
    this.viewCount,
    this.description,
    required this.formats,
  });

  factory VideoInfo.fromJson(Map<String, dynamic> json) {
    final rawFormats = json['formats'];
    final formats = rawFormats is List
        ? rawFormats
            .whereType<Map<String, dynamic>>()
            .map(VideoFormat.fromJson)
            .toList()
        : <VideoFormat>[];
    return VideoInfo(
      title: (json['title'] as String?) ?? 'Unknown',
      thumbnail: json['thumbnail'] as String?,
      uploader: json['uploader'] as String?,
      duration: json['duration'] as int?,
      viewCount: json['view_count'] as int?,
      description: json['description'] as String?,
      formats: formats,
    );
  }

  /// Format duration seconds as H:MM:SS or M:SS.
  String get durationFormatted {
    if (duration == null) return '';
    final h = duration! ~/ 3600;
    final m = (duration! % 3600) ~/ 60;
    final s = duration! % 60;
    if (h > 0) {
      return '$h:${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
    }
    return '$m:${s.toString().padLeft(2, '0')}';
  }
}

/// A single available format/quality for a video.
class VideoFormat {
  final String formatId;
  final String? label;
  final String? ext;
  final String? formatNote;
  final String? filesizeHr;

  const VideoFormat({
    required this.formatId,
    this.label,
    this.ext,
    this.formatNote,
    this.filesizeHr,
  });

  factory VideoFormat.fromJson(Map<String, dynamic> json) {
    return VideoFormat(
      formatId: (json['format_id'] ?? json['value'] ?? '').toString(),
      label: json['label'] as String?,
      ext: json['ext'] as String?,
      formatNote: json['format_note'] as String?,
      filesizeHr: json['filesize_hr'] as String?,
    );
  }

  /// Human-readable label shown in dropdowns.
  String get displayLabel {
    final parts = <String>[];
    if (label != null && label!.isNotEmpty) return label!;
    if (formatNote != null) parts.add(formatNote!);
    if (ext != null) parts.add(ext!.toUpperCase());
    if (filesizeHr != null) parts.add('— $filesizeHr');
    return parts.isNotEmpty ? parts.join(' ') : formatId;
  }
}
