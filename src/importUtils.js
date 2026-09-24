// Shared CSV row mapping/validation used by both the web upload endpoint
// and the CLI bulk-import script, so the two stay in sync.

// Japanese header -> internal column name. Trimmed and BOM-stripped before lookup.
// Note: an "ID" column is intentionally NOT mapped here. The source CSV's ID
// is not a trustworthy unique key, so it is always ignored on import; rows are
// instead deduplicated by the natural composite key (auction_no, box_no, branch_no).
const HEADER_MAP = {
    '○回大会': 'auction_no',
    '回大会': 'auction_no',
    '大会': 'auction_no',
    '箱番号': 'box_no',
    '枝番号': 'branch_no',
    '金額': 'price',
    '落札金額': 'price',
    '商品詳細': 'detail',
    '詳細': 'detail',
    'ランク': 'rank',
};

const REQUIRED_COLUMNS = ['auction_no', 'box_no', 'branch_no', 'detail'];

function normalizeHeader(h) {
    let s = String(h || '').replace(/^﻿/, '').trim();
    // Spreadsheet exports use various visually-identical "circle" glyphs in front
    // of 回大会 (○ U+25CB, ◯ U+25EF, 〇 U+3007, ⭕ U+2B55, ●, ◎). Normalize whichever
    // one appears to a single canonical character so header matching isn't fragile
    // against the exact Unicode codepoint a given export happens to use.
    s = s.replace(/^[○◯〇⭕⚪●◎]/, '○');
    return s;
}

// Builds a { columnIndex: internalName } map from a raw CSV header row.
// Throws with a Japanese error message listing missing required headers.
function mapHeaders(headerRow) {
    const indexToColumn = {};
    headerRow.forEach((raw, idx) => {
        const h = normalizeHeader(raw);
        const mapped = HEADER_MAP[h];
        if (mapped) indexToColumn[idx] = mapped;
    });

    const found = new Set(Object.values(indexToColumn));
    const missing = REQUIRED_COLUMNS.filter((c) => !found.has(c));
    if (missing.length > 0) {
        const jp = Object.entries(HEADER_MAP)
            .filter(([, v]) => missing.includes(v))
            .map(([k]) => k);
        throw new Error(`CSVに必須列が見つかりません: ${jp.join(', ')}`);
    }

    return indexToColumn;
}

// Auction sheets commonly mark an unsold/no-price lot with a bare dash rather
// than leaving the cell empty. Treat any of these dash-only values as "no price"
// (null) instead of a validation error.
const DASH_ONLY = /^[-−‐‑‒–—―ー]+$/;

function parsePrice(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    const cleaned = String(raw).replace(/[¥円,\s]/g, '');
    if (cleaned === '' || DASH_ONLY.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

function parseAuctionNo(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') return NaN;
    const cleaned = String(raw).replace(/[^\d.-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return NaN;
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

// Converts one raw CSV row (array of cell strings) + header map into a
// validated record, or a { error } description if the row should be skipped.
function parseRow(row, indexToColumn, rowNumber) {
    const rec = {};
    Object.entries(indexToColumn).forEach(([idx, col]) => {
        rec[col] = row[Number(idx)] !== undefined ? String(row[Number(idx)]).trim() : '';
    });

    const auctionNo = parseAuctionNo(rec.auction_no);
    if (!Number.isFinite(auctionNo) || Number.isNaN(auctionNo)) {
        return { error: { row: rowNumber, reason: `大会が不正です: "${rec.auction_no}"` } };
    }

    const boxNo = (rec.box_no || '').trim();
    if (!boxNo) {
        return { error: { row: rowNumber, reason: '箱番号が空です' } };
    }

    const branchNo = (rec.branch_no || '').trim();
    if (!branchNo) {
        return { error: { row: rowNumber, reason: '枝番号が空です' } };
    }

    const price = parsePrice(rec.price);
    if (Number.isNaN(price)) {
        return { error: { row: rowNumber, reason: `金額が不正です: "${rec.price}"` } };
    }

    return {
        record: {
            auction_no: auctionNo,
            box_no: boxNo,
            branch_no: branchNo,
            price: price,
            detail: rec.detail || '',
            rank: rec.rank || null,
        },
    };
}

// Composite dedup key matching the DB's UNIQUE (auction_no, box_no, branch_no)
// constraint. Uses a control character separator so field values can never
// collide across the join (e.g. auction_no=1,box_no="23" vs auction_no=12,box_no="3").
function compositeKey(record) {
    return [record.auction_no, record.box_no, record.branch_no].join('\x1f');
}

module.exports = { HEADER_MAP, mapHeaders, parseRow, normalizeHeader, compositeKey };
