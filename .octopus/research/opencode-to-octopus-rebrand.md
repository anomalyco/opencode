# P3 需求分析报告：OpenCode → Octopus 全量品牌迁移

> **版本**: v0.1.0 | **变更级别**: XL（~735 文件，9 Issues） | **日期**: 2026-05-11
> **上游文档**:
>
> - Discovery: `.octopus/discovery/2026-05-11-opencode-to-octopus-rebrand.md`
> - Version Plan: `.octopus/version-plans/v0.1.0.md`
> - Workflow: `.octopus/WORKFLOW.md`
>
> **Agent 分派确认** (WORKFLOW P3 规则):
>
> - M+ Issues (1, 2, 9) → ≥2 domain agents
> - Issue 1 (L) → core-dev + qa
> - Issue 2 (M) → core-dev + qa
> - Issue 9 (L) → feature-dev + qa
> - Issues 3-5 → core-dev (核心代码)
> - Issues 6-7 → feature-dev (UI/扩展)
> - Issue 8 → platform (CI/CD)
> - Breaking Change → compat (全量)
> - Security → security (全量)

---

## 一、需求澄清

### Issue 1: Monorepo 基础层 — npm scope 批量重命名 [L]

**当前状态**: 代码库中存在大量 `@opencode-ai/*` 的 npm scope 引用和 import 语句。

**需求要点**:

1. 20 个 `package.json` 的 `"name"` 字段从 `@opencode-ai/*` / `opencode` 改为 `@octopus-ai/*` / `@octopus-ai/octopus`
2. 根 `package.json` 的 `workspaces` + `dependencies` + `repository` 同步更新
3. 所有 TypeScript `import { ... } from "@opencode-ai/*"` 语句批量替换
4. `turbo.json` pipeline 任务名 `opencode#*` / `@opencode-ai/*#*` → `octopus#*` / `@octopus-ai/*#*`
5. `.opencode/package.json` 中 SDK 依赖更新
6. 生成新的 `bun.lock` 文件（workspace 依赖名变更后）

**当前已验证数据**:

- `turbo.json` 中存在 6 个 scope 任务名: `opencode#test`, `opencode#test:ci`, `@opencode-ai/app#test`, `@opencode-ai/app#test:ci`, `@opencode-ai/ui#test`, `@opencode-ai/ui#test:ci`

**验收标准**:

- `grep '@opencode-ai' packages/` 零结果
- `bun install` 成功
- `bun turbo typecheck` 全量通过

---

### Issue 2: 目录重命名 — `packages/opencode` → `packages/octopus` [M]

**当前状态**: `packages/octopus/` 目录存在，包含 ~9 个子目录（src/test/specs/script/migration 等），内含 ~80 文件。

**需求要点**:

1. `git mv packages/opencode packages/octopus`
2. 目录内 `package.json`: `name` 字段 + `bin` 字段 (`"opencode"` → `"octopus"`)
3. 全仓路径引用 `packages/octopus/` → `packages/octopus/` 批量替换
4. `sst.config.ts` 中的 `name: "opencode"` → `name: "octopus"`
5. 发布脚本、CI workflow、测试路径引用同步更新

**当前已验证数据**:

- 大量文件引用 `packages/octopus/`（主要集中在 `.github/workflows/`、`docs/`、自身文件和测试）
- `sst.config.ts` 包含 `name: "opencode"`

**验收标准**:

- `packages/octopus/` 目录不存在
- `grep 'packages/octopus/'` 零结果（排除 changelog/历史引用）
- `bun turbo typecheck` 通过

---

### Issue 3: API 标识符重命名 [S]

**需求要点**: 将 JS/TS 代码中的品牌相关标识符改名。

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

**集中区域**: `packages/sdk/js/src/`、`packages/octopus/src/`、`packages/plugin/src/`、`sdks/vscode/src/`

---

### Issue 4: 环境变量 & Flag 常量重命名 [S]

**当前状态**: `packages/core/src/flag/flag.ts` 包含 ~50 个 `Flag.OPENCODE_*` 属性定义（120 行），集中管理所有环境变量。变量名通过字符串字面量直接引用（如 `process.env["OPENCODE_CONFIG"]`）。

**需求要点**:

1. 所有 `Flag.OPENCODE_*` 属性名 → `Flag.OCTOPUS_*`
2. 所有 `process.env["OPENCODE_*"]` 引用 → `process.env["OCTOPUS_*"]`
3. `packages/core/src/global.ts` 中的 `app = "opencode"` → `app = "octopus"`（直接影响 `~/.config/opencode/`、`~/.local/share/opencode/` 等 XDG 路径）
4. 保留外部引用: `OTEL_EXPORTER_*` 不修改

**当前已验证数据**:

- `packages/core/src/global.ts:9`: `const app = "opencode"` 控制所有 XDG 路径
- `packages/core/src/flag/flag.ts`: 约 50 个 `OPENCODE_*` 标识符
- `packages/core/src/util/log.ts`: `opencode.log` → `octopus.log`

**验收标准**:

- `grep 'OPENCODE_' packages/core/src/flag/flag.ts` 零结果
- `bun turbo test:ci` 全量通过

---

### Issue 5: 配置系统重命名 [XS]

**需求要点**:

1. `.opencode/` 目录 → `.octopus/`（包括内部所有技能、Agent、命令定义）
2. `opencode.jsonc` → `octopus.jsonc`
3. 更新配置查找/加载逻辑（`packages/octopus/src/config/config.ts`）
4. 更新 CLI 各类命令中的配置路径引用
5. 更新所有测试 fixture 路径

**当前已验证数据**:

- `.opencode/` 目录已含 12 agent 定义、14 命令、17 技能（SKILL.md）、配置 jsonc
- 配置查找逻辑在 `config.ts` 中通过 `Flag.OPENCODE_CONFIG` / `Flag.OPENCODE_CONFIG_DIR` 读取

---

### Issue 6: 品牌资产重命名 [XS]

**需求要点**:

1. 主题文件 `opencode.json` → `octopus.json`，内部 `name` 字段更新
2. `opencodeTheme` → `octopusTheme` (default-themes.ts)
3. CSS class: `opencode-theme` / `opencode-find` / `opencode-line-comment-styles` → `octopus-*`
4. 图标: `icons/opencode.svg` → `icons/octopus.svg`
5. provider-icons types 中的 `"opencode"` / `"opencode-go"` 字符串

**保留/不修改**: `"opencode-go"` 和 `"opencode"` 作为 LLM model ID 字符串保留

---

### Issue 7: 扩展重命名 (VS Code + Zed) [XS]

**当前状态**:

- VS Code 扩展: `sdks/vscode/package.json` 含 16 处 `opencode` 引用（name、displayName、命令、keybindings）
- Zed 扩展: `packages/extensions/zed/extension.toml` 含完整的 `[agent_servers.opencode]` 定义

**VS Code 需求**: `"name": "opencode"` → `"octopus"`; 命令前缀 `opencode.` → `octopus.`; 所有 `"title"` / `"key"` 中的文本更新

**Zed 需求**: `id` / `name` / `description` / `[agent_servers.opencode]` / 图标路径 / archive URL 全部更新

---

### Issue 8: CI/CD & 脚本 URL 更新 [S]

**当前状态**: 27 个 workflow 文件，其中至少 3 个含 `anomalyco/opencode` 引用。

**需求要点**:

1. `opencode.yml` → `octopus.yml`（重命名 + 内部 brand 引用）
2. 所有 workflow 中的 `anomalyco/opencode` → 新仓库路径
3. `uses: sst/opencode/github@latest` 等 action 引用更新
4. 发布脚本 artifact 名称: `opencode-darwin-*.zip` → `octopus-darwin-*.zip`
5. 桌面菜单 URL: `https://opencode.ai/docs` → `https://octopus.ai/docs` 等
6. email 地址: `opencode@sst.dev` → `octopus@sst.dev`
7. GitHub Secrets/Variables 名建议同步（需人工操作）

**保留清单** (不修改):

- `uses: anomalyco/opencode/github@latest` 中的 `model: opencode/claude-opus-4-5` (外部模型 ID)
- `https://discord.gg/opencode` / `https://opencode.ai/install` (外部服务 URL)

---

### Issue 9: 文档 & i18n 全面更新 [L]

**当前已验证数据**:

- 约 140 个 MDX 文档页面引用了 `opencode` (多语言: nb/bs/da/it/es/pl/ru/ja/zh-tw/pt-br/ar/zh-cn/de/fr/th/tr/ko + 英文)
- 约 18 个 i18n locale JSON 文件含 `opencode` 引用
- 典型 i18n key: `share.opencode_version`, `share.opencode_name`

**需求要点**:

1. 文档路径/命令示例/配置代码块更新
2. 品牌名文本 "OpenCode" / "opencode" → "Octopus" / "octopus"
3. i18n key 重命名和翻译值更新
4. `.opencode/` → `.octopus/` 在所有文档路径中
5. 保留外部模型 ID、第三方包名不修改

---

## 二、技术可行性 — core-dev 分析

### 2.1 代码影响范围

| 维度            | 数据                                           |           复杂度            |
| --------------- | ---------------------------------------------- | :-------------------------: |
| npm scope 替换  | 20 个 package.json + ~200 个 TS 文件 import    |     **机械** (sed 批量)     |
| 目录重命名      | 1 个目录 (~80 文件内部 + 全仓 ~100 处路径引用) | **中** (git mv + grep 替换) |
| Flag/env 重命名 | 1 个核心文件 (120 行集中定义) + ~80 个引用点   |      **低** (集中定义)      |
| 配置系统        | 1 个目录重命名 + ~5 个配置查找逻辑文件         |   **中** (需确保迁移逻辑)   |
| XDG 路径变更    | `global.ts:9` 单点变量 `app = "opencode"`      |      **低** (单点修改)      |

### 2.2 关键风险点

**风险 1: 循环依赖 vs 全局字符串常量** (概率: 低 / 影响: 高)

- `packages/core/src/global.ts:9` 中的 `const app = "opencode"` 控制 `~/.config/opencode/`、`~/.local/share/opencode/` 等 XDG 路径
- 修改后将导致现有用户的配置/数据目录不可见
- **缓解**: compat 在 P5 设计自动迁移逻辑

**风险 2: bun.lock 不一致** (概率: 高 / 影响: 高)

- workspace 依赖名变化后 4 个 lock 文件需重新生成
- Issue 1 完成后需立即 `bun install` 生成新 lock file
- 可能存在跨平台 lock 差异

**风险 3: turbo.json 任务名引用** (概率: 中 / 影响: 中)

- `turbo.json` 中 pipeline task 名包含 scope 前缀
- 6 个任务名需要更新
- 改动小但容易被遗忘

**风险 4: `Config.boolean()` / `Config.string()` 直接读 process.env** (概率: 低 / 影响: 低)

- 部分 Flag 使用 `Config.boolean("OPENCODE_EXPERIMENTAL_FILEWATCHER")` 而非从 `Flag` 对象读
- 这些字符串也需搜索替换

**风险 5: 大小写三态 — Opencode / OPENCODE / opencode** (概率: 高 / 影响: 中)

- 代码中存在三种大小写变体: 首字母大写 (`OpencodeClient`)、全大写 (`OPENCODE_*`)、全小写 (`opencode` 命令名/路径)
- 批量替换脚本必须区分上下文，避免误伤
- **缓解**: 分三阶段替换，每阶段用精确的模式匹配

**风险 6: 动态引用无法被 grep 捕获** (概率: 中 / 影响: 中)

- `process.env[KEY_PREFIX + "_CONFIG"]` 等模板拼接引用不会被简单 grep 命中
- 运行时文件名构造（`opencode.jsonc` 作为字符串常量拼接到路径中）
- **缓解**: 使用 TypeScript typecheck 捕获未更新的引用，人工审查所有字符串拼接处

**风险 7: npm 包发布顺序依赖** (概率: 中 / 影响: 高)

- 发布 `@octopus-ai/octopus` 前必须先发布所有 `@octopus-ai/*` 依赖包
- 内部依赖链: `@octopus-ai/core` → `@octopus-ai/sdk` → `@octopus-ai/ui`/`@octopus-ai/plugin`/`@octopus-ai/app`
- **缓解**: 按依赖拓扑自底向上发布，使用 `npm publish --dry-run` 验证每步

**风险 8: GitHub Secrets 双轨过渡窗口** (概率: 中 / 影响: 高)

- CI 同时需要 `OLD.OPENCODE_API_KEY` 和 `NEW.OCTOPUS_API_KEY` 在过渡期并行存在
- Secrets 复制窗口内可能出现 CI 红
- **缓解**: 先建立新 Secret 并验证 → 代码切换到新名 → 旧 Secret 保留 2 个 minor 版本后移除

### 2.3 技术方案建议

**Issue 1**: 使用 `sed` 批量替换 `@opencode-ai` → `@octopus-ai`，对非代码文件（.json, .md）同样适用。排除列表需包含:

- 第三方包: `@gitlab/opencode-gitlab-auth`、`opencode-gitlab-auth`、`opencode-poe-auth`
- 无关前缀: `@opentui/*`

**Issue 2**: `git mv` + `rg` 检查。注意 `packages/octopus/` 内部文件中的自引用也需更新（如 `src/config/config.ts` 中的 import 路径）。

**Issue 4**: 集中在 `flag.ts` 文件的机械化替换。`global.ts` 中 `app` 变量的修改会导致所有 XDG 路径变更，需 compat 协调。

**Issue 5**: `.opencode/` 目录用 `git mv` 重命名，内部 SKILL.md 文件中对 `.opencode/` 的自引用需批量更新。Workflow 文件引用 `.opencode/` 处需更新。

### 2.4 自动化验证工具链

基于 LLM Panel 评审反馈，补充以下自动化验证步骤：

**验证脚本 (`script/verify-rebrand.ts`)** — 每个 Issue 完成后运行:

| 验证项         | 命令                                                                            | 目标 Issue |
| -------------- | ------------------------------------------------------------------------------- | :--------: |
| npm scope 残留 | `rg '@opencode-ai' --type ts --type json`                                       |     #1     |
| 目录残留       | `test -d packages/opencode`                                                     |     #2     |
| API 标识符残留 | `rg -i 'opencodeclient\|createopencode'`                                        |     #3     |
| 环境变量残留   | `rg 'OPENCODE_' packages/core/`                                                 |     #4     |
| 配置路径残留   | `rg '\.opencode\|opencode\.jsonc'`                                              |     #5     |
| 主题残留       | `rg 'opencodeTheme\|opencode\.json' packages/ui/`                               |     #6     |
| 扩展残留       | `rg 'opencode\.openTerminal\|id = "opencode"'`                                  |     #7     |
| 仓库 URL 残留  | `rg 'anomalyco/opencode' .github/`                                              |     #8     |
| 文档路径残留   | `rg '\.config/opencode\|opencode\.ai/install\|opencode\.ai/docs' packages/web/` |     #9     |

**端到端冒烟脚本 (`script/rebrand-smoke.ts`)** — Group 3 全部完成后运行:

| 测试项         | 命令                                    | 预期                          |
| -------------- | --------------------------------------- | ----------------------------- |
| CLI 启动       | `octopus --version`                     | 输出版本号                    |
| CLI 配置加载   | `octopus config --show`                 | 使用 `.octopus/octopus.jsonc` |
| 包发布 dry-run | `npm publish --dry-run` in packages/sdk | 成功，名称含 `@octopus-ai`    |
| VS Code 打包   | `bun run package` in sdks/vscode        | VSIX 打包成功                 |
| 全量 typecheck | `bun turbo typecheck`                   | 全通过                        |
| bun install    | `bun install --frozen-lockfile`         | 无 workspace 解析错误         |

---

## 三、UI/UX 影响 — feature-dev 分析

### 3.1 品牌资产范围

| 资产类型           | 文件数  | 修改内容                                                            |
| ------------------ | :-----: | ------------------------------------------------------------------- |
| 主题文件           |    1    | `opencode.json` → `octopus.json` + `name` 字段                      |
| 主题加载           |    1    | `default-themes.ts`: `opencodeTheme` → `octopusTheme`               |
| CSS class          | ~5 文件 | `opencode-theme` / `opencode-find` / `opencode-line-comment-styles` |
| 图标 SVG           |    1    | `icons/opencode.svg` → `icons/octopus.svg`                          |
| Provider icon 类型 |    1    | `"opencode"` / `"opencode-go"` 字符串（模型 ID 相关，需慎重）       |
| 文档 MDX           |  ~100+  | 代码示例、配置路径、命令引用                                        |
| i18n 翻译          | 18 文件 | key 重命名 + 翻译值更新                                             |

### 3.2 文档影响详细分析

**MDX 文件结构**: `packages/web/src/content/docs/` 下按语言代码组织，每个语言 ~10 个 MDX 页面（agents.mdx、config.mdx、commands.mdx、custom-tools.mdx、plugins.mdx、skills.mdx、themes.mdx、troubleshooting.mdx 等）。

**典型替换模式**:

1. 配置路径: `~/.config/opencode/` → `~/.config/octopus/`
2. 项目配置: `.opencode/` → `.octopus/`
3. 配置文件: `opencode.jsonc` → `octopus.jsonc`
4. CLI 命令: `opencode` → `octopus`
5. 品牌显示名: "OpenCode" → "Octopus"
6. npm scope 示例: `@opencode-ai/*` → `@octopus-ai/*`

**i18n 影响**: 18 个 locale JSON 文件中需更新:

- Key 级别: `share.opencode_version` → `share.octopus_version`
- Value 级别: 翻译文本中的品牌名

### 3.3 扩展影响

**VS Code** (`sdks/vscode/`):

- `package.json`: 16 处 `opencode` 引用需要更新
- 命令 ID 变更可能导致已安装扩展升级时出现注册问题
- Keybinding 中的 label 文本更新

**Zed** (`packages/extensions/zed/`):

- `extension.toml`: 需更新 `id`、`name`、`description`、`[agent_servers.opencode]` 节、5 个平台 target 的 archive URL 和 cmd
- 变更后扩展市场需要重新发布

### 3.4 UI/UX 风险

| 风险                       | 等级 | 描述                                                           |
| -------------------------- | :--: | -------------------------------------------------------------- |
| 主题名变更导致已有配置失效 |  高  | 用户可能在 `opencode.jsonc` 中显式引用了 `"opencode"` 主题名   |
| 扩展升级冲突               |  中  | VS Code 可能因命令 ID 变化而产生重复注册或旧命令残留           |
| MDX 代码块语义丢失         |  中  | 批量替换可能改变示例代码的运行时行为（如 bash 命令、model ID） |

---

## 四、CI/CD 影响 — platform 分析

### 4.1 Workflow 文件影响

**总计**: 27 个 workflow 文件，3 个受直接影响：

| Workflow       | 影响内容                                                       | 严重度 |
| -------------- | -------------------------------------------------------------- | :----: |
| `opencode.yml` | 文件名 + 内部 name/job id/`anomalyco/opencode` 引用            | **高** |
| `publish.yml`  | `anomalyco/opencode` 仓库路径、artifact 名称、AUR/Homebrew URL | **高** |
| `stats.yml`    | `anomalyco/opencode` 仓库路径                                  |   低   |

**其他 24 个 workflow**: 无直接 `opencode` 引用（如 `beta.yml`, `test.yml`, `typecheck.yml` 等），仅可能通过共享 action 间接依赖。

### 4.2 发布管线影响

| 组件              | 当前值         | 需改为                | 备注                              |
| ----------------- | -------------- | --------------------- | --------------------------------- |
| npm scope         | `@opencode-ai` | `@octopus-ai`         | 需在 npm 上注册 `@octopus-ai` org |
| npm 包名          | `opencode`     | `@octopus-ai/octopus` | Breaking Change                   |
| AUR package       | `opencode-bin` | `octopus-bin`         | 新包名                            |
| Homebrew formula  | `opencode`     | `octopus`             | 新 formula 名                     |
| Chocolatey        | `opencode`     | `octopus`             | 新 package                        |
| Docker image      | `opencode`     | `octopus`             | 新 image 名                       |
| VS Code extension | `opencode`     | `octopus`             | 新 extension id                   |
| Zed extension     | `opencode`     | `octopus`             | 新 extension id                   |

### 4.3 GitHub Secrets/Variables 影响

**需要在 GitHub Settings 中手动同步的操作:**

| 旧名                  | 新名                 | 类型     |
| --------------------- | -------------------- | -------- |
| `OPENCODE_API_KEY`    | `OCTOPUS_API_KEY`    | Secret   |
| `OPENCODE_APP_ID`     | `OCTOPUS_APP_ID`     | Variable |
| `OPENCODE_APP_SECRET` | `OCTOPUS_APP_SECRET` | Secret   |

**双轨策略**: 先同时设置新旧名称指向相同值，过渡后再删除旧名。

### 4.4 外部 URL 保留清单 (不修改)

| URL                                                         | 原因                       |
| ----------------------------------------------------------- | -------------------------- |
| `https://github.com/anomalyco/opencode/releases/download/*` | 当前仍指向原仓库           |
| `https://opencode.ai/install`                               | 外部服务，非本仓库控制     |
| `https://discord.gg/opencode`                               | Discord 邀请链接，外部服务 |

### 4.5 CI 风险

| 风险                                         | 等级 | 缓解                                                  |
| -------------------------------------------- | :--: | ----------------------------------------------------- |
| `opencode.yml` workflow 重命名后触发规则失效 |  高  | 需同步更新 `on.push.paths` 和 `on.workflow_call` 引用 |
| Secret 名不一致导致 CI 红                    |  高  | 双轨过渡                                              |
| Docker image 名变更需重建                    |  中  | registry 中先 push 新 image                           |

---

## 五、Breaking Change 判定 — compat 分析

### 5.1 总体判定

**结论: 是 Breaking Change。** 所有以下用户接口均被破坏：

| 接口                   | 旧值                          | 新值                         |        影响面        |
| ---------------------- | ----------------------------- | ---------------------------- | :------------------: |
| CLI 命令名             | `opencode`                    | `octopus`                    |     **所有用户**     |
| npm scope              | `@opencode-ai/*`              | `@octopus-ai/*`              | **所有 SDK 消费者**  |
| 环境变量               | `OPENCODE_*` (~50 个)         | `OCTOPUS_*`                  |   **所有配置用户**   |
| 项目配置目录           | `.opencode/`                  | `.octopus/`                  |     **所有项目**     |
| 全局配置文件           | `opencode.jsonc`              | `octopus.jsonc`              |     **所有用户**     |
| XDG 数据/缓存/配置路径 | `~/.local/share/opencode/` 等 | `~/.local/share/octopus/` 等 |     **所有用户**     |
| VS Code 命令前缀       | `opencode.*`                  | `octopus.*`                  | **VS Code 扩展用户** |

### 5.2 迁移成本评估

| 迁移项                | 用户操作                                   |    自动化可能？     |
| --------------------- | ------------------------------------------ | :-----------------: |
| CLI 命令名            | 肌肉记忆适配，脚本更新                     |  否 (alias 可缓解)  |
| 环境变量              | 重命名 `.env` / shell profile / CI secrets |    半自动 (脚本)    |
| `.opencode/` 配置目录 | 重命名为 `.octopus/`                       |  **是** (自动迁移)  |
| `opencode.jsonc` 配置 | 重命名文件                                 |  **是** (自动迁移)  |
| npm scope import      | 更新 package.json 依赖                     | 手动 (package.json) |
| VS Code keybinding    | 重置自定义快捷键                           |         否          |

### 5.3 推荐的兼容策略 (P5 详设)

**1. 环境变量双读 Fallback** (优先级: P0)

- 启动时同时检测 `OPENCODE_*` 和 `OCTOPUS_*`，优先使用 `OCTOPUS_*`
- 实现方式: 在 `flag.ts` 中封装读取函数，先读 `OCTOPUS_*`，不存在则回退到 `OPENCODE_*`
- 发现废弃的 `OPENCODE_*` 变量时输出 WARNING (含迁移指引)
- 过渡期: 2 个 minor 版本后移除旧支持 (v0.3.0+)

**2. 配置目录自动迁移命令** (优先级: P0)

- 新增 `octopus migrate` 命令:
  1. 检测 `.opencode/` 存在且无 `.octopus/` → 提示用户执行迁移
  2. 自动执行: `mv .opencode .octopus` + 文件内路径替换
  3. 在 `.opencode` 位置创建标记文件 `.opencode/.migrated-to-octopus`
  4. 应用新配置并重启
- 启动时静默检测旧目录 → 打印迁移指引（不自动执行，尊重用户控制）

**3. CLI alias 自动安装** (优先级: P1)

- 在首次启动时检测是否通过 `opencode` 别名调用:
  - 如检测到 `argv[0]` 包含 `opencode` → 输出 WARNING 提示新的命令名
- 可选: 在 shell profile 中自动插入 `alias opencode=octopus` (需用户确认)

**4. npm scope 过渡发布** (优先级: P0)

- 发布新包 `@octopus-ai/*` 到 npm registry
- 在旧包 `@opencode-ai/*` 上发布 deprecation 版本:
  ```json
  {
    "deprecated": "@opencode-ai/* is now @octopus-ai/*. Please update your package.json."
  }
  ```
- 可选: 在旧包上发布 re-export 垫片版本（指向新包），降低消费者迁移摩擦

**5. `opencode.jsonc` → `octopus.jsonc` 自动检测** (优先级: P1)

- 启动时先找 `octopus.jsonc` / `octopus.json`
- 找不到 → 回退找 `opencode.jsonc` / `opencode.json` → 自动加载并提示迁移
- 用户执行 `octopus migrate` 后完成正式重命名

**6. XDG 路径兼容** (优先级: P1)

- 新路径: `~/.config/octopus/`、`~/.local/share/octopus/`、`~/.local/state/octopus/`
- 检测旧路径: `~/.config/opencode/`、`~/.local/share/opencode/`、`~/.local/state/opencode/`
- 如新路径不存在但旧路径存在 → 提示 `octopus migrate-config`

### 5.4 兼容窗口建议

```
Phase 1 (v0.1.0):  双轨启用 + 自动迁移逻辑 + CLI alias
Phase 2 (v0.2.0):  保持双轨，开始输出废弃警告
Phase 3 (v0.3.0):  移除废弃 env var 支持，仅保留 OCTOPUS_*
```

---

## 六、安全风险 — security 分析

### 6.1 风险清单

| 风险                   | 等级 | 描述                                                                     | 应对措施                                                                            |
| ---------------------- | :--: | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **CI Secrets 名变更**  |  P1  | `OPENCODE_API_KEY` / `OPENCODE_APP_SECRET` 需同步改名，不同步则 CI 红    | 双轨制：先在 GitHub Settings 中同时设置新旧名称 → Issue 8 代码更新 → 过渡后删除旧名 |
| **依赖审计基线漂移**   |  P2  | npm scope 变更后 `bun audit` 基线需重建                                  | Rebase audit baseline after scope rename                                            |
| **Bundle size 变化**   |  P3  | 仅字符串替换，无代码逻辑变更，bundle size 应不变                         | 监控对比                                                                            |
| **Secret 泄露风险**    |  P0  | 批量替换脚本可能误改 `.gitleaksignore` 的 false positive 条目            | 替换时排除 `.gitleaksignore`                                                        |
| **外部 model ID 误杀** |  P1  | 模型路由标识 `opencode/claude-opus-4-7` 等被错误替换后将导致模型路由失败 | 所有替换脚本加入排除列表                                                            |

### 6.2 排除清单验证

以下字符串在所有 Issue 中**不得修改**:

```
# 第三方 npm 包
@gitlab/opencode-gitlab-auth
opencode-gitlab-auth
opencode-poe-auth

# LLM Model ID (外部模型路由)
opencode-go/deepseek-v4-pro
opencode/claude-opus-4-7
opencode/gpt-5.*
opencode/kimi-k2.*

# 外部服务 URL
https://opencode.ai/install
https://discord.gg/opencode
https://opencode.ai/docs (temporary, until octopus docs exist)

# 第三方库前缀
@opentui/*
OTEL_*
@openauthjs/*
```

### 6.3 安全检查点

- [ ] P6 后运行 `bun audit` 确认无新增漏洞
- [ ] P6 后对比 bundle size 基准
- [ ] P7 验证 `.gitleaksignore` 未被误改
- [ ] P8 Canary 阶段验证 Secret 双轨有效性

---

## 七、验收标准可测试性 — qa 分析

### Issue 1 — npm scope 批量重命名

**静态验证**:

- **Given** 所有 package.json name 字段和 TS import 语句已更新
- **When** 执行 `grep -r '@opencode-ai' packages/` (排除第三方包)
- **Then** 零结果

**运行时验证**:

- **Given** 包名更名完成
- **When** 执行 `bun install --frozen-lockfile`
- **Then** 无 workspace 解析错误，无 `@opencode-ai` 未解析警告

- **Given** 所有 import 已更新
- **When** 执行 `bun turbo typecheck`
- **Then** 全量通过，无 "Cannot find module '@opencode-ai/\*'" 错误

- **Given** scope 替换完成
- **When** 执行 `script/verify-rebrand.ts` (Issue 1 验证项)
- **Then** 所有 Issue 1 检查项通过

### Issue 2 — 目录重命名

- **Given** `git mv packages/opencode packages/octopus` 完成
- **When** 执行 `ls packages/opencode`
- **Then** 目录不存在

- **Given** 路径引用已更新
- **When** 执行 `rg 'packages/octopus/' --include='*.ts' --include='*.json' --include='*.yml'`
- **Then** 零结果（排除历史/变更记录）

### Issue 3 — API 标识符重命名

**静态验证**:

- **Given** API 标识符已改名
- **When** 执行 `rg -i 'opencodeclient|createopencode' packages/`
- **Then** 零结果

**运行时验证**:

- **Given** 标识符更新后
- **When** 执行 `bun test` in `sdk/js`, `packages/octopus`, `packages/plugin`
- **Then** 所有单元测试通过

- **Given** 标识符更新完成
- **When** 执行 `script/verify-rebrand.ts` (Issue 3 验证项)
- **Then** 检查项通过

### Issue 4 — 环境变量 & Flag 常量

**静态验证**:

- **Given** flag.ts 已更新
- **When** 执行 `grep 'OPENCODE_' packages/core/src/flag/flag.ts`
- **Then** 零结果

**运行时验证**:

- **Given** 环境变量引用已同步
- **When** 执行 `bun turbo test:ci`
- **Then** 全量测试通过（测试中的 env var 引用已同步）

- **Given** 所有 OPENCODE\_\* env var 引用已替换
- **When** 执行 `rg 'OPENCODE_' packages/`
- **Then** 零结果（排除外部引用如 `OTEL_*`、`@openauthjs/*`）

- **Given** 兼容双读逻辑已实现
- **When** 设置 `OPENCODE_DB=:memory:` 且不设置 `OCTOPUS_DB`
- **Then** 应用仍能启动并正确使用 `:memory:` 数据库

### Issue 5 — 配置系统重命名

**静态验证**:

- **Given** `.opencode/` 已重命名为 `.octopus/`
- **When** 执行 `ls .opencode/`
- **Then** 目录不存在

**运行时验证**:

- **Given** 配置查找逻辑已更新
- **When** 运行 `octopus config --show` 且 `.octopus/octopus.jsonc` 存在
- **Then** CLI 正确加载并显示配置

- **Given** 旧目录检测逻辑已实现
- **When** `.opencode/` 存在但 `.octopus/` 不存在
- **Then** CLI 启动时输出迁移提示，并回退读取 `.opencode/` 配置

- **Given** 迁移命令已实现
- **When** 运行 `octopus migrate`
- **Then** `.opencode/` → `.octopus/` 自动完成，内部路径引用同步更新

### Issue 6 — 品牌资产重命名

**静态验证**:

- **Given** 主题文件已重命名
- **When** 执行 `grep 'opencodeTheme\|opencode\.json' packages/ui/`
- **Then** 零结果（排除历史引用）

**运行时验证**:

- **Given** 主题变量已更新
- **When** 在 Storybook 或 CLI TUI 中切换 "Octopus" 主题
- **Then** 主题正确加载和渲染，无 `opencodeTheme` 未定义错误

- **Given** CSS class 已更新
- **When** 多行代码渲染
- **Then** `octopus-line-comment-styles` 等样式正确应用

### Issue 7 — 扩展重命名

**VS Code 静态验证**:

- **Given** package.json 命令 ID 已更新
- **When** 运行 `bun run package` in `sdks/vscode/`
- **Then** VSIX 打包成功，无命令 ID 重复错误

**VS Code 运行时验证**:

- **Given** 扩展已打包
- **When** 在 VS Code 中安装 .vsix 文件
- **Then** 扩展正确加载，命令前缀为 `octopus.openTerminal` 等

**Zed 验证**:

- **Given** `extension.toml` 已更新
- **When** 解析 toml 文件
- **Then** `id = "octopus"`、`[agent_servers.octopus]` 结构正确，全部 5 个平台 target 的 URL 和 cmd 已更新

### Issue 8 — CI/CD & 脚本 URL

**静态验证**:

- **Given** workflow 文件已更新
- **When** 执行 `grep 'anomalyco/opencode' .github/`
- **Then** 零结果（保留模型 ID 引用）

**运行时验证**:

- **Given** 发布脚本已更新
- **When** 执行 `rg 'opencode-darwin' packages/octopus/script/`
- **Then** 零结果

- **Given** GitHub Secrets 双轨已设置
- **When** CI 在 Octopus 仓库中触发
- **Then** workflow 正确引用 `OCTOPUS_API_KEY`，pipeline 全绿

- **Given** 发布配置文件已检查
- **When** 执行 `npm publish --dry-run` (主包和 SDK 包)
- **Then** 发布产物名称正确 (octopus / @octopus-ai/sdk)

### Issue 9 — 文档 & i18n

**静态验证**:

- **Given** 所有 MDX 页面已更新
- **When** 提取所有代码块中的命令和路径
- **Then** 所有路径指向 `.octopus/` / `octopus.jsonc`；命令名为 `octopus`

- **Given** i18n key 已更新
- **When** 前端加载 locale 文件
- **Then** `t("share.octopus_version")` 等 key 正确返回翻译文本

**运行时验证**:

- **Given** 文档站点构建
- **When** 在 `packages/web` 中执行 `astro build`
- **Then** 构建成功，无未替换的 `opencode` 引用警告

- **Given** 文档中的代码示例已审核
- **When** 随机抽检 20% 代码块中的命令和路径
- **Then** 命令名 = `octopus`，配置路径 = `~/.config/octopus/octopus.jsonc`

**端到端冒烟** (全部 9 Issue 完成后):

- **Given** 所有品牌迁移任务完成
- **When** 运行 `script/rebrand-smoke.ts`
- **Then** 全部冒烟检查通过 (CLI 启动、配置加载、包发布 dry-run、扩展打包、全量 typecheck)

---

## 八、工作量等级

### 8.1 逐 Issue 评估

| #   | Issue                | 预估文件 |     复杂度      | 工时 |  级别  |
| --- | -------------------- | :------: | :-------------: | :--: | :----: |
| 1   | npm scope 批量重命名 |   ~250   |   低 (机械化)   | 2-3h | **L**  |
| 2   | 目录重命名           |   ~80    |       中        |  1h  | **M**  |
| 3   | API 标识符重命名     |   ~60    | 中 (需人工审查) | 1.5h | **S**  |
| 4   | env/flags 重命名     |   ~50    |  低 (集中定义)  |  1h  | **S**  |
| 5   | 配置系统重命名       |   ~40    | 中 (需迁移逻辑) |  1h  | **S**  |
| 6   | 品牌资产重命名       |   ~12    |       低        | 0.5h | **XS** |
| 7   | 扩展重命名           |    ~8    |    低 (集中)    | 0.5h | **XS** |
| 8   | CI/CD 脚本           |   ~35    |   中 (多位置)   |  1h  | **S**  |
| 9   | 文档/i18n            |   ~200   | 高 (需语义审查) | 3-4h | **L**  |

**合计**: ~735 文件，**25-40 agent-hours**（含验证、兼容迁移、生态协调），3 agents 并行可压缩墙钟至 ~16-24h。

### 8.2 整体工作量等级: **XL**

**理由**: 总计 ~735 文件 > 500 (XL 阈值)，跨越 20+ 包，涉及全量品牌变更。

### 8.3 工作量详细构成

|      阶段      | 内容                                                           |  预估工时  |
| :------------: | -------------------------------------------------------------- | :--------: |
|    机械替换    | #1-#8 的 sed/rg/rename 操作                                    |   8-12h    |
|    验证闭环    | typecheck 修复 + test 适配 + bun.lock + CI 调试                |    4-6h    |
|  兼容逻辑开发  | env 双读 + migrate 命令 + CLI alias                            |    3-5h    |
|   包发布演练   | 20 包发布顺序验证 + npm/AUR/Homebrew/Chocolatey                |    3-5h    |
| 文档/i18n 校对 | 66 locale × ~140 MDX 人工审查                                  |    4-8h    |
|  外部生态协调  | VS Code publisher / Zed store / Homebrew tap / Docker registry |    2-3h    |
|      缓冲      | 不可预见问题 + 回退重试                                        |    1-3h    |
|    **合计**    |                                                                | **25-40h** |

### 8.4 并行执行潜力

| Group     | Issues | 串行 Agent-hours | 并行墙钟 (3 agents) |
| --------- | ------ | :--------------: | :-----------------: |
| Group 0   | #1     |       4-6h       |        4-6h         |
| Group 1   | #2     |       2-3h       |        2-3h         |
| Group 2   | #3-#8  |      12-18h      |        ~6-9h        |
| Group 3   | #9     |       4-8h       |        4-8h         |
| 验证+发布 | 全量   |       3-5h       |        3-5h         |
| **总计**  |        |    **25-40h**    |     **~16-24h**     |

---

## 九、LLM Panel 评审结果

> **评审日期**: 2026-05-11 | **通过模型**: 1/7 | **判定**: NoGo (需第 2 轮)
> **评审记录**: `.octopus/review/opencode-to-octopus-rebrand-p4.md`

### 修正清单（基于 Panel 6/7 批评）

|  #  | 修正项                                                                        |      状态       |
| :-: | ----------------------------------------------------------------------------- | :-------------: |
|  1  | 验收标准加入运行时验证 (CLI、扩展、发布、CI、冒烟)                            | ✅ 已更新 (七)  |
|  2  | 工作量评估更新为 25-40h                                                       | ✅ 已更新 (八)  |
|  3  | 补充自动化验证工具链 (`script/verify-rebrand.ts` + `script/rebrand-smoke.ts`) | ✅ 已更新 (2.4) |
|  4  | 兼容方案细化 (双读/迁移命令/npm deprecation/alias/XDG 路径)                   | ✅ 已更新 (5.3) |
|  5  | 风险矩阵补充 (大小写三态、动态引用、发布顺序、Secrets 窗口)                   | ✅ 已更新 (2.2) |

### 第 2 轮评审结果

**日期**: 2026-05-11 | **结果**: ✅ **7/7 Go** (超过 ≥4/7 阈值)

| 模型            | 总评 |
| --------------- | :--: |
| Claude Opus 4.7 |  Go  |
| GPT 5.5         |  Go  |
| Gemini 3.1 Pro  |  Go  |
| DeepSeek V4 Pro |  Go  |
| QWen 3.6 Plus   |  Go  |
| Kimi K2.6       |  Go  |
| MiniMax M2.7    |  Go  |

---

## 十、结论

☑ **可行**，建议进入 P4 LLM Panel 评审。

| 维度            |                                 判定                                 |
| --------------- | :------------------------------------------------------------------: |
| 技术可行性      | ⚠️ 机械化替换为主，风险可控 (补充了大小写三态/动态引用/发布顺序风险) |
| Breaking Change | ⚠️ 是 — 兼容方案已细化 (双读/migrate 命令/alias/npm deprecation/XDG) |
| CI/CD 影响      |    ⚠️ 中 — 3 个 workflow 文件受影响，需 GitHub Settings 同步双轨     |
| 安全风险        |                        ✅ 低 — 字符串替换为主                        |
| 验收标准        |  ⚠️ 已加入运行时验证 (CLI/扩展/发布/CI/冒烟) — 需 Panel 第 2 轮确认  |
| 工作量          |        ⚠️ XL — 25-40h (含验证、兼容、生态协调)，墙钟 ~16-24h         |
