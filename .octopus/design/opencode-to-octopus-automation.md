# P5 技术设计：OpenCode → Octopus 自动化迁移脚本

> **阶段**: P5 (core-dev) | **日期**: 2026-05-11
> **上游**: `.octopus/research/opencode-to-octopus-rebrand.md` §2.4
> **版本**: v0.1.0

---

## 目录

1. [设计概览](#1-设计概览)
2. [`script/verify-rebrand.ts` 设计](#2-scriptverify-rebrandts-设计)
3. [`script/rebrand-smoke.ts` 设计](#3-scriptrebrand-smokets-设计)
4. [Issue #1: sed 批量替换命令](#4-issue-1-sed-批量替换命令)
5. [Issue #2: `git mv` + 路径引用更新](#5-issue-2-git-mv--路径引用更新)
6. [Issue #4: Flag/env 重命名](#6-issue4-flagenv-重命名)
7. [Issue #5: 配置系统重命名](#7-issue-5-配置系统重命名)

---

## 1. 设计概览

### 1.1 自动化脚本位置

所有脚本放置在仓库根目录 `script/` 下，与原脚本（`beta.ts`, `publish.ts`, 等）同层：

```
script/
├── beta.ts
├── publish.ts
├── ...
├── verify-rebrand.ts    ← 新增: Issue 级验证
└── rebrand-smoke.ts     ← 新增: 端到端冒烟
```

脚本使用 `#!/usr/bin/env bun` shebang，通过 `bun run script/verify-rebrand.ts` 调用。遵循现有脚本模式：使用 `import { $ } from "bun"` 执行 shell 命令，`Bun.Glob` 扫描文件。

### 1.2 三阶段替换原则

`opencode` 存在三态大小写，必须分阶段精确替换避免误伤：

| 阶段               | 原字符串                | 目标字符串 | 文件类型                                              | 排除规则            |
| ------------------ | ----------------------- | ---------- | ----------------------------------------------------- | ------------------- |
| **A - 全小写**     | `opencode`              | `octopus`  | `.ts`, `.json`, `.yml`, `.toml`, `.md`, `.mdx`, `.js` | 排除列表（见 §4.1） |
| **B - 全大写**     | `OPENCODE_`             | `OCTOPUS_` | `.ts`, `.yml`                                         | `OTEL_*`            |
| **C - 首字母大写** | `Opencode` / `OpenCode` | `Octopus`  | `.ts`, `.json`, `.mdx`                                | 仅精确匹配标识符    |

### 1.3 排除清单（所有脚本共享）

以下字符串在所有阶段中**绝对不得修改**：

```
# 第三方 npm 包（保留原始拼写）
@gitlab/opencode-gitlab-auth
opencode-gitlab-auth
opencode-poe-auth

# LLM Model ID（外部模型路由标识）
opencode-go/deepseek-v4-pro
opencode/claude-opus-4-7
opencode/gpt-5.*
opencode/kimi-k2.*

# 外部服务 URL（非本仓库控制）
https://opencode.ai/install
https://discord.gg/opencode

# 第三方库前缀（非 opencode 品牌）
@opentui/*
OTEL_*
@openauthjs/*
```

### 1.4 脚本必须兼容改名后的仓库状态

所有脚本内部的 import/引用必须自身使用新名称（`@octopus-ai/*`），这意味着脚本需要在 Issue #1 完成（scope 改名）**之后**才能写入并运行。同时脚本自身不引用任何 `@opencode-ai/*` 包——它们应该是独立的 `bun` 脚本。

具体实现：

- `verify-rebrand.ts` 和 `rebrand-smoke.ts` **不 import 任何 `@opencode-ai/*` 或 `@octopus-ai/*` 包**
- 使用标准 `node:` imports + `bun` 内置 API（`Bun.$, Bun.Glob, Bun.file`）
- `rebrand-smoke.ts` 中需要运行的命令（typecheck, test）通过 `$` 执行 `bun turbo` CLI 间接调用

---

## 2. `script/verify-rebrand.ts` 设计

### 2.1 架构原则

- **独立可运行的 Issue 验证**：每个 Issue 有对应的 `checkIssue*` 函数，可单独运行（通过 `--issue N` 参数）
- **零容忍模式**：任何残留引用 = FAIL，exit code 非零
- **可输出 diff 模式**：`--verbose` 列出所有命中的文件和行号
- **优先使用 TypeScript 原生 API**，仅在必要时 fallback 到 `$` shell

### 2.2 数据结构

```ts
interface CheckResult {
  issue: number
  name: string
  command: string
  passed: boolean
  matches: string[]
  fileCount: number
  durationMs: number
}

type ExitReason = "all_passed" | "check_failed" | "usage_error"
```

### 2.3 CLI 接口

```bash
# 全量验证（默认所有 9 个 Issue）
bun run script/verify-rebrand.ts

# 验证指定 Issue
bun run script/verify-rebrand.ts --issue 1,2,4

# 仅检查组 0 (Issue #1)
bun run script/verify-rebrand.ts --group 0

# 详细模式——显示所有命中文档和行号
bun run script/verify-rebrand.ts --verbose

# JSON 输出（for CI）
bun run script/verify-rebrand.ts --json
```

### 2.4 验证函数设计（按 Issue）

#### `checkIssue1()` — npm scope 残留检查

```ts
function checkIssue1(): CheckResult {
  const patterns = [
    {
      name: "ts import",
      grep: { pattern: "@opencode-ai/", include: "*.ts", exclude: "node_modules|dist|.turbo|migration" },
    },
    { name: "tsx import", grep: { pattern: "@opencode-ai/", include: "*.tsx", exclude: "node_modules|dist|.turbo" } },
    { name: "json package", grep: { pattern: "@opencode-ai/", include: "package.json", exclude: "node_modules" } },
    { name: "turbo tasks", grep: { pattern: "@opencode-ai/|opencode#", include: "turbo.json" } },
    { name: "js sdk import", grep: { pattern: "@opencode-ai/", include: "*.js", exclude: "node_modules|dist" } },
  ]
  // ...
}
```

**注意**：npm scope 检查已经天然排除第三方包——`@gitlab/opencode-gitlab-auth` 不以 `@opencode-ai/` 开头，不会被匹配。

#### `checkIssue2()` — 目录残留检查

```ts
function checkIssue2(): CheckResult {
  // 静态检查: packages/octopus/ 目录不存在
  const dirExists = existsSync("packages/opencode")

  // 路径引用残留
  const pathRefs = grep({
    pattern: "packages/octopus/",
    include: "*.{ts,json,yml,md,mdx,toml}",
    exclude: "node_modules|dist|.turbo|migration",
  })

  // sst.config.ts 中的 name 字段
  const sstName = grep({ pattern: 'name:\\s*"opencode"', path: "sst.config.ts" })

  return { passed: !dirExists && pathRefs.length === 0 && sstName.length === 0, ... }
}
```

#### `checkIssue3()` — API 标识符残留检查

```ts
function checkIssue3(): CheckResult {
  const identifiers = [
    "createOpencode", // → createOctopus
    "createOpencodeClient", // → createOctopusClient
    "createOpencodeServer", // → createOctopusServer
    "createOpencodeTui", // → createOctopusTui
    "OpencodeClient", // → OctopusClient
    "OpencodeClientConfig", // → OctopusClientConfig
  ]
  // 构建精确的 word-boundary regex: /\b(createOpencode|OpencodeClient)\b/
  const pattern = identifiers.join("|")
  // 扫描 .ts,.tsx 文件（排除 node_modules, dist, migration, test snapshot）
  // ...
}
```

#### `checkIssue4()` — 环境变量残留检查

```ts
function checkIssue4(): CheckResult {
  const patterns = [
    {
      name: "Flag definitions",
      grep: { pattern: "OPENCODE_", path: "packages/core/src/flag/flag.ts" },
    },
    {
      name: "process.env refs",
      grep: { pattern: 'process\\.env\\["OPENCODE_', include: "*.ts" },
    },
    {
      name: "core opencode refs",
      grep: { pattern: "OPENCODE_", path: "packages/core/src", exclude: "flag/flag\\.ts" },
    },
  ]
  // 排除: OTEL_* 模式（使用 negative lookahead 或在 post-filter 中排除）
  // ...
}
```

#### `checkIssue5()` — 配置路径残留检查

```ts
function checkIssue5(): CheckResult {
  const patterns = [
    { name: ".opencode dir", grep: { pattern: "\\.opencode/", include: "*.{ts,json,yml,md,mdx}" } },
    { name: "opencode.jsonc", grep: { pattern: "opencode\\.jsonc", include: "*.{ts,json,yml,md,mdx}" } },
    { name: "opencode.json", grep: { pattern: '"[^"]*opencode\\.json"', include: "*.ts" } },
  ]
  // 注意: .opencode/ 目录的文件系统存在性在 Issue #5 本身检查
  // ...
}
```

#### `checkIssue6()` — 主题/品牌资产残留检查

```ts
function checkIssue6(): CheckResult {
  const patterns = [
    { name: "theme variable", grep: { pattern: "opencodeTheme", path: "packages/ui" } },
    { name: "theme file", grep: { pattern: "opencode\\.json", path: "packages/ui" } },
    {
      name: "css class",
      grep: { pattern: "opencode-theme|opencode-find|opencode-line-comment", include: "*.{ts,tsx,css}" },
    },
    { name: "icon file", grep: { pattern: "opencode\\.svg", include: "*.{ts,toml}" } },
  ]
  // ...
}
```

#### `checkIssue7()` — 扩展残留检查

```ts
function checkIssue7(): CheckResult {
  // VS Code
  const vscode = grep({ pattern: 'opencode\\.', path: "sdks/vscode/package.json" })

  // Zed
  const zed = grep({ pattern: '"opencode"|id = "opencode"|\\[agent_servers\\.opencode\\]|/opencode-darwin|/opencode-linux|/opencode-windows|\\./opencode|\\./opencode\\.exe', path: "packages/extensions/zed/extension.toml" })

  return { passed: vscode.length === 0 && zed.length === 0, ... }
}
```

#### `checkIssue8()` — CI/URL 残留检查

```ts
function checkIssue8(): CheckResult {
  const patterns = [
    { name: "repo url", grep: { pattern: "anomalyco/opencode", path: ".github" } },
    {
      name: "artifact name",
      grep: {
        pattern: "opencode-darwin|opencode-linux|opencode-windows",
        path: "packages/octopus/script|packages/octopus/script",
      },
    },
    { name: "email", grep: { pattern: "opencode@sst\\.dev", include: "*.{ts,json,yml,md,mdx}" } },
    // 以下不检查（保留清单）
    // anomalyco/opencode/github@latest 中的 model: opencode/claude-opus-4-5（外部模型ID）
    // https://discord.gg/opencode（外部 URL）
  ]
  // ...
}
```

#### `checkIssue9()` — 文档/i18n 残留检查

```ts
function checkIssue9(): CheckResult {
  const patterns = [
    { name: ".config/opencode", grep: { pattern: "\\.config/opencode/", path: "packages/web" } },
    { name: "CLI command doc", grep: { pattern: "`opencode\\b", path: "packages/web" } },
    { name: "i18n key", grep: { pattern: '"[^"]*\\.opencode_', path: "packages/web" } },
    { name: "AGENTS.md", grep: { pattern: "openCode|OpenCode|OPENCODE", path: "AGENTS.md" } },
  ]
  // 排除: 模型 ID（opencode-go/deepseek-v4-pro 等）
  // 排除: 外部 URL（https://opencode.ai/install, https://discord.gg/opencode）
  // ...
}
```

### 2.5 实现骨架

```ts
#!/usr/bin/env bun

import { resolve, relative } from "node:path"
import { existsSync } from "node:fs"
import { $ } from "bun"

// --- grep 封装 ---
interface GrepOptions {
  pattern: string
  path?: string
  include?: string
  exclude?: string
}

async function grep(opts: GrepOptions): Promise<string[]> {
  const args = ["-rl", "--no-heading", opts.pattern]
  if (opts.path) args.push(opts.path)
  if (opts.include) args.push("--include", opts.include)
  // Build the command string properly
  const cmd = `rg ${args.join(" ")}`
  // Execute via $ but with {nothrow: true} so non-zero exits don't crash
  // Actually, rg returns non-zero when no matches, which is fine
}

// --- Issue 验证器注册表 ---
const issues: Record<number, () => Promise<CheckResult>> = {
  1: checkIssue1,
  2: checkIssue2,
  3: checkIssue3,
  4: checkIssue4,
  5: checkIssue5,
  6: checkIssue6,
  7: checkIssue7,
  8: checkIssue8,
  9: checkIssue9,
}

// --- 参数解析 ---
const args = Bun.argv.slice(2)
const verbose = args.includes("--verbose")
const json = args.includes("--json")

// Parse --issue 1,2,4 or --group N
const issueIds = parseIssueArg(args)

// --- 主执行 ---
const results: CheckResult[] = []
for (const id of issueIds) {
  const fn = issues[id]
  if (!fn) {
    console.error(`Unknown issue: ${id}`)
    process.exit(2)
  }
  const result = await fn()
  results.push(result)
}

if (json) {
  console.log(JSON.stringify(results, null, 2))
} else {
  printSummary(results, verbose)
}

const allPassed = results.every((r) => r.passed)
process.exit(allPassed ? 0 : 1)
```

### 2.6 CI 集成

```yaml
# .github/workflows/verify-rebrand.yml (或集成到现有 workflow 中)
- name: Verify rebrand (partial)
  run: bun run script/verify-rebrand.ts --issue 1,2,4 --json
- name: Verify rebrand (all)
  run: bun run script/verify-rebrand.ts --json
```

---

## 3. `script/rebrand-smoke.ts` 设计

### 3.1 目标

在所有 9 个 Issue 完成后执行端到端验证。**此脚本依赖所有变更已完成**（包括 `packages/opencode` → `packages/octopus`、CLI 二进制名 `octopus`、配置目录 `.octopus/`）。

### 3.2 冒烟测试项

```ts
interface SmokeTest {
  name: string
  description: string
  async run(): Promise<SmokeResult>
}

interface SmokeResult {
  passed: boolean
  error?: string
  durationMs: number
  output?: string
}
```

### 3.3 测试列表

#### T1: 全量 typecheck

```ts
const testTypecheck: SmokeTest = {
  name: "typecheck",
  description: "bun turbo typecheck — 全量通过",
  async run() {
    const { exitCode, stderr } = await $`bun turbo typecheck`.nothrow().quiet()
    return {
      passed: exitCode === 0,
      error: exitCode !== 0 ? stderr.toString() : undefined,
    }
  },
}
```

#### T2: frozen lockfile 安装

```ts
const testFrozenInstall: SmokeTest = {
  name: "frozen-lockfile",
  description: "bun install --frozen-lockfile — 无 workspace 解析错误",
  async run() {
    const { exitCode, stderr } = await $`bun install --frozen-lockfile`.nothrow().quiet()
    return {
      passed: exitCode === 0,
      error: exitCode !== 0 ? stderr.toString() : undefined,
    }
  },
}
```

#### T3: 包名审计

```ts
const testPackageNames: SmokeTest = {
  name: "package-names",
  description: "所有 package.json 的 name 字段不含 opencode",
  async run() {
    // 扫描所有 package.json（排除 node_modules）
    const files = await Array.fromAsync(
      new Bun.Glob("**/package.json").scan({ absolute: true, cwd: process.cwd() }),
    ).then((arr) => arr.filter((f) => !f.includes("node_modules")))

    const violations: string[] = []
    for (const file of files) {
      const pkg = await Bun.file(file).json()
      if (pkg.name && /opencode/i.test(pkg.name)) {
        // 排除: 第三方 dependences 中的 opencode 包名（如 opencode-gitlab-auth）
        if (/gitlab|poe|openrouter/i.test(pkg.name)) continue
        violations.push(`${file}: name="${pkg.name}"`)
      }
    }
    return {
      passed: violations.length === 0,
      error: violations.length > 0 ? violations.join("\n") : undefined,
    }
  },
}
```

#### T4: CLI 二进制名审计

```ts
const testBinaryNames: SmokeTest = {
  name: "binary-names",
  description: "package.json bin 字段和 bin/ 目录不含 opencode",
  async run() {
    const files = await Array.fromAsync(new Bun.Glob("{packages/*/,sdks/*/}package.json").scan({ absolute: true }))
    const violations: string[] = []
    for (const file of files) {
      const pkg = await Bun.file(file).json()
      if (pkg.bin) {
        for (const [name] of Object.entries(pkg.bin)) {
          if (/opencode/i.test(name) && name !== "octopus") {
            violations.push(`${file}: bin["${name}"]`)
          }
        }
      }
    }
    // 检查 bin/ 目录中是否存在 opencode 文件
    const binFiles = await Array.fromAsync(new Bun.Glob("packages/octopus/bin/opencode").scan())
    if (binFiles.length > 0) violations.push(`bin/opencode still exists`)

    return {
      passed: violations.length === 0,
      error: violations.length > 0 ? violations.join("\n") : undefined,
    }
  },
}
```

#### T5: turbo.json 任务名审计

```ts
const testTurboTasks: SmokeTest = {
  name: "turbo-tasks",
  description: "turbo.json 任务名和 globalEnv 不含 opencode",
  async run() {
    const turbo = await Bun.file("turbo.json").json()
    const violations: string[] = []

    // 检查 globalEnv
    for (const env of turbo.globalEnv || []) {
      if (/opencode/i.test(env) && !/DISABLE/i.test(env)) {
        violations.push(`turbo.json globalEnv: ${env}`)
      }
    }
    // 检查 task names
    for (const key of Object.keys(turbo.tasks || {})) {
      if (/opencode/i.test(key) || /@opencode-ai/i.test(key)) {
        violations.push(`turbo.json task: ${key}`)
      }
    }

    return {
      passed: violations.length === 0,
      error: violations.length > 0 ? violations.join("\n") : undefined,
    }
  },
}
```

#### T6: ServiceTag 审计

```ts
const testServiceTags: SmokeTest = {
  name: "service-tags",
  description: "Effect ServiceTag 不含 @opencode/",
  async run() {
    // 使用 rg 搜索 `@opencode/` pattern（仅在 .ts 文件中）
    const { exitCode, stdout } = await $`rg -n '@opencode/' --include='*.ts' packages/octopus/src/`.nothrow().quiet()

    return {
      passed: exitCode !== 0, // rg returns 1 when no matches
      error: exitCode === 0 ? stdout.toString() : undefined,
    }
  },
}
```

#### T7: 配置路径一致性

```ts
const testConfigPaths: SmokeTest = {
  name: "config-paths",
  description: "代码中的配置路径引用一致",
  async run() {
    const violations: string[] = []

    // 检查 core/src/global.ts 中的 app 变量
    const globalFile = await Bun.file("packages/core/src/global.ts").text()
    const appMatch = globalFile.match(/const app\s*=\s*"([^"]+)"/)
    if (appMatch && appMatch[1] !== "octopus") {
      violations.push(`global.ts: app = "${appMatch[1]}" (should be "octopus")`)
    }

    // 检查 OPENCODE_ 枚举残留
    const flagFile = await Bun.file("packages/core/src/flag/flag.ts").text()
    const opencodeMatches = flagFile.match(/OPENCODE_\w+/g)
    if (opencodeMatches) {
      violations.push(`flag.ts: ${opencodeMatches.length} OPENCODE_* references remaining`)
    }

    return {
      passed: violations.length === 0,
      error: violations.length > 0 ? violations.join("\n") : undefined,
    }
  },
}
```

#### T8: 扩展打包（dry-run）

```ts
const testExtensionPack: SmokeTest = {
  name: "extension-pack",
  description: "VS Code 扩展打包成功",
  async run() {
    const { exitCode, stderr } = await $`bun run --cwd sdks/vscode package`.nothrow().quiet()
    return {
      passed: exitCode === 0,
      error: exitCode !== 0 ? stderr.toString() : undefined,
    }
  },
}
```

#### T9: 发布 dry-run

```ts
const testPublishDryRun: SmokeTest = {
  name: "publish-dry-run",
  description: "npm publish --dry-run 成功（SDK 包）",
  async run() {
    // 对 SDK 包执行 dry-run
    const { exitCode, stderr } = await $`npm publish --dry-run`.cwd("packages/sdk/js").nothrow().quiet()

    // 检查 package name 不含 opencode
    const pkg = await Bun.file("packages/sdk/js/package.json").json()
    const nameOk = pkg.name && !/opencode/i.test(pkg.name)

    return {
      passed: exitCode === 0 && nameOk,
      error: !nameOk ? `package name: ${pkg.name}` : exitCode !== 0 ? stderr.toString() : undefined,
    }
  },
}
```

### 3.4 主入口

```ts
#!/usr/bin/env bun

const tests: SmokeTest[] = [
  testTypecheck,
  testPackageNames,
  testBinaryNames,
  testTurboTasks,
  testServiceTags,
  testConfigPaths,
  testFrozenInstall,
  testExtensionPack,
  testPublishDryRun,
]

let allPassed = true
for (const test of tests) {
  const start = performance.now()
  process.stdout.write(`[ SMOKE ] ${test.description} ... `)

  const result = await test.run()
  const elapsed = (performance.now() - start).toFixed(0)

  if (result.passed) {
    console.log(`OK (${elapsed}ms)`)
  } else {
    allPassed = false
    console.log(`FAIL (${elapsed}ms)`)
    if (result.error) console.log(`  ${result.error}`)
  }
}

console.log(allPassed ? "\n✓ All smoke tests passed" : "\n✗ Some smoke tests failed")
process.exit(allPassed ? 0 : 1)
```

---

## 4. Issue #1: sed 批量替换命令

### 4.1 精确替换模式

**原则**：使用 anchored 替换，不做无上下文的全局 `s/opencode/octopus/g`。

### 4.2 Phase A: npm scope 替换（`@opencode-ai` → `@octopus-ai`）

这是最安全的机械替换——`@opencode-ai/` 是一个唯一前缀，在代码中完全没有歧义。

#### 命令 1: 所有 `package.json` 中的 `name` 字段

```bash
# Step 1: 预览（dry-run）
rg '@opencode-ai/' --include='package.json' -l | grep -v node_modules

# Step 2: 执行替换
rg '@opencode-ai/' --include='package.json' -l \
  | grep -v node_modules \
  | xargs sed -i 's|@opencode-ai/|@octopus-ai/|g'

# Step 3: 单独处理 root package.json 的 name 字段（无 scope 前缀）
# root package.json: "name": "opencode" → "name": "octopus"
sed -i 's|"name": "opencode"|"name": "octopus"|' package.json
```

#### 命令 2: 所有 TypeScript 文件中的 import 语句

```bash
# Step 1: 预览
rg '@opencode-ai/' --include='*.ts' --include='*.tsx' -l \
  | grep -v node_modules | grep -v dist | wc -l

# Step 2: 执行替换（import 路径、jest/ts 配置等）
rg '@opencode-ai/' --include='*.ts' --include='*.tsx' -l \
  | grep -v node_modules | grep -v dist \
  | xargs sed -i 's|@opencode-ai/|@octopus-ai/|g'

# Step 3: 同时修复 Effect ServiceTag（@opencode/ → @octopus/）
# 71 个引用在 packages/octopus/src/ 中
rg '@opencode/' --include='*.ts' -l \
  | grep -v node_modules \
  | xargs sed -i 's|@opencode/|@octopus/|g'
```

**安全性验证**：ServiceTag 替换 `@opencode/` → `@octopus/` 不会误伤任何合法引用，因为：

- `@opentui/` 是 `@opentui/` 不是 `@opencode/`
- `@openauthjs/` 是 `@openauthjs/` 不是 `@opencode/`
- 第三方包 `@gitlab/opencode-gitlab-auth` 不含 `@opencode/` 模式

#### 命令 3: JavaScript 文件中的 import 语句

```bash
rg '@opencode-ai/' --include='*.js' -l \
  | grep -v node_modules | grep -v dist \
  | xargs sed -i 's|@opencode-ai/|@octopus-ai/|g'
```

#### 命令 4: turbo.json 任务名

```bash
# turbo.json 中有 6 个引用需要手动更新（因为格式不统一）
# opencode#test → octopus#test
# opencode#test:ci → octopus#test:ci
# @opencode-ai/app#test → @octopus-ai/app#test
# @opencode-ai/app#test:ci → @octopus-ai/app#test:ci
# @opencode-ai/ui#test → @octopus-ai/ui#test
# @opencode-ai/ui#test:ci → @octopus-ai/ui#test:ci

sed -i 's|opencode#test|octopus#test|g' turbo.json
sed -i 's|opencode#test:ci|octopus#test:ci|g' turbo.json
sed -i 's|@opencode-ai/|@octopus-ai/|g' turbo.json

# globalEnv 和 globalPassThroughEnv 中也需检查
# 当前: ["CI", "OPENCODE_DISABLE_SHARE"]
sed -i 's|OPENCODE_DISABLE_SHARE|OCTOPUS_DISABLE_SHARE|g' turbo.json
```

#### 命令 5: workspace:\* 依赖引用（root package.json）

```bash
# root package.json 的 workspaces 块不变（它用的是目录路径模式，不是包名）
# 但 dependencies 中的 workspace:* 引用需更新:
sed -i 's|"@opencode-ai/plugin":|"@octopus-ai/plugin":|g' root/package.json
sed -i 's|"@opencode-ai/script":|"@octopus-ai/script":|g' root/package.json
sed -i 's|"@opencode-ai/sdk":|"@octopus-ai/sdk":|g' root/package.json
```

#### 命令 6: `.opencode/package.json` SDK 依赖

```bash
# .opencode/ 内部的 package.json 也引用了 @opencode-ai/sdk
sed -i 's|@opencode-ai/|@octopus-ai/|g' .opencode/package.json
```

### 4.3 Phase A 验证

```bash
# 完成后立即验证
rg '@opencode-ai/' --include='*.ts' --include='*.tsx' --include='*.json' \
  --include='*.js' \
  | grep -v node_modules | grep -v dist
# → 期望零结果

# 重建 lockfile
rm bun.lock
bun install
bun turbo typecheck
# → 期望全部通过
```

---

## 5. Issue #2: `git mv` + 路径引用更新

### 5.1 核心操作: 目录重命名

```bash
# Step 1: git mv 保留历史
git mv packages/opencode packages/octopus
```

此命令会:

1. 重命名目录
2. 将变更暂存到 Git index（`packages/octopus/*` → `packages/octopus/*`）
3. 保留所有文件的 Git 历史（blob 不丢失）

### 5.2 目录内部 `package.json` 更新

```bash
# packages/octopus/package.json 中的 name 字段已在 Issue #1 中处理
# 但 bin 字段需要额外处理:
sed -i 's|"opencode": "./bin/opencode"|"octopus": "./bin/octopus"|' packages/octopus/package.json

# bin/ 目录也需要重命名
git mv packages/octopus/bin/opencode packages/octopus/bin/octopus
```

### 5.3 `bin/opencode` (现在改为 `bin/octopus`) 内部引用更新

```bash
# packages/octopus/bin/octopus 文件中的引用需更新:
# Line 46: process.env.OPENCODE_BIN_PATH → process.env.OCTOPUS_BIN_PATH
# Line 52: .opencode → .octopus
# Line 73: const base = "opencode-" + ... → const base = "octopus-" + ...
# Line 74: const binary = ... "opencode.exe" ... "opencode"
# Line 191-194: 错误消息中的 "opencode" CLI 引用

# 这些在后续 Issue #4 中通过 OPENCODE_* 替换脚本统一处理
# 但二进制名 pattern (base/binary) 需要此阶段手动处理

sed -i 's|"opencode-" + platform|"octopus-" + platform|' packages/octopus/bin/octopus
sed -i 's|"opencode\.exe"|"octopus.exe"|' packages/octopus/bin/octopus
sed -i 's|: "opencode"$|: "octopus"|' packages/octopus/bin/octopus
sed -i 's|of the opencode CLI|of the octopus CLI|' packages/octopus/bin/octopus
```

### 5.4 全仓路径引用替换

```bash
# Preview: 列出所有引用 packages/octopus/ 的文件
rg -l 'packages/octopus/' --include='*.ts' --include='*.json' \
  --include='*.yml' --include='*.md' --include='*.nix' \
  --include='toml' | grep -v node_modules | grep -v dist

# 执行替换
rg -l 'packages/octopus/' --include='*.ts' --include='*.json' \
  --include='*.yml' --include='*.md' --include='*.nix' \
  --include='toml' | grep -v node_modules | grep -v dist \
  | xargs sed -i 's|packages/octopus/|packages/octopus/|g'
```

### 5.5 特殊文件处理

#### `package.json` (根) scripts

```bash
# root package.json 中的脚本引用
sed -i 's|--cwd packages/opencode|--cwd packages/octopus|g' package.json
```

#### `sst.config.ts`

```bash
# name: "opencode" → name: "octopus"
sed -i 's|name: "opencode"|name: "octopus"|' sst.config.ts
```

#### `AGENTS.md`

```bash
# 根目录和 packages 内的 AGENTS.md 引用更新
sed -i 's|packages/octopus/|packages/octopus/|g' AGENTS.md
```

#### `.github/workflows/` 中的路径引用

```bash
# CI workflow 中的路径引用更新
rg -l 'packages/octopus/' .github/ | xargs sed -i 's|packages/octopus/|packages/octopus/|g'
```

### 5.6 `bunfig.toml` 更新

```bash
# 如果 bunfig.toml 中存在路径引用
rg -l 'packages/octopus/' bunfig.toml
# 如有匹配则执行 sed
```

### 5.7 Issue #2 验证

```bash
# 目录不存在
test -d packages/opencode && echo "FAIL: packages/opencode still exists" || echo "OK"

# 新目录存在
test -d packages/octopus && echo "OK: packages/octopus exists" || echo "FAIL"

# 零路径引用残留
rg 'packages/octopus/' \
  --include='*.ts' --include='*.json' --include='*.yml' --include='*.md' \
  --include='*.nix' --include='*.toml' \
  | grep -v node_modules | grep -v dist | grep -v '.octopus/design' | grep -v '.octopus/research'
# → 期望零结果（排除 changelog/设计文档中的历史引用）

# 类型检查
bun turbo typecheck
```

---

## 6. Issue #4: Flag/env 重命名

### 6.1 `flag.ts` 集中替换

```bash
# 这是一个集中的机械化替换
# 所有 OPENCODE_ → OCTOPUS_ 替换在单个文件中
sed -i 's|OPENCODE_|OCTOPUS_|g' packages/core/src/flag/flag.ts
```

### 6.2 全仓 `process.env` 引用替换

```bash
# 先预览
rg -n 'process\.env\["OPENCODE_' --include='*.ts' | grep -v node_modules

# 执行替换（仅 .ts 文件）
rg -l '"OPENCODE_' --include='*.ts' | grep -v node_modules | grep -v dist \
  | xargs sed -i 's|"OPENCODE_|"OCTOPUS_|g'

# 也替换 Config.boolean("OPENCODE_*") 调用（在 flag.ts 中）
# 已在上面 sed 处理
```

### 6.3 `global.ts` 特殊处理

```bash
# Line 9: const app = "opencode" → const app = "octopus"
sed -i 's|const app = "opencode"|const app = "octopus"|' packages/core/src/global.ts

# Line 18: OPENCODE_TEST_HOME → OCTOPUS_TEST_HOME
sed -i 's|OPENCODE_TEST_HOME|OCTOPUS_TEST_HOME|g' packages/core/src/global.ts

# Line 63: Flag.OPENCODE_CONFIG_DIR → Flag.OCTOPUS_CONFIG_DIR
# (通过全局 OPENCODE_ → OCTOPUS_ 替换覆盖)
```

### 6.4 `opencode-process.ts` 特殊处理

```bash
# packages/core/src/util/opencode-process.ts
# Line 1: OPENCODE_RUN_ID → OCTOPUS_RUN_ID
# Line 2: OPENCODE_PROCESS_ROLE → OCTOPUS_PROCESS_ROLE
sed -i 's|OPENCODE_RUN_ID|OCTOPUS_RUN_ID|g' packages/core/src/util/opencode-process.ts
sed -i 's|OPENCODE_PROCESS_ROLE|OCTOPUS_PROCESS_ROLE|g' packages/core/src/util/opencode-process.ts
# 文件名本身: opencode-process.ts → 不需改名（这是 JS 标识符，属于 Issue #3）
```

### 6.5 `installation/version.ts` 特殊处理

```bash
# OPENCODE_VERSION → OCTOPUS_VERSION
# OPENCODE_CHANNEL → OCTOPUS_CHANNEL
sed -i 's|OPENCODE_VERSION|OCTOPUS_VERSION|g' packages/core/src/installation/version.ts
sed -i 's|OPENCODE_CHANNEL|OCTOPUS_CHANNEL|g' packages/core/src/installation/version.ts
```

### 6.6 `util/log.ts` 特殊处理

```bash
# opencode.log → octopus.log
sed -i 's|opencode\.log|octopus.log|g' packages/core/src/util/log.ts
```

### 6.7 验证

```bash
# flag.ts 零 OPENCODE_ 残留
rg 'OPENCODE_' packages/core/src/flag/flag.ts
# → 期望零结果

# 全仓 OPENCODE_ 残留（排除 OTEL_*、保留清单）
rg 'OPENCODE_' --include='*.ts' \
  | grep -v node_modules | grep -v OTEL_ \
  | grep -v dist
# → 期望零结果
```

---

## 7. Issue #5: 配置系统重命名

### 7.1 `.opencode/` 目录重命名为 `.octopus/`

```bash
# Step 1: git mv
git mv .opencode .octopus

# Step 2: .octopus 目录内部文件自引用更新
# .octopus/ 下的 SKILL.md、配置文件等可能引用 ".opencode/"
rg -l '\.opencode/' .octopus/ | xargs sed -i 's|\.opencode/|.octopus/|g'

# Step 3: 配置文件重命名
git mv .octopus/opencode.jsonc .octopus/octopus.jsonc
```

### 7.2 配置查找逻辑更新

```bash
# config.ts 中的配置查找路径
# 搜索 pattern: ".opencode" 或 "opencode.jsonc"
rg -n '\.opencode\|opencode\.jsonc' packages/octopus/src/config/

# 对匹配的文件执行替换
rg -l '\.opencode\|opencode\.jsonc' --include='*.ts' \
  | grep -v node_modules | grep -v dist \
  | xargs sed -i 's|\.opencode/|.octopus/|g'
rg -l 'opencode\.jsonc\|opencode\.json\b' --include='*.ts' \
  | grep -v node_modules | grep -v dist \
  | xargs sed -i 's|opencode\.jsonc|octopus.jsonc|g'
rg -l 'opencode\.json\b' --include='*.ts' \
  | grep -v node_modules | grep -v dist \
  | xargs sed -i 's|opencode\.json|octopus.json|g'
```

### 7.3 CLI 命令中的配置路径更新

```bash
# packages/octopus/src/ 下所有 CLI 命令
rg -l '\.opencode\|opencode\.jsonc' packages/octopus/src/ \
  | xargs sed -i 's|\.opencode|.octopus|g'
rg -l 'opencode\.jsonc\|opencode\.json' packages/octopus/src/ \
  | xargs sed -i 's|opencode\.jsonc|octopus.jsonc|g'
```

### 7.4 测试 fixture 路径更新

```bash
# packages/octopus/test/ 下所有 fixture 引用
rg -l '\.opencode\|opencode\.jsonc' packages/octopus/test/ \
  | xargs sed -i 's|\.opencode|.octopus|g'
rg -l 'opencode\.jsonc' packages/octopus/test/ \
  | xargs sed -i 's|opencode\.jsonc|octopus.jsonc|g'
```

### 7.5 Workflow 文件中的 `.opencode/` 引用

```bash
rg -l '\.opencode/' .github/ | xargs sed -i 's|\.opencode/|.octopus/|g'
```

### 7.6 验证

```bash
# .opencode/ 目录不存在
test -d .opencode && echo "FAIL" || echo "OK"

# 全仓无 .opencode/ 引用残留
rg '\.opencode/' --include='*.ts' --include='*.json' --include='*.yml' \
  --include='*.md' \
  | grep -v node_modules | grep -v dist \
  | grep -v '.octopus/design' | grep -v '.octopus/research' \
  | grep -v '.octopus/review' | grep -v '.octopus/version-plans'
# → 期望零结果（排除 .octopus/ 自身的设计/研究文档）
```

---

## 附录 A: 文件影响统计（Issue × 文件类型矩阵）

| Issue    | `.ts`/`.tsx` | `.json` | `.yml`  | `.md`/`.mdx` | `.toml` | `.nix` |  其他   |   合计   |
| -------- | :----------: | :-----: | :-----: | :----------: | :-----: | :----: | :-----: | :------: |
| #1       |     ~200     |   ~20   |    1    |     ~30      |    —    |   —    |   ~5    |   ~256   |
| #2       |     ~60      |   ~10   |   ~5    |      ~5      |    1    |   ~3   |   ~3    |   ~87    |
| #4       |     ~75      |    —    |    —    |      —       |    —    |   —    |   ~5    |   ~80    |
| #5       |     ~30      |   ~3    |   ~3    |      ~3      |    —    |   —    |   ~3    |   ~42    |
| #6       |      ~5      |   ~2    |    —    |      —       |    —    |   —    |   ~5    |   ~12    |
| #7       |      1       |   ~1    |    —    |      —       |    1    |   —    |    —    |    ~3    |
| #8       |      ~5      |   ~2    |   ~27   |      —       |    —    |   —    |   ~3    |   ~37    |
| #9       |      —       |   ~18   |    —    |     ~195     |    —    |   —    |    —    |   ~213   |
| **总计** |   **~376**   | **~56** | **~36** |   **~233**   |  **2**  | **~3** | **~24** | **~730** |

---

## 附录 B: 替换安全性矩阵

| 替换                                    | 模式          | 误伤风险 | 验证方法                           |
| --------------------------------------- | ------------- | :------: | ---------------------------------- |
| `@opencode-ai/` → `@octopus-ai/`        | 精确字符串    |  **零**  | grep 零残留 + typecheck            |
| `@opencode/` → `@octopus/` (ServiceTag) | 精确字符串    | **极低** | grep 排除 `@opentui`/`@openauthjs` |
| `OPENCODE_` → `OCTOPUS_`                | 精确字符串    | **极低** | grep 排除 `OTEL_`                  |
| `"opencode"` → `"octopus"` (JSON)       | Context-aware |  **中**  | 手动抽查 20%                       |
| `const app = "opencode"`                | Context-aware |  **低**  | 单点修改                           |
| `./opencode` → `./octopus` (TOML)       | Context-aware |  **中**  | 在 Zed extension.toml 中精确匹配   |

---

## 附录 C: 回滚策略

每个 Issue 对应一个独立 Git commit。回滚方式：

```bash
# 全量回滚到迁移前
git revert <commit-hash-of-issue-1>..<commit-hash-of-issue-9>

# 单个 Issue 回滚（假设按顺序提交）
git revert <issue-commit-hash>
```

**建议**：不使用 `--no-verify` 跳过 hook 提交，保持每个 Issue 的 `bun turbo typecheck` 绿。
