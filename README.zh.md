<p align="center">
  <img src="packages/ui/src/assets/brand/hero-md.webp" alt="云熙智能体 YunPat" width="280">
</p>

<p align="center">云熙智能体（YunPat）— 专利领域智能体平台，基于 <a href="https://github.com/sst/opencode">OpenCode</a>（MIT）二次开发。</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a>
</p>

---

## 说明

本仓库为**独立维护**的分叉，与 OpenCode / SST 官方无关。许可与归属见 [NOTICE](NOTICE)、[LICENSE](LICENSE)。

上游只读参考：`https://github.com/sst/opencode.git`

---

## 仓库内容

专利核心 monorepo：

- `packages/opencode` — CLI / 服务端引擎
- `packages/opencode-patent-plugin` — 专利工作流
- `packages/app`、`packages/ui` — Web 界面
- `packages/desktop` — Electron 桌面端
- `packages/core`、`packages/sdk`、`packages/plugin`、`packages/script`

原上游的 console、文档站、infra、GitHub Action 等已移至 `archive/`。

---

## 本地开发

在仓库根目录：

```bash
bun install
```

**引擎**

```bash
bun run dev
```

**Web UI**（另开终端）

```bash
bun run dev:web
```

**桌面端**

```bash
bun run dev:desktop
```

类型检查：

```bash
bun typecheck
```

测试请在各 package 目录执行，例如 `cd packages/opencode && bun test`。

---

## 配置

- 项目级 Agent：`.yunpat-agent/`
- 环境变量仍兼容 `OPENCODE_*`
- 模型：自备 API Key，本地开发**不需要** opencode.ai 账号

详见 [docs/independence.md](docs/independence.md)。

---

## 桌面端小范围内测（无需 Apple 开发者账号）

```bash
cd packages/desktop
bun run build
bun run package:mac
```

测试机首次打开：右键应用 → **打开**；或 `xattr -cr /path/to/应用.app`。

---

## 仓库地址

GitHub 仓库名：`yunpat-ts`（产品/包名仍为 `yunpat`）

https://github.com/xujian519/yunpat-ts
