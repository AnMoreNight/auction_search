const express = require('express');
const { pool } = require('../db');

const router = express.Router();

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

// Whitelisted sortable columns (query params never build SQL identifiers directly)
const SORTABLE_COLUMNS = {
    auction_no: 'auction_no',
    box_no: 'box_no',
    branch_no: 'branch_no',
    rank: 'rank',
    price: 'price',
};

// Escapes LIKE/ILIKE special characters so user input is matched literally.
function escapeLikeToken(token) {
    return token.replace(/[\\%_]/g, '\\$&');
}

// Splits a free-text query into AND-search keyword tokens
// (half-width and full-width spaces both act as separators).
function splitKeywords(q) {
    return String(q || '')
        .split(/[\s　]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
}

router.get('/search', async (req, res) => {
    const started = Date.now();
    try {
        const q = req.query.q || '';
        const scope = req.query.scope === 'recent' ? 'recent' : 'all'; // 全大会 | 直近N大会
        const count = Math.max(1, Math.min(1000, parseInt(req.query.count, 10) || 10));
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, parseInt(req.query.pageSize, 10) || DEFAULT_PAGE_SIZE));
        const offset = (page - 1) * pageSize;

        const keywords = splitKeywords(q);
        const whereParts = [];
        const params = [];

        if (scope === 'recent') {
            params.push(count);
            whereParts.push(`auction_no >= (
                SELECT MIN(auction_no) FROM (
                    SELECT DISTINCT auction_no FROM auction_items
                    ORDER BY auction_no DESC LIMIT $${params.length}
                ) recent_auctions
            )`);
        }

        keywords.forEach((kw) => {
            params.push(`%${escapeLikeToken(kw)}%`);
            whereParts.push(`detail ILIKE $${params.length} ESCAPE '\\'`);
        });

        const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

        const sortColumn = SORTABLE_COLUMNS[req.query.sortBy] || 'auction_no';
        const sortDir = req.query.sortDir === 'asc' ? 'ASC' : 'DESC';
        const orderSql = sortColumn === 'auction_no'
            ? `auction_no ${sortDir}, box_no ASC NULLS LAST, branch_no ASC NULLS LAST`
            : `${sortColumn} ${sortDir} NULLS LAST, auction_no DESC`;

        params.push(pageSize);
        const limitParamIdx = params.length;
        params.push(offset);
        const offsetParamIdx = params.length;

        const sql = `
            SELECT
                id,
                auction_no,
                box_no,
                branch_no,
                price,
                maker,
                detail,
                rank,
                COUNT(*) OVER() AS total_count
            FROM auction_items
            ${whereSql}
            ORDER BY ${orderSql}
            LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
        `;

        const result = await pool.query(sql, params);
        const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;

        res.json({
            items: result.rows.map((r) => ({
                id: r.id,
                auction_no: r.auction_no,
                box_no: r.box_no,
                branch_no: r.branch_no,
                price: r.price,
                maker: r.maker,
                detail: r.detail,
                rank: r.rank,
            })),
            total,
            page,
            pageSize,
            tookMs: Date.now() - started,
        });
    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ error: '検索中にエラーが発生しました。' });
    }
});

// Returns the highest auction_no currently in the DB, used by the UI to
// show a sensible default/help text for the "任意の大会数" option.
router.get('/tournaments/latest', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT MAX(auction_no) AS latest, COUNT(DISTINCT auction_no) AS total, MAX(updated_at) AS last_updated FROM auction_items'
        );
        res.json({
            latest: result.rows[0].latest,
            totalTournaments: Number(result.rows[0].total || 0),
            lastUpdated: result.rows[0].last_updated,
        });
    } catch (err) {
        console.error('Tournaments error:', err);
        res.status(500).json({ error: '取得中にエラーが発生しました。' });
    }
});

module.exports = router;
