/// A single user review returned by ``GET /reviews``.
class Review {
  final int rating; // 1-5
  final String comment;
  final String name;
  final String? createdAt;

  const Review({
    required this.rating,
    required this.comment,
    required this.name,
    this.createdAt,
  });

  factory Review.fromJson(Map<String, dynamic> json) {
    return Review(
      rating: (json['rating'] as num?)?.toInt() ?? 0,
      comment: (json['comment'] as String?) ?? '',
      name: (json['name'] as String?) ?? 'Anonymous',
      createdAt: json['created_at'] as String?,
    );
  }
}
