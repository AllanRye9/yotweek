import 'dart:io';
import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';

// CV themes matching the web frontend.
const _kThemes = [
  {'value': 'classic', 'label': '🔵 Classic', 'desc': 'Blue accent, professional'},
  {'value': 'modern', 'label': '🌑 Modern', 'desc': 'Dark header, sleek'},
  {'value': 'minimal', 'label': '⬜ Minimal', 'desc': 'Clean black & white'},
  {'value': 'executive', 'label': '🏅 Executive', 'desc': 'Navy & gold'},
  {'value': 'creative', 'label': '🎨 Creative', 'desc': 'Violet gradient, bold'},
  {'value': 'tech', 'label': '💻 Tech', 'desc': 'Dark slate, emerald'},
  {'value': 'elegant', 'label': '🌹 Elegant', 'desc': 'Burgundy, refined'},
  {'value': 'vibrant', 'label': '🟠 Vibrant', 'desc': 'Orange energy, modern'},
];

// Multi-step wizard steps.
const _kSteps = [
  {'id': 'personal', 'title': 'Personal Info', 'icon': Icons.person_outline},
  {'id': 'summary', 'title': 'Professional Summary', 'icon': Icons.summarize_outlined},
  {'id': 'experience', 'title': 'Work Experience', 'icon': Icons.work_outline},
  {'id': 'education', 'title': 'Education', 'icon': Icons.school_outlined},
  {'id': 'skills', 'title': 'Skills', 'icon': Icons.star_outline},
  {'id': 'extras', 'title': 'Projects & Publications', 'icon': Icons.science_outlined},
  {'id': 'theme', 'title': 'Theme & Logo', 'icon': Icons.palette_outlined},
];

class CvGeneratorScreen extends StatefulWidget {
  const CvGeneratorScreen({super.key});

  @override
  State<CvGeneratorScreen> createState() => _CvGeneratorScreenState();
}

class _CvGeneratorScreenState extends State<CvGeneratorScreen> {
  int _step = 0;
  bool _generating = false;
  String? _error;

  // Form controllers
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _location = TextEditingController();
  final _link = TextEditingController();
  final _summary = TextEditingController();
  final _experience = TextEditingController();
  final _education = TextEditingController();
  final _skills = TextEditingController();
  final _projects = TextEditingController();
  final _publications = TextEditingController();

  String _selectedTheme = 'classic';
  File? _logoFile;

  @override
  void dispose() {
    for (final c in [
      _name, _email, _phone, _location, _link, _summary,
      _experience, _education, _skills, _projects, _publications,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Map<String, String> get _fields => {
    'name': _name.text,
    'email': _email.text,
    'phone': _phone.text,
    'location': _location.text,
    'link': _link.text,
    'summary': _summary.text,
    'experience': _experience.text,
    'education': _education.text,
    'skills': _skills.text,
    'projects': _projects.text,
    'publications': _publications.text,
  };

  Future<void> _pickLogo() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.image,
      allowMultiple: false,
    );
    if (result != null && result.files.isNotEmpty) {
      setState(() => _logoFile = File(result.files.single.path!));
    }
  }

  Future<void> _pickAndExtract() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf', 'docx'],
    );
    if (result == null || result.files.isEmpty) return;
    final file = File(result.files.single.path!);
    try {
      final fields = await ApiService.instance.extractCv(file);
      setState(() {
        if (fields['name'] != null) _name.text = fields['name'].toString();
        if (fields['email'] != null) _email.text = fields['email'].toString();
        if (fields['phone'] != null) _phone.text = fields['phone'].toString();
        if (fields['location'] != null) _location.text = fields['location'].toString();
        if (fields['link'] != null) _link.text = fields['link'].toString();
        if (fields['summary'] != null) _summary.text = fields['summary'].toString();
        if (fields['experience'] != null) _experience.text = fields['experience'].toString();
        if (fields['education'] != null) _education.text = fields['education'].toString();
        if (fields['skills'] != null) _skills.text = fields['skills'].toString();
        if (fields['projects'] != null) _projects.text = fields['projects'].toString();
        if (fields['publications'] != null) _publications.text = fields['publications'].toString();
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('CV fields extracted!')));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Extract error: ${e is ApiException ? e.message : e}')));
    }
  }

  Future<void> _generate() async {
    if (_name.text.trim().isEmpty && _email.text.trim().isEmpty) {
      setState(() => _error = 'Name and email address are required.');
      return;
    }
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Please enter your full name.');
      return;
    }
    if (_email.text.trim().isEmpty) {
      setState(() => _error = 'Please enter your email address.');
      return;
    }
    setState(() {
      _generating = true;
      _error = null;
    });
    try {
      final bytes = await ApiService.instance.generateCv(
        fields: _fields,
        theme: _selectedTheme,
        logoFile: _logoFile,
      );
      // Save to temp file and launch.
      final tmp = await _saveTmp(bytes, 'cv.pdf');
      final uri = Uri.file(tmp.path);
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('CV saved – open it from your file manager')));
      }
    } catch (e) {
      setState(() => _error = e is ApiException ? e.message : e.toString());
    } finally {
      setState(() => _generating = false);
    }
  }

  Future<File> _saveTmp(List<int> bytes, String name) async {
    final dir = Directory.systemTemp;
    final file = File('${dir.path}/$name');
    await file.writeAsBytes(bytes);
    return file;
  }

  Widget _buildStep() {
    final stepId = (_kSteps[_step]['id'] as String);
    switch (stepId) {
      case 'personal':
        return _personalStep();
      case 'summary':
        return _textAreaStep('Professional Summary', _summary,
            hint: 'A brief overview of your career, strengths, and goals…');
      case 'experience':
        return _textAreaStep('Work Experience', _experience,
            hint: 'List your jobs, responsibilities, and achievements…');
      case 'education':
        return _textAreaStep('Education', _education,
            hint: 'Degrees, institutions, graduation years…');
      case 'skills':
        return _textAreaStep('Skills', _skills,
            hint: 'Languages, frameworks, tools, soft skills…');
      case 'extras':
        return _extrasStep();
      case 'theme':
        return _themeStep();
      default:
        return const SizedBox.shrink();
    }
  }

  Widget _personalStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _tf(_name, 'Full Name *', Icons.badge_outlined),
        const SizedBox(height: 12),
        _tf(_email, 'Email *', Icons.email_outlined, TextInputType.emailAddress),
        const SizedBox(height: 12),
        _tf(_phone, 'Phone', Icons.phone_outlined, TextInputType.phone),
        const SizedBox(height: 12),
        _tf(_location, 'Location', Icons.location_on_outlined),
        const SizedBox(height: 12),
        _tf(_link, 'Website / LinkedIn', Icons.link, TextInputType.url),
        const SizedBox(height: 16),
        OutlinedButton.icon(
          icon: const Icon(Icons.upload_file),
          label: const Text('Extract from existing CV (PDF/DOCX)'),
          onPressed: _pickAndExtract,
        ),
      ],
    );
  }

  Widget _textAreaStep(String label, TextEditingController ctrl, {String? hint}) {
    return TextField(
      controller: ctrl,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        border: const OutlineInputBorder(),
        alignLabelWithHint: true,
      ),
      maxLines: 10,
      minLines: 6,
      textAlignVertical: TextAlignVertical.top,
    );
  }

  Widget _extrasStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _textAreaStep('Projects', _projects,
            hint: 'Personal / professional projects you\'d like to highlight…'),
        const SizedBox(height: 16),
        _textAreaStep('Publications', _publications,
            hint: 'Papers, articles, or other published work…'),
      ],
    );
  }

  Widget _themeStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Choose a theme',
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.bold)),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: _kThemes.map((t) {
            final selected = _selectedTheme == t['value'];
            return ChoiceChip(
              label: Text(t['label'] as String),
              tooltip: t['desc'] as String,
              selected: selected,
              onSelected: (_) =>
                  setState(() => _selectedTheme = t['value'] as String),
            );
          }).toList(),
        ),
        const SizedBox(height: 20),
        Text('Logo (optional)',
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          icon: const Icon(Icons.image_outlined),
          label: Text(
              _logoFile != null ? _logoFile!.path.split('/').last : 'Pick logo image'),
          onPressed: _pickLogo,
        ),
        if (_logoFile != null) ...[
          const SizedBox(height: 8),
          TextButton.icon(
            icon: const Icon(Icons.close, size: 16, color: Colors.red),
            label: const Text('Remove logo',
                style: TextStyle(color: Colors.red)),
            onPressed: () => setState(() => _logoFile = null),
          ),
        ],
      ],
    );
  }

  Widget _tf(TextEditingController ctrl, String label, IconData icon,
      [TextInputType? type]) {
    return TextField(
      controller: ctrl,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon),
        border: const OutlineInputBorder(),
      ),
      keyboardType: type,
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final stepInfo = _kSteps[_step];
    final isLast = _step == _kSteps.length - 1;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('CV Generator',
              style: theme.textTheme.titleLarge
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Text('Create a professional PDF resume in minutes.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: Colors.grey.shade500)),
          const SizedBox(height: 16),

          // Step indicator
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: List.generate(_kSteps.length, (i) {
                final active = i == _step;
                final done = i < _step;
                return Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    GestureDetector(
                      onTap: () => setState(() => _step = i),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        width: active ? 32 : 24,
                        height: active ? 32 : 24,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: active
                              ? theme.colorScheme.primary
                              : done
                                  ? theme.colorScheme.primary.withOpacity(0.4)
                                  : Colors.grey.shade200,
                        ),
                        child: Icon(
                          done ? Icons.check : _kSteps[i]['icon'] as IconData,
                          size: active ? 16 : 13,
                          color: active || done
                              ? Colors.white
                              : Colors.grey.shade500,
                        ),
                      ),
                    ),
                    if (i < _kSteps.length - 1)
                      Container(
                        width: 20,
                        height: 2,
                        color: i < _step
                            ? theme.colorScheme.primary.withOpacity(0.4)
                            : Colors.grey.shade200,
                      ),
                  ],
                );
              }),
            ),
          ),
          const SizedBox(height: 4),
          Text(stepInfo['title'] as String,
              style: theme.textTheme.titleSmall
                  ?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 16),

          // Step content
          _buildStep(),
          const SizedBox(height: 16),

          // Error
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

          const SizedBox(height: 12),

          // Navigation
          Row(
            children: [
              if (_step > 0)
                OutlinedButton(
                  onPressed: () => setState(() => _step--),
                  child: const Text('Back'),
                ),
              const Spacer(),
              if (isLast)
                ElevatedButton.icon(
                  onPressed: _generating ? null : _generate,
                  icon: _generating
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.picture_as_pdf),
                  label:
                      Text(_generating ? 'Generating…' : 'Generate CV PDF'),
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 20, vertical: 14),
                  ),
                )
              else
                ElevatedButton(
                  onPressed: () => setState(() => _step++),
                  child: const Text('Next'),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
