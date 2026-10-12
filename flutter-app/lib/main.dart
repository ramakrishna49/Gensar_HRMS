import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/session.dart';
import 'features/auth/login_screen.dart';
import 'features/dashboard/dashboard_screen.dart';
import 'features/attendance/attendance_screen.dart';
import 'features/leave/leave_screen.dart';
import 'features/more/more_screen.dart';

void main() {
  runApp(ChangeNotifierProvider(create: (_) => Session(), child: const GensarApp()));
}

class GensarApp extends StatelessWidget {
  const GensarApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Gensar HRMS',
        theme: ThemeData(colorSchemeSeed: const Color(0xFF4F46E5), useMaterial3: true),
        initialRoute: '/login',
        routes: {
          '/login': (_) => const LoginScreen(),
          '/home': (_) => const DashboardScreen(),
          '/attendance': (_) => const AttendanceScreen(),
          '/leave': (_) => const LeaveScreen(),
          '/more': (_) => const MoreScreen(),
        },
      );
}
