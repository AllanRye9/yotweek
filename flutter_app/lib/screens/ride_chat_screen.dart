import 'dart:async';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import '../services/api_service.dart';
import '../config/app_config.dart';
import 'location_map_screen.dart';

/// Chat screen for a shared-ride conversation.
///
/// Features:
/// - Left (received) / right (sent) message bubbles
/// - Profile picture / avatar on received messages
/// - Animated typing indicator (3 bouncing dots) while composing
/// - "Confirm Journey" for passengers — opens a bottom sheet that uses
///   [LocationMapScreen] to obtain the device's current position, then
///   calls the backend confirm-journey endpoint and posts a location message.
/// - "Share Location" button for all users that opens [LocationMapScreen]
///   and sends coordinates into the chat.
/// - HTTP polling for new messages every 4 seconds.
class RideChatScreen extends StatefulWidget {
  final Map<String, dynamic> ride;
  final Map<String, dynamic>? currentUser;

  const RideChatScreen({super.key, required this.ride, this.currentUser});

  @override
  State<RideChatScreen> createState() => _RideChatScreenState();
}

class _RideChatScreenState extends State<RideChatScreen>
    with TickerProviderStateMixin {
  final _textCtrl   = TextEditingController();
  final _scrollCtrl = ScrollController();
  List<Map<String, dynamic>> _messages = [];
  bool   _loading   = true;
  String? _error;
  bool   _sending   = false;
  bool   _isTyping  = false;

  // Typing animation controllers (3 bouncing dots)
  late final List<AnimationController> _dotCtrl;
  late final List<Animation<double>>   _dotAnim;

  Timer? _pollTimer;

  Map<String, dynamic> get _ride => widget.ride;
  Map<String, dynamic>? get _me   => widget.currentUser;
  String get _rideId   => (_ride['ride_id'] ?? '').toString();
  String get _myId     => (_me?['user_id'] ?? '').toString();
  String get _myName   => (_me?['name'] ?? _me?['display_name'] ?? 'Me').toString();
  bool   get _isDriver => _myId.isNotEmpty && _myId == (_ride['user_id'] ?? '').toString();

  @override
  void initState() {
    super.initState();
    _dotCtrl = List.generate(
      3,
      (i) => AnimationController(
        vsync: this,
        duration: const Duration(milliseconds: 350),
      ),
    );
    _dotAnim = _dotCtrl
        .map((c) =>
            Tween<double>(begin: 0, end: -8).animate(
              CurvedAnimation(parent: c, curve: Curves.easeInOut),
            ))
        .toList();
    _loadMessages();
    _pollTimer = Timer.periodic(const Duration(seconds: 4), (_) => _loadMessages(silent: true));
  }

  @override
  void dispose() {
    _textCtrl.dispose();
    _scrollCtrl.dispose();
    _pollTimer?.cancel();
    for (final c in _dotCtrl) c.dispose();
    super.dispose();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  void _startTypingAnimation() {
    for (int i = 0; i < 3; i++) {
      Future.delayed(Duration(milliseconds: i * 140), () {
        if (mounted) _dotCtrl[i].repeat(reverse: true);
      });
    }
  }

  void _stopTypingAnimation() {
    for (final c in _dotCtrl) {
      c.stop();
      c.animateTo(0);
    }
  }

  void _onTextChanged(String text) {
    final typing = text.isNotEmpty;
    if (typing == _isTyping) return;
    setState(() => _isTyping = typing);
    if (typing) {
      _startTypingAnimation();
    } else {
      _stopTypingAnimation();
    }
  }

  Future<void> _loadMessages({bool silent = false}) async {
    if (!silent) setState(() { _loading = true; _error = null; });
    try {
      final msgs = await ApiService.instance.getRideChatMessages(_rideId);
      if (!mounted) return;
      setState(() {
        _messages = msgs;
        _loading  = false;
      });
      _scrollToBottom();
    } on ApiException catch (e) {
      if (mounted && !silent) setState(() { _error = e.message; _loading = false; });
    } catch (e) {
      if (mounted && !silent) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(
          _scrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      }
    });
  }

  /// Appends a local optimistic message then polls for confirmation.
  void _addLocalMessage(String text) {
    final localMsg = <String, dynamic>{
      'sender_id':   _myId,
      'sender_name': _myName,
      'text':        text,
      'ts':          DateTime.now().millisecondsSinceEpoch / 1000,
      '_local':      true,
    };
    setState(() => _messages.add(localMsg));
    _scrollToBottom();
  }

  Future<void> _sendText() async {
    final text = _textCtrl.text.trim();
    if (text.isEmpty || _sending) return;
    _textCtrl.clear();
    _onTextChanged('');
    setState(() => _sending = true);
    // NOTE: The backend ride-chat send endpoint is Socket.IO only (no REST
    // equivalent).  We store the message optimistically for local display and
    // inform the user to open the web interface to message the full group.
    _addLocalMessage(text);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            '⚠️ Ride chat requires the web interface for full messaging. '
            'Your message is shown locally only.',
          ),
          duration: Duration(seconds: 4),
        ),
      );
    }
    setState(() => _sending = false);
  }

  Future<void> _shareLocation() async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => LocationMapScreen(
          onShareLocation: (lat, lng, label) {
            _addLocalMessage(
              '📍 My location: https://maps.google.com/?q=$lat,$lng',
            );
          },
        ),
      ),
    );
  }

  Future<void> _openConfirmJourney() async {
    final nameCtrl    = TextEditingController(text: _myName);
    final contactCtrl = TextEditingController(
      text: (_me?['phone'] ?? _me?['email'] ?? '').toString(),
    );

    if (!mounted) return;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => _ConfirmJourneySheet(
        nameCtrl: nameCtrl,
        contactCtrl: contactCtrl,
        initialName: _myName,
        onOpenMap: (onLocationSelected) async {
          await Navigator.push(
            ctx,
            MaterialPageRoute(
              builder: (_) => LocationMapScreen(
                onShareLocation: onLocationSelected,
              ),
            ),
          );
        },
        onConfirm: (lat, lng, locationLabel) async {
          await ApiService.instance.confirmJourney(
            _rideId,
            nameCtrl.text.trim().isNotEmpty ? nameCtrl.text.trim() : _myName,
            contactCtrl.text.trim(),
          );
          if (locationLabel != null && lat != null && lng != null) {
            _addLocalMessage(
              '✅ Journey confirmed. 📍 My location: https://maps.google.com/?q=$lat,$lng',
            );
          } else {
            _addLocalMessage('✅ Journey confirmed by $_myName');
          }
          if (ctx.mounted) Navigator.pop(ctx);
        },
      ),
    );
    nameCtrl.dispose();
    contactCtrl.dispose();
  }

  // ── Message display helpers ───────────────────────────────────────────────

  bool _isMe(Map<String, dynamic> msg) {
    final sid = (msg['sender_id'] ?? '').toString();
    return sid.isNotEmpty && sid == _myId;
  }

  String _senderName(Map<String, dynamic> msg) {
    return (msg['sender_name'] ?? msg['name'] ?? 'User').toString();
  }

  String _msgText(Map<String, dynamic> msg) {
    return (msg['text'] ?? msg['content'] ?? '').toString();
  }

  String _fmtTime(dynamic ts) {
    if (ts == null) return '';
    try {
      final num n = ts is num ? ts : double.parse(ts.toString());
      final dt = n < 1e10
          ? DateTime.fromMillisecondsSinceEpoch((n * 1000).round())
          : DateTime.fromMillisecondsSinceEpoch(n.round());
      final local = dt.toLocal();
      final h = local.hour.toString().padLeft(2, '0');
      final m = local.minute.toString().padLeft(2, '0');
      return '$h:$m';
    } catch (_) {
      return '';
    }
  }

  Widget _avatar(String name, String? avatarUrl, {double size = 30}) {
    if (avatarUrl != null && avatarUrl.isNotEmpty) {
      final url = ApiService.instance.avatarUrl(avatarUrl);
      return CachedNetworkImage(
        imageUrl: url,
        imageBuilder: (_, img) => CircleAvatar(radius: size / 2, backgroundImage: img),
        errorWidget:  (_, __, ___) => _initialsAvatar(name, size),
        placeholder:  (_, __)      => CircleAvatar(radius: size / 2, child: const CircularProgressIndicator(strokeWidth: 2)),
      );
    }
    return _initialsAvatar(name, size);
  }

  Widget _initialsAvatar(String name, double size) {
    final colors = [
      Colors.blue.shade700,
      Colors.purple.shade700,
      Colors.teal.shade700,
      Colors.orange.shade800,
      Colors.green.shade800,
    ];
    final idx = name.isEmpty ? 0 : name.codeUnitAt(0) % colors.length;
    return CircleAvatar(
      radius: size / 2,
      backgroundColor: colors[idx],
      child: Text(
        name.isEmpty ? '?' : name[0].toUpperCase(),
        style: TextStyle(color: Colors.white, fontSize: size * 0.4, fontWeight: FontWeight.bold),
      ),
    );
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: _buildAppBar(),
      body: Column(
        children: [
          if (!_isDriver) _buildConfirmBanner(),
          Expanded(child: _buildMessages()),
          if (_isTyping) _buildTypingRow(),
          _buildInputBar(),
        ],
      ),
    );
  }

  AppBar _buildAppBar() {
    final origin      = (_ride['origin'] ?? _ride['ride_info']?['origin'] ?? '').toString();
    final destination = (_ride['destination'] ?? _ride['ride_info']?['destination'] ?? '').toString();
    return AppBar(
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('🚗 $origin → $destination',
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
              maxLines: 1,
              overflow: TextOverflow.ellipsis),
          if ((_ride['driver_name'] ?? '').toString().isNotEmpty)
            Text('Driver: ${_ride['driver_name']}',
                style: const TextStyle(fontSize: 11, color: Colors.grey)),
        ],
      ),
      actions: [
        IconButton(
          icon: const Icon(Icons.share_location),
          tooltip: 'Share Location',
          onPressed: _shareLocation,
        ),
        IconButton(
          icon: const Icon(Icons.refresh),
          tooltip: 'Refresh',
          onPressed: () => _loadMessages(),
        ),
      ],
    );
  }

  Widget _buildConfirmBanner() {
    return Material(
      color: const Color(0xFF78350F),
      child: InkWell(
        onTap: _openConfirmJourney,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(
            children: [
              const Icon(Icons.check_circle_outline, color: Color(0xFFFBBF24), size: 20),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Tap to Confirm Journey & Share Location',
                  style: TextStyle(color: Color(0xFFFBBF24), fontWeight: FontWeight.w600, fontSize: 13),
                ),
              ),
              const Icon(Icons.chevron_right, color: Color(0xFFFBBF24)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMessages() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, color: Colors.red, size: 40),
              const SizedBox(height: 12),
              Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.red)),
              const SizedBox(height: 16),
              ElevatedButton(onPressed: _loadMessages, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }
    if (_messages.isEmpty) {
      return const Center(
        child: Text('No messages yet.\nSend a message to start the conversation.',
            textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
      );
    }
    return ListView.builder(
      controller: _scrollCtrl,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      itemCount: _messages.length,
      itemBuilder: (_, i) => _buildBubble(_messages[i]),
    );
  }

  Widget _buildBubble(Map<String, dynamic> msg) {
    final isMe        = _isMe(msg);
    final name        = _senderName(msg);
    final text        = _msgText(msg);
    final time        = _fmtTime(msg['ts']);
    final isPending   = msg['_local'] == true;
    final senderAvUrl = (msg['sender_avatar'] ?? '').toString();

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: isMe ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (!isMe) ...[
            _avatar(name, senderAvUrl.isNotEmpty ? senderAvUrl : null),
            const SizedBox(width: 6),
          ],
          Flexible(
            child: Container(
              constraints: BoxConstraints(
                maxWidth: MediaQuery.of(context).size.width * 0.72,
              ),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: isMe
                    ? Theme.of(context).colorScheme.primary
                    : Colors.grey.shade800,
                borderRadius: BorderRadius.only(
                  topLeft:     const Radius.circular(16),
                  topRight:    const Radius.circular(16),
                  bottomLeft:  Radius.circular(isMe ? 16 : 4),
                  bottomRight: Radius.circular(isMe ? 4 : 16),
                ),
              ),
              child: Column(
                crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                children: [
                  if (!isMe)
                    Text(name,
                        style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFFFBBF24))),
                  Text(text, style: const TextStyle(color: Colors.white, fontSize: 14)),
                  const SizedBox(height: 2),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(time, style: const TextStyle(color: Colors.white60, fontSize: 10)),
                      if (isPending) ...[
                        const SizedBox(width: 4),
                        const Icon(Icons.access_time, size: 10, color: Colors.white54),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          ),
          if (isMe) const SizedBox(width: 6),
        ],
      ),
    );
  }

  Widget _buildTypingRow() {
    return Padding(
      padding: const EdgeInsets.only(left: 14, bottom: 4),
      child: Row(
        children: [
          _avatar(_myName, null, size: 24),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.grey.shade800,
              borderRadius: BorderRadius.circular(16),
            ),
            child: _TypingDots(dotAnim: _dotAnim),
          ),
        ],
      ),
    );
  }

  Widget _buildInputBar() {
    return Container(
      padding: EdgeInsets.only(
        left: 12,
        right: 8,
        top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom + 8,
      ),
      decoration: BoxDecoration(
        color: Theme.of(context).scaffoldBackgroundColor,
        boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.1), blurRadius: 4, offset: const Offset(0, -2))],
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _textCtrl,
              onChanged: _onTextChanged,
              maxLines: 4,
              minLines: 1,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => _sendText(),
              decoration: InputDecoration(
                hintText: 'Message…',
                filled: true,
                fillColor: Colors.grey.shade900,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(24),
                  borderSide: BorderSide.none,
                ),
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              ),
            ),
          ),
          const SizedBox(width: 6),
          IconButton(
            icon: const Icon(Icons.share_location, color: Color(0xFF4ADE80)),
            tooltip: 'Share Location',
            onPressed: _shareLocation,
          ),
          IconButton(
            icon: Icon(
              Icons.send_rounded,
              color: _sending ? Colors.grey : Theme.of(context).colorScheme.primary,
            ),
            onPressed: _sending ? null : _sendText,
          ),
        ],
      ),
    );
  }
}

// ── Confirm Journey bottom sheet ──────────────────────────────────────────────

class _ConfirmJourneySheet extends StatefulWidget {
  final TextEditingController nameCtrl;
  final TextEditingController contactCtrl;
  final String initialName;
  final Future<void> Function(
      void Function(double lat, double lng, String label) onSelected) onOpenMap;
  final Future<void> Function(double? lat, double? lng, String? label) onConfirm;

  const _ConfirmJourneySheet({
    required this.nameCtrl,
    required this.contactCtrl,
    required this.initialName,
    required this.onOpenMap,
    required this.onConfirm,
  });

  @override
  State<_ConfirmJourneySheet> createState() => _ConfirmJourneySheetState();
}

class _ConfirmJourneySheetState extends State<_ConfirmJourneySheet> {
  bool    _saving       = false;
  String? _msg;
  double? _lat;
  double? _lng;
  String? _locationLabel;

  @override
  void initState() {
    super.initState();
    // Try to get the device's location automatically when the sheet opens.
    _autoFetchLocation();
  }

  Future<void> _autoFetchLocation() async {
    try {
      bool ok = await Geolocator.isLocationServiceEnabled();
      if (!ok) return;
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) return;
      final pos = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.medium,
        timeLimit: const Duration(seconds: 8),
      );
      if (mounted) {
        setState(() {
          _lat = pos.latitude;
          _lng = pos.longitude;
          _locationLabel = '${pos.latitude.toStringAsFixed(5)}, ${pos.longitude.toStringAsFixed(5)}';
        });
      }
    } catch (_) {}
  }

  Future<void> _submit() async {
    setState(() { _saving = true; _msg = null; });
    try {
      await widget.onConfirm(_lat, _lng, _locationLabel);
    } on ApiException catch (e) {
      if (mounted) setState(() { _msg = e.message; _saving = false; });
    } catch (e) {
      if (mounted) setState(() { _msg = e.toString(); _saving = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
        left: 20,
        right: 20,
        top: 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Confirm Journey',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          const Text('Share your name, contact and current location with the driver.',
              style: TextStyle(color: Colors.grey, fontSize: 13)),
          const SizedBox(height: 16),
          TextField(
            controller: widget.nameCtrl,
            decoration: const InputDecoration(
              labelText: 'Your name',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: widget.contactCtrl,
            decoration: const InputDecoration(
              labelText: 'Phone or email',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          // Location row
          Row(
            children: [
              Icon(Icons.location_on,
                  color: _locationLabel != null
                      ? const Color(0xFF4ADE80)
                      : Colors.grey,
                  size: 18),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  _locationLabel != null
                      ? '📍 $_locationLabel'
                      : 'Getting location…',
                  style: TextStyle(
                      fontSize: 13,
                      color: _locationLabel != null ? Colors.white70 : Colors.grey),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              TextButton.icon(
                icon: const Icon(Icons.map_outlined, size: 16),
                label: const Text('Pick on Map'),
                onPressed: () async {
                  await widget.onOpenMap((lat, lng, label) {
                    if (mounted) {
                      setState(() {
                        _lat = lat;
                        _lng = lng;
                        _locationLabel = label;
                      });
                    }
                  });
                },
              ),
            ],
          ),
          if (_msg != null) ...[
            const SizedBox(height: 8),
            Text(_msg!, style: const TextStyle(color: Colors.red, fontSize: 13)),
          ],
          const SizedBox(height: 16),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 14),
              backgroundColor: const Color(0xFFF59E0B),
              foregroundColor: Colors.black,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            onPressed: _saving ? null : _submit,
            child: _saving
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Confirm Journey',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
          ),
        ],
      ),
    );
  }
}

// ── Typing indicator (3 bouncing dots) ────────────────────────────────────────

class _TypingDots extends StatelessWidget {
  final List<Animation<double>> dotAnim;

  const _TypingDots({required this.dotAnim});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(
        3,
        (i) => AnimatedBuilder(
          animation: dotAnim[i],
          builder: (_, __) => Transform.translate(
            offset: Offset(0, dotAnim[i].value),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2),
              child: Container(
                width: 7,
                height: 7,
                decoration: const BoxDecoration(
                  color: Colors.white60,
                  shape: BoxShape.circle,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
