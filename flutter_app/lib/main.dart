import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'config/app_config.dart';
import 'config/classical_theme.dart';
import 'providers/downloads_provider.dart';
import 'screens/home_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppConfig.load();
  runApp(const YotDownloaderApp());
}

class YotDownloaderApp extends StatelessWidget {
  const YotDownloaderApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => DownloadsProvider(),
      child: MaterialApp(
        title: 'YOT',
        debugShowCheckedModeBanner: false,
        theme: ClassicalTheme.light,
        darkTheme: ClassicalTheme.dark,
        themeMode: ThemeMode.system,
        home: const HomeScreen(),
      ),
    );
  }
}
