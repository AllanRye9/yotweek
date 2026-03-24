import 'package:flutter/material.dart';
import 'package:flutter_rating_bar/flutter_rating_bar.dart';
import '../models/review.dart';
import '../services/api_service.dart';

class ReviewsScreen extends StatefulWidget {
  const ReviewsScreen({super.key});

  @override
  State<ReviewsScreen> createState() => _ReviewsScreenState();
}

class _ReviewsScreenState extends State<ReviewsScreen> {
  List<Review> _reviews = [];
  bool _loading = false;
  String? _error;
  bool _canSubmit = false;
  bool _showForm = false;

  // Submit form state
  int _rating = 5;
  final _commentCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  bool _submitting = false;
  String? _submitError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _commentCtrl.dispose();
    _nameCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        ApiService.instance.getReviews(),
        ApiService.instance.canSubmitReview(),
      ]);
      setState(() {
        _reviews = results[0] as List<Review>;
        _canSubmit = results[1] as bool;
      });
    } catch (e) {
      setState(() => _error = e is ApiException ? e.message : e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _submit() async {
    if (_commentCtrl.text.trim().isEmpty) {
      setState(() => _submitError = 'Please write a comment.');
      return;
    }
    setState(() {
      _submitting = true;
      _submitError = null;
    });
    try {
      await ApiService.instance.submitReview(
        rating: _rating,
        comment: _commentCtrl.text.trim(),
        name: _nameCtrl.text.trim().isNotEmpty
            ? _nameCtrl.text.trim()
            : 'Anonymous',
      );
      setState(() {
        _showForm = false;
        _commentCtrl.clear();
        _nameCtrl.clear();
        _rating = 5;
      });
      await _load();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Review submitted – thank you!')));
    } catch (e) {
      setState(
          () => _submitError = e is ApiException ? e.message : e.toString());
    } finally {
      setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_error!, style: const TextStyle(color: Colors.red)),
                      const SizedBox(height: 12),
                      ElevatedButton(
                          onPressed: _load, child: const Text('Retry')),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: CustomScrollView(
                    slivers: [
                      // Submit review form
                      if (_canSubmit || _showForm)
                        SliverToBoxAdapter(
                          child: AnimatedCrossFade(
                            duration: const Duration(milliseconds: 300),
                            crossFadeState: _showForm
                                ? CrossFadeState.showSecond
                                : CrossFadeState.showFirst,
                            firstChild: Padding(
                              padding: const EdgeInsets.all(16),
                              child: OutlinedButton.icon(
                                icon: const Icon(Icons.rate_review),
                                label: const Text('Write a Review'),
                                onPressed: () =>
                                    setState(() => _showForm = true),
                              ),
                            ),
                            secondChild: _buildSubmitForm(theme),
                          ),
                        ),

                      // Reviews list header
                      SliverToBoxAdapter(
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                          child: Text(
                            '${_reviews.length} Review${_reviews.length == 1 ? '' : 's'}',
                            style: theme.textTheme.titleSmall
                                ?.copyWith(fontWeight: FontWeight.bold),
                          ),
                        ),
                      ),

                      if (_reviews.isEmpty)
                        SliverFillRemaining(
                          hasScrollBody: false,
                          child: Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.reviews_outlined,
                                    size: 60, color: Colors.grey.shade300),
                                const SizedBox(height: 12),
                                Text('No reviews yet',
                                    style: TextStyle(
                                        color: Colors.grey.shade500)),
                              ],
                            ),
                          ),
                        )
                      else
                        SliverList(
                          delegate: SliverChildBuilderDelegate(
                            (ctx, i) => _buildReviewCard(_reviews[i], theme),
                            childCount: _reviews.length,
                          ),
                        ),
                    ],
                  ),
                ),
    );
  }

  Widget _buildSubmitForm(ThemeData theme) {
    return Card(
      margin: const EdgeInsets.all(16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Write a Review',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),

            // Star rating
            Center(
              child: RatingBar.builder(
                initialRating: _rating.toDouble(),
                minRating: 1,
                maxRating: 5,
                allowHalfRating: false,
                itemPadding:
                    const EdgeInsets.symmetric(horizontal: 4),
                itemBuilder: (_, __) =>
                    const Icon(Icons.star, color: Colors.amber),
                onRatingUpdate: (r) => setState(() => _rating = r.toInt()),
              ),
            ),
            const SizedBox(height: 12),

            TextField(
              controller: _nameCtrl,
              decoration: const InputDecoration(
                labelText: 'Your name (optional)',
                prefixIcon: Icon(Icons.person_outline),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),

            TextField(
              controller: _commentCtrl,
              decoration: const InputDecoration(
                labelText: 'Your review *',
                hintText: 'Share your experience…',
                border: OutlineInputBorder(),
                alignLabelWithHint: true,
              ),
              maxLines: 4,
              minLines: 3,
            ),

            if (_submitError != null) ...[
              const SizedBox(height: 8),
              Text(_submitError!,
                  style: TextStyle(color: Colors.red.shade700, fontSize: 13)),
            ],

            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => setState(() {
                    _showForm = false;
                    _submitError = null;
                  }),
                  child: const Text('Cancel'),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: _submitting ? null : _submit,
                  child: _submitting
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Submit'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildReviewCard(Review review, ThemeData theme) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 18,
                  backgroundColor: theme.colorScheme.primary.withOpacity(0.15),
                  child: Text(
                    review.name.isNotEmpty ? review.name[0].toUpperCase() : '?',
                    style: TextStyle(
                        color: theme.colorScheme.primary,
                        fontWeight: FontWeight.bold),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(review.name,
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                      Row(
                        children: List.generate(
                          5,
                          (i) => Icon(
                            i < review.rating ? Icons.star : Icons.star_border,
                            size: 14,
                            color: Colors.amber,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                if (review.createdAt != null)
                  Text(
                    _formatDate(review.createdAt!),
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: Colors.grey.shade400),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Text(review.comment, style: theme.textTheme.bodyMedium),
          ],
        ),
      ),
    );
  }

  String _formatDate(String iso) {
    try {
      final dt = DateTime.parse(iso).toLocal();
      return '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')}';
    } catch (_) {
      return iso;
    }
  }
}
