- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests

# OpenCode Desktop 构建指南

## ⚠️ 重要提示

当前分支存在**内存管理 bug**，`opencode-cli` 在启动后 10-20 秒崩溃。

**临时解决方案**：使用稳定版本 (v1.1.51) 的 `opencode-cli` 替换构建产物。

---

## 🚀 快速构建

### 一键构建脚本

```bash
# 1. 构建前端和 Tauri 应用
bun run --cwd packages/desktop build && \
bun run --cwd packages/desktop tauri build && \

# 2. 替换为稳定版本的 opencode-cli（关键步骤）
cp /opt/homebrew/Cellar/opencode/1.1.51/bin/opencode \
  "packages/desktop/src-tauri/target/release/bundle/macos/OpenCode Dev.app/Contents/MacOS/opencode-cli" && \

# 3. 安装到系统
cp -R "packages/desktop/src-tauri/target/release/bundle/macos/OpenCode Dev.app" /Applications/ && \

echo "✅ 构建完成！应用已安装到 /Applications/"
```

### 分步构建

如果需要分步执行：

```bash
# 步骤 1: 构建前端
bun run --cwd packages/desktop build

# 步骤 2: 构建 Tauri 应用
bun run --cwd packages/desktop tauri build

# 步骤 3: 替换 CLI（必须）
cp /opt/homebrew/Cellar/opencode/1.1.51/bin/opencode \
  "packages/desktop/src-tauri/target/release/bundle/macos/OpenCode Dev.app/Contents/MacOS/opencode-cli"

# 步骤 4: 安装应用
cp -R "packages/desktop/src-tauri/target/release/bundle/macos/OpenCode Dev.app" /Applications/
```

---

## 📦 构建产物

| 类型           | 路径                                                                                   |
| -------------- | -------------------------------------------------------------------------------------- |
| **应用包**     | `packages/desktop/src-tauri/target/release/bundle/macos/OpenCode Dev.app`              |
| **DMG 安装包** | `packages/desktop/src-tauri/target/release/bundle/dmg/OpenCode Dev_1.1.51_aarch64.dmg` |

---

## ✅ 验证构建

构建完成后运行以下命令验证：

```bash
# 启动应用
open "/Applications/OpenCode Dev.app"

# 等待 30 秒后检查服务器状态
sleep 30 && ps aux | grep "opencode-cli serve" | grep -v grep

# 检查崩溃报告
ls -t ~/Library/Logs/DiagnosticReports/opencode-cli-*.ips 2>/dev/null | head -1
```

**验证标准**：服务器稳定运行超过 30 秒且无新崩溃报告。

---

## 🐛 已知问题

### 内存管理 Bug

| 项目         | 详情                                                         |
| ------------ | ------------------------------------------------------------ |
| **症状**     | `opencode-cli` 启动后 10-20 秒崩溃                           |
| **错误信息** | `malloc_report` → `abort()` in "Wasm Worklist Helper Thread" |
| **影响范围** | 所有启动方式和构建类型                                       |
| **临时方案** | 使用 v1.1.51 稳定版本的 `opencode-cli`                       |
| **根本原因** | 待定位（可能与 Wasm/线程管理相关）                           |

### Git 状态

当前有未提交的改动（回退了 commit `6454c583e`）：
- `packages/desktop/src-tauri/src/cli.rs`
- `packages/desktop/src-tauri/tauri.prod.conf.json`

---

## 🔧 后续工作

### 1. 定位 Bug 来源

使用 `git bisect` 二分查找引入 bug 的提交：

```bash
git bisect start
git bisect bad HEAD
git bisect good e1e356cab  # v1.1.45 release

# 然后按照 git bisect 的提示进行测试
# 每次构建后运行验证脚本，标记 good/bad
```

### 2. 修复内存管理问题

**重点排查方向**：
- Wasm 运行时相关改动
- 线程管理和生命周期
- 内存分配和释放逻辑
- 异步任务处理

---

*最后更新：2026-01-30*


<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

Use the `/trellis:start` command when starting a new session to:
- Initialize your developer identity
- Understand current project context
- Read relevant guidelines

Use `@/.trellis/` to learn:
- Development workflow (`workflow.md`)
- Project structure guidelines (`spec/`)
- Developer workspace (`workspace/`)

Keep this managed block so 'trellis update' can refresh the instructions.

<!-- TRELLIS:END -->
