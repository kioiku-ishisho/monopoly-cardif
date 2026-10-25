# 現實人生

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
| `AGENT_DAILY_LIMIT` | `60` | 每位玩家每天最多和 AI 保險業務員對話幾則 |
| `ADVISOR_DAILY_LIMIT` | `40` | 每位玩家每天最多問階段結束時的 AI 理專幾則 |

---

## 後端 API

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| POST | `/api/games` | `{jobId, playerId}` → `{gameId}`，開始新的一局 |
| POST | `/api/games/:id/draw` | `{kind: "chance"\|"fate", stage}` → `{card}`；該階段抽完回傳 404 `exhausted` |
| POST | `/api/games/:id/draws/:cardId` | `{accepted}`，記錄機會牌的選擇 |
| POST | `/api/agent` | `{gameId, playerId, context, messages}` → `{reply, recommendations}`，AI 保險業務員對話 |
| POST | `/api/advisor` | `{gameId, playerId, context, messages}` → `{reply}`，階段結束時的 AI 理專問答 |
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
2. 伺服器用 `js/score.js` 的計分標準算分（和離線的本機評分同一套），再把分數明細、結算數據、玩家決策與**伺服器記錄的抽牌與選擇**交給 Claude，由 Claude 撰寫總結、決策回顧與建議（Structured Outputs 保證回傳格式）。
3. 分數寫入 `games` 與 `players.bestScore`。

**計分標準（100 分，不計入剩餘資產）**

| 項目 | 配分 | 計算方式 |
| --- | --- | --- |
| 壽命 | 20 | 結束年齡 ÷ 100 × 20 |
| 幸福指數 | 20 | 全程平均幸福 × 0.2 |
| 健康指數 | 20 | 全程平均健康 × 0.2 |
| 保險決策 | 20 | 保障缺口 8（醫療 35 歲前、重大疾病 40 歲前、意外 40 歲前、長照或年金 50 歲前投保得滿分，晚買得部分分數；舊保單不算）、保費占月薪 5–15% 得 4、醫療支出被理賠的比例 × 4、沒有停效 4 |
| 理財決策 | 10 | 保有 3 個月以上生活費的比例 × 4、投資 2 檔以上 3（1 檔 1.5）、沒被強制賣股也沒破產 3 |
| 保險知識 | 10 | 特殊格知識題答對率 × 10（沒遇到給 5 分） |
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

- 一圈 60 格 = 5 年，一格 = 1 個月；三個人生階段共用同一圈，每走一格自動領薪並扣生活費
- 青年 25–40 歲（3 圈）→ 中年 40–65 歲（5 圈）→ 老年 65 歲以上
- 中年收入 ×1.3；老年改領退休金（月薪 70%，隨物價調整）；青年、中年每圈健康自然恢復（+5、+3），老年每圈 −2；幸福每圈 −3～−4，存款不到 3 個月生活費再 −6
- 每個人生階段結束（40、65 歲）與遊戲結束時，顯示「階段結算與檢討」（模板見 `js/review.js`），分三個分頁：**結算**（階段初／末成績單、保單、資產配置、健康幸福與緊急預備金）、**檢討**（依階段的檢核項目給 ✅⚠️❌ 與 A–D 等第、本階段理賠與最大支出）、**理專建議**（依未達成項目給建議與下一階段重點，可問理專最多 6 題；連得上伺服器時由 `/api/advisor` 的 Claude 回答，離線時常見問題改用模板回答）。遊戲結束時沒有理專分頁
- **平衡模擬**：`node scripts/simulate.mjs` 用「不做規劃」與「有做規劃」兩種策略各跑 2,000 局，統計失敗率（破產、幸福歸零、75 歲前健康歸零）。目前數值：不做規劃約 50%、有做規劃約 13%。調參數可用 `--set economy.inflation=0.01` 試算
- **幸福指數**（0–100，起始 70）約等於心理健康：人際、休閒、壓力、悲傷等事件牌增減幸福，運動、飲食、疾病、受傷等增減健康（共 242 張牌由健康改為幸福，對照表在 `docs/幸福指數對照表.md`，由 `scripts/happiness-cards.mjs` 產生）
- **職業風險**：`js/data.js` 的 `jobs[].risk` 調整事件機率，例如外送員意外 ×2、工程師心血管 ×1.3、心理壓力 ×1.4；命運牌在伺服器端依此加權抽牌，重大疾病的發生率也會套用
- **通膨與利息**：物價每年上漲 2%，生活費、事件牌與住院費用跟著物價調整；薪資（含退休金）每圈只調升 1%；正的現金每月以年利率 1.5% 計息（`js/data.js` 的 `economy`）
- **經濟劇本**：股市依真實歷史事件的順序演出（網路泡沫 2000、SARS 2003、金融海嘯 2008、歐債 2011、中國股災 2015、新冠 2020、升息 2022、AI 熱潮 2023），每格有 30% 機率改成未來情境；事件會讓股價急跌再逐年回升，也可能影響現金、健康、幸福、物價與生病機率（`marketStory`）
- 結束條件：現金歸零（破產，會先強制賣股）、健康歸零、幸福歸零（失去生活動力），或活到 100 歲

| 格子 | 數量 | 效果 |
| --- | --- | --- |
| 起點 | 1 | 無 |
| 機會 | 20 | 抽機會牌，可接受或放棄 |
| 命運 | 17 | 抽命運牌，抽到即發生 |
| 保險業務員 | 5 | 和 AI 業務員對話（可提問、推薦險種並直接投保）；連不上伺服器時改為隨機介紹 3 種險種 |
| 住院 | 2 | 擲骰決定住院天數（點數 × 2 天），醫療費每天 1,000，醫療險可理賠；下回合暫停移動 |
| 特殊格 | 7 | 保單健檢、理財講座、觀念挑戰、貴人相助、保險優惠、保單整理日、錯過優惠各 1 格（`js/data.js` 的 `specialTiles`） |
| 休息（含 3 個角落） | 8 | 什麼事都沒發生 |

保單健檢與觀念挑戰會出保險知識題（`js/quiz.js`，限時 20 秒）；保險優惠與錯過優惠在下一次投保時結算。股票漲跌顏色可在首頁設定切換（預設台股紅漲綠跌）。

事件牌共 900 張（各階段 300 張），原稿在 `docs/event-cards.md`。

### 保險

十一種可投保險種與 5 種初始舊保單的數值都在 `js/data.js` 的 `insurance`，邏輯在 `js/insurance.js`。金額以「每月」、時間以「月」設定，遊戲再依每格月數換算。

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
| 住院日額險 | 350 | 自然（每圈依年齡調整） | 每圈續約 / 85 歲 | 住院每天 2,000，每次最多 30 天（沒有天數的事件依醫藥費估算） |
| 終身壽險（分紅） | 980 | 平準 | 20 年 / 終身 | 身故 100 萬與解約金取高；解約金依累計保費 × 年度倍數（參考真實建議書） |
| 年金險 | 自選 3,000／5,000／10,000 | 2% 累積 | 繳到 65 歲 / 終身 | 65 歲起每月領年金，保證 20 年 |

- **初始保單**：開局依機率抽保單類型（無 25%、基礎 35%／1 張、一般 30%／2 張、進階 10%／3 張），從舊保單池（小額終身壽險、舊型住院日額、學生團保延續意外險、舊型防癌險、手術險）抽不重複的已繳清保單；「保單整理日」特殊格再抽 1 張。
- **保險頁**：右上角「保險」隨時可閱讀全部險種條款、看目前報價並自己投保，也可隨時解約。每個險種有「📄 建議書」（`proposal.html`），列出逐年保費、身故給付與解約金，可列印或另存 PDF。
- **AI 業務員**：踩到保險業務員格時開啟對話（`/api/agent`，Claude 依玩家年齡、職業、健康、病史、現有保單與報價回答），推薦以按鈕呈現，玩家按下才會投保；每次來訪最多問 6 題。

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
  agent.js              AI 保險業務員對話（推薦以 tool use 回傳）
  advisor.js            階段結束時的 AI 理專問答
  _lib/catalog.js       讓伺服器讀取 js/data.js 的險種資料
  evaluate.js           Claude 評分 + 排行榜
scripts/import-cards.mjs  事件牌匯入 Firestore（解析共用 scripts/lib/cards.mjs）
scripts/simulate.mjs    遊戲平衡模擬（無畫面版的回合流程）
js/score.js             計分標準（本機評分與伺服器評分共用）
js/review.js            人生階段結算與檢討的模板（檢核項目、理專建議、常見問答）
docs/event-cards.md     事件牌清單原稿
firestore.rules         Firestore 安全規則（全部拒絕瀏覽器存取）
vercel.json             Function 設定（評分最長 120 秒）
css/ js/ *.html         前端（js/world.js 產生不規則人生圈的地圖幾何，js/quiz.js 為保險知識題庫；遊戲頁拆成 js/game/ 底下的模組，說明見 js/game.js 開頭）
```
