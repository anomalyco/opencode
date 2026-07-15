<p align="center">
  <img src="assets/kancode.png" alt="KanCode" width="128" />
</p>

<p align="center">
  <a href="https://github.com/puetsua/kancode">
    <strong>KanCode</strong>
  </a>
</p>
<p align="center">開源的 AI Coding Agent（TUI / CLI）。OpenCode fork，並維持雙讀相容設定。</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zht.md">繁體中文</a>
</p>

---

### 開始使用

本 fork 目前以從原始碼建置與執行為主。套件發行管道（npm、Homebrew、Scoop、安裝腳本、桌面安裝程式等）尚未提供。

**需求：** [Bun](https://bun.sh) 1.3+

```bash
git clone https://github.com/puetsua/kancode.git
cd kancode
bun install
bun dev
```

`bun dev` 會啟動 KanCode TUI。若要在其他目錄執行：

```bash
bun dev <directory>
# 或在本倉庫根目錄執行
bun dev .
```

CLI 腳本名稱為 `kancode`；安裝為 package bin 時仍保留 `opencode` 作為別名。

### 設定相容性

KanCode 會繼續讀取 OpenCode 設定：

| 類型 | 優先順序 |
| --- | --- |
| 設定檔 | 優先 `kancode.json` / `kancode.jsonc`；否則 `opencode.json` / `opencode.jsonc`（同一目錄只取第一個存在的檔名，不會合併兩個名字） |
| 專案目錄 | 同時載入 `.kancode/` 與 `.opencode/`；衝突時 `.kancode` 優先 |
| 環境變數 | 繼續支援 `OPENCODE_*`；`KANCODE_*` 為同義別名（兩者都設時以 `KANCODE_*` 為準） |
| XDG / 資料目錄 | 優先使用非空的 `kancode` 路徑；否則回退到既有的 `opencode` 目錄 |

問題回報：[puetsua/kancode](https://github.com/puetsua/kancode/issues)。

上游 OpenCode 文件仍可參考共用功能：[opencode.ai/docs](https://opencode.ai/docs)。

### Agents

KanCode 內建了兩種 Agent，您可以使用 `Tab` 鍵快速切換。

- **default** - 預設模式，具備完整權限的 Agent，適用於開發工作。
- **plan** - 唯讀模式，適用於程式碼分析與探索。
  - 預設禁止修改檔案。
  - 執行 bash 指令前會詢問權限。
  - 非常適合用來探索陌生的程式碼庫或規劃變更。

此外，還包含一個 **general** 子 Agent，用於處理複雜搜尋與多步驟任務。此 Agent 供系統內部使用，亦可透過在訊息中輸入 `@general` 來呼叫。

了解更多關於 [Agents](https://opencode.ai/docs/agents) 的資訊（上游文件）。

### 線上文件

共用設定細節請參閱上游 [OpenCode 文件](https://opencode.ai/docs)。本 fork 請優先參考 README 與 `AGENTS.md`。
