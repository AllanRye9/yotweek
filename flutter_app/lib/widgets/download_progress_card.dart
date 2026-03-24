import 'package:flutter/material.dart';
import '../models/download_status.dart';
import '../providers/downloads_provider.dart';

/// A compact card that shows the progress of a single download.
class DownloadProgressCard extends StatelessWidget {
  final DownloadEntry entry;
  final VoidCallback? onCancel;
  final VoidCallback? onDismiss;

  const DownloadProgressCard({
    super.key,
    required this.entry,
    this.onCancel,
    this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    final status = entry.status;
    final theme = Theme.of(context);

    Color stateColor;
    IconData stateIcon;
    switch (status.state) {
      case 'done':
        stateColor = Colors.green;
        stateIcon = Icons.check_circle;
        break;
      case 'error':
        stateColor = Colors.red;
        stateIcon = Icons.error;
        break;
      case 'downloading':
        stateColor = theme.colorScheme.primary;
        stateIcon = Icons.download;
        break;
      case 'merging':
        stateColor = Colors.orange;
        stateIcon = Icons.merge_type;
        break;
      default:
        stateColor = Colors.grey;
        stateIcon = Icons.hourglass_top;
    }

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(stateIcon, size: 18, color: stateColor),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    status.title,
                    style: theme.textTheme.bodyMedium
                        ?.copyWith(fontWeight: FontWeight.w600),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (status.isActive && onCancel != null)
                  IconButton(
                    icon: const Icon(Icons.close, size: 18),
                    onPressed: onCancel,
                    tooltip: 'Cancel',
                    visualDensity: VisualDensity.compact,
                  ),
                if (!status.isActive && onDismiss != null)
                  IconButton(
                    icon: const Icon(Icons.close, size: 18),
                    onPressed: onDismiss,
                    tooltip: 'Dismiss',
                    visualDensity: VisualDensity.compact,
                  ),
              ],
            ),
            if (status.isActive) ...[
              const SizedBox(height: 8),
              LinearProgressIndicator(
                value: status.progress,
                backgroundColor: Colors.grey.shade200,
                color: stateColor,
                minHeight: 6,
                borderRadius: BorderRadius.circular(3),
              ),
              const SizedBox(height: 4),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    '${(status.progress * 100).toStringAsFixed(0)}%',
                    style: theme.textTheme.bodySmall,
                  ),
                  if (status.speed != null)
                    Text(status.speed!, style: theme.textTheme.bodySmall),
                  if (status.eta != null)
                    Text('ETA ${status.eta}', style: theme.textTheme.bodySmall),
                ],
              ),
            ],
            if (status.isDone && status.filename != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  '✓ ${status.filename}',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: Colors.green.shade700),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            if (status.isError && status.error != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  status.error!,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: Colors.red.shade700),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
          ],
        ),
      ),
    );
  }
}
