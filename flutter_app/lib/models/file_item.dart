/// A file in the downloads folder, returned by ``GET /files``.
class FileItem {
  final String name;
  final String? sizeHr;
  final int? sizeBytes;
  final String? modifiedAt;

  const FileItem({
    required this.name,
    this.sizeHr,
    this.sizeBytes,
    this.modifiedAt,
  });

  factory FileItem.fromJson(Map<String, dynamic> json) {
    return FileItem(
      name: (json['name'] as String?) ?? '',
      sizeHr: json['size_hr'] as String?,
      sizeBytes: json['size'] as int?,
      modifiedAt: json['modified_at'] as String?,
    );
  }

  /// Extension without dot, lower-case (e.g. "mp4", "pdf").
  String get extension {
    final dot = name.lastIndexOf('.');
    if (dot < 0 || dot == name.length - 1) return '';
    return name.substring(dot + 1).toLowerCase();
  }
}
