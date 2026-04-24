import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../config/classical_theme.dart';
import '../services/api_service.dart';
import 'dm_chat_screen.dart';

/// Travel Companions discovery feed.
///
/// Features per design spec §3-B:
/// - Classical card-grid layout with traveller avatar, route, dates, bio,
///   compatibility score, and "Connect" action.
/// - Collapsible advanced filters: gender preference, age range, language,
///   interests, verification status, trip purpose.
/// - Sort options: Most Compatible / Nearest Departure / Highest Rated.
/// - Companion profile view (full-screen) with two-column desktop layout.
/// - "Propose Travel" primary action triggering a DM chat with template.
/// - Empty-state illustration with guidance text.
class TravelCompanionsScreen extends StatefulWidget {
  final Map<String, dynamic>? currentUser;

  const TravelCompanionsScreen({super.key, this.currentUser});

  @override
  State<TravelCompanionsScreen> createState() => _TravelCompanionsScreenState();
}

class _TravelCompanionsScreenState extends State<TravelCompanionsScreen> {
  // ── State ──────────────────────────────────────────────────────────────────

  List<Map<String, dynamic>> _companions = [];
  bool _loading = false;
  String? _error;

  // Filters
  bool _filtersExpanded = false;
  String _sortBy = 'compatible';
  String _genderPref = 'any';
  RangeValues _ageRange = const RangeValues(18, 65);
  String _language = '';
  bool _verifiedOnly = false;
  final Set<String> _interests = {};

  static const _sortOptions = [
    _SortOption('compatible', Icons.star_rate_rounded, 'Most Compatible'),
    _SortOption('departure',  Icons.event,             'Nearest Departure'),
    _SortOption('rated',      Icons.thumb_up_rounded,  'Highest Rated'),
  ];

  static const _allInterests = [
    'Adventure', 'Culture', 'Food', 'Photography',
    'Nature', 'Nightlife', 'Sports', 'Budget',
  ];

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  @override
  void initState() {
    super.initState();
    _loadCompanions();
  }

  Future<void> _loadCompanions() async {
    setState(() { _loading = true; _error = null; });
    try {
      final raw = await ApiService.instance.listCompanions(
        sortBy: _sortBy,
        genderPref: _genderPref == 'any' ? null : _genderPref,
        ageMin: _ageRange.start.round(),
        ageMax: _ageRange.end.round(),
        language: _language.isEmpty ? null : _language,
        verifiedOnly: _verifiedOnly,
        interests: _interests.isEmpty ? null : _interests.toList(),
      );
      if (mounted) setState(() { _companions = raw; _loading = false; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  Future<void> _openProfile(Map<String, dynamic> companion) async {
    await Navigator.push<void>(
      context,
      MaterialPageRoute(
        builder: (_) => _CompanionProfileScreen(
          companion: companion,
          currentUser: widget.currentUser,
        ),
      ),
    );
  }

  Future<void> _connect(Map<String, dynamic> companion) async {
    final userId = (companion['user_id'] ?? '').toString();
    if (userId.isEmpty) {
      _showError('Companion info not available.');
      return;
    }
    if (widget.currentUser == null) {
      _showError('Please sign in to connect.');
      return;
    }
    try {
      final result = await ApiService.instance.startDmConversation(userId);
      final conv       = result['conv']       as Map<String, dynamic>? ?? {};
      final otherUser  = result['other_user'] as Map<String, dynamic>? ?? {
        'user_id':    userId,
        'name':       companion['name'] ?? 'Traveller',
        'username':   '',
        'avatar_url': companion['avatar_url'] ?? '',
      };
      if (mounted) {
        Navigator.push<void>(
          context,
          MaterialPageRoute(
            builder: (_) => DmChatScreen(
              conversation: {...conv, 'other_user': otherUser},
              currentUser:  widget.currentUser,
            ),
          ),
        );
      }
    } on ApiException catch (e) {
      _showError(e.message);
    } catch (e) {
      _showError(e.toString());
    }
  }

  void _showError(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg),
        backgroundColor: ClassicalTheme.error,
      ),
    );
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      body: Column(
        children: [
          _SortBar(
            selected: _sortBy,
            options: _sortOptions,
            onSelected: (v) { setState(() => _sortBy = v); _loadCompanions(); },
          ),
          _FilterPanel(
            expanded:     _filtersExpanded,
            genderPref:   _genderPref,
            ageRange:     _ageRange,
            language:     _language,
            verifiedOnly: _verifiedOnly,
            interests:    _interests,
            allInterests: _allInterests,
            onToggle: () => setState(() => _filtersExpanded = !_filtersExpanded),
            onGenderChanged:   (v) => setState(() => _genderPref = v),
            onAgeRangeChanged: (v) => setState(() => _ageRange   = v),
            onLanguageChanged: (v) => setState(() => _language   = v),
            onVerifiedChanged: (v) => setState(() => _verifiedOnly = v),
            onInterestToggled: (v) {
              setState(() {
                _interests.contains(v)
                    ? _interests.remove(v)
                    : _interests.add(v);
              });
            },
            onApply: _loadCompanions,
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? _ErrorView(message: _error!, onRetry: _loadCompanions)
                    : _companions.isEmpty
                        ? _EmptyState(
                            onAction: _loadCompanions,
                          )
                        : RefreshIndicator(
                            onRefresh: _loadCompanions,
                            color: cs.secondary,
                            child: _CompanionGrid(
                              companions:  _companions,
                              onCardTap:   _openProfile,
                              onConnect:   _connect,
                              currentUser: widget.currentUser,
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}

// ── Sort bar ──────────────────────────────────────────────────────────────────

class _SortOption {
  final String value;
  final IconData icon;
  final String label;

  const _SortOption(this.value, this.icon, this.label);
}

class _SortBar extends StatelessWidget {
  final String selected;
  final List<_SortOption> options;
  final ValueChanged<String> onSelected;

  const _SortBar({
    required this.selected,
    required this.options,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      color: cs.surface,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: options.map((opt) {
            final active = opt.value == selected;
            return Padding(
              padding: const EdgeInsets.only(right: 8),
              child: FilterChip(
                label: Text(opt.label),
                avatar: Icon(opt.icon, size: 15,
                    color: active ? cs.onPrimary : cs.primary),
                selected: active,
                onSelected: (_) => onSelected(opt.value),
                selectedColor: cs.primary,
                labelStyle: TextStyle(
                  color: active ? cs.onPrimary : cs.onSurface,
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                ),
                showCheckmark: false,
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
              ),
            );
          }).toList(),
        ),
      ),
    );
  }
}

// ── Filter panel ──────────────────────────────────────────────────────────────

class _FilterPanel extends StatelessWidget {
  final bool            expanded;
  final String          genderPref;
  final RangeValues     ageRange;
  final String          language;
  final bool            verifiedOnly;
  final Set<String>     interests;
  final List<String>    allInterests;
  final VoidCallback    onToggle;
  final ValueChanged<String>      onGenderChanged;
  final ValueChanged<RangeValues> onAgeRangeChanged;
  final ValueChanged<String>      onLanguageChanged;
  final ValueChanged<bool>        onVerifiedChanged;
  final ValueChanged<String>      onInterestToggled;
  final VoidCallback              onApply;

  const _FilterPanel({
    required this.expanded,
    required this.genderPref,
    required this.ageRange,
    required this.language,
    required this.verifiedOnly,
    required this.interests,
    required this.allInterests,
    required this.onToggle,
    required this.onGenderChanged,
    required this.onAgeRangeChanged,
    required this.onLanguageChanged,
    required this.onVerifiedChanged,
    required this.onInterestToggled,
    required this.onApply,
  });

  @override
  Widget build(BuildContext context) {
    final cs  = Theme.of(context).colorScheme;
    final tt  = Theme.of(context).textTheme;
    return Container(
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest,
        border: Border(bottom: BorderSide(color: cs.outlineVariant)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Toggle header – minimum 48×48 touch target
          InkWell(
            onTap: onToggle,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                children: [
                  Icon(Icons.tune_rounded, size: 18, color: cs.primary),
                  const SizedBox(width: 8),
                  Text('Filters', style: tt.labelLarge?.copyWith(color: cs.primary)),
                  const Spacer(),
                  Icon(
                    expanded ? Icons.expand_less : Icons.expand_more,
                    color: cs.primary,
                  ),
                ],
              ),
            ),
          ),
          AnimatedCrossFade(
            duration: const Duration(milliseconds: 250),
            crossFadeState: expanded
                ? CrossFadeState.showFirst
                : CrossFadeState.showSecond,
            firstChild: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Divider(height: 1),
                  const SizedBox(height: 12),
                  // Gender preference
                  Text('Gender preference', style: tt.labelMedium),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 8,
                    children: ['any', 'male', 'female', 'non-binary'].map((g) {
                      final sel = genderPref == g;
                      return ChoiceChip(
                        label: Text(g == 'any' ? 'Any' : _capitalize(g)),
                        selected: sel,
                        onSelected: (_) => onGenderChanged(g),
                        selectedColor: cs.primary,
                        labelStyle: TextStyle(
                          color: sel ? cs.onPrimary : cs.onSurface,
                          fontSize: 13,
                        ),
                        showCheckmark: false,
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 12),
                  // Age range
                  Row(
                    children: [
                      Text('Age range', style: tt.labelMedium),
                      const Spacer(),
                      Text(
                        '${ageRange.start.round()} – ${ageRange.end.round()}',
                        style: tt.labelMedium?.copyWith(color: cs.secondary),
                      ),
                    ],
                  ),
                  RangeSlider(
                    values: ageRange,
                    min:  18,
                    max:  80,
                    divisions: 62,
                    activeColor: cs.secondary,
                    inactiveColor: cs.outlineVariant,
                    onChanged: onAgeRangeChanged,
                  ),
                  const SizedBox(height: 8),
                  // Language & verification
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          decoration: InputDecoration(
                            labelText: 'Language',
                            prefixIcon: const Icon(Icons.language, size: 18),
                            isDense: true,
                          ),
                          onChanged: onLanguageChanged,
                        ),
                      ),
                      const SizedBox(width: 16),
                      Row(
                        children: [
                          Switch(
                            value: verifiedOnly,
                            onChanged: onVerifiedChanged,
                            activeColor: cs.secondary,
                          ),
                          Text('Verified only', style: tt.labelMedium),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  // Interests
                  Text('Interests', style: tt.labelMedium),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    children: allInterests.map((i) {
                      final sel = interests.contains(i);
                      return FilterChip(
                        label: Text(i),
                        selected: sel,
                        onSelected: (_) => onInterestToggled(i),
                        selectedColor: cs.secondaryContainer,
                        labelStyle: TextStyle(
                          color: sel ? cs.onSecondaryContainer : cs.onSurface,
                          fontSize: 12,
                        ),
                        showCheckmark: false,
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 12),
                  // Apply button
                  Align(
                    alignment: Alignment.centerRight,
                    child: ElevatedButton.icon(
                      onPressed: onApply,
                      icon: const Icon(Icons.search, size: 16),
                      label: const Text('Apply Filters'),
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                        textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            secondChild: const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }

  static String _capitalize(String s) =>
      s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);
}

// ── Companion grid ────────────────────────────────────────────────────────────

class _CompanionGrid extends StatelessWidget {
  final List<Map<String, dynamic>> companions;
  final ValueChanged<Map<String, dynamic>> onCardTap;
  final ValueChanged<Map<String, dynamic>> onConnect;
  final Map<String, dynamic>? currentUser;

  const _CompanionGrid({
    required this.companions,
    required this.onCardTap,
    required this.onConnect,
    this.currentUser,
  });

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final crossCount = width >= 1024 ? 3 : (width >= 600 ? 2 : 1);
    return GridView.builder(
      padding: const EdgeInsets.all(16),
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: crossCount,
        crossAxisSpacing: 12,
        mainAxisSpacing: 12,
        childAspectRatio: crossCount == 1 ? 3.2 : 0.85,
      ),
      itemCount: companions.length,
      itemBuilder: (_, i) => _CompanionCard(
        companion:   companions[i],
        onTap:       () => onCardTap(companions[i]),
        onConnect:   () => onConnect(companions[i]),
        currentUser: currentUser,
      ),
    );
  }
}

// ── Companion card ────────────────────────────────────────────────────────────

class _CompanionCard extends StatelessWidget {
  final Map<String, dynamic> companion;
  final VoidCallback onTap;
  final VoidCallback onConnect;
  final Map<String, dynamic>? currentUser;

  const _CompanionCard({
    required this.companion,
    required this.onTap,
    required this.onConnect,
    this.currentUser,
  });

  @override
  Widget build(BuildContext context) {
    final cs      = Theme.of(context).colorScheme;
    final tt      = Theme.of(context).textTheme;
    final width   = MediaQuery.sizeOf(context).width;
    final isMobile = width < 600;

    final name       = (companion['name']          ?? 'Traveller').toString();
    final route      = (companion['route']         ?? '').toString();
    final dates      = (companion['dates']         ?? '').toString();
    final bio        = (companion['bio']            ?? '').toString();
    final avatarUrl  = (companion['avatar_url']    ?? '').toString();
    final verified   = companion['verified'] == true;
    final score      = (companion['compatibility_score'] as num?)?.toInt();
    final isSelf     = currentUser != null &&
        currentUser!['user_id'].toString() == companion['user_id'].toString();

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: isMobile
            ? _buildHorizontal(context, cs, tt, name, route, dates, bio,
                avatarUrl, verified, score, isSelf)
            : _buildVertical(context, cs, tt, name, route, dates, bio,
                avatarUrl, verified, score, isSelf),
      ),
    );
  }

  // ── Vertical layout (tablet / desktop grid) ───────────────────────────────

  Widget _buildVertical(
    BuildContext context,
    ColorScheme cs,
    TextTheme tt,
    String name, String route, String dates, String bio,
    String avatarUrl, bool verified, int? score, bool isSelf,
  ) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Avatar + name row
          Row(
            children: [
              _Avatar(name: name, avatarUrl: avatarUrl, radius: 28),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(name,
                              style: tt.headlineSmall,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis),
                        ),
                        if (verified) ...[
                          const SizedBox(width: 4),
                          Tooltip(
                            message: 'Verified traveller',
                            child: Icon(Icons.verified_rounded,
                                size: 16, color: cs.secondary),
                          ),
                        ],
                      ],
                    ),
                    if (score != null)
                      _CompatibilityBadge(score: score, cs: cs),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          // Route
          if (route.isNotEmpty)
            _InfoRow(icon: Icons.route_rounded, text: route, cs: cs),
          // Dates
          if (dates.isNotEmpty)
            _InfoRow(icon: Icons.calendar_today, text: dates, cs: cs),
          // Bio
          if (bio.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              bio,
              style: tt.bodySmall,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          const Spacer(),
          // Connect button
          if (!isSelf)
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: onConnect,
                icon: const Icon(Icons.connect_without_contact, size: 16),
                label: const Text('Connect'),
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                ),
              ),
            ),
        ],
      ),
    );
  }

  // ── Horizontal layout (mobile list) ──────────────────────────────────────

  Widget _buildHorizontal(
    BuildContext context,
    ColorScheme cs,
    TextTheme tt,
    String name, String route, String dates, String bio,
    String avatarUrl, bool verified, int? score, bool isSelf,
  ) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Avatar(name: name, avatarUrl: avatarUrl, radius: 26),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(name,
                          style: tt.headlineSmall,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis),
                    ),
                    if (verified) ...[
                      const SizedBox(width: 4),
                      Icon(Icons.verified_rounded,
                          size: 14, color: cs.secondary),
                    ],
                    if (score != null) ...[
                      const SizedBox(width: 8),
                      _CompatibilityBadge(score: score, cs: cs, compact: true),
                    ],
                  ],
                ),
                if (route.isNotEmpty)
                  _InfoRow(icon: Icons.route_rounded, text: route, cs: cs),
                if (dates.isNotEmpty)
                  _InfoRow(icon: Icons.calendar_today, text: dates, cs: cs),
                if (bio.isNotEmpty)
                  Text(bio,
                      style: tt.bodySmall,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
          if (!isSelf)
            Padding(
              padding: const EdgeInsets.only(left: 8, top: 2),
              child: ElevatedButton(
                onPressed: onConnect,
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  minimumSize: Size.zero,
                  textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                ),
                child: const Text('Connect'),
              ),
            ),
        ],
      ),
    );
  }
}

// ── Companion profile screen ──────────────────────────────────────────────────

class _CompanionProfileScreen extends StatelessWidget {
  final Map<String, dynamic> companion;
  final Map<String, dynamic>? currentUser;

  const _CompanionProfileScreen({
    required this.companion,
    this.currentUser,
  });

  Future<void> _propose(BuildContext context) async {
    final userId = (companion['user_id'] ?? '').toString();
    if (userId.isEmpty) return;
    if (currentUser == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please sign in to propose travel.')),
      );
      return;
    }
    try {
      final result = await ApiService.instance.startDmConversation(userId);
      final conv      = result['conv']       as Map<String, dynamic>? ?? {};
      final otherUser = result['other_user'] as Map<String, dynamic>? ?? {
        'user_id':    userId,
        'name':       companion['name'] ?? 'Traveller',
        'username':   '',
        'avatar_url': companion['avatar_url'] ?? '',
      };
      if (context.mounted) {
        Navigator.push<void>(
          context,
          MaterialPageRoute(
            builder: (_) => DmChatScreen(
              conversation: {...conv, 'other_user': otherUser},
              currentUser:  currentUser,
            ),
          ),
        );
      }
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message), backgroundColor: ClassicalTheme.error),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: ClassicalTheme.error),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs   = Theme.of(context).colorScheme;
    final tt   = Theme.of(context).textTheme;
    final width = MediaQuery.sizeOf(context).width;
    final isDesktop = width >= 1024;

    final name      = (companion['name']       ?? 'Traveller').toString();
    final bio       = (companion['bio']        ?? '').toString();
    final avatarUrl = (companion['avatar_url'] ?? '').toString();
    final verified  = companion['verified'] == true;
    final route     = (companion['route']      ?? '').toString();
    final dates     = (companion['dates']      ?? '').toString();
    final score     = (companion['compatibility_score'] as num?)?.toInt();
    final interests = (companion['interests'] as List?)
            ?.map((e) => e.toString())
            .toList() ??
        [];
    final reviews = (companion['reviews'] as List?)
            ?.cast<Map<String, dynamic>>() ??
        [];
    final isSelf = currentUser != null &&
        currentUser!['user_id'].toString() == companion['user_id'].toString();

    Widget leftPanel = _ProfileLeft(
      companion: companion,
      name: name, bio: bio, avatarUrl: avatarUrl,
      verified: verified, score: score, interests: interests,
      cs: cs, tt: tt,
    );

    Widget rightPanel = _ProfileRight(
      route: route, dates: dates, reviews: reviews,
      cs: cs, tt: tt,
    );

    Widget body = isDesktop
        ? Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Flexible(flex: 2, child: leftPanel),
              VerticalDivider(width: 1, color: cs.outlineVariant),
              Flexible(flex: 3, child: SingleChildScrollView(child: rightPanel)),
            ],
          )
        : SingleChildScrollView(
            child: Column(children: [leftPanel, const Divider(), rightPanel]),
          );

    return Scaffold(
      appBar: AppBar(
        title: Text(name),
      ),
      body: body,
      bottomNavigationBar: isSelf
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () => _propose(context),
                    icon: const Icon(Icons.send_rounded),
                    label: const Text('Propose Travel'),
                  ),
                ),
              ),
            ),
    );
  }
}

class _ProfileLeft extends StatelessWidget {
  final Map<String, dynamic> companion;
  final String name, bio, avatarUrl;
  final bool verified;
  final int? score;
  final List<String> interests;
  final ColorScheme cs;
  final TextTheme tt;

  const _ProfileLeft({
    required this.companion,
    required this.name, required this.bio, required this.avatarUrl,
    required this.verified, required this.score, required this.interests,
    required this.cs, required this.tt,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(child: _Avatar(name: name, avatarUrl: avatarUrl, radius: 48)),
          const SizedBox(height: 12),
          Center(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(name, style: tt.headlineLarge),
                if (verified) ...[
                  const SizedBox(width: 6),
                  Tooltip(
                    message: 'Verified traveller',
                    child: Icon(Icons.verified_rounded,
                        size: 20, color: cs.secondary),
                  ),
                ],
              ],
            ),
          ),
          if (score != null) ...[
            const SizedBox(height: 6),
            Center(child: _CompatibilityBadge(score: score!, cs: cs)),
          ],
          const SizedBox(height: 16),
          if (bio.isNotEmpty) ...[
            Text('About', style: tt.headlineSmall),
            const SizedBox(height: 6),
            Text(bio, style: tt.bodyLarge),
            const SizedBox(height: 16),
          ],
          if (interests.isNotEmpty) ...[
            Text('Interests', style: tt.headlineSmall),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: interests.map((i) => Chip(
                label: Text(i),
                backgroundColor: cs.secondaryContainer,
                labelStyle: TextStyle(
                  color: cs.onSecondaryContainer, fontSize: 12),
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 0),
              )).toList(),
            ),
          ],
          // Verification badges (spec §9)
          const SizedBox(height: 16),
          _VerificationBadges(companion: companion, verified: verified, cs: cs, tt: tt),
        ],
      ),
    );
  }
}

class _ProfileRight extends StatelessWidget {
  final String route, dates;
  final List<Map<String, dynamic>> reviews;
  final ColorScheme cs;
  final TextTheme tt;

  const _ProfileRight({
    required this.route, required this.dates,
    required this.reviews, required this.cs, required this.tt,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Trip Details', style: tt.headlineMedium),
          const SizedBox(height: 12),
          if (route.isNotEmpty)
            _InfoRow(icon: Icons.route_rounded, text: route, cs: cs),
          if (dates.isNotEmpty)
            _InfoRow(icon: Icons.calendar_today, text: dates, cs: cs),
          const SizedBox(height: 20),
          Text('Reviews', style: tt.headlineMedium),
          const SizedBox(height: 8),
          if (reviews.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text('No reviews yet.', style: tt.bodySmall),
            )
          else
            ...reviews.map((r) => _ReviewTile(review: r, tt: tt, cs: cs)),
        ],
      ),
    );
  }
}

// ── Verification badges (spec §9) ─────────────────────────────────────────────

class _VerificationBadges extends StatelessWidget {
  final Map<String, dynamic> companion;
  final bool verified;
  final ColorScheme cs;
  final TextTheme tt;

  const _VerificationBadges({
    required this.companion,
    required this.verified,
    required this.cs,
    required this.tt,
  });

  @override
  Widget build(BuildContext context) {
    if (!verified) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Verification', style: tt.headlineSmall),
        const SizedBox(height: 8),
        _BadgeRow(
          icon: Icons.shield_rounded,
          label: 'ID Verified',
          tooltip: 'Government ID verified',
          cs: cs,
          tt: tt,
        ),
        _BadgeRow(
          icon: Icons.phone_rounded,
          label: 'Phone Verified',
          tooltip: 'Phone number confirmed',
          cs: cs,
          tt: tt,
        ),
        _BadgeRow(
          icon: Icons.email_rounded,
          label: 'Email Verified',
          tooltip: 'Email address confirmed',
          cs: cs,
          tt: tt,
        ),
      ],
    );
  }
}

class _BadgeRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String tooltip;
  final ColorScheme cs;
  final TextTheme tt;

  const _BadgeRow({
    required this.icon, required this.label,
    required this.tooltip, required this.cs, required this.tt,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Tooltip(
        message: tooltip,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: cs.secondary),
            const SizedBox(width: 6),
            Text(label, style: tt.bodySmall?.copyWith(color: cs.secondary)),
          ],
        ),
      ),
    );
  }
}

// ── Review tile ───────────────────────────────────────────────────────────────

class _ReviewTile extends StatelessWidget {
  final Map<String, dynamic> review;
  final TextTheme tt;
  final ColorScheme cs;

  const _ReviewTile({required this.review, required this.tt, required this.cs});

  @override
  Widget build(BuildContext context) {
    final author  = (review['author']  ?? 'Traveller').toString();
    final comment = (review['comment'] ?? '').toString();
    final rating  = (review['rating']  as num?)?.toInt() ?? 0;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: cs.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: cs.outlineVariant),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(author,
                    style: tt.labelLarge?.copyWith(color: cs.onSurface)),
                const Spacer(),
                Row(
                  children: List.generate(
                    5,
                    (i) => Icon(
                      i < rating ? Icons.star_rounded : Icons.star_outline_rounded,
                      size: 14,
                      color: cs.secondary,
                    ),
                  ),
                ),
              ],
            ),
            if (comment.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(comment, style: tt.bodySmall),
            ],
          ],
        ),
      ),
    );
  }
}

// ── Empty state ───────────────────────────────────────────────────────────────

class _EmptyState extends StatelessWidget {
  final VoidCallback onAction;

  const _EmptyState({required this.onAction});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.people_alt_outlined,
                size: 72, color: cs.outlineVariant),
            const SizedBox(height: 16),
            Text(
              'No travel companions found',
              style: tt.headlineMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              'Adjust your filters or check back later to find fellow travellers sharing your route.',
              style: tt.bodyMedium?.copyWith(color: cs.outline),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: onAction,
              icon: const Icon(Icons.refresh),
              label: const Text('Refresh'),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Error view ────────────────────────────────────────────────────────────────

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final tt = Theme.of(context).textTheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 48, color: cs.error),
            const SizedBox(height: 12),
            Text(message,
                style: tt.bodyMedium?.copyWith(color: cs.error),
                textAlign: TextAlign.center),
            const SizedBox(height: 20),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Try Again'),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Shared small widgets ──────────────────────────────────────────────────────

class _Avatar extends StatelessWidget {
  final String name;
  final String avatarUrl;
  final double radius;

  const _Avatar({
    required this.name,
    required this.avatarUrl,
    required this.radius,
  });

  static const _palette = [
    ClassicalTheme.navy,
    Color(0xFF7C3AED),
    Color(0xFF0F766E),
    Color(0xFFC2410C),
    Color(0xFF15803D),
  ];

  @override
  Widget build(BuildContext context) {
    if (avatarUrl.isNotEmpty) {
      return CachedNetworkImage(
        imageUrl: avatarUrl,
        imageBuilder: (_, img) =>
            CircleAvatar(radius: radius, backgroundImage: img),
        errorWidget: (_, __, ___) => _letter(),
        placeholder: (_, __) => _letter(),
      );
    }
    return _letter();
  }

  Widget _letter() {
    final idx = name.isEmpty ? 0 : name.codeUnitAt(0) % _palette.length;
    return CircleAvatar(
      radius: radius,
      backgroundColor: _palette[idx],
      child: Text(
        name.isEmpty ? '?' : name[0].toUpperCase(),
        style: TextStyle(
          color: Colors.white,
          fontSize: radius * 0.65,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String text;
  final ColorScheme cs;

  const _InfoRow({required this.icon, required this.text, required this.cs});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          Icon(icon, size: 14, color: cs.outline),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              text,
              style: TextStyle(fontSize: 13, color: cs.outline),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

class _CompatibilityBadge extends StatelessWidget {
  final int score;
  final ColorScheme cs;
  final bool compact;

  const _CompatibilityBadge({
    required this.score,
    required this.cs,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 6 : 8,
        vertical:   compact ? 2 : 3,
      ),
      decoration: BoxDecoration(
        color: cs.secondaryContainer,
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: cs.secondary.withOpacity(0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.star_rounded, size: compact ? 11 : 13, color: cs.secondary),
          const SizedBox(width: 3),
          Text(
            '$score% match',
            style: TextStyle(
              fontSize: compact ? 10 : 12,
              fontWeight: FontWeight.w700,
              color: cs.secondary,
              letterSpacing: 0.2,
            ),
          ),
        ],
      ),
    );
  }
}
