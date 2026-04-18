import 'dart:async';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../services/api_service.dart';
import 'login_screen.dart';
import 'ride_chat_screen.dart';
import 'dm_chat_screen.dart';

/// Inbox screen with two tabs:
///
/// 1. **Rides** (default) — shows ride-chat conversations for rides the user
///    has participated in.
/// 2. **Direct Messages** — shows DM conversations with a search bar for
///    filtering by username.
///
/// Both tabs display profile pictures, usernames, last-message previews,
/// timestamps and unread-count badges.
class InboxScreen extends StatefulWidget {
  const InboxScreen({super.key});

  @override
  State<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends State<InboxScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabCtrl;

  // Current user (null = unknown, may be unauthenticated)
  Map<String, dynamic>? _currentUser;
  bool _userLoading = true;

  // Rides tab
  List<Map<String, dynamic>> _rideInbox = [];
  bool   _rideLoading = false;
  String? _rideError;

  // DM tab
  List<Map<String, dynamic>> _dmConvs  = [];
  bool   _dmLoading   = false;
  String? _dmError;
  String  _dmSearch   = '';
  Timer?  _searchDebounce;
  final   _searchCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    // Rides is tab 0 (default); DM is tab 1
    _tabCtrl = TabController(length: 2, vsync: this, initialIndex: 0);
    _tabCtrl.addListener(_onTabChanged);
    _initUser();
  }

  @override
  void dispose() {
    _tabCtrl
      ..removeListener(_onTabChanged)
      ..dispose();
    _searchCtrl.dispose();
    _searchDebounce?.cancel();
    super.dispose();
  }

  // ── Initialisation ────────────────────────────────────────────────────────

  Future<void> _initUser() async {
    await ApiService.instance.loadCookies();
    if (!mounted) return;
    try {
      final user = await ApiService.instance.getCurrentUser();
      if (mounted) {
        setState(() { _currentUser = user; _userLoading = false; });
        if (user != null) {
          // Auto-open most recent ride chat when the screen first loads
          _loadRideInbox(autoOpen: true);
        }
      }
    } catch (_) {
      if (mounted) setState(() => _userLoading = false);
    }
  }

  void _onTabChanged() {
    if (_tabCtrl.indexIsChanging) return;
    if (_tabCtrl.index == 0 && _rideInbox.isEmpty && !_rideLoading) {
      _loadRideInbox();
    }
    if (_tabCtrl.index == 1 && _dmConvs.isEmpty && !_dmLoading) {
      _loadDmConvs();
    }
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  Future<void> _loadRideInbox({bool autoOpen = false}) async {
    if (_currentUser == null) return;
    setState(() { _rideLoading = true; _rideError = null; });
    try {
      final list = await ApiService.instance.getRideChatInbox();
      if (mounted) {
        setState(() { _rideInbox = list; _rideLoading = false; });
        // Auto-open the most recent ride conversation on first load
        if (autoOpen && list.isNotEmpty && mounted) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) _openRideChat(list.first);
          });
        }
      }
    } on ApiException catch (e) {
      if (mounted) setState(() { _rideError = e.message; _rideLoading = false; });
    } catch (e) {
      if (mounted) setState(() { _rideError = e.toString(); _rideLoading = false; });
    }
  }

  Future<void> _loadDmConvs({String? search}) async {
    if (_currentUser == null) return;
    setState(() { _dmLoading = true; _dmError = null; });
    try {
      final list = await ApiService.instance.getDmConversations(
          search: search?.isNotEmpty == true ? search : null);
      if (mounted) setState(() { _dmConvs = list; _dmLoading = false; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _dmError = e.message; _dmLoading = false; });
    } catch (e) {
      if (mounted) setState(() { _dmError = e.toString(); _dmLoading = false; });
    }
  }

  void _onSearchChanged(String value) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 400), () {
      if (!mounted) return;
      setState(() => _dmSearch = value.trim());
      _loadDmConvs(search: _dmSearch.isNotEmpty ? _dmSearch : null);
    });
  }

  void _openRideChat(Map<String, dynamic> item) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => RideChatScreen(ride: item, currentUser: _currentUser),
      ),
    ).then((_) { if (mounted) _loadRideInbox(); });
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  void _openLogin() {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => LoginScreen(
          onLoggedIn: (user) {
            Navigator.pop(context);
            setState(() { _currentUser = user; });
            _loadRideInbox();
          },
        ),
      ),
    );
  }

  Future<void> _logout() async {
    await ApiService.instance.logout();
    if (mounted) {
      setState(() {
        _currentUser = null;
        _rideInbox = [];
        _dmConvs   = [];
      });
    }
  }

  // ── Formatting helpers ────────────────────────────────────────────────────

  String _fmtTs(dynamic ts) {
    if (ts == null) return '';
    try {
      final num n = ts is num ? ts : double.parse(ts.toString());
      final dt = n < 1e10
          ? DateTime.fromMillisecondsSinceEpoch((n * 1000).round())
          : DateTime.fromMillisecondsSinceEpoch(n.round());
      final local = dt.toLocal();
      final now   = DateTime.now();
      final diff  = now.difference(local);
      if (diff.inMinutes  < 1)  return 'now';
      if (diff.inHours    < 1)  return '${diff.inMinutes}m';
      if (diff.inHours    < 24) return '${diff.inHours}h';
      return '${local.day}/${local.month}';
    } catch (_) {
      return '';
    }
  }

  String _lastDmMessage(Map<String, dynamic> conv) {
    final lm = conv['last_message'];
    if (lm is Map) return (lm['content'] ?? '').toString();
    if (lm is String) return lm;
    return '';
  }

  dynamic _lastDmTs(Map<String, dynamic> conv) {
    final lm = conv['last_message'];
    if (lm is Map) return lm['ts'] ?? conv['timestamp'] ?? conv['created_at'];
    return conv['timestamp'] ?? conv['created_at'];
  }

  Widget _avatar(String name, String? avatarUrl, {double size = 40}) {
    if (avatarUrl != null && avatarUrl.isNotEmpty) {
      final url = ApiService.instance.avatarUrl(avatarUrl);
      return CachedNetworkImage(
        imageUrl: url,
        imageBuilder: (_, img) =>
            CircleAvatar(radius: size / 2, backgroundImage: img),
        errorWidget: (_, __, ___) => _initialsAvatar(name, size),
        placeholder: (_, __) =>
            CircleAvatar(radius: size / 2, child: const CircularProgressIndicator(strokeWidth: 2)),
      );
    }
    return _initialsAvatar(name, size);
  }

  Widget _initialsAvatar(String name, double size) {
    const palette = [
      Color(0xFF1D4ED8),
      Color(0xFF7C3AED),
      Color(0xFF0F766E),
      Color(0xFFC2410C),
      Color(0xFF15803D),
    ];
    final idx = name.isEmpty ? 0 : name.codeUnitAt(0) % palette.length;
    return CircleAvatar(
      radius: size / 2,
      backgroundColor: palette[idx],
      child: Text(
        name.isEmpty ? '?' : name[0].toUpperCase(),
        style: TextStyle(
            color: Colors.white,
            fontSize: size * 0.38,
            fontWeight: FontWeight.bold),
      ),
    );
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Inbox'),
        actions: [
          if (_currentUser != null)
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: TextButton.icon(
                icon: const Icon(Icons.logout, size: 16),
                label: const Text('Sign Out', style: TextStyle(fontSize: 12)),
                onPressed: _logout,
              ),
            )
          else if (!_userLoading)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: TextButton.icon(
                icon: const Icon(Icons.login, size: 16),
                label: const Text('Sign In', style: TextStyle(fontSize: 12)),
                onPressed: _openLogin,
              ),
            ),
        ],
        bottom: TabBar(
          controller: _tabCtrl,
          tabs: const [
            Tab(icon: Icon(Icons.directions_car), text: 'Rides'),
            Tab(icon: Icon(Icons.message),        text: 'Direct Messages'),
          ],
        ),
      ),
      body: _userLoading
          ? const Center(child: CircularProgressIndicator())
          : _currentUser == null
              ? _buildNotLoggedIn()
              : TabBarView(
                  controller: _tabCtrl,
                  children: [
                    _buildRidesTab(),
                    _buildDmTab(),
                  ],
                ),
    );
  }

  Widget _buildNotLoggedIn() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.inbox, size: 64, color: Colors.grey),
            const SizedBox(height: 16),
            const Text(
              'Sign in to view your inbox',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            const Text(
              'Access your ride chats and direct messages.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey),
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              icon: const Icon(Icons.login),
              label: const Text('Sign In'),
              onPressed: _openLogin,
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Rides tab ─────────────────────────────────────────────────────────────

  Widget _buildRidesTab() {
    if (_rideLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_rideError != null) {
      return _buildError(_rideError!, _loadRideInbox);
    }
    if (_rideInbox.isEmpty) {
      return _buildEmpty(
        icon: Icons.directions_car_outlined,
        message: 'No ride conversations yet.\nJoin a ride to start chatting.',
        onRefresh: _loadRideInbox,
      );
    }
    return RefreshIndicator(
      onRefresh: _loadRideInbox,
      child: ListView.separated(
        itemCount: _rideInbox.length,
        separatorBuilder: (_, __) =>
            const Divider(height: 1, indent: 72, endIndent: 0),
        itemBuilder: (_, i) => _buildRideTile(_rideInbox[i]),
      ),
    );
  }

  Widget _buildRideTile(Map<String, dynamic> item) {
    final rideInfo   = item['ride_info'] as Map<String, dynamic>? ?? {};
    final origin     = (item['origin']      ?? rideInfo['origin']      ?? '').toString();
    final dest       = (item['destination'] ?? rideInfo['destination'] ?? '').toString();
    final lastMsg    = (item['text'] ?? item['last_message'] ?? '').toString();
    final ts         = item['ts'] ?? item['timestamp'];
    final unread     = (item['unread_count'] as int?) ?? 0;
    final driverName = (item['driver_name'] ?? '').toString();

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      leading: _avatar(driverName.isNotEmpty ? driverName : 'R', null, size: 44),
      title: Row(
        children: [
          Expanded(
            child: Text(
              '$origin  →  $dest',
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Text(_fmtTs(ts),
              style: const TextStyle(color: Colors.grey, fontSize: 11)),
        ],
      ),
      subtitle: Row(
        children: [
          Expanded(
            child: Text(
              lastMsg,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                  color: unread > 0 ? Colors.white70 : Colors.grey,
                  fontSize: 13,
                  fontWeight:
                      unread > 0 ? FontWeight.w500 : FontWeight.normal),
            ),
          ),
          if (unread > 0)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xFFF59E0B),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                unread.toString(),
                style: const TextStyle(
                    color: Colors.black,
                    fontSize: 10,
                    fontWeight: FontWeight.bold),
              ),
            ),
        ],
      ),
      onTap: () => _openRideChat(item),
    );
  }

  // ── DM tab ────────────────────────────────────────────────────────────────

  Widget _buildDmTab() {
    return Column(
      children: [
        // Search bar
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
          child: TextField(
            controller: _searchCtrl,
            onChanged: _onSearchChanged,
            decoration: InputDecoration(
              hintText: 'Search by username…',
              prefixIcon: const Icon(Icons.search, size: 20),
              suffixIcon: _dmSearch.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.close, size: 18),
                      onPressed: () {
                        _searchCtrl.clear();
                        _onSearchChanged('');
                      },
                    )
                  : null,
              filled: true,
              fillColor: Colors.grey.shade900,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(24),
                borderSide: BorderSide.none,
              ),
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            ),
          ),
        ),
        Expanded(child: _buildDmList()),
      ],
    );
  }

  Widget _buildDmList() {
    if (_dmLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_dmError != null) {
      return _buildError(_dmError!, () => _loadDmConvs());
    }
    if (_dmConvs.isEmpty) {
      return _buildEmpty(
        icon: Icons.message_outlined,
        message: _dmSearch.isNotEmpty
            ? 'No conversations found for "$_dmSearch".'
            : 'No direct messages yet.\n'
                'Start a conversation from a ride chat.',
        onRefresh: () => _loadDmConvs(),
      );
    }
    return RefreshIndicator(
      onRefresh: () => _loadDmConvs(search: _dmSearch),
      child: ListView.separated(
        itemCount: _dmConvs.length,
        separatorBuilder: (_, __) =>
            const Divider(height: 1, indent: 72, endIndent: 0),
        itemBuilder: (_, i) => _buildDmTile(_dmConvs[i]),
      ),
    );
  }

  Widget _buildDmTile(Map<String, dynamic> conv) {
    final other     = (conv['other_user'] as Map<String, dynamic>?) ?? {};
    final name      = (other['name'] ?? other['username'] ?? conv['name'] ?? 'User').toString();
    final username  = (other['username'] ?? '').toString();
    final avatarUrl = (other['avatar_url'] ?? '').toString();
    final lastMsg   = _lastDmMessage(conv);
    final ts        = _lastDmTs(conv);
    final unread    = (conv['unread_count'] as int?) ?? 0;
    final delivery  = (conv['last_delivery'] ?? '').toString();

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      leading: _avatar(name, avatarUrl.isNotEmpty ? avatarUrl : null, size: 44),
      title: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name,
                    style: const TextStyle(
                        fontWeight: FontWeight.w600, fontSize: 14),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
                if (username.isNotEmpty)
                  Text('@$username',
                      style: const TextStyle(
                          color: Colors.grey, fontSize: 11),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
          Text(_fmtTs(ts),
              style: const TextStyle(color: Colors.grey, fontSize: 11)),
        ],
      ),
      subtitle: Row(
        children: [
          // Delivery ticks
          if (delivery == 'read')
            const Icon(Icons.done_all, size: 13, color: Color(0xFF60A5FA))
          else if (delivery == 'delivered')
            const Icon(Icons.done_all, size: 13, color: Colors.grey)
          else if (delivery == 'sent')
            const Icon(Icons.done, size: 13, color: Colors.grey),
          if (delivery.isNotEmpty) const SizedBox(width: 4),
          Expanded(
            child: Text(
              lastMsg,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                  color: unread > 0 ? Colors.white70 : Colors.grey,
                  fontSize: 13,
                  fontWeight:
                      unread > 0 ? FontWeight.w500 : FontWeight.normal),
            ),
          ),
          if (unread > 0)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xFFF59E0B),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                unread.toString(),
                style: const TextStyle(
                    color: Colors.black,
                    fontSize: 10,
                    fontWeight: FontWeight.bold),
              ),
            ),
        ],
      ),
      onTap: () => Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => DmChatScreen(
            conversation: conv,
            currentUser:  _currentUser,
          ),
        ),
      ).then((_) => _loadDmConvs(search: _dmSearch)),
    );
  }

  // ── Shared states ─────────────────────────────────────────────────────────

  Widget _buildError(String message, VoidCallback onRetry) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: Colors.red, size: 40),
            const SizedBox(height: 12),
            Text(message,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.red)),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }

  Widget _buildEmpty({
    required IconData icon,
    required String message,
    required VoidCallback onRefresh,
  }) {
    return ListView(
      children: [
        const SizedBox(height: 80),
        Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 56, color: Colors.grey.shade700),
              const SizedBox(height: 16),
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.grey, fontSize: 14),
              ),
              const SizedBox(height: 24),
              TextButton.icon(
                icon: const Icon(Icons.refresh),
                label: const Text('Refresh'),
                onPressed: onRefresh,
              ),
            ],
          ),
        ),
      ],
    );
  }
}
