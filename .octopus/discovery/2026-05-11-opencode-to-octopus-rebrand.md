# Discovery: OpenCode → Octopus 全量品牌迁移

## 问题陈述

将项目从 opencode 品牌全面迁移到 octopus 品牌，不留死角。新品牌标识为 **Octopus**（首字母大写），npm scope 使用 **`@octopus-ai`**。

## 用户原始表达

> "当前项目从opencode源代码拷贝，需要将当前项目中opencode品牌修改为octopus品牌，未来octopus品牌将独立于opencode进行迭代开发。"

追问确认：
> "1）所有opencode一律改为octopus，不要留死角；2）新品牌标识是Octopus，npm scope用@octopus-ai"

## 迭代澄清记录

| 轮次 | 问题 | 回答 |
|------|------|------|
| 1 | 是否所有层级都改？只改对外展示还是内部引用也改？npm scope 用什么？ | 所有 opencode 一律改为 octopus，不保留任何；npm scope 用 @octopus-ai |
| 2 | 品牌大小写规则？ | Octopus（首字母大写） |

## 根本需求（5 Whys）

1. **表层需求**: 将项目中的 opencode 品牌名改为 octopus
2. **Why**: 项目是从 opencode 源码拷贝的 fork，需要独立品牌
3. **Why**: 避免与上游 opencode 项目命名冲突，建立独立标识
4. **Why**: 计划在 fork 基础上独立迭代开发，需要自己的品牌生态（npm scope、CLI、文档）
5. **根本原因**: 建立独立于 opencode 的 Octopus 产品线，为长期独立迭代奠定品牌基础

## 查重结果

| 来源 | 结果 | 判定 |
|------|------|------|
| `.octopus/discovery/` | 无已有文档 | — |
| CHANGELOG.md | 不存在 | — |
| GitHub Issues (open) | 无网络访问 | 无法判定 |
| GitHub Issues (closed) | 无网络访问 | 无法判定 |

**重复判定**: ☑ 全新需求

## 影响范围初判

### 变更量级

- **TypeScript 文件**: ~5,602 处引用
- **Markdown/MDX 文件**: ~1,334 处引用
- **JSON 文件**: ~506 处引用
- **总计**: ~7,400+ 处引用，分布在 ~300+ 文件中
- **变更级别**: **XL**（>500 文件）

### 涉及的包/模块

| 包/目录 | 当前名 | 目标名 | 类型 |
|----------|--------|--------|------|
| `packages/core` | `@opencode-ai/core` | `@octopus-ai/core` | scope 重命名 |
| `packages/sdk/js` | `@opencode-ai/sdk` | `@octopus-ai/sdk` | scope 重命名 |
| `packages/opencode` | `opencode`（非 scope） | `@octopus-ai/octopus` | 目录 + 包名 |
| `packages/ui` | `@opencode-ai/ui` | `@octopus-ai/ui` | scope 重命名 |
| `packages/app` | `@opencode-ai/app` | `@octopus-ai/app` | scope 重命名 |
| `packages/desktop` | `@opencode-ai/desktop` | `@octopus-ai/desktop` | scope 重命名 |
| `packages/web` | `@opencode-ai/web` | `@octopus-ai/web` | scope 重命名 |
| `packages/llm` | `@opencode-ai/llm` | `@octopus-ai/llm` | scope 重命名 |
| `packages/enterprise` | `@opencode-ai/enterprise` | `@octopus-ai/enterprise` | scope 重命名 |
| `packages/function` | `@opencode-ai/function` | `@octopus-ai/function` | scope 重命名 |
| `packages/plugin` | `@opencode-ai/plugin` | `@octopus-ai/plugin` | scope 重命名 |
| `packages/script` | `@opencode-ai/script` | `@octopus-ai/script` | scope 重命名 |
| `packages/slack` | `@opencode-ai/slack` | `@octopus-ai/slack` | scope 重命名 |
| `packages/storybook` | `@opencode-ai/storybook` | `@octopus-ai/storybook` | scope 重命名 |
| `packages/http-recorder` | `@opencode-ai/http-recorder` | `@octopus-ai/http-recorder` | scope 重命名 |
| `packages/console/app` | `@opencode-ai/console-app` | `@octopus-ai/console-app` | scope 重命名 |
| `packages/console/core` | `@opencode-ai/console-core` | `@octopus-ai/console-core` | scope 重命名 |
| `packages/console/function` | `@opencode-ai/console-function` | `@octopus-ai/console-function` | scope 重命名 |
| `packages/console/mail` | `@opencode-ai/console-mail` | `@octopus-ai/console-mail` | scope 重命名 |
| `packages/console/resource` | `@opencode-ai/console-resource` | `@octopus-ai/console-resource` | scope 重命名 |

### 额外影响范围

| 类别 | 描述 | 预估文件数 |
|------|------|:---:|
| `.opencode/` 目录 | 项目级配置目录 → `.octopus/` | ~50 |
| `opencode.jsonc` 配置文件 | 全局 + 项目级配置文件名 | ~30 |
| 环境变量 | ~50 个 `OPENCODE_*` 环境变量 → `OCTOPUS_*` | ~80 |
| Flag 常量 | `Flag.OPENCODE_*` 命名 | ~1（集中定义） |
| API 标识符 | `createOpencode*`、`OpencodeClient` 等 | ~140 |
| VS Code 扩展 | `sdks/vscode/` 包名、命令、显示名 | ~5 |
| Zed 扩展 | `packages/extensions/zed/` | ~2 |
| GitHub Actions | ~27 个工作流文件 + 脚本中的 URL | ~35 |
| 主题文件 | `opencode.json` 主题 + `opencodeTheme` 变量 | ~10 |
| i18n 翻译 | 66 个 locale JSON + i18n key 重命名 | ~70 |
| 文档 (MDX) | ~100 个 doc 页面中的路径/示例/品牌引用 | ~100 |
| `turbo.json` | pipeline 任务名 | ~1 |
| `sst.config.ts` | 部署名 | ~1 |
| `bun.lock` | 4 个锁文件（需重新生成） | ~4 |

### 不需要修改的引用（外部依赖）

以下引用属于**外部服务/第三方**，不在本项目控制范围内，应保留：

**第三方 npm 包**:
- `@gitlab/opencode-gitlab-auth` — GitLab 提供的开源包
- `opencode-gitlab-auth` — 同上
- `opencode-poe-auth` — 第三方包
- `@opentui/*` — OpenTUI 第三方 UI 库（仅巧合前缀相似，无关）

**LLM Model ID（外部模型路由标识）**:
- `model: opencode-go/deepseek-v4-pro` — OpenCode 平台的 Go 模型前缀
- `model: opencode/claude-opus-4-7` — OpenCode 平台的 Zen 模型前缀
- `model: opencode/gpt-5.4-nano` / `opencode/kimi-k2.5` 等 — 同上
- ⚠️ **这些是 OpenCode 平台的模型 ID，不是项目品牌名。修改会导致模型路由失败。建议保留或迁移到自有模型网关后再改。**

**GitHub 基础设施标识（需配合 GitHub 设置同步修改）**:
- `OPENCODE_APP_ID` / `OPENCODE_APP_SECRET` — GitHub App 凭证（需在 GitHub 组织设置中同步改名）
- `OPENCODE_API_KEY` — CI 使用的 API Key Secret（需在 GitHub Secrets 中同步重命名）
- `opencode-agent[bot]` — Bot 账号用户名（取决于 GitHub 账号设置）
- `bot@opencode.ai` — CI email（取决于实际邮箱配置）

**外部服务 URL**:
- `https://opencode.ai/install` — OpenCode 官方安装脚本（外部服务）
- `https://discord.gg/opencode` — Discord 邀请链接（外部服务）
- `https://models.dev` — 模型列表 API（与 OpenCode 无关）

---

## Issue 拆解

### 依赖拓扑

```
Issue 1 (Scope + imports)  ← 基础层，所有后续 Issue 的依赖
  ├── Issue 2 (目录 rename)  ← 依赖 #1
  ├── Issue 3 (标识符)       ← 依赖 #1, #2
  ├── Issue 4 (env/flags)    ← 依赖 #1, #2
  ├── Issue 5 (配置系统)     ← 依赖 #1, #2
  ├── Issue 6 (主题资产)     ← 依赖 #1, #2
  ├── Issue 7 (扩展)         ← 依赖 #1, #2
  ├── Issue 8 (CI/script)    ← 依赖 #1, #2
  └── Issue 9 (文档/i18n)    ← 依赖 #1-#7（等前面稳定后再改示例）
```

### Issue 列表

| # | Issue 标题 | 预估文件数 | 级别 | 依赖 | 可并行 |
|---|-----------|:---:|:---:|------|:---:|
| 1 | **Monorepo 基础层 — npm scope 批量重命名** | ~250 | L | — | — |
| 2 | **目录重命名 — `packages/opencode` → `packages/octopus`** | ~80 | M | #1 | — |
| 3 | **API 标识符重命名** (`createOpencode*` → `createOctopus*`, `OpencodeClient` → `OctopusClient`) | ~60 | S | #1, #2 | #4, #5, #6 |
| 4 | **环境变量 & Flag 常量重命名** (`OPENCODE_*` → `OCTOPUS_*`) | ~50 | S | #1, #2 | #3, #5, #6 |
| 5 | **配置系统重命名** (`.opencode/` → `.octopus/`, `opencode.jsonc` → `octopus.jsonc`) | ~40 | S | #1, #2 | #3, #4, #6 |
| 6 | **品牌资产重命名** (主题、图标、CSS class) | ~12 | XS | #1, #2 | #3, #4, #5, #7 |
| 7 | **扩展重命名** (VS Code + Zed 扩展) | ~8 | XS | #1, #2 | #6 |
| 8 | **CI/CD & 脚本 URL 更新** | ~35 | S | #1, #2 | #3, #4, #5, #6, #7 |
| 9 | **文档 & i18n 全面更新** | ~200 | L | #1~#7 | — |

---

### Issue 1: Monorepo 基础层 — npm scope 批量重命名 [L]

**描述**: 将所有 19 个 `@opencode-ai/*` 作用域包 + 根包 `opencode` 的名称字段改为 `@octopus-ai/*` / `@octopus-ai/octopus`，同步更新所有 TypeScript `import ... from "@opencode-ai/*"` 语句。

**范围**:
- 20 个 `package.json` 的 `"name"` 字段
- 根 `package.json` 的 `workspaces` + `dependencies` + `repository`
- ~200 个文件中的 `import { ... } from "@opencode-ai/*"` 语句
- `turbo.json` 中的 pipeline 任务名（`opencode#test` → `octopus#test` 等）
- `.opencode/package.json` 中的 SDK 依赖

**验收标准**:
- [ ] `grep '@opencode-ai' packages/` 零结果
- [ ] `bun install` 成功（无未解析 workspace 依赖）
- [ ] `bun turbo typecheck` 全量通过

**注意**: 此 Issue 变更量大但机械化，可用 `sed` 批量替换 + `bun install` 验证。

---

### Issue 2: 目录重命名 — `packages/opencode` → `packages/octopus` [M]

**描述**: 将 `packages/octopus/` 目录及其内部 `"name": "opencode"`、`"bin": { "opencode": ... }` 等字段改为 octopus。

**范围**:
- `git mv packages/opencode packages/octopus`
- 目录内 `package.json`: name + bin 字段
- 全仓路径引用: `packages/octopus/` → `packages/octopus/`（脚本、CI、文档、测试路径）
- `sst.config.ts` 中的部署名
- 发布脚本中路径引用

**验收标准**:
- [ ] `packages/octopus/` 目录不存在
- [ ] `grep 'packages/octopus/'` 零结果（排除 changelog/历史提交引用）
- [ ] 所有测试路径引用使用 `packages/octopus/`
- [ ] `bun turbo typecheck` 通过

**前置依赖**: Issue 1

---

### Issue 3: API 标识符重命名 [S]

**描述**: 将所有 `createOpencode*`、`OpencodeClient*`、`createOpencode*` 等 JS/TS 标识符改为对应的 Octopus 命名。

**改名映射**:
| 原名 | 新名 |
|------|------|
| `createOpencode` | `createOctopus` |
| `createOpencodeClient` | `createOctopusClient` |
| `createOpencodeServer` | `createOctopusServer` |
| `createOpencodeTui` | `createOctopusTui` |
| `OpencodeClient` | `OctopusClient` |
| `OpencodeClientConfig` | `OctopusClientConfig` |
| `TERMINAL_NAME = "opencode"` | `TERMINAL_NAME = "octopus"` |

**范围**: ~60 文件（集中在 `packages/sdk/js/src/`、`packages/octopus/src/`、`packages/plugin/src/`、`sdks/vscode/src/`）

**验收标准**:
- [ ] `grep -i 'opencodeclient\|createopencode'` 零结果
- [ ] 所有 SDK consumer 代码编译通过
- [ ] 相关测试通过（`bun test` in sdk/js, octopus, plugin, vscode）

**前置依赖**: Issue 1, 2

---

### Issue 4: 环境变量 & Flag 常量重命名 [S]

**描述**: 将所有 `OPENCODE_*` 环境变量名和 `Flag.OPENCODE_*` 属性改为 `OCTOPUS_*`。

**核心文件**: `packages/core/src/flag/flag.ts`（集中定义 ~50 个 Flag）

**改名规则**: 简单的 `s/OPENCODE_/OCTOPUS_/g`，但需注意：
- 不修改第三方包的 env var（如 `OTEL_*` 不是本项目的）
- 不修改 `@openauthjs/openauth` 等第三方前缀

**验收标准**:
- [ ] `grep 'OPENCODE_' packages/core/src/flag/flag.ts` 零结果
- [ ] 所有测试中引用的 env var 同步更新
- [ ] `bun turbo test:ci` 全量通过

**前置依赖**: Issue 1, 2

---

### Issue 5: 配置系统重命名 [XS/S]

**描述**: `.opencode/` 目录 → `.octopus/`，`opencode.jsonc` → `octopus.jsonc`，更新所有配置读写路径。

**范围**:
- `.opencode/` 目录自身重命名（`git mv`）
- `packages/core/src/global.ts` 中的默认配置路径
- `packages/octopus/src/config/config.ts` 中的配置查找逻辑
- `packages/octopus/src/cli/cmd/tui/config/tui-migrate.ts` 中的迁移逻辑
- `packages/octopus/src/cli/cmd/mcp.ts` 中的配置候选路径
- `packages/octopus/src/installation/index.ts` 中的安装路径
- `packages/octopus/src/cli/cmd/run/trace.ts` 中的日志路径
- `packages/octopus/src/cli/cmd/run/variant.shared.ts` 中的 state 路径
- 所有测试 fixture 中的 `.opencode/` 和 `opencode.jsonc` 路径
- `.octopus/WORKFLOW.md` 等相关文档
- `.opencode/skills/` 下的 SKILL.md 文件中的 `.opencode/` 引用

**验收标准**:
- [ ] `.opencode/` 目录变为 `.octopus/` 后内部文件内容同步更新
- [ ] `grep '\.opencode/'` 零有效结果（排除历史/模板说明）
- [ ] 配置查找/加载/迁移功能正确
- [ ] 相关测试通过

**前置依赖**: Issue 1, 2

---

### Issue 6: 品牌资产重命名 [XS]

**描述**: 主题、图标、CSS class 中 opencode 引用改名。

**范围**:
- `packages/ui/src/theme/themes/opencode.json` → 内容中 `name` 字段更新
- `packages/ui/src/theme/default-themes.ts`: `opencodeTheme` → `octopusTheme`
- CSS class: `opencode-theme` → `octopus-theme`, `opencode-find` → `octopus-find`, `opencode-line-comment-styles` → `octopus-line-comment-styles`
- `packages/extensions/zed/icons/opencode.svg` → `octopus.svg`
- `packages/ui/src/components/provider-icons/types.ts` 中 `"opencode"` 和 `"opencode-go"` 字符串

**验收标准**:
- [ ] 主题文件正确加载
- [ ] VS Code/Zed 图标显示正确
- [ ] Storybook 中主题切换正常

**前置依赖**: Issue 1, 2

---

### Issue 7: 扩展重命名 (VS Code + Zed) [XS]

**描述**: VS Code 和 Zed 扩展中的品牌标识更新。

**VS Code** (`sdks/vscode/`):
- `package.json`: `name`、`displayName`、`description`
- 命令 ID 前缀: `opencode.openTerminal` → `octopus.openTerminal`
- `src/extension.ts`: `TERMINAL_NAME`、命令注册

**Zed** (`packages/extensions/zed/`):
- `extension.toml`: `id`、`name`、`description`、`repository`、`[agent_servers.*]`、二进制名、下载 URL

**验收标准**:
- [ ] VS Code 扩展可打包
- [ ] Zed 扩展 toml 格式正确
- [ ] 命令前缀一致

**前置依赖**: Issue 1, 2

---

### Issue 8: CI/CD & 脚本 URL 更新 [S]

**描述**: 所有 GitHub Actions workflow、构建/发布脚本、外部 URL 引用中 `anomalyco/opencode` → 新仓库路径的更新。

**范围**:
- `github/workflows/opencode.yml` → 重命名为 `octopus.yml`，更新 name + job id
- 27 个 workflow 文件中的:
  - `uses: anomalyco/opencode/github@latest` → 新仓库路径
  - `if: github.repository == 'anomalyco/opencode'` → 新仓库路径
  - `uses: sst/opencode/github@latest` 等 action 引用
  - `bun i -g opencode-ai` 等安装命令（如果 Octopus 有自己的 CLI 安装方式）
  - workflow 名称、job 名称、step 名称中的品牌引用
  - email 地址: `opencode@sst.dev` → `octopus@sst.dev`
  - git user.name: `"opencode"` → `"octopus"`
  - PR comment 中 scope 示例: `packages/opencode` → `packages/octopus`
- `packages/octopus/script/publish.ts` 中的 AUR/Homebrew 下载 URL（`/opencode-darwin-*.zip` → `/octopus-darwin-*.zip`）
- `packages/octopus/src/cli/cmd/github.ts` 中的 `uses: anomalyco/opencode/github@latest`
- `packages/console/app/` 中的 API URL
- `packages/desktop/src/main/menu.ts` 中的 GitHub Issues URL
- `packages/containers/` Dockerfiles（如有 opencode 引用）
- `flake.nix`（如有 opencode 引用）
- `sst.config.ts` 中的部署名

**需要同步更新的 GitHub 设置**（不在代码仓库内，需手动操作）:
- GitHub Secrets: `OPENCODE_API_KEY` → `OCTOPUS_API_KEY`
- GitHub Variables: `OPENCODE_APP_ID` → `OCTOPUS_APP_ID`
- GitHub Secret: `OPENCODE_APP_SECRET` → `OCTOPUS_APP_SECRET`

**验收标准**:
- [ ] `grep 'anomalyco/opencode' .github/` 零结果（注意排除历史引用说明）
- [ ] workflow 文件可正确触发
- [ ] 发布脚本的 artifact 名称指向正确

**前置依赖**: Issue 1, 2

---

### Issue 9: 文档 & i18n 全面更新 [L]

**描述**: 所有 Markdown/MDX 文档和 i18n 翻译文件中的品牌引用更新。

**范围**:
- `packages/web/src/content/docs/` 下 ~100 个 MDX 页面（路径示例、配置代码块、命令引用）
- `packages/web/src/content/i18n/` 下 ~66 个 locale JSON 文件
  - i18n key 重命名: `share.opencode_version` → `share.octopus_version` 等
  - i18n 翻译值: "OpenCode"/"opencode" → "Octopus"/"octopus"
- `.octopus/WORKFLOW.md` 中的 `.opencode/` 路径引用（已部分完成）
- 根目录 `AGENTS.md`（如有 opencode 引用）

**执行策略**:
1. 先批量替换路径模式（`~/.config/opencode/` → `~/.config/octopus/`，`.opencode/` → `.octopus/`，`opencode.jsonc` → `octopus.jsonc`）
2. 再替换品牌文本（"OpenCode" → "Octopus"，"opencode" → "octopus" 在描述文本中）
3. i18n key 需逐个审查确保语义正确
4. ⚠️ 保留外部模型 ID（如 `opencode/claude-opus-4-7`）不修改

**验收标准**:
- [ ] 所有文档中的配置路径指向 `.octopus/` / `octopus.jsonc`
- [ ] 品牌名统一为 "Octopus"（文档标题、描述文本）
- [ ] i18n key 更新后前端可以正确读取
- [ ] `opencode` 仅在历史/迁移说明 + 外部引用中保留

**前置依赖**: Issue 1~7（确保文档中的代码示例与实际代码一致）

---

## 建议的变更级别

**XL** — 总体超过 300 文件、7400+ 引用。已拆解为 9 个 Issue（1×L + 2×M + 4×S + 2×XS），最大单个 Issue 为 250 文件（L 级）。

### 并行执行建议

```
Phase 1 (串行):
  Issue 1 (Scope + imports) → 完成后
    ├── Phase 2 (并行):
    │   Issue 2 (目录 rename)
    │   
    ├── Phase 3 (并行, 依赖 #1 + #2):
    │   Issue 3 (API 标识符)
    │   Issue 4 (env/flags)
    │   Issue 5 (配置系统)
    │   Issue 6 (品牌资产)
    │   Issue 7 (扩展)
    │   Issue 8 (CI/script)
    │   
    └── Phase 4 (最后, 依赖 #1~#7):
        Issue 9 (文档/i18n)
```

**注意**: Issue 3-8 可在 Issue 1+2 完成后完全并行执行，因为它们修改的文件集基本不重叠。

## 决策

☑ 进入 P1（创建 9 个 GitHub Issue）→ 由 orchestrator 接管后续流程
