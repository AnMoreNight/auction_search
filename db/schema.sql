-- Auction price database search system
-- PostgreSQL schema

-- Needed for fast partial-text search (ILIKE '%keyword%') via GIN index
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Note: the source CSV's own "ID" column (when present) is not trustworthy as a
-- unique key and is ignored on import. Duplicates are instead detected by the
-- natural composite key (auction_no, box_no, branch_no) via the UNIQUE constraint
-- below; `id` here is just an internal auto-generated primary key.
CREATE TABLE IF NOT EXISTS auction_items (
    id          BIGSERIAL PRIMARY KEY,
    auction_no  INTEGER NOT NULL,        -- 大会
    box_no      TEXT NOT NULL,           -- 箱番号
    branch_no   TEXT NOT NULL,           -- 枝番号
    price       INTEGER,                 -- 金額
    maker       TEXT,                    -- メーカー（現行CSVには含まれない・任意）
    detail      TEXT NOT NULL DEFAULT '',-- 商品詳細
    rank        TEXT,                    -- ランク
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT auction_items_lot_unique UNIQUE (auction_no, box_no, branch_no)
);

-- 直近N大会 filtering: DISTINCT auction_no ORDER BY ... DESC LIMIT N relies on this index
CREATE INDEX IF NOT EXISTS idx_auction_items_auction_no
    ON auction_items (auction_no DESC);

-- Fast multi-keyword partial match search on 商品詳細 (supports ILIKE '%kw%' via GIN)
CREATE INDEX IF NOT EXISTS idx_auction_items_detail_trgm
    ON auction_items USING GIN (detail gin_trgm_ops);

-- Useful when filtering/sorting also touches maker
CREATE INDEX IF NOT EXISTS idx_auction_items_maker_trgm
    ON auction_items USING GIN (maker gin_trgm_ops);

-- Support sorting the results table by price / rank
CREATE INDEX IF NOT EXISTS idx_auction_items_price ON auction_items (price);
CREATE INDEX IF NOT EXISTS idx_auction_items_rank ON auction_items (rank);

-- Keep updated_at current on re-import/UPDATE
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auction_items_updated_at ON auction_items;
CREATE TRIGGER trg_auction_items_updated_at
    BEFORE UPDATE ON auction_items
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
