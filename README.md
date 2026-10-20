# 人生富翁

單人大富翁遊戲，用一場人生（25 歲到老年）體驗財務決策，學習理財與資產分配。前端是純 HTML / CSS / JavaScript；機會與命運牌存在 SQLite，由 Python 標準函式庫寫成的伺服器提供，不需要安裝任何套件。

## 執行

```bash
python server.py
```

開啟 http://localhost:5173 。第一次啟動會自動建立 `db/game.db`，之後每次啟動都會從 `db/seed.sql` 重新載入事件牌（遊戲紀錄保留）。

> 直接用瀏覽器開啟 `index.html` 仍可遊玩，但抽不到機會與命運牌。

## 頁面

| 頁面 | 說明 |
| --- | --- |
| `index.html` | 角色與職業（可隨機更換）、月薪、開始遊玩；右上角：如何遊玩、歷史遊玩紀錄、歷史取得提示、設定 |
| `game.html` | 左上離開／暫停、右上股票／歷史事件、可拖曳縮放的地圖、擲骰子、底部現金與健康（點擊展開個人資料） |
| `result.html` | AI 評分、全服排名、遊戲總結、決策回顧、理財建議、回到主頁 |

## 規則（目前數值）

- 一圈 60 格 = 5 年，一格 = 1 個月；每走一格自動領薪並扣生活費
- 青年 25–40 歲（3 圈）→ 中年 40–65 歲（5 圈）→ 老年 65 歲以上
- 中年收入 ×1.3；老年改領退休金（月薪 40%）；中年、老年每圈健康自然下降
- 結束條件：現金歸零（破產，會先強制賣股）、健康歸零，或活到 100 歲

### 格子（每圈 60 格）

| 格子 | 青年 | 中年 | 老年 | 效果 |
| --- | --- | --- | --- | --- |
| 起點 | 1 | 1 | 1 | 無 |
| 機會 | 26 | 24 | 19 | 抽機會牌，可接受或放棄 |
| 命運 | 16 | 18 | 24 | 抽命運牌，抽到即發生 |
| 保險 | 10 | 9 | 6 | 可投保醫療險 |
| 休息（含 3 個角落） | 7 | 8 | 10 | 什麼事都沒發生 |

格子排列由 `js/data.js` 的 `layoutBoard()` 依數量平均分散產生。

### 事件牌

- 共 900 張（青年、中年、老年各 300 張），來源為 `docs/event-cards.md`
- 每張牌可能影響：現金（一次性）、每月淨收入（持續）、健康
- **同一局不會抽到重複的牌**：伺服器把每局抽過的牌記在 `game_draws`（主鍵為 `game_id + card_id`），抽牌時只從尚未抽過的牌中隨機挑選
- 醫療險：投保後，同時造成現金減少與健康下降的命運牌，現金損失理賠 80%；保費依投保時的階段固定

### 修改事件牌

1. 編輯 `docs/event-cards.md`（維持表格格式：編號｜事件｜影響｜牌種）
2. 執行 `python tools/import_cards.py` 重新產生 `db/seed.sql`
3. 重啟 `python server.py`

## API

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| POST | `/api/games` | `{jobId}` → `{gameId}`，開始新的一局 |
| POST | `/api/games/<gameId>/draw` | `{kind: "chance"|"fate", stage: "youth"|"middle"|"elder"}` → `{card}`；該階段的牌抽完時回傳 404 `exhausted` |
| POST | `/api/games/<gameId>/draws/<cardId>` | `{accepted: true|false}`，記錄機會牌的選擇 |

## 檔案結構

```
server.py           靜態網頁 + 事件牌 API
db/schema.sql       資料表：cards、games、game_draws
db/seed.sql         事件牌資料（由 tools/import_cards.py 產生）
docs/event-cards.md 事件牌清單原稿
tools/import_cards.py
css/base.css        設計變數、按鈕、彈窗、無障礙設定（深色、高對比、字級、減少動態）
css/*.css           各頁樣式
js/storage.js       localStorage / sessionStorage 工具
js/data.js          職業、階段、格子數量與排列、保險、股票、市場新聞、理財提示
js/api.js           呼叫事件牌 API
js/events.js        機會、命運、保險、休息格的事件流程
js/ui.js            彈窗、提示訊息、圖示、格式化
js/game.js          遊戲主流程
js/ai.js            AI 評分與排名（目前為本機規則版）
js/index.js / js/result.js
```

## 待辦

- **真正的 AI 評分**：架設後端呼叫 LLM，把網址填入 `js/ai.js` 的 `AI_CONFIG.evaluateEndpoint`（API 金鑰不可放在前端）。
- **全服排名**：目前為模擬數據；可沿用 `server.py` 的 SQLite 新增成績資料表後填入 `AI_CONFIG.rankEndpoint`。
