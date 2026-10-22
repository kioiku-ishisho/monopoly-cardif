# 人生富翁

單人大富翁遊戲，用一場人生（25 歲到老年）體驗財務決策，學習理財與資產分配。

- **前端**：純 HTML / CSS / JavaScript（不需建置）
- **後端**：Vercel Serverless Functions（`api/`）
- **資料庫**：Firebase Firestore（事件牌、每局抽牌紀錄、全服排行榜）
- **AI 評分**：Claude API（`claude-haiku-5-5`）

```
瀏覽器 ──► Vercel（靜態網頁 + /api/*）──► Firestore
                                    └──► Claude API
```

瀏覽器不會直接連 Firestore 或 Claude；所有金鑰只存在 Vercel 的環境變數裡。

---

## 設定步驟

### 1. Firebase（Firestore）

1. 到 [Firebase Console](https://console.firebase.google.com/) →「新增專案」（Google Analytics 可關閉）。
2. 左側「建構 → Firestore Database」→「建立資料庫」→ 選 **正式版模式（production mode）**，位置建議 `asia-east1`（台灣）。
3. 「專案設定 ⚙ → 服務帳戶 → 產生新的私密金鑰」，下載 JSON 檔。
   **這個檔案等同資料庫的最高權限，不要放進專案資料夾或提交到 git。**
4. 把 JSON 轉成 base64（PowerShell）：
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\路徑\服務帳戶.json")) | Set-Clipboard
   ```
   剪貼簿裡的字串就是下面要用的 `FIREBASE_SERVICE_ACCOUNT`。
5. 部署安全規則（拒絕瀏覽器直接存取資料庫）：
   ```bash
   firebase login
   firebase use --add
   npm run deploy:rules
   ```

### 2. Claude API

1. 到 [Claude Console](https://platform.claude.com/) → Settings → **API Keys** → 建立金鑰。
2. 在 Billing 儲值，並建議設定每月消費上限（Limits）。
3. 這把金鑰就是 `ANTHROPIC_API_KEY`。

### 3. 本機環境變數與匯入事件牌

```bash
npm install
```

複製 `.env.example` 為 `.env.local`，填入上面兩個值（`.env.local` 已在 `.gitignore`）。接著把 900 張事件牌上傳到 Firestore：

```bash
npm run import-cards
```

修改 `docs/event-cards.md` 後重新執行這行即可更新牌組；`npm run import-cards:dry` 只檢查格式、不上傳。

### 4. Vercel

```bash
vercel login
vercel link
vercel env add ANTHROPIC_API_KEY
vercel env add FIREBASE_SERVICE_ACCOUNT
```

（`env add` 時 Production、Preview、Development 三個環境都勾選。）

- **本機開發**：`npm run dev`（等同 `vercel dev`），開啟 http://localhost:3000
- **正式部署**：`vercel --prod`，或在 Vercel Dashboard 連結 GitHub repo，之後 push 到 `main` 就會自動部署

### 選填環境變數

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `CLAUDE_MODEL` | `claude-haiku-5-5` | AI 評分使用的模型 |
| `EVAL_DAILY_LIMIT` | `20` | 每位玩家每天最多 AI 評分幾局（控制 API 費用） |

---

## 後端 API

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| POST | `/api/games` | `{jobId, playerId}` → `{gameId}`，開始新的一局 |
| POST | `/api/games/:id/draw` | `{kind: "chance"\|"fate", stage}` → `{card}`；該階段抽完回傳 404 `exhausted` |
| POST | `/api/games/:id/draws/:cardId` | `{accepted}`，記錄機會牌的選擇 |
| POST | `/api/evaluate` | `{gameId, playerId, record}` → `{evaluation, rank}`，Claude 評分並寫入排行榜 |
| GET | `/api/leaderboard?playerId=` | `{top, me}`：全服前 20 名（不含玩家 id，只標示自己）與自己的名次 |

### Firestore 資料結構

| 集合 | 文件 | 內容 |
| --- | --- | --- |
| `cardDecks` | `youth-chance` 等 6 份 | 一整副牌（`cards` 陣列）；抽牌只需讀一份文件 |
| `games` | 每局一份 | `playerId`、`jobId`、`drawn`（抽過的牌）、`choices`（機會牌選擇）、`evaluation`、`score` |
| `players` | 每位玩家一份 | `bestScore`（個人最高分）、`gamesEvaluated`、每日評分次數 |

### 抽卡不重複

抽牌在 Firestore **交易（transaction）** 中進行：讀取本局 `drawn` → 從剩下的牌隨機挑一張 → 寫回 `drawn`。兩次抽牌同時發生時，Firestore 會重試交易，保證同一局不會抽到重複的牌。

### AI 評分與全服排名

1. 遊戲結束後，結算頁呼叫 `/api/evaluate`。
2. 伺服器把結算數據、玩家決策、**伺服器記錄的抽牌與選擇** 交給 Claude，Claude 依五項規準（壽命 30、財富 35、健康 15、風險管理 10、結局 10）打分，並寫總結、決策回顧與建議（Structured Outputs 保證回傳格式）。
3. 伺服器把各項分數夾在滿分內後加總，寫入 `games` 與 `players.bestScore`。
4. 排名 = 個人最高分比你高的玩家數 + 1。
5. 同一局只會評分一次；重新整理會直接回傳之前的結果。
6. 已開啟 Claude 的 **refusal fallback**（`fallbacks: "default"`）：若請求被安全分類器拒絕，會自動改用建議的備援模型。

無法連線伺服器（直接開啟 HTML、API 失敗、超過每日次數）時，結算頁會改用 `js/ai.js` 的本機規則評分，並標示「不列入排名」。

### 費用與限制（估計）

- **Claude**：每局評分約數千到一萬多個輸入 token 加上思考與輸出，約 US$0.05–0.15 一局；可用 `EVAL_DAILY_LIMIT` 與 Console 的消費上限控制。
- **Firestore 免費額度**：每天 5 萬次讀取、2 萬次寫入。每次抽牌約 1 讀 1 寫，一局約 100～200 次抽牌，**免費額度大約可支撐每天 100 多局**；超過需升級 Blaze（用量計費）方案。
- **防作弊**：玩家 id 是瀏覽器裡的匿名 id，結算數據也由前端送出，有心人可以偽造分數。若要正式比賽，需改成伺服器端模擬或加入登入機制。

---

## 遊戲規則（目前數值）

- 一圈 60 格 = 5 年，一格 = 1 個月；每走一格自動領薪並扣生活費
- 青年 25–40 歲（3 圈）→ 中年 40–65 歲（5 圈）→ 老年 65 歲以上
- 中年收入 ×1.3；老年改領退休金（月薪 40%）；中年、老年每圈健康自然下降
- 結束條件：現金歸零（破產，會先強制賣股）、健康歸零，或活到 100 歲

| 格子 | 青年 | 中年 | 老年 | 效果 |
| --- | --- | --- | --- | --- |
| 起點 | 1 | 1 | 1 | 無 |
| 機會 | 26 | 24 | 19 | 抽機會牌，可接受或放棄 |
| 命運 | 16 | 18 | 24 | 抽命運牌，抽到即發生 |
| 保險 | 10 | 9 | 6 | 業務員隨機介紹 3 種符合年齡與健康條件的險種 |
| 休息（含 3 個角落） | 7 | 8 | 10 | 什麼事都沒發生 |

事件牌共 900 張（各階段 300 張），原稿在 `docs/event-cards.md`。

### 保險

九種險種的數值都在 `js/data.js` 的 `insurance`，邏輯在 `js/insurance.js`。金額以「每月」、時間以「月」設定，遊戲再依每格月數換算。

| 險種 | 25 歲月繳 | 費率 | 繳費 / 保障 | 理賠 |
| --- | --- | --- | --- | --- |
| 定期壽險 | 600 | 平準 | 繳到 65 歲 / 65 歲 | 身故 300 萬，計入「留給家人」 |
| 意外險 | 300（廚師、農夫 450；外送員 600） | 依職業 | 每圈續約 / 80 歲 | 意外醫療每次 3 萬、意外身故 300 萬 |
| 醫療險 | 800 | 自然（每圈依年齡調整） | 每圈續約 / 85 歲 | 醫藥費 80%，每次最多 15 萬 |
| 重大傷病險 | 700 | 平準 | 20 年 / 終身 | 癌症、心肌梗塞、中風、洗腎一次 100 萬 |
| 特定傷病險 | 500 | 平準 | 20 年 / 85 歲 | 心肌梗塞、中風、洗腎各 100 萬（不含癌症） |
| 癌症險 | 400 | 平準 | 20 年 / 終身 | 確診 50 萬，之後每月 1 萬共 12 個月 |
| 長照險 | 900 | 平準 | 20 年 / 終身 | 進入長照 3 個月後給付 30 萬，之後每月 3 萬 |
| 投資型保險 | 自選 3,000／5,000／10,000 | 彈性 | 可停繳 / 85 歲 | 帳戶跟著台灣50 ETF；身故 100 萬與帳戶價值取高 |
| 年金險 | 自選 3,000／5,000／10,000 | 2% 累積 | 繳到 65 歲 / 終身 | 65 歲起每月領年金，保證 20 年 |

- **投保**：其他年齡的保費線性內插；健康低於門檻拒保，低於 70 加費 30%（壽險 30–49 加費 60%）；有相關病史的險種拒保。
- **扣款**：保費每月與生活費一起扣；現金不足有 1 個月寬限期，之後停效（投資型改停繳、年金險改為不再繳費）。保費超過月薪 10% 時提醒（雙十原則）。
- **疾病標籤**：命運牌依 `js/data.js` 的 `cardTags` 分為意外、一般住院、癌症、心肌梗塞、腦中風、末期腎病，保險依標籤理賠。牌組裡的重大疾病很少，所以每回合另外依年齡與健康擲一次 `majorIllness`（會停薪數個月）。
- **長照**：健康 ≤ 30 進入長照狀態，之後每月多 3 萬照護費。
- **身故**：壽險、意外身故、投資型、年金險的給付計入結算的「留給家人」，不算玩家自己的淨資產；投資型與年金帳戶在其他結局計入淨資產。

---

## 檔案結構

```
api/                    Vercel Serverless Functions
  _lib/firebase.js      Firebase Admin 初始化
  _lib/decks.js         讀取牌組（含快取）
  _lib/http.js          共用驗證與錯誤格式
  games/index.js        建立遊戲
  games/[id]/draw.js    抽牌（交易保證不重複）
  games/[id]/draws/[cardId].js  記錄機會牌選擇
  evaluate.js           Claude 評分 + 排行榜
scripts/import-cards.mjs  事件牌匯入 Firestore
docs/event-cards.md     事件牌清單原稿
firestore.rules         Firestore 安全規則（全部拒絕瀏覽器存取）
vercel.json             Function 設定（評分最長 120 秒）
css/ js/ *.html         前端（js/world.js 產生三個不規則人生圈的地圖幾何）
```
