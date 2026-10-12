import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/session.dart';

/// MVP leave: balance + my requests + apply. Approvals stay web/manager Phase-2.
class LeaveScreen extends StatefulWidget {
  const LeaveScreen({super.key});
  @override
  State<LeaveScreen> createState() => _LeaveScreenState();
}

class _LeaveScreenState extends State<LeaveScreen> {
  List _mine = [];
  String _msg = '';
  final _from = TextEditingController();
  final _to = TextEditingController();
  final _reason = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await context.read<Session>().api.get('/api/leave/my');
      setState(() => _mine = (res.data?['leaves'] ?? res.data?['rows'] ?? []) as List);
    } catch (_) {}
  }

  Future<void> _apply() async {
    setState(() => _msg = '');
    try {
      await context.read<Session>().api.post('/api/leave/apply', data: {
        'from_date': _from.text.trim(),
        'to_date': _to.text.trim(),
        'reason': _reason.text.trim(),
      });
      setState(() => _msg = 'Applied.');
      await _load();
    } catch (_) {
      setState(() => _msg = 'Apply failed — check dates (YYYY-MM-DD).');
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Leave')),
        body: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            TextField(controller: _from, decoration: const InputDecoration(labelText: 'From (YYYY-MM-DD)', border: OutlineInputBorder())),
            const SizedBox(height: 8),
            TextField(controller: _to, decoration: const InputDecoration(labelText: 'To (YYYY-MM-DD)', border: OutlineInputBorder())),
            const SizedBox(height: 8),
            TextField(controller: _reason, decoration: const InputDecoration(labelText: 'Reason', border: OutlineInputBorder())),
            const SizedBox(height: 8),
            FilledButton(onPressed: _apply, child: const Text('Apply')),
            if (_msg.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_msg)),
            const SizedBox(height: 12),
            const Text('My requests', style: TextStyle(fontWeight: FontWeight.bold)),
            Expanded(
              child: ListView.builder(
                itemCount: _mine.length,
                itemBuilder: (_, i) {
                  final r = _mine[i] as Map;
                  return ListTile(
                    title: Text('${r['from_date'] ?? ''} → ${r['to_date'] ?? ''}'),
                    subtitle: Text((r['reason'] ?? '').toString(), maxLines: 2, overflow: TextOverflow.ellipsis),
                    trailing: Text((r['status'] ?? '').toString()),
                  );
                },
              ),
            ),
          ]),
        ),
      );
}
