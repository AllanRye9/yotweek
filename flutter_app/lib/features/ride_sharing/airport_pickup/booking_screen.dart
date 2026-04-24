import 'package:flutter/material.dart';
import '../../../screens/dm_chat_screen.dart';
import '../../../services/api_service.dart';
import 'fare_calculator.dart';

/// Airport pickup booking screen.
///
/// Clients select an airport, enter their destination, and the system
/// auto-calculates the fare before presenting the nearest verified drivers.
class BookingScreen extends StatefulWidget {
  /// When [true] the screen omits its own [AppBar] — use this when the
  /// screen is embedded inside a parent scaffold (e.g. [RidesHubScreen]).
  final bool hideAppBar;

  const BookingScreen({super.key, this.hideAppBar = false});

  @override
  State<BookingScreen> createState() => _BookingScreenState();
}

class _BookingScreenState extends State<BookingScreen> {
  final _airportController = TextEditingController();
  final _destinationController = TextEditingController();
  bool _loading = false;
  bool _bookingLoading = false;
  String? _error;
  double? _fare;
  List<Map<String, dynamic>> _drivers = [];
  Map<String, dynamic>? _currentUser;

  @override
  void initState() {
    super.initState();
    _loadCurrentUser();
  }

  Future<void> _loadCurrentUser() async {
    await ApiService.instance.loadCookies();
    if (!mounted) return;
    try {
      final user = await ApiService.instance.getCurrentUser();
      if (mounted) setState(() => _currentUser = user);
    } catch (_) {}
  }

  @override
  void dispose() {
    _airportController.dispose();
    _destinationController.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    final airport = _airportController.text.trim();
    final destination = _destinationController.text.trim();
    if (airport.isEmpty || destination.isEmpty) {
      setState(() => _error = 'Please enter both airport and destination.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
      _fare = null;
      _drivers = [];
    });
    try {
      final result = await ApiService.instance.searchAirportPickup(
        airport: airport,
        destination: destination,
      );
      final calculatedFare = FareCalculator.fromApiResult(result);
      setState(() {
        _fare = calculatedFare;
        _drivers = List<Map<String, dynamic>>.from(result['drivers'] ?? []);
      });
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _book(Map<String, dynamic> driver) async {
    final driverUserId = (driver['user_id'] ?? driver['driver_id'] ?? '').toString();
    if (driverUserId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Driver contact info not available.')),
      );
      return;
    }
    if (_currentUser == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please sign in to book a ride.')),
      );
      return;
    }
    setState(() => _bookingLoading = true);
    try {
      final result = await ApiService.instance.startDmConversation(driverUserId);
      final conv = result['conv'] as Map<String, dynamic>? ?? {};
      final otherUser = result['other_user'] as Map<String, dynamic>? ??
          {
            'user_id': driverUserId,
            'name': (driver['name'] ?? 'Driver').toString(),
            'username': '',
            'avatar_url': '',
          };
      final conversation = {
        ...conv,
        'other_user': otherUser,
      };
      if (mounted) {
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => DmChatScreen(
              conversation: conversation,
              currentUser: _currentUser,
            ),
          ),
        );
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message), backgroundColor: Colors.red.shade700),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString()), backgroundColor: Colors.red.shade700),
        );
      }
    } finally {
      if (mounted) setState(() => _bookingLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: widget.hideAppBar
          ? null
          : AppBar(title: const Text('✈️ Airport Pickup')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _airportController,
              decoration: const InputDecoration(
                labelText: 'Airport',
                hintText: 'e.g. Nairobi JKIA',
                prefixIcon: Icon(Icons.flight_land),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _destinationController,
              decoration: const InputDecoration(
                labelText: 'Destination',
                hintText: 'e.g. Westlands, Nairobi',
                prefixIcon: Icon(Icons.location_on),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _loading ? null : _search,
              icon: _loading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.search),
              label: const Text('Find Drivers'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: const TextStyle(color: Colors.red)),
            ],
            if (_fare != null) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.green.shade50,
                  border: Border.all(color: Colors.green.shade300),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  'Estimated fare: \$${_fare!.toStringAsFixed(2)}',
                  style: TextStyle(
                    color: Colors.green.shade800,
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                  ),
                ),
              ),
            ],
            const SizedBox(height: 16),
            Expanded(
              child: _drivers.isEmpty && !_loading
                  ? const Center(
                      child: Text(
                        'Enter your airport and destination to find drivers.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Colors.grey),
                      ),
                    )
                  : ListView.builder(
                      itemCount: _drivers.length,
                      itemBuilder: (context, index) {
                        final driver = _drivers[index];
                        final verified = driver['verified'] == true;
                        return Card(
                          margin: const EdgeInsets.symmetric(vertical: 4),
                          child: ListTile(
                            leading: CircleAvatar(
                              backgroundColor:
                                  verified ? Colors.blue : Colors.grey,
                              child: Text(
                                (driver['name'] as String? ?? '?')
                                    .characters
                                    .first
                                    .toUpperCase(),
                                style: const TextStyle(color: Colors.white),
                              ),
                            ),
                            title: Row(
                              children: [
                                Text(driver['name'] as String? ?? 'Driver'),
                                if (verified) ...[
                                  const SizedBox(width: 6),
                                  const Icon(Icons.verified,
                                      color: Colors.blue, size: 16),
                                ],
                              ],
                            ),
                            subtitle: Text(
                              driver['distance_km'] != null
                                  ? '${(driver['distance_km'] as num).toStringAsFixed(1)} km away'
                                  : 'Distance unknown',
                            ),
                            trailing: ElevatedButton(
                              onPressed: _bookingLoading ? null : () => _book(driver),
                              child: _bookingLoading
                                  ? const SizedBox(
                                      width: 16,
                                      height: 16,
                                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                    )
                                  : const Text('Book'),
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
