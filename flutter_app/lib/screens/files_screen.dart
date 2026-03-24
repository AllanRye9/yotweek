import 'dart:io';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/file_item.dart';
import '../services/api_service.dart';

class FilesScreen extends StatefulWidget {
  const FilesScreen({super.key});

  @override
  State<FilesScreen> createState() => _FilesScreenState();
}

class _FilesScreenState extends State<FilesScreen> {
  List<FileItem> _files = [];
  bool _loading = false;
  String? _error;
  final Set<String> _selected = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final files = await ApiService.instance.listFiles();
      setState(() => _files = files);
    } catch (e) {
      setState(() => _error = e is ApiException ? e.message : e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _openFile(FileItem file) async {
    final url = Uri.parse(ApiService.instance.downloadUrl(file.name));
    if (!await launchUrl(url, mode: LaunchMode.externalApplication)) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Cannot open ${file.name}')));
    }
  }

  Future<void> _deleteFile(FileItem file) async {
    final confirmed = await _confirm('Delete "${file.name}"?');
    if (!confirmed) return;
    try {
      await ApiService.instance.deleteFile(file.name);
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: ${e is ApiException ? e.message : e}')));
    }
  }

  Future<void> _downloadZip() async {
    if (_selected.isEmpty) return;
    try {
      final bytes = await ApiService.instance.downloadZip(_selected.toList());
      final tmp = File(
          '${Directory.systemTemp.path}/yot_downloads_${DateTime.now().millisecondsSinceEpoch}.zip');
      await tmp.writeAsBytes(bytes);
      final uri = Uri.file(tmp.path);
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('ZIP saved to ${tmp.path}')));
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: ${e is ApiException ? e.message : e}')));
    }
  }

  Future<bool> _confirm(String message) async {
    return await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            content: Text(message),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(ctx, false),
                  child: const Text('Cancel')),
              TextButton(
                  onPressed: () => Navigator.pop(ctx, true),
                  child: const Text('Delete',
                      style: TextStyle(color: Colors.red))),
            ],
          ),
        ) ??
        false;
  }

  IconData _iconForExt(String ext) {
    switch (ext) {
      case 'mp4':
      case 'webm':
      case 'mkv':
      case 'avi':
        return Icons.videocam;
      case 'mp3':
      case 'm4a':
      case 'ogg':
      case 'wav':
        return Icons.audiotrack;
      case 'pdf':
        return Icons.picture_as_pdf;
      case 'docx':
      case 'doc':
        return Icons.description;
      case 'xlsx':
      case 'xls':
        return Icons.table_chart;
      default:
        return Icons.insert_drive_file;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          if (_selected.isNotEmpty)
            Container(
              color: Theme.of(context).colorScheme.primaryContainer,
              padding:
                  const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: Row(
                children: [
                  Text('${_selected.length} selected',
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                  const Spacer(),
                  TextButton.icon(
                    icon: const Icon(Icons.folder_zip, size: 18),
                    label: const Text('Download ZIP'),
                    onPressed: _downloadZip,
                  ),
                  TextButton(
                    child: const Text('Clear'),
                    onPressed: () => setState(() => _selected.clear()),
                  ),
                ],
              ),
            ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(_error!,
                                style: const TextStyle(color: Colors.red)),
                            const SizedBox(height: 12),
                            ElevatedButton(
                                onPressed: _load, child: const Text('Retry')),
                          ],
                        ),
                      )
                    : _files.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.folder_open,
                                    size: 60,
                                    color: Colors.grey.shade300),
                                const SizedBox(height: 12),
                                Text('No files yet',
                                    style: TextStyle(
                                        color: Colors.grey.shade500)),
                              ],
                            ),
                          )
                        : RefreshIndicator(
                            onRefresh: _load,
                            child: ListView.separated(
                              itemCount: _files.length,
                              separatorBuilder: (_, __) =>
                                  const Divider(height: 1),
                              itemBuilder: (context, i) {
                                final file = _files[i];
                                final isSelected =
                                    _selected.contains(file.name);
                                return ListTile(
                                  leading: Checkbox(
                                    value: isSelected,
                                    onChanged: (v) => setState(() {
                                      if (v == true) {
                                        _selected.add(file.name);
                                      } else {
                                        _selected.remove(file.name);
                                      }
                                    }),
                                  ),
                                  title: Text(file.name,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis),
                                  subtitle: file.sizeHr != null
                                      ? Text(file.sizeHr!)
                                      : null,
                                  trailing: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(_iconForExt(file.extension),
                                          color: Colors.blue.shade300,
                                          size: 20),
                                      const SizedBox(width: 4),
                                      IconButton(
                                        icon: const Icon(Icons.download,
                                            size: 20),
                                        tooltip: 'Download',
                                        onPressed: () => _openFile(file),
                                      ),
                                      IconButton(
                                        icon: const Icon(Icons.delete_outline,
                                            size: 20, color: Colors.red),
                                        tooltip: 'Delete',
                                        onPressed: () => _deleteFile(file),
                                      ),
                                    ],
                                  ),
                                  onTap: () => _openFile(file),
                                );
                              },
                            ),
                          ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _load,
        tooltip: 'Refresh',
        child: const Icon(Icons.refresh),
      ),
    );
  }
}
