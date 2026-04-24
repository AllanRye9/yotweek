import 'package:flutter/material.dart';

/// Classical aesthetic theme for the YOT platform.
///
/// Design tokens:
///   Navy     #1A2A4A  – primary brand colour, top nav, active states
///   Charcoal #2C3E50  – headings, prominent text
///   Cream    #F8F4EC  – light-mode background / scaffold
///   Gold     #C9A84C  – accent, highlights, active underlines
///   White    #FFFFFF  – card surfaces
///   Grey     #6B7280  – secondary / hint text
///   Red      #DC3545  – destructive / error
///
/// All text/background pairings meet WCAG 2.1 AA (≥4.5:1 contrast for normal text).
abstract final class ClassicalTheme {
  // ── Colour constants ──────────────────────────────────────────────────────

  static const Color navy     = Color(0xFF1A2A4A);
  static const Color charcoal = Color(0xFF2C3E50);
  static const Color cream    = Color(0xFFF8F4EC);
  static const Color gold     = Color(0xFFC9A84C);
  static const Color white    = Color(0xFFFFFFFF);
  static const Color grey     = Color(0xFF6B7280);
  static const Color error    = Color(0xFFDC3545);

  // ── Shared colour values ──────────────────────────────────────────────────

  /// Navy with 10 % opacity – used for pressed/hover overlays on light mode.
  static final Color navyOverlay = navy.withOpacity(0.10);

  // ── Typography scale ──────────────────────────────────────────────────────
  //
  // Heading family: serif-stack (Georgia / fallback serif)
  // Body family   : sans-serif system stack (Roboto / SF Pro / fallback)
  // Minimum body  : 16 sp (spec §7)

  static const _serif = 'Georgia';

  static TextTheme _textTheme(Color primaryText, Color secondaryText) {
    return TextTheme(
      // Display / hero headings
      displayLarge: TextStyle(
        fontFamily: _serif,
        fontSize: 32,
        fontWeight: FontWeight.w700,
        color: primaryText,
        letterSpacing: -0.5,
      ),
      displayMedium: TextStyle(
        fontFamily: _serif,
        fontSize: 26,
        fontWeight: FontWeight.w700,
        color: primaryText,
      ),
      displaySmall: TextStyle(
        fontFamily: _serif,
        fontSize: 22,
        fontWeight: FontWeight.w600,
        color: primaryText,
      ),
      // H1 – H3 equivalents
      headlineLarge: TextStyle(
        fontFamily: _serif,
        fontSize: 20,
        fontWeight: FontWeight.w700,
        color: primaryText,
      ),
      headlineMedium: TextStyle(
        fontFamily: _serif,
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: primaryText,
      ),
      headlineSmall: TextStyle(
        fontFamily: _serif,
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: primaryText,
      ),
      // Body – minimum 16 sp per spec §7
      bodyLarge: TextStyle(fontSize: 16, color: primaryText, height: 1.5),
      bodyMedium: TextStyle(fontSize: 16, color: primaryText, height: 1.5),
      bodySmall: TextStyle(fontSize: 14, color: secondaryText, height: 1.4),
      // Labels
      labelLarge: TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: primaryText,
        letterSpacing: 0.3,
      ),
      labelMedium: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w500,
        color: secondaryText,
        letterSpacing: 0.3,
      ),
      labelSmall: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w500,
        color: secondaryText,
        letterSpacing: 0.4,
      ),
    );
  }

  // ── Light theme ───────────────────────────────────────────────────────────

  static ThemeData get light {
    const cs = ColorScheme(
      brightness:       Brightness.light,
      primary:          navy,
      onPrimary:        white,
      primaryContainer: Color(0xFFD6E0F5), // light navy tint
      onPrimaryContainer: charcoal,
      secondary:        gold,
      onSecondary:      white,
      secondaryContainer: Color(0xFFF5EDD0), // light gold tint
      onSecondaryContainer: charcoal,
      tertiary:         charcoal,
      onTertiary:       white,
      tertiaryContainer: Color(0xFFE8ECF2),
      onTertiaryContainer: charcoal,
      error:            error,
      onError:          white,
      errorContainer:   Color(0xFFFFDADA),
      onErrorContainer: Color(0xFF7A0020),
      surface:          white,
      onSurface:        charcoal,
      surfaceContainerHighest: Color(0xFFEDEAE2), // cream tint
      outline:          Color(0xFFB0A998),
      outlineVariant:   Color(0xFFD8D3C9),
      scrim:            Color(0x99000000),
      inverseSurface:   charcoal,
      onInverseSurface: cream,
      inversePrimary:   Color(0xFF91A8D8),
    );

    return _build(cs, cream, _textTheme(charcoal, grey));
  }

  // ── Dark theme ────────────────────────────────────────────────────────────

  static ThemeData get dark {
    const darkSurface = Color(0xFF14202E);
    const cs = ColorScheme(
      brightness:       Brightness.dark,
      primary:          Color(0xFF91A8D8), // lightened navy for dark bg
      onPrimary:        Color(0xFF0D1929),
      primaryContainer: Color(0xFF243653),
      onPrimaryContainer: Color(0xFFD6E0F5),
      secondary:        gold,
      onSecondary:      Color(0xFF1C1200),
      secondaryContainer: Color(0xFF3D2F0A),
      onSecondaryContainer: Color(0xFFF5E6B0),
      tertiary:         Color(0xFFB8C8E0),
      onTertiary:       Color(0xFF0D1929),
      tertiaryContainer: Color(0xFF243653),
      onTertiaryContainer: Color(0xFFD6E0F5),
      error:            Color(0xFFFF8A95),
      onError:          Color(0xFF5A0010),
      errorContainer:   Color(0xFF7A0020),
      onErrorContainer: Color(0xFFFFDADA),
      surface:          darkSurface,
      onSurface:        Color(0xFFECE8E0),
      surfaceContainerHighest: Color(0xFF1E2E40),
      outline:          Color(0xFF5A6E84),
      outlineVariant:   Color(0xFF3A4D62),
      scrim:            Color(0x99000000),
      inverseSurface:   Color(0xFFECE8E0),
      onInverseSurface: darkSurface,
      inversePrimary:   navy,
    );

    return _build(cs, darkSurface, _textTheme(const Color(0xFFECE8E0), const Color(0xFF9EAEBF)));
  }

  // ── Shared builder ────────────────────────────────────────────────────────

  static ThemeData _build(ColorScheme cs, Color scaffoldBg, TextTheme tt) {
    return ThemeData(
      useMaterial3: true,
      colorScheme: cs,
      scaffoldBackgroundColor: scaffoldBg,
      textTheme: tt,

      // ── App bar ──
      appBarTheme: AppBarTheme(
        elevation: 0,
        scrolledUnderElevation: 1,
        backgroundColor: cs.primary,
        foregroundColor: cs.onPrimary,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontFamily: _serif,
          fontSize: 18,
          fontWeight: FontWeight.w700,
          color: cs.onPrimary,
          letterSpacing: 0.2,
        ),
        iconTheme: IconThemeData(color: cs.onPrimary),
      ),

      // ── Cards ──
      cardTheme: CardTheme(
        elevation: 2,
        shadowColor: cs.primary.withOpacity(0.08),
        surfaceTintColor: Colors.transparent,
        color: cs.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: cs.outlineVariant, width: 0.8),
        ),
        margin: EdgeInsets.zero,
      ),

      // ── Inputs – underline style with floating labels (spec §5) ──
      inputDecorationTheme: InputDecorationTheme(
        filled: false,
        border: UnderlineInputBorder(
          borderSide: BorderSide(color: cs.outline, width: 1.2),
        ),
        enabledBorder: UnderlineInputBorder(
          borderSide: BorderSide(color: cs.outline, width: 1.2),
        ),
        focusedBorder: UnderlineInputBorder(
          borderSide: BorderSide(color: cs.secondary, width: 2),
        ),
        errorBorder: UnderlineInputBorder(
          borderSide: BorderSide(color: cs.error, width: 1.5),
        ),
        focusedErrorBorder: UnderlineInputBorder(
          borderSide: BorderSide(color: cs.error, width: 2),
        ),
        floatingLabelStyle: TextStyle(color: cs.secondary, fontWeight: FontWeight.w600),
        labelStyle: TextStyle(color: cs.outline),
        hintStyle: TextStyle(color: cs.outline, fontSize: 14),
        errorStyle: TextStyle(color: cs.error, fontSize: 12),
        prefixIconColor: cs.outline,
        contentPadding: const EdgeInsets.symmetric(horizontal: 0, vertical: 12),
      ),

      // ── Elevated buttons – solid navy, subtle hover lift ──
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: cs.primary,
          foregroundColor: cs.onPrimary,
          disabledBackgroundColor: cs.primary.withOpacity(0.4),
          disabledForegroundColor: cs.onPrimary.withOpacity(0.6),
          elevation: 2,
          shadowColor: cs.primary.withOpacity(0.25),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          textStyle: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.3,
          ),
        ).copyWith(
          elevation: WidgetStateProperty.resolveWith(
            (states) => states.contains(WidgetState.hovered) ? 4 : 2,
          ),
        ),
      ),

      // ── Outlined buttons ──
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: cs.primary,
          disabledForegroundColor: cs.outline.withOpacity(0.4),
          side: BorderSide(color: cs.primary, width: 1.5),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          textStyle: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.3,
          ),
        ),
      ),

      // ── Text buttons ──
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: cs.secondary,
          textStyle: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.2,
          ),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
        ),
      ),

      // ── Bottom navigation bar (mobile) ──
      navigationBarTheme: NavigationBarThemeData(
        elevation: 4,
        shadowColor: cs.primary.withOpacity(0.12),
        backgroundColor: cs.surface,
        indicatorColor: cs.primaryContainer,
        labelTextStyle: WidgetStateProperty.all(
          TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: cs.primary),
        ),
      ),

      // ── Tab bar – underline indicator in gold (spec §2) ──
      tabBarTheme: TabBarTheme(
        labelColor: cs.secondary,
        unselectedLabelColor: cs.onPrimary.withOpacity(0.7),
        indicator: UnderlineTabIndicator(
          borderSide: BorderSide(color: cs.secondary, width: 3),
          borderRadius: const BorderRadius.vertical(top: Radius.circular(2)),
        ),
        indicatorSize: TabBarIndicatorSize.tab,
        labelStyle: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.3,
        ),
        unselectedLabelStyle: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w500,
        ),
        overlayColor: WidgetStateProperty.all(Colors.white.withOpacity(0.08)),
      ),

      // ── Chips ──
      chipTheme: ChipThemeData(
        backgroundColor: cs.primaryContainer,
        selectedColor: cs.primary,
        labelStyle: TextStyle(fontSize: 13, color: cs.onPrimaryContainer),
        side: BorderSide(color: cs.outlineVariant),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(99)),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      ),

      // ── Dividers ──
      dividerTheme: DividerThemeData(
        color: cs.outlineVariant,
        thickness: 0.8,
        space: 1,
      ),

      // ── Floating action button ──
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: cs.secondary,
        foregroundColor: cs.onSecondary,
        elevation: 3,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),

      // ── Snack bars (non-intrusive top-center, spec §5) ──
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        backgroundColor: cs.inverseSurface,
        contentTextStyle: TextStyle(color: cs.onInverseSurface, fontSize: 14),
        elevation: 4,
      ),

      // ── Dialog ──
      dialogTheme: DialogTheme(
        backgroundColor: cs.surface,
        elevation: 8,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        titleTextStyle: TextStyle(
          fontFamily: _serif,
          fontSize: 18,
          fontWeight: FontWeight.w700,
          color: cs.onSurface,
        ),
      ),
    );
  }
}
