import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../config/app_config.dart';
import '../providers/downloads_provider.dart';
import '../widgets/active_downloads_bar.dart';
import 'downloader_screen.dart';
import 'files_screen.dart';
import 'cv_generator_screen.dart';
import 'doc_converter_screen.dart';
import 'reviews_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tabIndex = 0;

  static const _tabs = [
    _TabInfo(icon: Icons.download, label: 'Download'),
    _TabInfo(icon: Icons.folder_open, label: 'Files'),
    _TabInfo(icon: Icons.description, label: 'CV'),
    _TabInfo(icon: Icons.transform, label: 'Convert'),
    _TabInfo(icon: Icons.star_outline, label: 'Reviews'),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    Theme.of(context).colorScheme.primary,
                    Theme.of(context).colorScheme.secondary,
                  ],
                ),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.download_rounded, color: Colors.white, size: 20),
            ),
            const SizedBox(width: 10),
            const Text('YOT Downloader',
                style: TextStyle(fontWeight: FontWeight.bold)),
          ],
        ),
        actions: [
          // Active downloads badge
          Consumer<DownloadsProvider>(
            builder: (context, provider, _) {
              final count = provider.activeCount;
              return Stack(
                alignment: Alignment.center,
                children: [
                  IconButton(
                    icon: const Icon(Icons.downloading),
                    tooltip: 'Active Downloads',
                    onPressed: () {
                      showModalBottomSheet(
                        context: context,
                        builder: (_) => _ActiveDownloadsSheet(),
                        isScrollControlled: true,
                        shape: const RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.vertical(top: Radius.circular(16)),
                        ),
                      );
                    },
                  ),
                  if (count > 0)
                    Positioned(
                      top: 8,
                      right: 8,
                      child: Container(
                        padding: const EdgeInsets.all(3),
                        decoration: const BoxDecoration(
                          color: Colors.red,
                          shape: BoxShape.circle,
                        ),
                        child: Text(
                          count.toString(),
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 10,
                              fontWeight: FontWeight.bold),
                        ),
                      ),
                    ),
                ],
              );
            },
          ),
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            tooltip: 'Settings',
            onPressed: () => _openSettings(context),
          ),
        ],
      ),
      body: Column(
        children: [
          // Active downloads bar (appears when there are downloads)
          const ActiveDownloadsBar(),
          Expanded(child: _buildBody()),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tabIndex,
        onDestinationSelected: (i) => setState(() => _tabIndex = i),
        destinations: _tabs
            .map((t) => NavigationDestination(icon: Icon(t.icon), label: t.label))
            .toList(),
      ),
    );
  }

  Widget _buildBody() {
    switch (_tabIndex) {
      case 0:
        return const DownloaderScreen();
      case 1:
        return const FilesScreen();
      case 2:
        return const CvGeneratorScreen();
      case 3:
        return const DocConverterScreen();
      case 4:
        return const ReviewsScreen();
      default:
        return const SizedBox.shrink();
    }
  }

  void _openSettings(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => _SettingsDialog(),
    );
  }
}

// ── Active downloads bottom sheet ─────────────────────────────────────────────

class _ActiveDownloadsSheet extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Consumer<DownloadsProvider>(
      builder: (context, provider, _) {
        final all = provider.all;
        return DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.5,
          maxChildSize: 0.9,
          minChildSize: 0.2,
          builder: (_, ctrl) => Column(
            children: [
              const SizedBox(height: 8),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.grey.shade300,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Text('Downloads',
                        style: Theme.of(context)
                            .textTheme
                            .titleMedium
                            ?.copyWith(fontWeight: FontWeight.bold)),
                    const Spacer(),
                    if (provider.activeCount > 0)
                      TextButton(
                        onPressed: () async {
                          await provider.cancelAll();
                        },
                        child: const Text('Cancel All',
                            style: TextStyle(color: Colors.red)),
                      ),
                  ],
                ),
              ),
              if (all.isEmpty)
                const Expanded(
                  child: Center(child: Text('No downloads yet')),
                )
              else
                Expanded(
                  child: ListView.builder(
                    controller: ctrl,
                    itemCount: all.length,
                    itemBuilder: (_, i) {
                      final entry = all[i];
                      return _DownloadTile(entry: entry, provider: provider);
                    },
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _DownloadTile extends StatelessWidget {
  final DownloadEntry entry;
  final DownloadsProvider provider;

  const _DownloadTile({required this.entry, required this.provider});

  @override
  Widget build(BuildContext context) {
    final status = entry.status;
    return ListTile(
      leading: _stateIcon(status.state),
      title: Text(status.title,
          maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: status.isActive
          ? LinearProgressIndicator(
              value: status.progress,
              minHeight: 4,
              borderRadius: BorderRadius.circular(2),
            )
          : Text(status.isDone ? '✓ Done' : status.error ?? 'Error'),
      trailing: status.isActive
          ? IconButton(
              icon: const Icon(Icons.close, size: 18),
              onPressed: () => provider.cancel(entry.id),
            )
          : IconButton(
              icon: const Icon(Icons.close, size: 18),
              onPressed: () => provider.remove(entry.id),
            ),
    );
  }

  Widget _stateIcon(String state) {
    switch (state) {
      case 'done':
        return const Icon(Icons.check_circle, color: Colors.green);
      case 'error':
        return const Icon(Icons.error, color: Colors.red);
      case 'downloading':
        return const SizedBox(
            width: 24,
            height: 24,
            child: CircularProgressIndicator(strokeWidth: 2.5));
      default:
        return const Icon(Icons.hourglass_top, color: Colors.grey);
    }
  }
}

// ── Settings dialog ────────────────────────────────────────────────────────────

class _SettingsDialog extends StatefulWidget {
  @override
  State<_SettingsDialog> createState() => _SettingsDialogState();
}

class _SettingsDialogState extends State<_SettingsDialog> {
  late final TextEditingController _ctrl;
  bool _saved = false;

  @override
  void initState() {
    super.initState();
    _ctrl = TextEditingController(text: AppConfig.baseUrl);
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    await AppConfig.setBaseUrl(_ctrl.text.trim());
    setState(() => _saved = true);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Settings'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Backend URL',
              style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
          const SizedBox(height: 6),
          TextField(
            controller: _ctrl,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              hintText: 'http://your-server.com',
              helperText: 'Your YOT Downloader FastAPI server address',
            ),
            keyboardType: TextInputType.url,
            autocorrect: false,
          ),
          if (_saved) ...[
            const SizedBox(height: 8),
            const Text('✓ Saved',
                style: TextStyle(color: Colors.green, fontSize: 13)),
          ],
        ],
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close')),
        ElevatedButton(onPressed: _save, child: const Text('Save')),
      ],
    );
  }
}

// ── Helper ─────────────────────────────────────────────────────────────────────

class _TabInfo {
  final IconData icon;
  final String label;

  const _TabInfo({required this.icon, required this.label});
}

extension on DownloadsProvider {
  Future<void> cancelAll() async {
    for (final entry in all.where((e) => e.status.isActive)) {
      await cancel(entry.id);
    }
  }
}
