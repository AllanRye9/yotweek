import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/downloads_provider.dart';
import '../widgets/download_progress_card.dart';

/// A collapsible bottom sheet that shows all tracked downloads.
class ActiveDownloadsBar extends StatefulWidget {
  const ActiveDownloadsBar({super.key});

  @override
  State<ActiveDownloadsBar> createState() => _ActiveDownloadsBarState();
}

class _ActiveDownloadsBarState extends State<ActiveDownloadsBar> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    return Consumer<DownloadsProvider>(
      builder: (context, provider, _) {
        final all = provider.all;
        final activeCount = provider.activeCount;

        if (all.isEmpty) return const SizedBox.shrink();

        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Material(
              color: Theme.of(context).colorScheme.primaryContainer,
              child: InkWell(
                onTap: () => setState(() => _expanded = !_expanded),
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  child: Row(
                    children: [
                      if (activeCount > 0)
                        SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.5,
                            color: Theme.of(context).colorScheme.primary,
                          ),
                        )
                      else
                        Icon(Icons.download_done,
                            size: 18,
                            color: Theme.of(context).colorScheme.primary),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          activeCount > 0
                              ? '$activeCount download${activeCount == 1 ? '' : 's'} in progress'
                              : 'All downloads complete',
                          style: Theme.of(context)
                              .textTheme
                              .bodySmall
                              ?.copyWith(fontWeight: FontWeight.w600),
                        ),
                      ),
                      Icon(
                        _expanded
                            ? Icons.keyboard_arrow_down
                            : Icons.keyboard_arrow_up,
                        size: 18,
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (_expanded)
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 300),
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: all.length,
                  itemBuilder: (context, i) {
                    final entry = all[i];
                    return DownloadProgressCard(
                      entry: entry,
                      onCancel: entry.status.isActive
                          ? () => provider.cancel(entry.id)
                          : null,
                      onDismiss: !entry.status.isActive
                          ? () => provider.remove(entry.id)
                          : null,
                    );
                  },
                ),
              ),
          ],
        );
      },
    );
  }
}
