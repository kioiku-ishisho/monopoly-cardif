-- 事件牌：內容由 db/seed.sql 匯入（來源 docs/event-cards.md）
CREATE TABLE IF NOT EXISTS cards (
  id          TEXT PRIMARY KEY,               -- 例：Y1-01
  stage       TEXT NOT NULL CHECK (stage IN ('youth', 'middle', 'elder')),
  kind        TEXT NOT NULL CHECK (kind IN ('chance', 'fate')),  -- 機會（可選擇）/ 命運（不可選擇）
  category    INTEGER NOT NULL CHECK (category BETWEEN 1 AND 6), -- ①～⑥ 主要影響
  text        TEXT NOT NULL,
  cash        INTEGER NOT NULL DEFAULT 0,     -- 現金一次性增減
  net_income  INTEGER NOT NULL DEFAULT 0,     -- 每月淨收入增減（持續）
  health      INTEGER NOT NULL DEFAULT 0      -- 健康增減
);
CREATE INDEX IF NOT EXISTS idx_cards_stage_kind ON cards (stage, kind);

-- 每一局遊戲
CREATE TABLE IF NOT EXISTS games (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL,
  started_at  INTEGER NOT NULL                -- Unix 時間（毫秒）
);

-- 每局抽過的牌：(game_id, card_id) 為主鍵，保證同一局不會抽到同一張
CREATE TABLE IF NOT EXISTS game_draws (
  game_id     TEXT NOT NULL REFERENCES games (id),
  card_id     TEXT NOT NULL REFERENCES cards (id),
  drawn_at    INTEGER NOT NULL,
  accepted    INTEGER,                        -- 機會牌：1 接受 / 0 放棄；命運牌為 NULL
  PRIMARY KEY (game_id, card_id)
);
