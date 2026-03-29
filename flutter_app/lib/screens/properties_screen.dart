import 'package:flutter/material.dart';
import '../services/api_service.dart';

/// Real estate property discovery screen.
///
/// Features:
/// - Staggered animated list of property cards
/// - Pull-to-refresh
/// - Status filter chips (All / Active / Sold / Rented)
/// - Tap a card to see a detail bottom sheet
/// - Responsive layout: single-column on mobile, two-column on wider screens
class PropertiesScreen extends StatefulWidget {
  const PropertiesScreen({super.key});

  @override
  State<PropertiesScreen> createState() => _PropertiesScreenState();
}

class _PropertiesScreenState extends State<PropertiesScreen>
    with SingleTickerProviderStateMixin {
  List<Map<String, dynamic>> _properties = [];
  bool _loading = false;
  String? _error;
  String _statusFilter = ''; // '' = all

  static const _statusOptions = ['', 'active', 'sold', 'rented'];
  static const _statusLabels  = ['All', 'Active', 'Sold', 'Rented'];

  late final AnimationController _listCtrl;

  @override
  void initState() {
    super.initState();
    _listCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _loadProperties();
  }

  @override
  void dispose() {
    _listCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadProperties() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await ApiService.instance
          .listProperties(status: _statusFilter.isEmpty ? null : _statusFilter);
      if (mounted) {
        setState(() {
          _properties = data;
          _loading = false;
        });
        _listCtrl
          ..reset()
          ..forward();
      }
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  // ── Colours ────────────────────────────────────────────────────────────────

  static Color _statusColor(String? s) {
    switch (s) {
      case 'active': return const Color(0xFF22C55E);
      case 'sold':   return const Color(0xFFEF4444);
      case 'rented': return const Color(0xFFF59E0B);
      default:       return const Color(0xFF6B7280);
    }
  }

  static Color _statusBg(String? s) {
    switch (s) {
      case 'active': return const Color(0xFF052E16);
      case 'sold':   return const Color(0xFF450A0A);
      case 'rented': return const Color(0xFF451A03);
      default:       return const Color(0xFF1F2937);
    }
  }

  static String _statusLabel(String? s) {
    switch (s) {
      case 'active': return 'Active';
      case 'sold':   return 'Sold';
      case 'rented': return 'Rented';
      default:       return s ?? '—';
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  static String _formatPrice(dynamic price) {
    if (price == null) return 'POA';
    return '£${(price as num).toStringAsFixed(0).replaceAllMapped(
          RegExp(r'\B(?=(\d{3})+(?!\d))'),
          (m) => ',',
        )}/mo';
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final screenWidth = MediaQuery.sizeOf(context).width;
    final twoColumns  = screenWidth >= 600;

    return Scaffold(
      appBar: AppBar(
        title: const Text('🏠 Property Discovery'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
            onPressed: _loadProperties,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Filter chips ──────────────────────────────────────────────────
          _FilterBar(
            selected: _statusFilter,
            options: _statusOptions,
            labels: _statusLabels,
            onSelected: (v) {
              setState(() => _statusFilter = v);
              _loadProperties();
            },
          ),

          // ── Content ───────────────────────────────────────────────────────
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? _ErrorView(error: _error!, onRetry: _loadProperties)
                    : RefreshIndicator(
                        onRefresh: _loadProperties,
                        child: _properties.isEmpty
                            ? _EmptyView(filter: _statusFilter)
                            : twoColumns
                                ? _TwoColumnGrid(
                                    properties: _properties,
                                    ctrl: _listCtrl,
                                    onTap: _showPropertyDetail,
                                  )
                                : _PropertyList(
                                    properties: _properties,
                                    ctrl: _listCtrl,
                                    onTap: _showPropertyDetail,
                                  ),
                      ),
          ),
        ],
      ),
    );
  }

  void _showPropertyDetail(Map<String, dynamic> prop) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _PropertyDetailSheet(property: prop),
    );
  }
}

// ── Filter bar ────────────────────────────────────────────────────────────────

class _FilterBar extends StatelessWidget {
  final String selected;
  final List<String> options;
  final List<String> labels;
  final void Function(String) onSelected;

  const _FilterBar({
    required this.selected,
    required this.options,
    required this.labels,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        itemCount: options.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (_, i) {
          final isActive = options[i] == selected;
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              child: FilterChip(
                label: Text(labels[i]),
                selected: isActive,
                onSelected: (_) => onSelected(options[i]),
                showCheckmark: false,
              ),
            ),
          );
        },
      ),
    );
  }
}

// ── Single-column list ────────────────────────────────────────────────────────

class _PropertyList extends StatelessWidget {
  final List<Map<String, dynamic>> properties;
  final AnimationController ctrl;
  final void Function(Map<String, dynamic>) onTap;

  const _PropertyList({
    required this.properties,
    required this.ctrl,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.all(12),
      itemCount: properties.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (_, i) => _AnimatedPropertyCard(
        property: properties[i],
        index: i,
        ctrl: ctrl,
        onTap: onTap,
      ),
    );
  }
}

// ── Two-column grid ───────────────────────────────────────────────────────────

class _TwoColumnGrid extends StatelessWidget {
  final List<Map<String, dynamic>> properties;
  final AnimationController ctrl;
  final void Function(Map<String, dynamic>) onTap;

  const _TwoColumnGrid({
    required this.properties,
    required this.ctrl,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      padding: const EdgeInsets.all(12),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 10,
        crossAxisSpacing: 10,
        childAspectRatio: 0.72,
      ),
      itemCount: properties.length,
      itemBuilder: (_, i) => _AnimatedPropertyCard(
        property: properties[i],
        index: i,
        ctrl: ctrl,
        onTap: onTap,
      ),
    );
  }
}

// ── Animated property card ────────────────────────────────────────────────────

class _AnimatedPropertyCard extends StatelessWidget {
  final Map<String, dynamic> property;
  final int index;
  final AnimationController ctrl;
  final void Function(Map<String, dynamic>) onTap;

  const _AnimatedPropertyCard({
    required this.property,
    required this.index,
    required this.ctrl,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final delay = (index * 0.07).clamp(0.0, 0.7);
    final animation = CurvedAnimation(
      parent: ctrl,
      curve: Interval(delay, (delay + 0.35).clamp(0.0, 1.0),
          curve: Curves.easeOut),
    );

    return FadeTransition(
      opacity: animation,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0, 0.18),
          end: Offset.zero,
        ).animate(animation),
        child: _PropertyCard(property: property, onTap: onTap),
      ),
    );
  }
}

// ── Property card ─────────────────────────────────────────────────────────────

class _PropertyCard extends StatefulWidget {
  final Map<String, dynamic> property;
  final void Function(Map<String, dynamic>) onTap;

  const _PropertyCard({required this.property, required this.onTap});

  @override
  State<_PropertyCard> createState() => _PropertyCardState();
}

class _PropertyCardState extends State<_PropertyCard> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final p      = widget.property;
    final status = p['status'] as String? ?? 'active';
    final color  = _PropertiesScreenState._statusColor(status);
    final bg     = _PropertiesScreenState._statusBg(status);

    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit:  (_) => setState(() => _hovered = false),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        transform: Matrix4.translationValues(0, _hovered ? -3 : 0, 0),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: color.withOpacity(0.35), width: 1.2),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(_hovered ? 0.45 : 0.25),
              blurRadius: _hovered ? 16 : 8,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(14),
          child: InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: () => widget.onTap(p),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Cover image
                ClipRRect(
                  borderRadius:
                      const BorderRadius.vertical(top: Radius.circular(14)),
                  child: Stack(
                    children: [
                      Container(
                        height: 130,
                        width: double.infinity,
                        color: Colors.blueGrey.shade800,
                        child: p['cover_image'] != null
                            ? Image.network(
                                p['cover_image'] as String,
                                fit: BoxFit.cover,
                                errorBuilder: (_, __, ___) =>
                                    const Center(
                                        child: Text('🏠',
                                            style: TextStyle(fontSize: 36))),
                              )
                            : const Center(
                                child: Text('🏠',
                                    style: TextStyle(fontSize: 36))),
                      ),
                      // Status badge
                      Positioned(
                        top: 8,
                        right: 8,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: bg,
                            borderRadius: BorderRadius.circular(99),
                            border: Border.all(
                                color: color.withOpacity(0.5), width: 1),
                          ),
                          child: Text(
                            _PropertiesScreenState._statusLabel(status),
                            style: TextStyle(
                              color: color,
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                      // Price badge
                      Positioned(
                        bottom: 8,
                        left: 8,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: Colors.black.withOpacity(0.72),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            _PropertiesScreenState._formatPrice(p['price']),
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                // Info
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        (p['title'] as String?) ?? 'Property',
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 14,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (p['address'] != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          '📍 ${p['address']}',
                          style: TextStyle(
                              color: Colors.grey.shade400, fontSize: 11),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                      const SizedBox(height: 8),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          style: FilledButton.styleFrom(
                            backgroundColor: const Color(0xFF3B82F6),
                            padding: const EdgeInsets.symmetric(vertical: 6),
                            minimumSize: Size.zero,
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(8),
                            ),
                          ),
                          onPressed: () => widget.onTap(p),
                          child: const Text('View Details →',
                              style: TextStyle(fontSize: 12)),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ── Property detail bottom sheet ──────────────────────────────────────────────

class _PropertyDetailSheet extends StatelessWidget {
  final Map<String, dynamic> property;

  const _PropertyDetailSheet({required this.property});

  @override
  Widget build(BuildContext context) {
    final p      = property;
    final status = p['status'] as String? ?? 'active';
    final color  = _PropertiesScreenState._statusColor(status);

    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      minChildSize: 0.35,
      maxChildSize: 0.92,
      builder: (_, scrollCtrl) => Container(
        decoration: const BoxDecoration(
          color: Color(0xFF111827),
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: ListView(
          controller: scrollCtrl,
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
          children: [
            // Handle
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 12, bottom: 16),
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.grey.shade700,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            // Cover
            if (p['cover_image'] != null)
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.network(
                  p['cover_image'] as String,
                  height: 200,
                  width: double.infinity,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) =>
                      const SizedBox(height: 80, child: Center(child: Text('🏠', style: TextStyle(fontSize: 40)))),
                ),
              ),
            const SizedBox(height: 16),
            // Status + price row
            Row(
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(99),
                    border: Border.all(color: color.withOpacity(0.5)),
                  ),
                  child: Text(
                    _PropertiesScreenState._statusLabel(status),
                    style: TextStyle(
                        color: color,
                        fontWeight: FontWeight.w700,
                        fontSize: 13),
                  ),
                ),
                const Spacer(),
                Text(
                  _PropertiesScreenState._formatPrice(p['price']),
                  style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 18,
                      color: Colors.white),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              (p['title'] as String?) ?? 'Property',
              style: const TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 20,
                  color: Colors.white),
            ),
            if (p['address'] != null) ...[
              const SizedBox(height: 6),
              Text(
                '📍 ${p['address']}',
                style:
                    TextStyle(color: Colors.grey.shade400, fontSize: 13),
              ),
            ],
            if (p['description'] != null) ...[
              const SizedBox(height: 12),
              Text(
                (p['description'] as String),
                style: TextStyle(
                    color: Colors.grey.shade300,
                    fontSize: 13,
                    height: 1.55),
              ),
            ],
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                icon: const Icon(Icons.chat_bubble_outline, size: 16),
                label: const Text('Contact Agent'),
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF3B82F6),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10)),
                ),
                onPressed: () => Navigator.pop(context),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Empty / error views ───────────────────────────────────────────────────────

class _EmptyView extends StatelessWidget {
  final String filter;
  const _EmptyView({required this.filter});

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        const SizedBox(height: 100),
        const Center(child: Text('🏠', style: TextStyle(fontSize: 48))),
        const SizedBox(height: 16),
        Center(
          child: Text(
            filter.isEmpty
                ? 'No properties listed yet.'
                : 'No ${filter} properties found.',
            style: const TextStyle(color: Colors.grey),
            textAlign: TextAlign.center,
          ),
        ),
      ],
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String error;
  final VoidCallback onRetry;
  const _ErrorView({required this.error, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: Colors.red, size: 40),
            const SizedBox(height: 12),
            Text(error,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.red)),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}
