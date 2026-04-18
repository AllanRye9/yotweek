import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../services/api_service.dart';
import 'login_screen.dart';

/// Simple profile screen that shows the current user's details.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  Map<String, dynamic>? _user;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadUser();
  }

  Future<void> _loadUser() async {
    await ApiService.instance.loadCookies();
    if (!mounted) return;
    try {
      final user = await ApiService.instance.getCurrentUser();
      if (mounted) setState(() { _user = user; _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _logout() async {
    await ApiService.instance.logout();
    if (mounted) {
      Navigator.pop(context);
    }
  }

  Widget _avatar(Map<String, dynamic> user, double size) {
    final name = (user['name'] ?? user['username'] ?? 'U').toString();
    final avatarPath = (user['avatar_url'] ?? '').toString();
    if (avatarPath.isNotEmpty) {
      final url = ApiService.instance.avatarUrl(avatarPath);
      return CachedNetworkImage(
        imageUrl: url,
        imageBuilder: (_, img) => CircleAvatar(radius: size / 2, backgroundImage: img),
        errorWidget: (_, __, ___) => _initialsAvatar(name, size),
        placeholder: (_, __) => CircleAvatar(
          radius: size / 2,
          child: const CircularProgressIndicator(strokeWidth: 2),
        ),
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
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Profile'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.pop(context),
        ),
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
                          onPressed: _loadUser,
                          child: const Text('Retry'),
                        ),
                      ],
                    ),
                  ),
                )
              : _user == null
                  ? _buildNotLoggedIn()
                  : _buildProfile(_user!),
    );
  }

  Widget _buildNotLoggedIn() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.person_outline, size: 64, color: Colors.grey),
            const SizedBox(height: 16),
            const Text('You are not signed in.',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              icon: const Icon(Icons.login),
              label: const Text('Sign In'),
              onPressed: () {
                Navigator.pushReplacement(
                  context,
                  MaterialPageRoute(
                    builder: (_) => LoginScreen(
                      onLoggedIn: (user) {
                        Navigator.pop(context);
                        setState(() { _user = user; });
                      },
                    ),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildProfile(Map<String, dynamic> user) {
    final name     = (user['name']     ?? 'Unknown').toString();
    final email    = (user['email']    ?? '').toString();
    final username = (user['username'] ?? '').toString();
    final bio      = (user['bio']      ?? '').toString();
    final phone    = (user['phone']    ?? '').toString();
    final role     = (user['role']     ?? '').toString();
    final location = (user['location_name'] ?? '').toString();

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // Avatar
          _avatar(user, 100),
          const SizedBox(height: 16),
          Text(name,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
          if (username.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text('@$username',
                style: const TextStyle(color: Colors.grey, fontSize: 14)),
          ],
          if (role.isNotEmpty) ...[
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primaryContainer,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(role,
                  style: TextStyle(
                      fontSize: 12,
                      color: Theme.of(context).colorScheme.onPrimaryContainer,
                      fontWeight: FontWeight.w600)),
            ),
          ],
          const SizedBox(height: 24),
          // Info tiles
          _infoTile(Icons.email_outlined, 'Email', email),
          if (phone.isNotEmpty) _infoTile(Icons.phone_outlined, 'Phone', phone),
          if (location.isNotEmpty) _infoTile(Icons.location_on_outlined, 'Location', location),
          if (bio.isNotEmpty) _infoTile(Icons.info_outline, 'Bio', bio),
          const SizedBox(height: 32),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              icon: const Icon(Icons.logout, color: Colors.red),
              label: const Text('Sign Out', style: TextStyle(color: Colors.red)),
              onPressed: _logout,
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: Colors.red),
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _infoTile(IconData icon, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: Colors.grey),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: const TextStyle(fontSize: 11, color: Colors.grey)),
                Text(value, style: const TextStyle(fontSize: 14)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
