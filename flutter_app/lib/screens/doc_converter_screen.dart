import 'dart:io';
import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';

// Conversion matrix matching the web frontend.
const _kConversionMap = {
  'pdf': ['word', 'excel', 'powerpoint', 'jpeg', 'png'],
  'docx': ['pdf', 'excel', 'powerpoint', 'jpeg', 'png'],
  'doc': ['pdf', 'excel', 'powerpoint', 'jpeg', 'png'],
  'xlsx': ['pdf', 'word', 'powerpoint', 'jpeg', 'png'],
  'xls': ['pdf', 'word', 'powerpoint', 'jpeg', 'png'],
  'pptx': ['pdf', 'word', 'excel', 'jpeg', 'png'],
  'ppt': ['pdf', 'word', 'excel', 'jpeg', 'png'],
  'jpg': ['pdf', 'png', 'word'],
  'jpeg': ['pdf', 'png', 'word'],
  'png': ['pdf', 'jpeg', 'word'],
  'gif': ['pdf', 'jpeg', 'png'],
  'bmp': ['pdf', 'jpeg', 'png'],
  'tiff': ['pdf', 'jpeg', 'png'],
  'tif': ['pdf', 'jpeg', 'png'],
};

const _kTargetLabels = {
  'pdf': '📄 PDF',
  'word': '📝 Word (.docx)',
  'excel': '📊 Excel (.xlsx)',
  'powerpoint': '📊 PowerPoint (.pptx)',
  'jpeg': '🖼 JPEG image',
  'png': '🖼 PNG image',
};

const _kTargetExtensions = {
  'pdf': 'pdf',
  'word': 'docx',
  'excel': 'xlsx',
  'powerpoint': 'pptx',
  'jpeg': 'jpg',
  'png': 'png',
};

class DocConverterScreen extends StatefulWidget {
  const DocConverterScreen({super.key});

  @override
  State<DocConverterScreen> createState() => _DocConverterScreenState();
}

class _DocConverterScreenState extends State<DocConverterScreen> {
  File? _file;
  String? _fileExt;
  String? _selectedTarget;
  bool _converting = false;
  String? _error;
  String? _successMsg;

  Future<void> _pickFile() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: _kConversionMap.keys.toList(),
      allowMultiple: false,
    );
    if (result == null || result.files.isEmpty) return;
    final path = result.files.single.path!;
    final ext = path.split('.').last.toLowerCase();
    setState(() {
      _file = File(path);
      _fileExt = ext;
      _selectedTarget = null;
      _error = null;
      _successMsg = null;
    });
  }

  List<String> get _availableTargets {
    if (_fileExt == null) return [];
    return _kConversionMap[_fileExt] ?? [];
  }

  Future<void> _convert() async {
    if (_file == null || _selectedTarget == null) return;
    setState(() {
      _converting = true;
      _error = null;
      _successMsg = null;
    });
    try {
      final bytes = await ApiService.instance.convertDocument(_file!, _selectedTarget!);
      final outExt = _kTargetExtensions[_selectedTarget] ?? _selectedTarget!;
      final baseName = _file!.path.split('/').last.replaceAll(RegExp(r'\.[^.]+$'), '');
      final outName = '${baseName}_converted.$outExt';
      final tmp = File('${Directory.systemTemp.path}/$outName');
      await tmp.writeAsBytes(bytes);
      final uri = Uri.file(tmp.path);
      if (await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        setState(() => _successMsg = 'Opened: $outName');
      } else {
        setState(() => _successMsg = 'Saved to ${tmp.path}');
      }
    } catch (e) {
      setState(() => _error = e is ApiException ? e.message : e.toString());
    } finally {
      setState(() => _converting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final targets = _availableTargets;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Document Converter',
              style: theme.textTheme.titleLarge
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Text('Convert PDF, Word, Excel, PowerPoint & images.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: Colors.grey.shade500)),
          const SizedBox(height: 20),

          // ── File picker ────────────────────────────────────────────────────
          InkWell(
            onTap: _pickFile,
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                border: Border.all(
                  color: _file != null
                      ? theme.colorScheme.primary
                      : Colors.grey.shade300,
                  width: 2,
                ),
                borderRadius: BorderRadius.circular(12),
                color: _file != null
                    ? theme.colorScheme.primary.withOpacity(0.05)
                    : Colors.grey.shade50,
              ),
              child: Column(
                children: [
                  Icon(
                    _file != null ? Icons.check_circle_outline : Icons.upload_file,
                    size: 40,
                    color: _file != null
                        ? theme.colorScheme.primary
                        : Colors.grey.shade400,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _file != null
                        ? _file!.path.split('/').last
                        : 'Tap to pick a file',
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: _file != null
                          ? theme.colorScheme.primary
                          : Colors.grey.shade500,
                    ),
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (_file == null)
                    Text(
                      'PDF, Word, Excel, PowerPoint, images',
                      style: TextStyle(
                          fontSize: 12, color: Colors.grey.shade400),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // ── Target format ──────────────────────────────────────────────────
          if (_file != null && targets.isNotEmpty) ...[
            Text('Convert to',
                style: theme.textTheme.labelMedium
                    ?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: targets.map((t) {
                final label = _kTargetLabels[t] ?? t.toUpperCase();
                final selected = _selectedTarget == t;
                return ChoiceChip(
                  label: Text(label),
                  selected: selected,
                  onSelected: (_) =>
                      setState(() => _selectedTarget = t),
                );
              }).toList(),
            ),
            const SizedBox(height: 16),
          ],

          if (_file != null && targets.isEmpty)
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.orange.shade50,
                border: Border.all(color: Colors.orange.shade200),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                'No conversion options available for .${_fileExt ?? '?'} files.',
                style: TextStyle(color: Colors.orange.shade800),
              ),
            ),

          // ── Error / success ────────────────────────────────────────────────
          if (_error != null)
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.red.shade50,
                border: Border.all(color: Colors.red.shade200),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(_error!,
                  style: TextStyle(color: Colors.red.shade800)),
            ),

          if (_successMsg != null)
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.green.shade50,
                border: Border.all(color: Colors.green.shade200),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(_successMsg!,
                  style: TextStyle(color: Colors.green.shade800)),
            ),

          const SizedBox(height: 12),

          // ── Convert button ─────────────────────────────────────────────────
          ElevatedButton.icon(
            onPressed:
                _file != null && _selectedTarget != null && !_converting
                    ? _convert
                    : null,
            icon: _converting
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.transform),
            label: Text(_converting ? 'Converting…' : 'Convert'),
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
          ),

          if (_file != null) ...[
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => setState(() {
                _file = null;
                _fileExt = null;
                _selectedTarget = null;
                _error = null;
                _successMsg = null;
              }),
              child: const Text('Clear'),
            ),
          ],
        ],
      ),
    );
  }
}
