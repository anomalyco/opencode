# 繁體中文（台灣）用語表

OpenCode V2 文件 `content/zht/` 的翻譯用語。英文欄與 `zh.md` 一致；台灣用語以自然、常見的開發者說法為準。

## 保留英文

- 產品名稱：OpenCode、Zen、Go、Go Plus、Go Teams、Desktop、Console（產品全名 OpenCode Console 譯為「OpenCode 控制台」）。
- `agent`、`subagent`（含 `coding agent` → 編碼 agent）。永不譯為「代理」。
- 供應商、模型、公司、應用程式與工具名稱。
- 縮寫：MCP、LSP、SDK、CLI、API、TUI、JSON、ZDR、SSO、SCIM、OIDC、SAML、harness、profile（Codex）、bundle、schema。
- 指令、旗標、設定鍵與值、環境變數、路徑、程式碼、URL、金鑰。
- 從產品引用的英文介面標籤，例如 **Settings › Billing**、**Add credits**，以及供應商驗證模式表格中的 Bearer、API key header、Custom header。

## 用語

| English | zht | 備註 |
| --- | --- | --- |
| agent, subagent | agent、subagent | `child agent` → 子 agent；`coding agent` → 編碼 agent |
| session | 工作階段 | `child session` → 子工作階段 |
| workspace / team | 工作區 / 團隊 | Go Teams 保留英文 |
| Console（產品） | 控制台 | OpenCode Console → OpenCode 控制台；URL、路徑、程式碼與粗體介面標籤保留英文 |
| console（瀏覽器） | 主控台 | 例如瀏覽器開發人員主控台 |
| account | 帳號 | 不用「帳戶」 |
| member / owner / admin | 成員 / 擁有者 / 管理員 | |
| organization / enterprise | 組織 / 企業 | |
| authentication / authenticate | 驗證 | 不用「認證」或「身分驗證」 |
| authorization / authorize | 授權 | |
| credential / secret | 憑證 / 密鑰 | |
| OAuth, access, bearer or install token | 權杖 | 模型用量與計費的 token 保留 `token`（例如「每 token」） |
| API key | API 金鑰 | |
| provider（模型供應商） | 供應商 | API provider 這種程式介面 → 提供者 |
| model | 模型 | |
| command | 指令 | slash command → 斜線指令 |
| config / configure / setting | 設定 | 設定檔 = config file |
| default / built-in | 預設 / 內建 | |
| plugin | 外掛 | |
| skill | 技能 | |
| tool | 工具 | |
| prompt | 提示詞 | system prompt → 系統提示詞 |
| context | 上下文 | |
| permission / approval | 權限 / 核准 | allow / ask / deny 的值保留程式碼 |
| billing / invoice | 帳單 / 發票 | |
| subscription / plan | 訂閱 / 方案 | |
| usage / limit / quota | 用量 / 上限 / 配額 | |
| credits / balance | 額度 / 餘額 | |
| top up | 儲值 | |
| pay-as-you-go | 按用量計費 | |
| spend limit | 消費上限 | |
| seat | 席次 | |
| region | 地區 | |
| domain / hostname / port | 網域 / 主機名稱 / 連接埠 | |
| proxy（網路） | 代理 | 僅指網路代理 |
| loopback | 迴環 | |
| transcript | 對話記錄 | |
| scrollback | 捲動歷史 | |
| formatter | 格式化工具 | |
| references（功能） | 引用 | 文件的「Reference」章節譯為「參考」 |
| checkpoint / snapshot | 檢查點 / 快照 | |
| effort（推理） | 推理強度 | |
| compaction | 壓縮 | agent 名稱 `compaction` 保留 |
| warming | 預熱 | |
| policy（行為規則） | 原則 | 法律文件的政策 → 政策 |
| rule / policy rule | 規則 / 權限規則 | |
| expose（API 或 RPC） | 對外提供 | 避免「暴露」 |
| composer | 輸入框 | `build/` 外掛與 API 頁面上的 `composer` 是 API 物件，保留英文 |
| Diff（檢視器或章節） | Diff | 一般差異 → 差異 |
| Free（價格或方案標籤） | 免費 | |
| base URL | 基礎 URL | |
| harness, profile（Codex） | harness、profile | 保留英文 |
| profile（AWS） | 設定檔 | 例如「具名的 AWS 設定檔」 |
| invoice / invoiced billing / credit limit | 發票 / 按發票結算 / 授信額度 | |
| keybind / shortcut | 快捷鍵 | |
| metadata | 中繼資料 | |
| frontmatter | 前置中繼資料 | 程式碼及檔案欄位原樣保留 |
| command palette | 指令面板 | |
| session fork | 建立工作階段分支 | Git 與 Effect 的 `fork` 另依語境處理 |
| raised surface | 浮層背景 | |
| checkout（Git） / worktree / well-known | checkout / worktree / well-known | 保留英文，包括 Git worktree |
| render / renderer（UI） | 算繪 / 算繪器 | 視句意可用「顯示」或「呈現」；協定轉換仍用「轉譯」 |
| fiber（Effect） | fiber | 保留英文 |

## 台灣用語對照

程式、檔案、資料夾、目錄、設定、伺服器、網路、使用者、專案、預設、支援、資料、函式、變數、物件、陣列、字串、型別、介面、模組、套件、程式庫、相依性、端點、請求、回應、標頭、主體、串流、事件、掛鉤、中介層、路由、用戶端、瀏覽器、終端機、編輯器、擴充功能、整合、連接、中斷連接、重新導向、撤銷、輪替、到期、授予、存取、角色、原則、規則、萬用字元、正規表示式、比對、解析、驗證、格式、序列化、編碼、解碼、加密、雜湊、建置、編譯、執行階段、部署、啟動、停止、重新啟動、啟用、停用、切換、選取、點選、輸入、按下、貼上、複製、剪下、復原、重做、搜尋、尋找、篩選、排序、清單、表格、欄位、參數、引數、旗標、環境變數、密鑰、偏好設定、功能、行為、範例、注意、警告、提示、錯誤、失敗、無效、可用、自訂、第三方、開源、免費、付費、價格、成本、用量、隱私、安全性、合規、稽核、日誌、偵錯、追蹤、遙測、指標、儀表板、狀態頁面、事故、中斷、維護、已棄用、舊版、移轉、重大變更、變更記錄、安裝、解除安裝、升級、更新、下載、上傳、分享、連結、映像、容器、磁碟區、防火牆、憑證。

## 風格

- 稱呼讀者為「你」，不用「您」。
- 全形標點：「」，。：；！？（）與破折號「——」；省略號用「…」。
- 中文與英文、數字之間加半形空格（「OpenCode 是一個」「5 分鐘」）；中文與全形標點之間不加空格。
- 中文句子中的括號用全形（）；純程式碼或英文縮寫的短括號可用半形，例如 (`build`)。
- 引號用「」；巢狀引號用『』。
- 避免翻譯腔：不照抄英文語序，主詞與連接詞能省則省；長句拆短。
- 標題、表格標頭、Callout 內容、程式碼區塊的說明文字都要翻譯；程式碼、行內程式碼、路徑、URL、元件與 prop 原樣保留。
- 內部連結維持 docs 根相對路徑（`/config`），不寫 `/docs/...` 或語言前綴。
- frontmatter 只翻譯 `title` 與 `description`，其他鍵與值原樣保留。
- 標題結構（數量、順序、層級）必須與英文頁完全相同。
