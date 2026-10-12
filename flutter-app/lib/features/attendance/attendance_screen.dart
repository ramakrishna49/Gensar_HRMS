import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';
import '../../core/session.dart';

/// MVP attendance: check-in/out with GPS. Photo upload comes in Phase-2
/// (backend purges photos; keep parity with web flow then).
class AttendanceScreen extends StatefulWidget {
  const AttendanceScreen({super.key});
  @override
  State<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends State<AttendanceScreen> {
  String _msg = '';
  bool _busy = false;
  List _history = [];

  @override
  void initState() {
    super.initState();
    _historyLoad();
  }

  Future<Position?> _pos() async {
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
      setState(() => _msg = 'Location permission required for attendance.');
      return null;
    }
    return Geolocator.getCurrentPosition(desiredAccuracy: LocationAccuracy.high);
  }

  Future<void> _historyLoad() async {
    try {
      final res = await context.read<Session>().api.get('/api/attendance/my', query: {'limit': 10});
      setState(() => _history = (res.data?['records'] ?? res.data?['rows'] ?? []) as List);
    } catch (_) {}
  }

  Future<void> _act(String path) async {
    setState(() { _busy = true; _msg = ''; });
    try {
      final p = await _pos();
      if (p == null) return;
      await context.read<Session>().api.post(path, data: {
        'latitude': p.latitude,
        'longitude': p.longitude,
        'source': 'android-app',
      });
      setState(() => _msg = '$path ok');
      await _historyLoad();
    } catch (e) {
      setState(() => _msg = 'Failed: offline? Will queue in Phase-2.');
    } finally {
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Attendance')),
        body: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Expanded(child: FilledButton(onPressed: _busy ? null : () => _act('/api/attendance/check-in'), child: const Text('Check-in'))),
              const SizedBox(width: 12),
              Expanded(child: OutlinedButton(onPressed: _busy ? null : () => _act('/api/attendance/check-out'), child: const Text('Check-out'))),
            ]),
            if (_msg.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_msg)),
            const SizedBox(height: 12),
            const Text('Recent', style: TextStyle(fontWeight: FontWeight.bold)),
            Expanded(
              child: ListView.builder(
                itemCount: _history.length,
                itemBuilder: (_, i) {
                  final r = _history[i] as Map;
                  return ListTile(
                    title: Text((r['date'] ?? r['created_at'] ?? '').toString()),
                    subtitle: Text('in: ${r['check_in'] ?? '-'} out: ${r['check_out'] ?? '-'}'),
                    trailing: Text((r['status'] ?? '').toString()),
                  );
                },
              ),
            ),
          ]),
        ),
      );
}
