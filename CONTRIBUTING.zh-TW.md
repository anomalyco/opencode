# 貢獻給 OpenCode

我們希望讓大家能夠輕鬆地為 OpenCode 做貢獻。以下是最常見會被合併的變更類型：

- Bug 修復
- 增加額外的 LSP / Formatter
- 提升 LLM 效能
- 支援新的提供商 (Provider)
- 針對特定環境問題的修復
- 缺失的標準行為
- 文件改進

但是，任何 UI 或核心產品功能的變更，在實作前必須經過核心團隊的設計審查。

如果您不確定您的 PR 是否會被接受，請隨時詢問維護者，或查看帶有以下相關標籤的 issue：

- [`help wanted`](https://github.com/anomalyco/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3Ahelp-wanted)
- [`good first issue`](https://github.com/anomalyco/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22)
- [`bug`](https://github.com/anomalyco/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3Abug)
- [`perf`](https://github.com/anomalyco/opencode/issues?q=is%3Aopen%20is%3Aissue%20label%3A%22perf%22)

> [!NOTE]
> 忽略這些限制的 PR 很可能會被關閉。

想認領一個 issue 嗎？請留言，除非我們已經著手處理，否則維護者可能會將其分配給您。

## 開發 OpenCode

- 需求: Bun 1.3+
- 從程式碼庫根目錄安裝依賴項並啟動開發伺服器：

  ```bash
  bun install
  bun dev
  ```

### 在不同目錄下執行

預設情況下，`bun dev` 會在 `packages/opencode` 目錄下執行 OpenCode。若要在不同目錄或儲存庫下執行：

```bash
bun dev <directory>
```

要在 opencode 儲存庫本身的根目錄下執行 OpenCode：

```bash
bun dev .
```

### 建置 "localcode"

要編譯獨立的可執行檔：

```bash
./packages/opencode/script/build.ts --single
```

然後透過以下指令執行：

```bash
./packages/opencode/dist/opencode-<platform>/bin/opencode
```

將 `<platform>` 替換為您的平台（例如 `darwin-arm64`, `linux-x64`）。

- 核心元件：
  - `packages/opencode`: OpenCode 核心業務邏輯與伺服器。
  - `packages/opencode/src/cli/cmd/tui/`: TUI 程式碼，使用 SolidJS 和 [opentui](https://github.com/sst/opentui) 撰寫。
  - `packages/app`: 共用的 Web UI 元件，使用 SolidJS 撰寫。
  - `packages/desktop`: 原生桌面應用程式，使用 Tauri 建置（封裝了 `packages/app`）。
  - `packages/plugin`: `@opencode-ai/plugin` 的原始碼。

### 執行 Web 應用程式

要在開發過程中測試 UI 變更，請執行 Web 應用程式：

```bash
bun run --cwd packages/app dev
```

這將在 http://localhost:5173 （或輸出中顯示的其他連接埠）啟動本地開發伺服器。大多數 UI 變更都可以在此處進行測試。

### 執行桌面應用程式

桌面應用程式是一個封裝了 Web UI 的原生 Tauri 應用程式。

要執行原生桌面應用程式：

```bash
bun run --cwd packages/desktop tauri dev
```

這將在 http://localhost:1420 啟動 Web 開發伺服器並打開原生視窗。

如果您只需要 Web 開發伺服器（不需要原生 shell）：

```bash
bun run --cwd packages/desktop dev
```

要建立生產環境的 `dist/` 並建置原生應用程式包：

```bash
bun run --cwd packages/desktop tauri build
```

這將透過 Tauri 的 `beforeBuildCommand` 自動執行 `bun run --cwd packages/desktop build`。

> [!NOTE]
> 執行桌面應用程式需要額外的 Tauri 依賴項（Rust 工具鏈、特定平台的函式庫）。請參閱 [Tauri 先決條件](https://v2.tauri.app/start/prerequisites/) 了解設定說明。

> [!NOTE]
> 如果您更改了 API 或 SDK（例如 `packages/opencode/src/server/server.ts`），請執行 `./script/generate.ts` 以重新生成 SDK 和相關檔案。

請嘗試遵循 [風格指南](./STYLE_GUIDE.md)。

### 設定除錯器 (Debugger)

Bun 的除錯功能目前還比較粗糙。希望本指南能幫助您完成設定並避免一些痛點。

除錯 OpenCode 最可靠的方法是透過 `bun run --inspect=<url> dev ...` 手動在終端機執行，然後透過該 URL 附加您的除錯器。其他方法可能會導致中斷點對應錯誤，至少在 VSCode 中是這樣（因人而異）。

注意事項：

- 如果您想執行 OpenCode TUI 並在伺服器程式碼中觸發中斷點，您可能需要執行 `bun dev spawn` 而不是通常的 `bun dev`。這是因為 `bun dev` 在工作執行緒中執行伺服器，中斷點可能無法在那裡運作。
- 如果 `spawn` 對您不起作用，您可以單獨除錯伺服器：
  - 除錯伺服器：`bun run --inspect=ws://localhost:6499/ ./src/index.ts serve --port 4096`，
    然後使用 `opencode attach http://localhost:4096` 附加 TUI。
  - 除錯 TUI：`bun run --inspect=ws://localhost:6499/ --conditions=browser ./src/index.ts`

其他技巧：

- 根據您的工作流程，您可能想要使用 `--inspect-wait` 或 `--inspect-brk` 代替 `--inspect`。
- 每次呼叫都指定 `--inspect=ws://localhost:6499/` 可能很繁瑣，您可以使用 `export BUN_OPTIONS=--inspect=ws://localhost:6499/` 代替。

#### VSCode 設定

如果您使用 VSCode，可以使用我們的設定範例 [.vscode/settings.example.json](.vscode/settings.example.json) 和 [.vscode/launch.example.json](.vscode/launch.example.json)。

一些可能有問題的除錯方法：

- `"request": "launch"` 的除錯設定可能會導致中斷點對應錯誤而無法使用。
- 在 VSCode `JavaScript Debug Terminal` 中執行 OpenCode 時也會出現同樣的問題。

話雖如此，您不妨嘗試這些方法，它們可能對您有用。

## Pull Request 期望

- 盡量保持 PR 小而專注。
- 在描述中連結相關的 issue。
- 解釋問題以及您的變更為何能修復它。
- 避免使用冗長的 LLM 生成的 PR 說明。
- 在新增新函數或功能之前，請確保該行為在程式碼庫中尚未存在。

### 風格偏好

這些不是強制執行的，只是一般準則：

- **函數**：保持邏輯在一個函數內，除非拆分能透過複用或組合帶來明顯的好處。
- **解構**：不要進行不必要的變數解構。
- **控制流**：避免 `else` 陳述式。
- **錯誤處理**：盡可能使用 `.catch(...)` 而不是 `try`/`catch`。
- **類型**：追求精確的類型，避免 `any`。
- **變數**：堅持不可變模式，避免 `let`。
- **命名**：當能保持描述性時，選擇簡潔的單字識別符。
- **執行時 API**：當適合使用案例時，使用 Bun 輔助函數，如 `Bun.file()`。

## 功能請求

對於全新的功能，請從設計討論開始。開啟一個 issue 描述問題、您建議的方法（可選）以及為什麼它屬於 OpenCode。核心團隊將幫助決定是否應該推進；請等待批准，不要直接開啟功能 PR。
