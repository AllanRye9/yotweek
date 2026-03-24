import 'package:flutter_test/flutter_test.dart';
import 'package:yot_downloader/main.dart';
import 'package:yot_downloader/config/app_config.dart';

void main() {
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
  });

  test('AppConfig default base URL', () {
    expect(AppConfig.defaultBaseUrl, 'http://localhost:8000');
  });

  test('AppConfig setBaseUrl strips trailing slash', () async {
    await AppConfig.setBaseUrl('http://example.com/');
    expect(AppConfig.baseUrl, 'http://example.com');
  });

  testWidgets('App renders without crashing', (tester) async {
    await tester.pumpWidget(const YotDownloaderApp());
    // App shell loads
    expect(find.text('YOT Downloader'), findsOneWidget);
  });
}
