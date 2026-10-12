import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/session.dart';

/// More tab: holidays + announcements + profile (read-only MVP).
class MoreScreen extends StatefulWidget {
  const MoreScreen({super.key});
  @override
  State<MoreScreen> createState() => _MoreScreenState();
}

class _MoreScreenState extends State<MoreScreen> {
  List _holidays = [];
  List _ann = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = context.read<Session>().api;
    try {
      final h = await api.get('/api/holidays');
      setState(() => _holidays = (h.data?['holidays'] ?? h.data?['rows'] ?? []) as List);
    } catch (_) {}
    try {
      final a = await api.get('/api/announcements');
      setState(() => _ann = (a.data?['announcements'] ?? a.data?['rows'] ?? []) as List);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final u = context.watch<Session>().user ?? {};
    return Scaffold(
      appBar: AppBar(title: const Text('More')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Card(child: ListTile(title: Text('${u['first_name'] ?? ''} ${u['last_name'] ?? ''}'), subtitle: Text('${u['employee_id'] ?? ''} • ${u['role'] ?? ''}'))),
        const SizedBox(height: 8),
        const Text('Holidays', style: TextStyle(fontWeight: FontWeight.bold)),
        ..._holidays.take(5).map((h) => ListTile(title: Text((h['name'] ?? h['title'] ?? '').toString()), trailing: Text((h['date'] ?? '').toString()))),
        const SizedBox(height: 8),
        const Text('Announcements', style: TextStyle(fontWeight: FontWeight.bold)),
        ..._ann.take(5).map((a) => ListTile(title: Text((a['title'] ?? '').toString()), subtitle: Text((a['message'] ?? a['body'] ?? '').toString(), maxLines: 2, overflow: TextOverflow.ellipsis))),
      ]),
    );
  }
}
