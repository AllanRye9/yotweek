import 'dart:async';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../config/classical_theme.dart';
import '../services/api_service.dart';
import 'dm_chat_screen.dart';
import 'profile_screen.dart';

/// Displays the ride-share board.
///
/// Features:
/// - Status chips (open / taken / cancelled) with distinct colours
/// - Pull-to-refresh
/// - Animated "Driver Nearby" banner with sound-like visual pulse
/// - Mark-as-Taken / Cancel controls for the poster
/// - Home button to navigate back to home tab
/// - Profile picture that navigates to the profile page
///
/// Parameters:
/// - [onGoHome]: callback invoked when the Home button is tapped.
///   Typically switches the parent [HomeScreen] to tab 0.
/// - [currentUser]: the currently logged-in user map (from `/api/auth/me`).
///   Used to show the correct profile avatar and to distinguish drivers
///   from passengers on each ride card.
class RideShareScreen extends StatefulWidget {
  final VoidCallback? onGoHome;
  final Map<String, dynamic>? currentUser;

  /// When [true] the screen omits its own [AppBar] because it is hosted
  /// inside a parent scaffold that already provides one (e.g. [RidesHubScreen]).
  final bool hideAppBar;

  const RideShareScreen({
    super.key,
    this.onGoHome,
    this.currentUser,
    this.hideAppBar = false,
  });

  @override
  State<RideShareScreen> createState() => _RideShareScreenState();
}

class _RideShareScreenState extends State<RideShareScreen>
    with TickerProviderStateMixin {
  List<Map<String, dynamic>> _rides = [];
  bool _loading = false;
  String? _error;

  // Driver-nearby banner animation
  late final AnimationController _bannerCtrl;
  late final Animation<double> _bannerPulse;
  bool _showBanner = false;

  @override
  void initState() {
    super.initState();
    _bannerCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    )..addStatusListener((s) {
        if (s == AnimationStatus.completed) _bannerCtrl.reverse();
        if (s == AnimationStatus.dismissed && _showBanner) _bannerCtrl.forward();
      });
    _bannerPulse = Tween<double>(begin: 1.0, end: 1.06).animate(
      CurvedAnimation(parent: _bannerCtrl, curve: Curves.easeInOut),
    );
    _loadRides();
  }

  @override
  void dispose() {
    _bannerCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadRides() async {
    setState(() { _loading = true; _error = null; });
    try {
      final rides = await ApiService.instance.listRides();
      if (mounted) setState(() { _rides = rides; _loading = false; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _markTaken(String rideId) async {
    try {
      await ApiService.instance.takeRide(rideId);
      setState(() {
        _rides = _rides.map((r) =>
          r['ride_id'] == rideId ? {...r, 'status': 'taken'} : r,
        ).toList();
      });
      _showSuccessSnack('Ride marked as taken ✅');
    } on ApiException catch (e) {
      _showErrorSnack(e.message);
    }
  }

  Future<void> _cancelRide(String rideId) async {
    try {
      await ApiService.instance.cancelRide(rideId);
      setState(() {
        _rides = _rides.map((r) =>
          r['ride_id'] == rideId ? {...r, 'status': 'cancelled'} : r,
        ).toList();
      });
      _showSuccessSnack('Ride cancelled');
    } on ApiException catch (e) {
      _showErrorSnack(e.message);
    }
  }

  void _showSuccessSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: Colors.green.shade700),
    );
  }

  void _showErrorSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: Colors.red.shade700),
    );
  }

  // ── UI helpers ───────────────────────────────────────────────────────────

  Widget _statusChip(String status) {
    final cs = Theme.of(context).colorScheme;
    Color bg;
    Color fg;
    String label;
    switch (status) {
      case 'taken':
        bg = ClassicalTheme.gold.withOpacity(0.15);
        fg = ClassicalTheme.gold;
        label = '● Taken';
        break;
      case 'cancelled':
        bg = cs.error.withOpacity(0.12);
        fg = cs.error;
        label = '● Cancelled';
        break;
      default: // open
        bg = const Color(0xFF166534).withOpacity(0.15);
        fg = const Color(0xFF166534);
        label = '● Open';
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: fg.withOpacity(0.4)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: fg,
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.4,
        ),
      ),
    );
  }

  Widget _buildAvatar() {
    final user = widget.currentUser;
    if (user == null) {
      return IconButton(
        icon: const Icon(Icons.person_outline),
        tooltip: 'Profile',
        onPressed: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const ProfileScreen()),
        ),
      );
    }
    final name       = (user['name'] ?? 'U').toString();
    final avatarPath = (user['avatar_url'] ?? '').toString();
    Widget avatar;
    if (avatarPath.isNotEmpty) {
      final url = ApiService.instance.avatarUrl(avatarPath);
      avatar = CachedNetworkImage(
        imageUrl: url,
        imageBuilder: (_, img) => CircleAvatar(radius: 16, backgroundImage: img),
        errorWidget:  (_, __, ___) => _letterAvatar(name),
        placeholder:  (_, __)      => _letterAvatar(name),
      );
    } else {
      avatar = _letterAvatar(name);
    }
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: GestureDetector(
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const ProfileScreen()),
        ),
        child: avatar,
      ),
    );
  }

  Widget _letterAvatar(String name) {
    const palette = [
      Color(0xFF1D4ED8),
      Color(0xFF7C3AED),
      Color(0xFF0F766E),
      Color(0xFFC2410C),
      Color(0xFF15803D),
    ];
    final idx = name.isEmpty ? 0 : name.codeUnitAt(0) % palette.length;
    return CircleAvatar(
      radius: 16,
      backgroundColor: palette[idx],
      child: Text(
        name.isEmpty ? '?' : name[0].toUpperCase(),
        style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: widget.hideAppBar
          ? null
          : AppBar(
        title: const Text('✈️ Airport Pickup Service'),
        leading: IconButton(
          icon: const Icon(Icons.home_outlined),
          tooltip: 'Home',
          onPressed: widget.onGoHome ?? () => Navigator.maybePop(context),
        ),
        actions: [
          _buildAvatar(),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.error_outline, color: Colors.red, size: 40),
                        const SizedBox(height: 12),
                        Text(_error!, textAlign: TextAlign.center,
                            style: const TextStyle(color: Colors.red)),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          onPressed: _loadRides,
                          child: const Text('Retry'),
                        ),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadRides,
                  child: _rides.isEmpty
                      ? ListView(
                          children: const [
                            SizedBox(height: 120),
                            Center(
                              child: Text(
                                'No airport pickups posted yet.\nBe the first!',
                                textAlign: TextAlign.center,
                                style: TextStyle(color: Colors.grey),
                              ),
                            ),
                          ],
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.all(12),
                          itemCount: _rides.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (_, i) => _RideCard(
                            ride: _rides[i],
                            currentUser: widget.currentUser,
                            onTake: _markTaken,
                            onCancel: _cancelRide,
                            statusChipBuilder: _statusChip,
                          ),
                        ),
                ),
    );
  }
}

// ── Ride card ───────────────────────────────────────────────────────────────

class _RideCard extends StatelessWidget {
  final Map<String, dynamic> ride;
  final Map<String, dynamic>? currentUser;
  final Future<void> Function(String) onTake;
  final Future<void> Function(String) onCancel;
  final Widget Function(String) statusChipBuilder;

  const _RideCard({
    required this.ride,
    required this.onTake,
    required this.onCancel,
    required this.statusChipBuilder,
    this.currentUser,
  });

  Color _cardBorder(String status, ColorScheme cs) {
    switch (status) {
      case 'taken':     return ClassicalTheme.gold.withOpacity(0.5);
      case 'cancelled': return cs.error.withOpacity(0.35);
      default:          return cs.outlineVariant;
    }
  }

  Color _cardBg(String status, ColorScheme cs) {
    switch (status) {
      case 'taken':     return ClassicalTheme.gold.withOpacity(0.08);
      case 'cancelled': return cs.error.withOpacity(0.06);
      default:          return cs.surface;
    }
  }

  String _formatDate(String? raw) {
    if (raw == null) return '—';
    try {
      final dt = DateTime.parse(raw).toLocal();
      return '${dt.day}/${dt.month}/${dt.year}  ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return raw;
    }
  }

  String? _extractContact(String? notes) {
    if (notes == null) return null;
    final idx = notes.indexOf('Contact:');
    if (idx == -1) return null;
    return notes.substring(idx + 8).trim();
  }

  String? _extractNotes(String? notes) {
    if (notes == null) return null;
    final idx = notes.indexOf('| Contact:');
    if (idx != -1) return notes.substring(0, idx).trim();
    if (notes.startsWith('Contact:')) return null;
    return notes;
  }

  // Returns true if the current user is the driver of this ride
  bool _isDriver(Map<String, dynamic>? user) {
    if (user == null) return false;
    final myId = (user['user_id'] ?? '').toString();
    final driverId = (ride['user_id'] ?? '').toString();
    return myId.isNotEmpty && myId == driverId;
  }

  Future<void> _openBookingDm(BuildContext context) async {
    final driverUserId = (ride['user_id'] ?? '').toString();
    if (driverUserId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Driver info not available.')),
      );
      return;
    }
    try {
      final result = await ApiService.instance.startDmConversation(driverUserId);
      final conv = result['conv'] as Map<String, dynamic>? ?? {};
      final otherUser = result['other_user'] as Map<String, dynamic>? ??
          {
            'user_id': driverUserId,
            'name': (ride['driver_name'] ?? 'Driver').toString(),
            'username': '',
            'avatar_url': '',
          };
      final conversation = {
        ...conv,
        'other_user': otherUser,
      };
      if (context.mounted) {
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => DmChatScreen(
              conversation: conversation,
              currentUser: currentUser,
            ),
          ),
        );
      }
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message), backgroundColor: Colors.red.shade700),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: Colors.red.shade700),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs      = Theme.of(context).colorScheme;
    final status = (ride['status'] as String?) ?? 'open';
    final rideId = ride['ride_id'] as String;
    final isCancelled = status == 'cancelled';
    final contact = _extractContact(ride['notes'] as String?);
    final noteText = _extractNotes(ride['notes'] as String?);
    final fare = ride['fare'];
    final fareText = fare != null ? '\$${(fare as num).toStringAsFixed(2)}' : null;
    final isDriver = _isDriver(currentUser);

    return AnimatedOpacity(
      opacity: isCancelled ? 0.55 : 1.0,
      duration: const Duration(milliseconds: 300),
      child: Container(
        decoration: BoxDecoration(
          color: _cardBg(status, cs),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: _cardBorder(status, cs), width: 1.2),
        ),
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Status chip + route
            Row(
              children: [
                statusChipBuilder(status),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '✈️ ${ride['origin']}  →  ${ride['destination']}',
                    style: const TextStyle(
                        fontWeight: FontWeight.w700, fontSize: 13),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            // Details row
            Wrap(
              spacing: 12,
              runSpacing: 4,
              children: [
                _detail(Icons.access_time, _formatDate(ride['departure'] as String?)),
                _detail(Icons.event_seat, '${ride['seats']} seat(s)'),
                _detail(Icons.person_outline, ride['driver_name'] as String? ?? '—'),
                if (fareText != null)
                  _detail(Icons.attach_money, fareText),
              ],
            ),
            if (noteText != null && noteText.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text('"$noteText"',
                  style: const TextStyle(
                      color: Colors.grey, fontSize: 12, fontStyle: FontStyle.italic)),
            ],
            if (contact != null) ...[
              const SizedBox(height: 4),
              Row(
                children: [
                  const Icon(Icons.phone, size: 13, color: Color(0xFF60A5FA)),
                  const SizedBox(width: 4),
                  Text(contact,
                      style: const TextStyle(
                          color: Color(0xFF60A5FA), fontSize: 12)),
                ],
              ),
            ],
            // Action buttons for open rides
            if (status == 'open') ...[
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  // Passengers see a Book button; driver sees Mark Taken / Cancel
                  if (!isDriver) ...[
                    ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        textStyle: const TextStyle(fontSize: 12),
                      ),
                      icon: const Icon(Icons.chat_bubble_outline, size: 14),
                      label: const Text('Book'),
                      onPressed: () => _openBookingDm(context),
                    ),
                  ] else ...[
                    OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: ClassicalTheme.gold,
                        side: BorderSide(color: ClassicalTheme.gold, width: 0.8),
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      icon: const Icon(Icons.check_circle_outline, size: 14),
                      label: const Text('Mark Taken', style: TextStyle(fontSize: 12)),
                      onPressed: () => onTake(rideId),
                    ),
                    const SizedBox(width: 8),
                    TextButton(
                      style: TextButton.styleFrom(
                        foregroundColor: cs.error,
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      onPressed: () => onCancel(rideId),
                      child: const Text('Cancel', style: TextStyle(fontSize: 12)),
                    ),
                  ],
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _detail(IconData icon, String text) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 13, color: Colors.grey),
      const SizedBox(width: 4),
      Text(text, style: const TextStyle(color: Colors.grey, fontSize: 12)),
    ],
  );
}
