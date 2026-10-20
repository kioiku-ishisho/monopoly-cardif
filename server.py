"""人生富翁本機伺服器：提供靜態網頁與事件牌 API（SQLite）。

用法：python server.py [port]   （預設 5173）

API
  POST /api/games                         {jobId}            -> {gameId}
  POST /api/games/<gameId>/draw           {kind, stage}      -> {card} 或 404 {error: "exhausted"}
  POST /api/games/<gameId>/draws/<cardId> {accepted}         -> {ok: true}
"""
import json
import re
import sqlite3
import sys
import time
import uuid
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "db" / "game.db"
STAGES = {"youth", "middle", "elder"}
KINDS = {"chance", "fate"}


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """建立資料表，並每次啟動都以 seed.sql 重新載入事件牌（遊戲紀錄保留）。"""
    with connect() as conn:
        conn.executescript((ROOT / "db" / "schema.sql").read_text(encoding="utf-8"))
        # 舊局可能引用已刪除的牌，重載期間暫停外鍵檢查
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.executescript((ROOT / "db" / "seed.sql").read_text(encoding="utf-8"))
        count = conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    print(f"資料庫就緒：{count} 張事件牌（{DB_PATH.relative_to(ROOT)}）")


def card_json(row):
    return {
        "id": row["id"],
        "stage": row["stage"],
        "kind": row["kind"],
        "category": row["category"],
        "text": row["text"],
        "cash": row["cash"],
        "netIncome": row["net_income"],
        "health": row["health"],
    }


def create_game(body):
    job_id = str(body.get("jobId") or "")[:40]
    if not job_id:
        return 400, {"error": "jobId 必填"}
    game_id = uuid.uuid4().hex
    with connect() as conn:
        conn.execute("INSERT INTO games (id, job_id, started_at) VALUES (?, ?, ?)",
                     (game_id, job_id, int(time.time() * 1000)))
    return 200, {"gameId": game_id}


def draw_card(game_id, body):
    kind, stage = body.get("kind"), body.get("stage")
    if kind not in KINDS or stage not in STAGES:
        return 400, {"error": "kind 或 stage 不正確"}
    with connect() as conn:
        if not conn.execute("SELECT 1 FROM games WHERE id = ?", (game_id,)).fetchone():
            return 404, {"error": "game_not_found"}
        # 從本局尚未抽過的牌中隨機挑一張
        row = conn.execute(
            """SELECT * FROM cards
               WHERE stage = ? AND kind = ?
                 AND id NOT IN (SELECT card_id FROM game_draws WHERE game_id = ?)
               ORDER BY RANDOM() LIMIT 1""",
            (stage, kind, game_id),
        ).fetchone()
        if not row:
            return 404, {"error": "exhausted"}
        conn.execute("INSERT INTO game_draws (game_id, card_id, drawn_at) VALUES (?, ?, ?)",
                     (game_id, row["id"], int(time.time() * 1000)))
    return 200, {"card": card_json(row)}


def record_choice(game_id, card_id, body):
    accepted = body.get("accepted")
    if not isinstance(accepted, bool):
        return 400, {"error": "accepted 必須為 true/false"}
    with connect() as conn:
        cur = conn.execute(
            """UPDATE game_draws SET accepted = ?
               WHERE game_id = ? AND card_id = ?
                 AND card_id IN (SELECT id FROM cards WHERE kind = 'chance')""",
            (int(accepted), game_id, card_id),
        )
    if not cur.rowcount:
        return 404, {"error": "draw_not_found"}
    return 200, {"ok": True}


ROUTES = [
    (re.compile(r"^/api/games$"), lambda m, b: create_game(b)),
    (re.compile(r"^/api/games/([0-9a-f]{32})/draw$"), lambda m, b: draw_card(m[1], b)),
    (re.compile(r"^/api/games/([0-9a-f]{32})/draws/([YMO][1-6]-\d{2})$"), lambda m, b: record_choice(m[1], m[2], b)),
]


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # 開發期間不要快取，修改後重新整理即可看到
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        # 不對外提供資料庫與伺服器程式
        if path.startswith("/db/") or path.startswith("/tools/") or path.endswith(".py"):
            self.send_error(404)
            return
        super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        for pattern, handler in ROUTES:
            m = pattern.match(path)
            if m:
                try:
                    length = int(self.headers.get("Content-Length") or 0)
                    body = json.loads(self.rfile.read(length) or b"{}") if length else {}
                    if not isinstance(body, dict):
                        raise ValueError
                except ValueError:
                    self.send_json(400, {"error": "invalid_json"})
                    return
                self.send_json(*handler(m, body))
                return
        self.send_json(404, {"error": "not_found"})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    init_db()
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(ROOT)))
    print(f"人生富翁：http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
