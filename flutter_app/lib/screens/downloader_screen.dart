import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../models/video_info.dart';
import '../providers/downloads_provider.dart';
import '../services/api_service.dart';
import '../widgets/video_info_card.dart';

const _kVideoFormats = [
  {'value': 'best', 'label': 'Best Quality (auto)'},
  {'value': 'bestvideo[ext=mp4]+bestaudio/best', 'label': 'Best MP4'},
  {'value': 'bestvideo[height<=1080]+bestaudio/best', 'label': '1080p HD'},
  {'value': 'bestvideo[height<=720]+bestaudio/best', 'label': '720p HD'},
  {'value': 'bestvideo[height<=480]+bestaudio/best', 'label': '480p SD'},
  {'value': 'bestvideo[height<=360]+bestaudio/best', 'label': '360p'},
  {'value': 'bestaudio/best', 'label': 'Audio only'},
];

const _kOutputExts = ['mp4', 'webm', 'mkv', 'avi', 'mp3', 'm4a', 'ogg', 'wav'];

class DownloaderScreen extends StatefulWidget {
  const DownloaderScreen({super.key});

  @override
  State<DownloaderScreen> createState() => _DownloaderScreenState();
}

class _DownloaderScreenState extends State<DownloaderScreen> {
  final _urlCtrl = TextEditingController();
  VideoInfo? _info;
  bool _fetchingInfo = false;
  bool _startingDownload = false;
  String? _error;
  String _selectedFormat = 'best';
  String _selectedExt = 'mp4';
  // When the API returns formats, this holds the chosen format_id.
  String? _apiFormat;

  @override
  void dispose() {
    _urlCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetchInfo() async {
    final url = _urlCtrl.text.trim();
    if (url.isEmpty) {
      setState(() => _error = 'Please enter a URL');
      return;
    }
    setState(() {
      _error = null;
      _info = null;
      _fetchingInfo = true;
    });
    try {
      final info = await ApiService.instance.getVideoInfo(url);
      setState(() {
        _info = info;
        _apiFormat = info.formats.isNotEmpty ? info.formats.first.formatId : null;
      });
    } catch (e) {
      setState(() => _error = _errMsg(e));
    } finally {
      setState(() => _fetchingInfo = false);
    }
  }

  Future<void> _startDownload() async {
    final url = _urlCtrl.text.trim();
    if (url.isEmpty || _info == null) return;
    setState(() {
      _error = null;
      _startingDownload = true;
    });
    try {
      final format = _apiFormat ?? _selectedFormat;
      final result = await ApiService.instance.startDownload(
        url: url,
        format: format,
        ext: _selectedExt,
      );
      final id = result['download_id']?.toString() ?? '';
      final title = result['title']?.toString() ?? _info!.title;
      if (id.isNotEmpty) {
        if (!mounted) return;
        context.read<DownloadsProvider>().add(id, title);
      }
      if (result['warning'] != null) {
        setState(() => _error = '⚠ ${result['warning']}');
      }
    } catch (e) {
      setState(() => _error = _errMsg(e));
    } finally {
      setState(() => _startingDownload = false);
    }
  }

  void _clear() {
    setState(() {
      _urlCtrl.clear();
      _info = null;
      _error = null;
      _apiFormat = null;
    });
  }

  Future<void> _pasteFromClipboard() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text?.trim();
    if (text != null && text.isNotEmpty) {
      setState(() => _urlCtrl.text = text);
    }
  }

  String _errMsg(Object e) => e is ApiException ? e.message : e.toString();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Download Video / Audio',
              style: theme.textTheme.titleLarge
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),

          // ── URL input ──────────────────────────────────────────────────────
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextField(
                  controller: _urlCtrl,
                  decoration: InputDecoration(
                    hintText: 'https://youtube.com/watch?v=…',
                    border: const OutlineInputBorder(),
                    contentPadding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 12),
                    suffixIcon: _urlCtrl.text.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.close, size: 18),
                            onPressed: _clear,
                          )
                        : IconButton(
                            icon: const Icon(Icons.content_paste, size: 18),
                            tooltip: 'Paste',
                            onPressed: _pasteFromClipboard,
                          ),
                  ),
                  keyboardType: TextInputType.url,
                  autocorrect: false,
                  onSubmitted: (_) => _fetchInfo(),
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                height: 48,
                child: ElevatedButton(
                  onPressed: _fetchingInfo ? null : _fetchInfo,
                  child: _fetchingInfo
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Get Info'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),

          // ── Error banner ───────────────────────────────────────────────────
          if (_error != null)
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.red.shade50,
                border: Border.all(color: Colors.red.shade200),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(_error!,
                  style: TextStyle(color: Colors.red.shade800, fontSize: 13)),
            ),

          // ── Video info card ────────────────────────────────────────────────
          if (_info != null) ...[
            const SizedBox(height: 12),
            VideoInfoCard(info: _info!),
            const SizedBox(height: 12),

            // ── Format selectors ─────────────────────────────────────────────
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Quality',
                          style: theme.textTheme.labelSmall
                              ?.copyWith(color: Colors.grey)),
                      const SizedBox(height: 4),
                      _info!.formats.isNotEmpty
                          ? DropdownButtonFormField<String>(
                              value: _apiFormat,
                              isExpanded: true,
                              decoration: const InputDecoration(
                                  border: OutlineInputBorder(),
                                  contentPadding: EdgeInsets.symmetric(
                                      horizontal: 10, vertical: 8)),
                              items: _info!.formats
                                  .map((f) => DropdownMenuItem(
                                        value: f.formatId,
                                        child: Text(f.displayLabel,
                                            overflow: TextOverflow.ellipsis),
                                      ))
                                  .toList(),
                              onChanged: (v) =>
                                  setState(() => _apiFormat = v),
                            )
                          : DropdownButtonFormField<String>(
                              value: _selectedFormat,
                              isExpanded: true,
                              decoration: const InputDecoration(
                                  border: OutlineInputBorder(),
                                  contentPadding: EdgeInsets.symmetric(
                                      horizontal: 10, vertical: 8)),
                              items: _kVideoFormats
                                  .map((f) => DropdownMenuItem(
                                        value: f['value'],
                                        child: Text(f['label']!,
                                            overflow: TextOverflow.ellipsis),
                                      ))
                                  .toList(),
                              onChanged: (v) =>
                                  setState(() => _selectedFormat = v!),
                            ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                SizedBox(
                  width: 110,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Format',
                          style: theme.textTheme.labelSmall
                              ?.copyWith(color: Colors.grey)),
                      const SizedBox(height: 4),
                      DropdownButtonFormField<String>(
                        value: _selectedExt,
                        decoration: const InputDecoration(
                            border: OutlineInputBorder(),
                            contentPadding: EdgeInsets.symmetric(
                                horizontal: 10, vertical: 8)),
                        items: _kOutputExts
                            .map((e) => DropdownMenuItem(
                                  value: e,
                                  child: Text(e.toUpperCase()),
                                ))
                            .toList(),
                        onChanged: (v) => setState(() => _selectedExt = v!),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // ── Action buttons ─────────────────────────────────────────────
            Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: _startingDownload ? null : _startDownload,
                    icon: _startingDownload
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child:
                                CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.download),
                    label: Text(_startingDownload ? 'Starting…' : 'Download'),
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(onPressed: _clear, child: const Text('Clear')),
              ],
            ),
          ],

          const SizedBox(height: 20),
          Text(
            'Supports YouTube, TikTok, Instagram, Twitter/X, Facebook, Vimeo, '
            'Dailymotion & 1,000+ more sites',
            style: theme.textTheme.bodySmall
                ?.copyWith(color: Colors.grey.shade500),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
