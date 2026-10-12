import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/session.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _id = TextEditingController();
  final _pw = TextEditingController();
  bool _obscure = true;

  @override
  Widget build(BuildContext context) {
    final s = context.watch<Session>();
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Gensar HRMS', style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              const Text('Employee sign-in'),
              const SizedBox(height: 24),
              TextField(controller: _id, decoration: const InputDecoration(labelText: 'Employee ID / Email', border: OutlineInputBorder())),
              const SizedBox(height: 12),
              TextField(
                controller: _pw,
                obscureText: _obscure,
                decoration: InputDecoration(
                  labelText: 'Password',
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    icon: Icon(_obscure ? Icons.visibility : Icons.visibility_off),
                    onPressed: () => setState(() => _obscure = !_obscure),
                  ),
                ),
              ),
              if (s.error != null) ...[
                const SizedBox(height: 8),
                Text(s.error!, style: const TextStyle(color: Colors.red)),
              ],
              const SizedBox(height: 16),
              FilledButton(
                onPressed: s.loading
                    ? null
                    : () async {
                        final ok = await s.login(_id.text.trim(), _pw.text);
                        if (ok && context.mounted) Navigator.pushReplacementNamed(context, '/home');
                      },
                child: s.loading
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Sign in'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
