import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/session.dart';

/// MVP dashboard: today attendance status + leave balance + nav to MVP modules.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});
  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  String _status = 'Loading...';
  String _balance = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = context.read<Session>().api;
    try {
      final my = await api.get('/api/attendance/my', query: {'limit': 1});
      final rows = (my.data?['records'] ?? my.data?['rows'] ?? []) as List;
      _status = rows.isEmpty ? 'Not checked in today' : (rows.first['status'] ?? 'Checked in').toString();
    } catch (_) {
      _status = 'Offline / API unreachable';
    }
    try {
      final bal = await api.get('/api/leave/balance');
      _balance = (bal.data?['balance'] ?? bal.data).toString();
    } catch (_) {}
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Gensar HRMS'),
        actions: [
          IconButton(icon: const Icon(Icons.logout), onPressed: () async {
            await s.logout();
            if (context.mounted) Navigator.pushReplacementNamed(context, '/login');
          }),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Hi, ${s.user?['first_name'] ?? ''} 👋'),
            const SizedBox(height: 12),
            Card(child: ListTile(title: const Text('Today'), subtitle: Text(_status))),
            if (_balance.isNotEmpty) Card(child: ListTile(title: const Text('Leave balance'), subtitle: Text(_balance, maxLines: 4, overflow: TextOverflow.ellipsis))),
            const SizedBox(height: 12),
            Wrap(spacing: 12, runSpacing: 12, children: [
              _tile(context, Icons.fingerprint, 'Attendance', '/attendance'),
              _tile(context, Icons.event_note, 'Leave', '/leave'),
              _tile(context, Icons.more_horiz, 'More', '/more'),
            ]),
          ],
        ),
      ),
    );
  }

  Widget _tile(BuildContext c, IconData i, String t, String route) => SizedBox(
        width: 150,
        child: Card(
          child: InkWell(
            onTap: () => Navigator.pushNamed(c, route),
            child: Padding(padding: const EdgeInsets.all(16), child: Column(children: [Icon(i, size: 32), const SizedBox(height: 8), Text(t)])),
          ),
        ),
      );
}
