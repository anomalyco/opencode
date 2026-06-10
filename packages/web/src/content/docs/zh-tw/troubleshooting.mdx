---
title: 疑難排解
description: 常見問題及其解決方法。
---

要偵錯 OpenCode 的問題，請先檢查其儲存在磁碟上的日誌和本地資料。

---

## 日誌

日誌檔案寫入位置：

- **macOS/Linux**: `~/.local/share/opencode/log/`
- **Windows**: 按 `WIN+R` 並貼上 `%USERPROFILE%\.local\share\opencode\log`

日誌檔案以時間戳記命名（例如 `2025-01-09T123456.log`），並保留最近的 10 個日誌檔案。

你可以透過 `--log-level` 命令列選項設定日誌等級以取得更詳細的偵錯資訊。例如：`opencode --log-level DEBUG`。

---

## 儲存

OpenCode 將工作階段資料和其他應用程式資料儲存在磁碟上：

- **macOS/Linux**: `~/.local/share/opencode/`
- **Windows**: 按 `WIN+R` 並貼上 `%USERPROFILE%\.local\share\opencode`

該目錄包含：

- `auth.json` - 身分驗證資料，如 API 金鑰、OAuth Token
- `log/` - 應用程式日誌
- `project/` - 專案特定資料，如工作階段和訊息資料
  - 如果專案位於 Git 儲存庫中，則儲存在 `./<project-slug>/storage/`
  - 如果不是 Git 儲存庫，則儲存在 `./global/storage/`

---

## 桌面應用程式

OpenCode Desktop 會在背景執行一個本地 OpenCode 伺服器（即 `opencode-cli` 附屬程序）。大多數問題是由外掛異常、快取損壞或錯誤的伺服器設定引起的。

### 快速檢查

- 完全退出並重新啟動應用程式。
- 如果應用程式顯示錯誤頁面，請點擊**重新啟動**並複製錯誤詳情。
- 僅限 macOS：`OpenCode` 選單 -> **Reload Webview**（當 UI 空白或凍結時有效）。

---

### 停用外掛

如果桌面應用程式在啟動時當機、卡住或行為異常，請先停用外掛。

#### 檢查全域設定

開啟你的全域設定檔，查找 `plugin` 鍵。

- **macOS/Linux**: `~/.config/opencode/opencode.jsonc`（或 `~/.config/opencode/opencode.json`）
- **macOS/Linux**（舊版安裝）: `~/.local/share/opencode/opencode.jsonc`
- **Windows**: 按 `WIN+R` 並貼上 `%USERPROFILE%\.config\opencode\opencode.jsonc`

如果你設定了外掛，請透過移除該鍵或將其設定為空陣列來暫時停用它們：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [],
}
```

#### 檢查外掛目錄

OpenCode 還可以從磁碟載入本地外掛。暫時將這些外掛移走（或重新命名資料夾），然後重新啟動桌面應用程式：

- **全域外掛**
  - **macOS/Linux**: `~/.config/opencode/plugins/`
  - **Windows**: 按 `WIN+R` 並貼上 `%USERPROFILE%\.config\opencode\plugins`
- **專案外掛**（僅當你使用了專案級設定時）
  - `<your-project>/.opencode/plugins/`

如果應用程式恢復正常，請逐個重新啟用外掛，找出導致問題的那個。

---

### 清除快取

如果停用外掛沒有幫助（或外掛安裝卡住了），請清除快取以便 OpenCode 重新建置。

1. 完全退出 OpenCode Desktop。
2. 刪除快取目錄：

- **macOS**: Finder -> `Cmd+Shift+G` -> 貼上 `~/.cache/opencode`
- **Linux**: 刪除 `~/.cache/opencode`（或執行 `rm -rf ~/.cache/opencode`）
- **Windows**: 按 `WIN+R` 並貼上 `%USERPROFILE%\.cache\opencode`

3. 重新啟動 OpenCode Desktop。

---

### 修復伺服器連線問題

OpenCode Desktop 可以啟動自己的本地伺服器（預設行為），也可以連線到你設定的伺服器 URL。

如果你看到**「Connection Failed」**對話框（或應用程式始終停留在啟動畫面），請檢查自訂伺服器 URL。

#### 清除桌面預設伺服器 URL

在主頁面上，點擊伺服器名稱（帶有狀態指示點）以開啟伺服器選擇器。在**預設伺服器**部分，點擊**清除**。

#### 從設定中移除 `server.port` / `server.hostname`

如果你的 `opencode.json(c)` 包含 `server` 部分，請暫時移除該部分並重新啟動桌面應用程式。

#### 檢查環境變數

如果你在環境中設定了 `OPENCODE_PORT`，桌面應用程式將嘗試使用該連接埠作為本地伺服器連接埠。

- 取消設定 `OPENCODE_PORT`（或選擇一個空閒連接埠）並重新啟動。

---

### Linux: Wayland / X11 問題

在 Linux 上，某些 Wayland 設定可能會導致視窗空白或合成器錯誤。

- 如果你使用 Wayland 且應用程式出現空白或當機，請嘗試使用 `OC_ALLOW_WAYLAND=1` 啟動。
- 如果情況變得更糟，請移除該設定並嘗試在 X11 工作階段下啟動。

---

### Windows: WebView2 執行階段

在 Windows 上，OpenCode Desktop 需要 Microsoft Edge **WebView2 Runtime**。如果應用程式開啟後是空白視窗或無法啟動，請安裝或更新 WebView2 後重試。

---

### Windows: 常見效能問題

如果你在 Windows 上遇到效能緩慢、檔案存取問題或終端機問題，請嘗試使用 [WSL (Windows Subsystem for Linux)](/docs/windows-wsl)。WSL 提供了一個 Linux 環境，能更好地與 OpenCode 的功能相容。

---

### 通知不顯示

OpenCode Desktop 僅在以下情況下顯示系統通知：

- 在作業系統設定中已為 OpenCode 啟用通知，且
- 應用程式視窗未處於焦點狀態。

---

### 重設桌面應用程式儲存（最後手段）

如果應用程式無法啟動且你無法從 UI 內部清除設定，請重設桌面應用程式的儲存狀態。

1. 退出 OpenCode Desktop。
2. 找到並刪除以下檔案（它們位於 OpenCode Desktop 應用程式資料目錄中）：

- `opencode.settings.dat`（桌面預設伺服器 URL）
- `opencode.global.dat` 和 `opencode.workspace.*.dat`（UI 狀態，如最近的伺服器/專案）

快速找到該目錄：

- **macOS**: Finder -> `Cmd+Shift+G` -> `~/Library/Application Support`（然後搜尋上述檔案名稱）
- **Linux**: 在 `~/.local/share` 下搜尋上述檔案名稱
- **Windows**: 按 `WIN+R` -> `%APPDATA%`（然後搜尋上述檔案名稱）

---

## 取得幫助

如果你遇到 OpenCode 的問題：

1. **在 GitHub 上回報問題**

   回報 Bug 或請求功能的最佳方式是透過我們的 GitHub 儲存庫：

   [**github.com/anomalyco/opencode/issues**](https://github.com/anomalyco/opencode/issues)

   在建立新 Issue 之前，請先搜尋已有的 Issue，看看你的問題是否已被回報。

2. **加入我們的 Discord**

   如需即時幫助和社群討論，請加入我們的 Discord 伺服器：

   [**opencode.ai/discord**](https://opencode.ai/discord)

---

## 常見問題

以下是一些常見問題及其解決方法。

---

### OpenCode 無法啟動

1. 檢查日誌中的錯誤訊息
2. 嘗試使用 `--print-logs` 執行以在終端機中查看輸出
3. 使用 `opencode upgrade` 確保你使用的是最新版本

---

### 身分驗證問題

1. 嘗試在 TUI 中使用 `/connect` 指令重新進行身分驗證
2. 檢查你的 API 金鑰是否有效
3. 確保你的網路允許連線到供應商的 API

---

### 模型不可用

1. 檢查你是否已通過供應商的身分驗證
2. 驗證設定中的模型名稱是否正確
3. 某些模型可能需要特定的存取權限或訂閱

如果你遇到 `ProviderModelNotFoundError`，很可能是在某處錯誤地參考了模型。
模型應按如下方式參考：`<providerId>/<modelId>`

範例：

- `openai/gpt-4.1`
- `openrouter/google/gemini-2.5-flash`
- `opencode/kimi-k2`

要查看你有權存取哪些模型，請執行 `opencode models`

---

### ProviderInitError

如果你遇到 ProviderInitError，很可能是設定無效或已損壞。

要解決此問題：

1. 首先，按照[供應商指南](/docs/providers)驗證你的供應商是否已正確設定
2. 如果問題仍然存在，請嘗試清除已儲存的設定：

   ```bash
   rm -rf ~/.local/share/opencode
   ```

   在 Windows 上，按 `WIN+R` 並刪除：`%USERPROFILE%\.local\share\opencode`

3. 在 TUI 中使用 `/connect` 指令重新與供應商進行身分驗證。

---

### AI_APICallError 和供應商套件問題

如果你遇到 API 呼叫錯誤，可能是由於供應商套件過期導致的。OpenCode 會根據需要動態安裝供應商套件（OpenAI、Anthropic、Google 等）並將它們快取到本地。

要解決供應商套件問題：

1. 清除供應商套件快取：

   ```bash
   rm -rf ~/.cache/opencode
   ```

   在 Windows 上，按 `WIN+R` 並刪除：`%USERPROFILE%\.cache\opencode`

2. 重新啟動 OpenCode 以重新安裝最新的供應商套件

這將強制 OpenCode 下載最新版本的供應商套件，通常可以解決模型參數和 API 變更帶來的相容性問題。

---

### 在 Linux 上複製/貼上不可用

Linux 使用者需要安裝以下剪貼簿工具之一，複製/貼上功能才能正常運作：

**對於 X11 系統：**

```bash
apt install -y xclip
# or
apt install -y xsel
```

**對於 Wayland 系統：**

```bash
apt install -y wl-clipboard
```

**對於無頭環境：**

```bash
apt install -y xvfb
# and run:
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
export DISPLAY=:99.0
```

OpenCode 會偵測你是否正在使用 Wayland 並優先使用 `wl-clipboard`，否則將按以下順序嘗試查找剪貼簿工具：`xclip` 和 `xsel`。
