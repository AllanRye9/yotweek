import 'package:flutter/material.dart';
import 'ride_share_screen.dart';
import 'travel_companions_screen.dart';
import '../features/ride_sharing/airport_pickup/booking_screen.dart';

/// Top-level hub for the three transport modules.
///
/// Implements spec §2:
///   "Primary Module Tabs: Ride / Companion / Airport — visually distinct
///   active state with underline indicator."
///
/// The gold underline tab indicator is applied by [ClassicalTheme.tabBarTheme].
/// Each tab owns its own scroll position and state via [AutomaticKeepAliveClientMixin]
/// in the individual screens.
class RidesHubScreen extends StatefulWidget {
  /// Callback to navigate back to the main home tab.
  final VoidCallback? onGoHome;

  /// Authenticated user profile map from `/api/auth/me`.
  final Map<String, dynamic>? currentUser;

  const RidesHubScreen({
    super.key,
    this.onGoHome,
    this.currentUser,
  });

  @override
  State<RidesHubScreen> createState() => _RidesHubScreenState();
}

class _RidesHubScreenState extends State<RidesHubScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabCtrl;

  static const _tabs = [
    _TabSpec(
      icon:  Icons.directions_car_rounded,
      label: 'Ride',
      semanticLabel: 'Ride sharing module',
    ),
    _TabSpec(
      icon:  Icons.people_alt_rounded,
      label: 'Companion',
      semanticLabel: 'Travel companions module',
    ),
    _TabSpec(
      icon:  Icons.flight_takeoff_rounded,
      label: 'Airport',
      semanticLabel: 'Airport booking module',
    ),
  ];

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: _tabs.length, vsync: this);
  }

  @override
  void dispose() {
    _tabCtrl.dispose();
    super.dispose();
  }

  // Placeholder text adapts to the active tab (spec §2 – context-aware search bar).
  String get _searchHint {
    switch (_tabCtrl.index) {
      case 0:  return 'Search pickup / drop-off locations…';
      case 1:  return 'Search travel companions by route…';
      default: return 'Search flights, airports…';
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          tooltip: 'Back',
          onPressed: widget.onGoHome ?? () => Navigator.maybePop(context),
        ),
        // Context-aware search bar (spec §2)
        title: AnimatedBuilder(
          animation: _tabCtrl,
          builder: (_, __) => _SearchBar(hint: _searchHint),
        ),
        bottom: TabBar(
          controller: _tabCtrl,
          onTap: (_) => setState(() {}), // rebuild for context-aware search
          tabs: _tabs
              .map(
                (t) => Tab(
                  icon: Icon(t.icon, semanticLabel: t.semanticLabel),
                  text: t.label,
                ),
              )
              .toList(),
        ),
      ),
      body: TabBarView(
        controller: _tabCtrl,
        children: [
          // ── Tab 0: Ride Sharing ──────────────────────────────────────────
          RideShareScreen(
            currentUser: widget.currentUser,
            onGoHome: widget.onGoHome,
            hideAppBar: true,
          ),

          // ── Tab 1: Travel Companions ─────────────────────────────────────
          TravelCompanionsScreen(
            currentUser: widget.currentUser,
          ),

          // ── Tab 2: Airport Booking ───────────────────────────────────────
          const BookingScreen(hideAppBar: true),
        ],
      ),
    );
  }
}

// ── Context-aware search bar (spec §2) ────────────────────────────────────────

class _SearchBar extends StatelessWidget {
  final String hint;

  const _SearchBar({required this.hint});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return GestureDetector(
      onTap: () {
        // In a full implementation this would open a search overlay.
        // For now it serves as a visual placeholder per the design spec.
      },
      child: Container(
        height: 36,
        decoration: BoxDecoration(
          color: cs.onPrimary.withOpacity(0.15),
          borderRadius: BorderRadius.circular(8),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 12),
        alignment: Alignment.centerLeft,
        child: Row(
          children: [
            Icon(Icons.search, size: 16, color: cs.onPrimary.withOpacity(0.8)),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                hint,
                style: TextStyle(
                  color: cs.onPrimary.withOpacity(0.75),
                  fontSize: 13,
                  overflow: TextOverflow.ellipsis,
                ),
                maxLines: 1,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Helper ────────────────────────────────────────────────────────────────────

class _TabSpec {
  final IconData icon;
  final String   label;
  final String   semanticLabel;

  const _TabSpec({
    required this.icon,
    required this.label,
    required this.semanticLabel,
  });
}
