import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api_service.dart';

/// Displays the ride-share board.
///
/// Features:
/// - Status chips (open / taken / cancelled) with distinct colours
/// - Pull-to-refresh
/// - Animated "Driver Nearby" banner with sound-like visual pulse
/// - Mark-as-Taken / Cancel controls for the poster
class RideShareScreen extends StatefulWidget {
  const RideShareScreen({super.key});

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
    Color bg;
    Color fg;
    String label;
    switch (status) {
      case 'taken':
        bg = const Color(0xFF78350F);
        fg = const Color(0xFFFBBF24);
        label = '🟡 Taken';
        break;
      case 'cancelled':
        bg = const Color(0xFF450A0A);
        fg = const Color(0xFFF87171);
        label = '🔴 Cancelled';
        break;
      default: // open
        bg = const Color(0xFF052E16);
        fg = const Color(0xFF4ADE80);
        label = '🟢 Open';
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ride Share'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadRides,
            tooltip: 'Refresh',
          ),
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
                                'No rides posted yet.\nBe the first!',
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
  final Future<void> Function(String) onTake;
  final Future<void> Function(String) onCancel;
  final Widget Function(String) statusChipBuilder;

  const _RideCard({
    required this.ride,
    required this.onTake,
    required this.onCancel,
    required this.statusChipBuilder,
  });

  Color _cardBorder(String status) {
    switch (status) {
      case 'taken':     return const Color(0xFFF59E0B).withOpacity(0.4);
      case 'cancelled': return const Color(0xFFF87171).withOpacity(0.25);
      default:          return Colors.grey.withOpacity(0.25);
    }
  }

  Color _cardBg(String status) {
    switch (status) {
      case 'taken':     return const Color(0xFF451A03).withOpacity(0.18);
      case 'cancelled': return const Color(0xFF450A0A).withOpacity(0.12);
      default:          return Colors.white.withOpacity(0.04);
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

  @override
  Widget build(BuildContext context) {
    final status = (ride['status'] as String?) ?? 'open';
    final rideId = ride['ride_id'] as String;
    final isCancelled = status == 'cancelled';
    final contact = _extractContact(ride['notes'] as String?);
    final noteText = _extractNotes(ride['notes'] as String?);

    return AnimatedOpacity(
      opacity: isCancelled ? 0.55 : 1.0,
      duration: const Duration(milliseconds: 300),
      child: Container(
        decoration: BoxDecoration(
          color: _cardBg(status),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: _cardBorder(status), width: 1.2),
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
                    '${ride['origin']}  →  ${ride['destination']}',
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
            // Action buttons (only for open rides — poster would need auth)
            if (status == 'open') ...[
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFFFBBF24),
                      side: const BorderSide(color: Color(0xFFFBBF24), width: 0.8),
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
                      foregroundColor: const Color(0xFFF87171),
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    onPressed: () => onCancel(rideId),
                    child: const Text('Cancel', style: TextStyle(fontSize: 12)),
                  ),
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
