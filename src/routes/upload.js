const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { pool } = require('../db');
const { mapHeaders, parseRow, compositeKey, decodeCsvBuffer } = require('../importUtils');

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

const BATCH_SIZE = 500;
const COLUMNS = ['auction_no', 'box_no', 'branch_no', 'price', 'detail', 'rank'];

async function upsertBatch(client, batch) {
    const valuesSql = [];
    const params = [];
    batch.forEach((rec, i) => {
        const base = i * COLUMNS.length;
        valuesSql.push(`(${COLUMNS.map((_, j) => `$${base + j + 1}`).join(', ')})`);
        COLUMNS.forEach((col) => params.push(rec[col]));
    });

    const sql = `
        INSERT INTO auction_items (${COLUMNS.join(', ')})
        VALUES ${valuesSql.join(', ')}
        ON CONFLICT (auction_no, box_no, branch_no) DO UPDATE SET
            price = EXCLUDED.price,
            detail = EXCLUDED.detail,
            rank = EXCLUDED.rank,
            updated_at = now()
        RETURNING (xmax = 0) AS inserted
    `;

    const result = await client.query(sql, params);
    let inserted = 0;
    let updated = 0;
    result.rows.forEach((r) => (r.inserted ? inserted++ : updated++));
    return { inserted, updated };
}

router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'CSVファイルが指定されていません。' });
    }

    let rows;
    try {
        const content = decodeCsvBuffer(req.file.buffer);
        rows = parse(content, {
            skip_empty_lines: true,
            relax_column_count: true,
        });
    } catch (err) {
        return res.status(400).json({ error: `CSVの解析に失敗しました: ${err.message}` });
    }

    if (rows.length === 0) {
        return res.status(400).json({ error: 'CSVが空です。' });
    }

    let indexToColumn;
    try {
        indexToColumn = mapHeaders(rows[0]);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    const dataRows = rows.slice(1);
    const errors = [];
    const byKey = new Map(); // de-dupe within the same file (auction_no+box_no+branch_no); last occurrence wins

    dataRows.forEach((row, i) => {
        const rowNumber = i + 2; // account for header row + 1-indexing
        const { record, error } = parseRow(row, indexToColumn, rowNumber);
        if (error) {
            if (errors.length < 50) errors.push(error);
            return;
        }
        byKey.set(compositeKey(record), record);
    });

    const records = Array.from(byKey.values());
    let inserted = 0;
    let updated = 0;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
            const batch = records.slice(i, i + BATCH_SIZE);
            const result = await upsertBatch(client, batch);
            inserted += result.inserted;
            updated += result.updated;
        }
        await client.query('COMMIT');
        // Refresh planner statistics so the search index (pg_trgm) stays picked
        // correctly right after new rows land, instead of waiting for autovacuum.
        await client.query('ANALYZE auction_items');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Import error:', err);
        return res.status(500).json({ error: `DB登録中にエラーが発生しました: ${err.message}` });
    } finally {
        client.release();
    }

    res.json({
        ok: true,
        totalRows: dataRows.length,
        processed: records.length,
        inserted,
        updated,
        skipped: dataRows.length - records.length,
        errors,
    });
});

module.exports = router;
