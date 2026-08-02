const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../data/gensar_hrms.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

function convertParams(sql, params) {
    let s = sql.replace(/NOW\(\)/g, "datetime('now')");

    const placeholders = [];
    const re = /\$(\d+)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
        placeholders.push({ index: parseInt(m[1]), pos: m.index, len: m[0].length });
    }

    placeholders.sort((a, b) => b.pos - a.pos);

    const newParams = [];
    for (const ph of placeholders) {
        newParams.unshift(params[ph.index - 1]);
        s = s.substring(0, ph.pos) + '?' + s.substring(ph.pos + ph.len);
    }

    return { sql: s, params: newParams };
}

function query(sql, params = []) {
    const converted = convertParams(sql, params);
    const s = converted.sql;
    const p = converted.params;
    const upper = s.trim().toUpperCase();

    const returningMatch = s.match(/RETURNING\s+(.+?)$/i);
    if (returningMatch && (upper.startsWith('INSERT') || upper.startsWith('UPDATE') || upper.startsWith('DELETE'))) {
        const returningCols = returningMatch[1].trim();
        const baseSql = s.replace(/\s+RETURNING\s+.+$/i, '');

        if (upper.startsWith('INSERT')) {
            const tableMatch = baseSql.match(/INSERT\s+INTO\s+(\w+)/i);
            if (tableMatch) {
                const table = tableMatch[1];
                const result = sqlite.prepare(baseSql).run(...p);
                if (result.changes > 0 && result.lastInsertRowid) {
                    const row = sqlite.prepare(`SELECT ${returningCols === '*' ? '*' : returningCols} FROM ${table} WHERE id = ?`).get(result.lastInsertRowid);
                    return { rows: row ? [row] : [] };
                }
                return { rows: [] };
            }
        }

        if (upper.startsWith('UPDATE')) {
            const match = baseSql.match(/UPDATE\s+(\w+)\s+SET\s+[\s\S]*?WHERE\s+([\s\S]*)$/i);
            if (!match) {
                sqlite.prepare(baseSql).run(...p);
                return { rows: [] };
            }
            const table = match[1];
            const where = match[2];
            const whereParamCount = (where.match(/\?/g) || []).length;
            const whereParams = p.slice(p.length - whereParamCount);
            // Capture matching rows BEFORE the update (the WHERE may reference updated columns)
            const idRows = sqlite.prepare(`SELECT id FROM ${table} WHERE ${where}`).all(...whereParams);
            const result = sqlite.prepare(baseSql).run(...p);
            if (result.changes > 0 && idRows.length > 0) {
                const ids = idRows.map(r => r.id);
                const placeholders = ids.map(() => '?').join(',');
                const row = sqlite.prepare(`SELECT ${returningCols === '*' ? '*' : returningCols} FROM ${table} WHERE id IN (${placeholders})`).get(...ids);
                return { rows: row ? [row] : [] };
            }
            return { rows: [] };
        }

        if (upper.startsWith('DELETE')) {
            const tableMatch = baseSql.match(/DELETE\s+FROM\s+(\w+)/i);
            let deletedRows = [];

            if (tableMatch && returningCols !== 'id') {
                const table = tableMatch[1];
                const idParam = p[p.length - 1];
                const check = sqlite.prepare(`SELECT ${returningCols === '*' ? '*' : returningCols} FROM ${table} WHERE id = ?`).get(idParam);
                if (check) deletedRows = [check];
            }

            const result = sqlite.prepare(baseSql).run(...p);

            if (returningCols !== 'id' && deletedRows.length > 0) {
                return { rows: deletedRows, changes: result.changes };
            }

            if (returningCols === 'id') {
                const idParam = p[p.length - 1];
                return { rows: [{ id: idParam }], changes: result.changes };
            }

            return { rows: [], changes: result.changes };
        }
    }

    if (upper.startsWith('SELECT') || upper.startsWith('WITH')) {
        return { rows: sqlite.prepare(s).all(...p) };
    }

    const result = sqlite.prepare(s).run(...p);
    return { rows: [], changes: result.changes, lastInsertRowid: result.lastInsertRowid };
}

const pool = {
    query: (sql, params) => query(sql, params),
    end: () => sqlite.close()
};

module.exports = { query, pool, sqlite };
