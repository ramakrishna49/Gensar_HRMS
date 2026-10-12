require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query } = require('./server/config/database');
(async () => {
  const h = await bcrypt.hash('Test@123', 10);
  const r = await query(
    `INSERT INTO employees (employee_id, first_name, last_name, email, password_hash, joining_date, role, status, must_change_password)
     VALUES ('APPTEST001','App','Tester','apptest@gensar.local',$1,CURRENT_DATE,'employee','active',0)
     ON CONFLICT (employee_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'active'
     RETURNING id, employee_id`,
    [h]
  );
  console.log(JSON.stringify(r.rows));
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
