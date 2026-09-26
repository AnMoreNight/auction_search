// One-time / large-batch CSV import using PostgreSQL COPY for maximum speed.
// Intended for the initial migration of the existing ~100,000 records.
// For the ongoing weekly ~3,000-row updates, use the web upload screen instead.
//
// Usage: npm run import:bulk -- /path/to/data.csv
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { from: copyFrom } = require('pg-copy-streams');
const { pool } = require('../src/db');
const { mapHeaders, parseRow, compositeKey, decodeCsvBuffer } = require('../src/importUtils');

const COLUMNS = ['auction_no', 'box_no', 'branch_no', 'price', 'detail', 'rank'];

function toCopyLine(rec) {
    // Escape for COPY ... WITH (FORMAT text) default format: backslash-escape
    // backslash, tab and newline; empty string stays as empty string; NULLs as \N.
    const esc = (v) => {
        if (v === null || v === undefined || v === '') return '\\N';
        return String(v).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
    };
    return COLUMNS.map((c) => esc(rec[c])).join('\t') + '\n';
}

async function main() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error('Usage: npm run import:bulk -- /path/to/data.csv');
        process.exit(1);
    }

    const content = decodeCsvBuffer(fs.readFileSync(path.resolve(filePath)));
    const rows = parse(content, { skip_empty_lines: true, relax_column_count: true });
    if (rows.length === 0) {
        console.error('CSV is empty.');
        process.exit(1);
    }

    const indexToColumn = mapHeaders(rows[0]);
    const dataRows = rows.slice(1);

    const errors = [];
    const byKey = new Map();
    dataRows.forEach((row, i) => {
        const rowNumber = i + 2;
        const { record, error } = parseRow(row, indexToColumn, rowNumber);
        if (error) {
            errors.push(error);
            return;
        }
        byKey.set(compositeKey(record), record);
    });

    console.log(`Parsed ${dataRows.length} rows, ${byKey.size} unique valid records, ${errors.length} errors.`);
    if (errors.length > 0) {
        console.log('First errors:', errors.slice(0, 10));
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`
            CREATE TEMP TABLE auction_items_staging (
                auction_no INTEGER,
                box_no TEXT,
                branch_no TEXT,
                price INTEGER,
                detail TEXT,
                rank TEXT
            ) ON COMMIT DROP
        `);

        const stream = client.query(
            copyFrom(`COPY auction_items_staging (${COLUMNS.join(', ')}) FROM STDIN WITH (FORMAT text)`)
        );

        await new Promise((resolve, reject) => {
            stream.on('error', reject);
            stream.on('finish', resolve);
            for (const rec of byKey.values()) {
                stream.write(toCopyLine(rec));
            }
            stream.end();
        });

        const upsertResult = await client.query(`
            INSERT INTO auction_items (${COLUMNS.join(', ')})
            SELECT ${COLUMNS.join(', ')} FROM auction_items_staging
            ON CONFLICT (auction_no, box_no, branch_no) DO UPDATE SET
                price = EXCLUDED.price,
                detail = EXCLUDED.detail,
                rank = EXCLUDED.rank,
                updated_at = now()
            RETURNING (xmax = 0) AS inserted
        `);

        await client.query('COMMIT');
        console.log('Refreshing planner statistics (ANALYZE)...');
        await client.query('ANALYZE auction_items');

        let inserted = 0;
        let updated = 0;
        upsertResult.rows.forEach((r) => (r.inserted ? inserted++ : updated++));
        console.log(`Done. Inserted: ${inserted}, Updated: ${updated}.`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Import failed:', err);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

main();
