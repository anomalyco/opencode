<p align="center">
  <a href="https://github.com/puetsua/kancode">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">開源的 AI Coding Agent。</p>
<p align="center">
  <a href="https://github.com/puetsua/kancode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/puetsua/kancode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zht.md">繁體中文</a>
</p>

![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)

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

`bun dev` 會啟動 OpenCode TUI。若要在其他目錄執行：

```bash
bun dev <directory>
# 或在本倉庫根目錄執行
bun dev .
```

更多貢獻說明、本機建置與其他工作流程，請參閱 [CONTRIBUTING.md](./CONTRIBUTING.md)。

### Agents

OpenCode 內建了兩種 Agent，您可以使用 `Tab` 鍵快速切換。

- **build** - 預設模式，具備完整權限的 Agent，適用於開發工作。
- **plan** - 唯讀模式，適用於程式碼分析與探索。
  - 預設禁止修改檔案。
  - 執行 bash 指令前會詢問權限。
  - 非常適合用來探索陌生的程式碼庫或規劃變更。

此外，OpenCode 還包含一個 **general** 子 Agent，用於處理複雜搜尋與多步驟任務。此 Agent 供系統內部使用，亦可透過在訊息中輸入 `@general` 來呼叫。

了解更多關於 [Agents](https://opencode.ai/docs/agents) 的資訊。

### 線上文件

關於如何設定 OpenCode 的詳細資訊，請參閱 [文件](https://opencode.ai/docs)。

### 參與貢獻

如果您有興趣參與開發，請在提交 Pull Request 前先閱讀我們的 [貢獻指南 (Contributing Docs)](./CONTRIBUTING.md)。
