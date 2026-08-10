# Plan: Per-User Workspace Directories

> Source PRD: https://github.com/xingyun0812/opencode/issues/2

Phase 之间无硬依赖，可以单独交付。

## Architectural decisions

- **Config**: `OPENCODE_DATA_ROOT` (optional, default from `global.ts` XDG path) — follows the existing pattern of `OPENCODE_JWT_SECRET` / `OPENCODE_SERVER_PASSWORD` in `packages/server/src/auth.ts`
- **Route**: `POST /api/session` — `payload.location` remains optional; the default changes based on auth context
- **Key model**: `Location.Ref { directory: AbsolutePath, workspaceID?: WorkspaceID }` — schema unchanged
- **Auth & directory mapping**:
  - JWT present → `<data_root>/workspaces/<safe_userID>/`
  - JWT absent (Basic Auth / unauthenticated) → `process.cwd()` (legacy behavior, migration compatibility)
  - Explicit `location` parameter in request body → overrides all defaults
- **userID sanitization**: `encodeURIComponent()` — prevents path traversal in directory names (detailed in Phase 2)
- **Directory autocreation**: `fs.makeDirectory(path, { recursive: true })` — failure returns HTTP 503
- **Cleanup interface**: Effect type + Service tag only (no implementation in this plan) — defined in Phase 2 because directory structure design informs the cleanup signature

---

## Phase 1: DataRoot 配置 + 目录工具

**User stories**: #8 — 运营商配置根路径

**改动**: 只加新文件，不改已有代码

### What to build

定义 `DataRootConfig` Effect Service，从环境变量 `OPENCODE_DATA_ROOT` 读取数据根目录，提供合理的默认值（复用 `global.ts` 的 XDG 逻辑），并接入 server 的 Layer 栈，使 Phase 2 可以通过依赖注入使用它。

### Implementation notes

- 参照 `JwtConfig` (packages/server/src/auth.ts:43-53) 的模式：`Context.Service` + 静态 `layer` getter + `EffectConfig.string`
- **默认值方案（方案 A，推荐）**: `DataRootConfig` 的默认值从 `@opencode-ai/core/global` 的 `Path.data` 读取。`global.ts` 已经处理了 XDG 优先级（`$XDG_DATA_HOME` → `~/.local/share/`）和 `OPENCODE_TEST_HOME` 覆盖。`DataRootConfig` 只在 `OPENCODE_DATA_ROOT` 环境变量设置时覆盖它，否则直接使用 `Path.data`。这样就避免了和 `global.ts` 重复实现 XDG 逻辑。
- 放在 `packages/server/src/` 下，和 `auth.ts` 同层
- 确认 `packages/core/src/fs-util.ts` 中的 `ensureDir` 可用
- 注册到 `packages/server/src/routes.ts` 的 Layer 栈中，放在 `JwtConfig.layer` 同级

### Acceptance criteria

- [ ] `OPENCODE_DATA_ROOT` 设置后，server 启动能通过 `DataRootConfig` service 读到配置值
- [ ] `OPENCODE_DATA_ROOT` 未设置时，默认值为 `global.ts` 的 `Path.data`
- [ ] 可以通过 Effect 依赖注入在任何 handler 中使用 `DataRootConfig`
- [ ] `ensureDir` 确认可用

---

## Phase 2: Session 创建默认目录 + 清理接口定义

**User stories**: #1, #2, #3, #4 (workspace 隔离), #5 (清理接口定义), #6 (location 覆盖), #10 (Basic Auth 兼容)

**改动**: 改 handler，加清理接口定义

### What to build

修改 `session.create` 的 location 默认逻辑，实现三优先级的目录选择策略。同时定义 workspace 清理接口的 Effect type + Service tag（无实现），因为 Phase 2 的目录结构设计决定了清理接口的签名。

### 目录选择优先级

1. 请求体中的 `location` 参数 → 直接使用（用户显式选择）
2. `UserContext` 存在（JWT 认证）→ `<data_root>/workspaces/<safe_userID>/`
3. 无 `UserContext`（Basic Auth / 无认证）→ `process.cwd()`（旧行为，迁移兼容）

### 修改点

- **Server handler** (`packages/server/src/handlers/session.ts`): `session.create` 的 `location` 默认逻辑从 `{ directory: AbsolutePath.make(process.cwd()) }` 替换为三优先级策略
- **`deriveDefaultLocation` 函数**: 抽成 `packages/server/src/handlers/session.ts` 文件中的私有函数（或同目录下单独文件），便于 Phase 3 直接测试。签名: `(userContext: UserContext.Info | undefined) => Effect<Location.Ref, never, DataRootConfig>`。handler 中变成 `location: ctx.payload.location ?? (yield* deriveDefaultLocation(userContext))`
- **userID sanitization**: `encodeURIComponent(userID)` — 防止 `/../` 等路径穿越
- **自动创建目录**: 确定 target directory 后，调用 `fs.makeDirectory(path, { recursive: true })`，失败返回 HTTP 503（统一使用 503，用 message 区分原因）
- **清理接口**: 定义 `WorkspaceCleanup` 的 Effect type + Service tag，放在 `packages/server/src/` 下。签名: `cleanup(userID: string): Effect<void, CleanupError>` — 无实现

### 边界情况

- userID 包含 `/../` 等路径穿越字符 → 被 `encodeURIComponent` 净化
- 目录已存在 → 不报错，直接复用
- 磁盘满 / 权限不足 → 503 + 描述性 message（客户端不需要区分不同原因）
- Basic Auth 多用户共享一个密码 → 共用 `process.cwd()`（PRD 已说明这是迁移兼容层）

### Acceptance criteria

- [ ] JWT 请求 + 无 `location` → session 目录为 `<data_root>/workspaces/<safe_userID>/`
- [ ] JWT 请求 + 显式 `location` → session 目录为请求指定的路径
- [ ] Basic Auth 请求（无 JWT）→ session 目录为 `process.cwd()`
- [ ] 目录不存在时自动创建
- [ ] 目录创建失败 → 503
- [ ] userID 含 `/../` → 被净化，无路径穿越风险
- [ ] 清理接口的 Effect type + Service tag 已定义（无实现）

---

## Phase 3: 集成测试

**User stories**: #9 (旧 Session 兼容), #5 (清理 — 仅占位，未来实现)

**改动**: 只加测试不改代码

### What to build

为 Phase 1-2 添加集成测试，覆盖所有核心路径和边界情况。不改动生产代码。

### 测试覆盖

**Session 创建 (integration test):**

- JWT + 不传 location → 目录为 `<data_root>/workspaces/<safe_userID>/`
- JWT + 传 location → 目录为指定的 path
- Basic Auth + 不传 location → 目录为 `process.cwd()`
- JWT 无效 → 401，不创建 session
- 目录自动创建（不存在的目录被创建）
- 目录创建失败 → 503

**DataRoot 配置 (unit test):**

- `OPENCODE_DATA_ROOT` 设置 → 使用配置值
- `OPENCODE_DATA_ROOT` 未设置 → 使用 `global.ts` 的 `Path.data`
- `XDG_DATA_HOME` 优先于 `~/.local/share/`

**userID 净化 (unit test):**

- `../` 包含 → 被净化
- URL 不安全字符 → 被编码
- 正常 userID → 不变

**旧 Session 兼容 (integration test):**

- 无 user_id 的旧 session → 仍指向 `process.cwd()`

### Implementation notes

- **测试 Layer override**: 如果现有测试框架（`HttpRouter.serve(HttpApiApp.routes, ...)`）不支持直接注入 mock `DataRootConfig`，可以在 `DataRootConfig` 的 layer 实现中支持通过 `OPENCODE_DATA_ROOT` 环境变量覆盖测试值，或在 `routes.ts` 中暴露一个 `allowLayerOverride` hook。具体方式取决于测试框架的 mock 能力，Phase 3 开工时确认。

### Acceptance criteria

- [ ] Phase 1 的配置逻辑有 unit test 覆盖
- [ ] Phase 2 的目录选择有 integration test 覆盖
- [ ] userID 净化有 unit test 覆盖
- [ ] 旧 session 兼容路径有 test 覆盖
- [ ] 目录创建失败 → 503 有 test 覆盖
- [ ] 所有测试通过