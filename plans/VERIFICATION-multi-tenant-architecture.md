# Multi-Tenant Architecture — 实现验证报告

> 验证日期：2026-08-10
> 验证依据：`plans/DESIGN-multi-tenant-architecture.md` Phase 1-4 设计文档

## 验证结论概览

| Phase | 覆盖 | 状态 |
|-------|------|------|
| Phase 1 — 用户身份 + Session 归属 | 10/10 | ✅ 全部实现 |
| Phase 2 — Skill 范围 + 列表过滤 | 4/4 | ✅ 全部实现 |
| Phase 3 — Skill CRUD API | 4/4 | ✅ 全部实现 |
| Phase 4 — Agent 权限组合 | 2/3 | ⚠️ 部分实现 |

---

## Phase 1 — 用户身份 + Session 归属 ✅

### 1.1 JwtConfig 类 + JWT 验证

| 文件 | 行号 | 说明 |
|------|------|------|
| `packages/server/src/auth.ts` | 43-53 | `JwtConfig` service，读取 `OPENCODE_JWT_SECRET` |
| `packages/server/src/auth.ts` | 57-59 | `base64UrlDecode()` |
| `packages/server/src/auth.ts` | 62-64 | `base64UrlEncode()` |
| `packages/server/src/auth.ts` | 70-82 | `decodeJwtPayload()` — 解析 user_id、username、department_code、role、permissions |
| `packages/server/src/auth.ts` | 84-120 | `validateJwt()` — HMAC-SHA256 验证 + 过期检查，返回 `Option<UserContext.Info>` |

### 1.2 UserContext 类型

| 文件 | 行号 | 说明 |
|------|------|------|
| `packages/schema/src/user-context.ts` | 5 | `Role` 类型：`"global_admin" \| "dept_admin" \| "user"` |
| `packages/schema/src/user-context.ts` | 9-15 | `Info` struct：userID、username、departmentCode、role、permissions |
| `packages/schema/src/user-context.ts` | 17 | `Service` class — Effect Context Service |

### 1.3 Session 表增加 user_id、user_department_code

| 文件 | 行号 | 说明 |
|------|------|------|
| `packages/core/src/session/sql.ts` | 32 | `SessionTable.user_id` — `text()` |
| `packages/core/src/session/sql.ts` | 33 | `SessionTable.user_department_code` — `text()` |

### 1.4 session.create 写入 user context

| 文件 | 行号 | 说明 |
|------|------|------|
| `packages/core/src/session.ts` | 79-86 | `CreateInput` 包含 `userID?` 和 `userDepartmentCode?` |
| `packages/core/src/session.ts` | 264-274 | 创建后通过 SQL update 写入 `user_id`、`user_department_code` |
| `packages/server/src/handlers/session.ts` | 132-140 | Handler 从 `userContext` 提取并传入 `create()` |

### 1.5 canAccess() 过滤

| 文件 | 行号 | 说明 |
|------|------|------|
| `packages/server/src/handlers/session.ts` | 24-42 | 三层 RBAC：global_admin 全可见，dept_admin 可见本部门 + 自己，user 仅自己 |
| `packages/server/src/handlers/session.ts` | 96-98 | session.list 应用过滤 |
| `packages/server/src/handlers/session.ts` | 57-70 | withSessionAccess() 用于详情/操作类接口 |

### 1.6 session.prompt 返回 404，interrupt 返回 403

| 文件 | 行号 | 说明 |
|------|------|------|
| `packages/server/src/handlers/session.ts` | 202 | prompt 调用 `withSessionAccess(..., { hideExistence: true })` → 404 |
| `packages/server/src/handlers/session.ts` | 443-449 | interrupt 调用 `withSessionAccess(...)` 无 hideExistence → 403 |
| `packages/protocol/src/errors.ts` | 55-62 | `SessionNotFoundError` → `httpApiStatus: 404` |
| `packages/protocol/src/errors.ts` | 98-102 | `ForbiddenError` → `httpApiStatus: 403` |

### 1.7 认证中间件 — JWT "不降级" 策略

| 文件 | 行号 | 说明 |
|------|------|------|
| `packages/server/src/middleware/authorization.ts` | 39-41 | `extractBearerToken()` |
| `packages/server/src/middleware/authorization.ts` | 57-75 | Bearer token 存在时验证 JWT，无效直接 401，不降级到 Basic Auth |
| `packages/server/src/middleware/authorization.ts` | 77-84 | 无 Bearer token 时才走 Basic Auth |

---

## Phase 2 — Skill 范围 + 列表过滤 ✅

### 2.1 SkillScope 类型

| 文件 | 行号 | 说明 |
|------|------|------|
| `packages/schema/src/skill.ts` | 7-12 | `SkillScope` struct：`{ type: "global" \| "department" \| "user"; departmentCode?; userID? }` |
| `packages/schema/src/skill.ts` | 33 | `Info.scope` — `SkillScope.pipe(optional)` |

### 2.2 parseScopeDir 目录解析

| 文件 | 行号 | 说明 |
|------|------|------|
| `packages/core/src/skill.ts` | 38-45 | `parseScopeDir("global")` → global，`"dept_eng"` → department，`"user_42"` → user |
| `packages/core/src/skill.ts` | 47-66 | `parseScope()` — 从文件路径推断 scope |
| `packages/core/src/skill.ts` | 235-245 | `scopeDirName()` — scope 到目录名的逆映射 |

### 2.3 list() 按用户 scope 过滤

| 文件 | 行号 | 说明 |
|------|------|------|
| `packages/core/src/skill.ts` | 251-270 | list(userContext?) — global 全可见，department 需匹配 departmentCode，user 需匹配 userID |

### 2.4 目录结构扫描

| 文件 | 行号 | 说明 |
|------|------|------|
| `packages/core/src/skill.ts` | 136-203 | load() 扫描目录，区分 scopeDirs 和 flatDirs（兼容旧格式） |

---

## Phase 3 — Skill CRUD API ✅

### 3.1 CRUD 端点

| 文件 | 行号 | 说明 |
|------|------|------|
| `packages/protocol/src/groups/skill.ts` | 42-54 | `GET /api/skill` — list |
| `packages/protocol/src/groups/skill.ts` | 55-67 | `POST /api/skill` — create |
| `packages/protocol/src/groups/skill.ts` | 68-81 | `PUT /api/skill/:name` — update |
| `packages/protocol/src/groups/skill.ts` | 82-94 | `DELETE /api/skill/:name` — remove |
| `packages/protocol/src/api.ts` | 50 | SkillGroup 注册到 API |

### 3.2 checkScopeAccess

| 文件 | 行号 | 说明 |
|------|------|------|
| `packages/server/src/handlers/skill.ts` | 13-37 | global → 仅 global_admin；department → global_admin/dept_admin 匹配；user → 仅自己 |

### 3.3 三层校验链

| 文件 | 行号 | 说明 |
|------|------|------|
| `packages/server/src/handlers/skill.ts` | 59 | create 调用 checkScopeAccess |
| `packages/server/src/handlers/skill.ts` | 87-91 | update 获取现有 skill 后校验 scope |
| `packages/server/src/handlers/skill.ts` | 118-122 | remove 获取现有 skill 后校验 scope |

### 3.4 Cache 失效

| 文件 | 行号 | 说明 |
|------|------|------|
| `packages/core/src/skill.ts` | 248-249 | `invalidateCache()` — 清空 Map |
| `packages/core/src/skill.ts` | 291 | create 后调用 |
| `packages/core/src/skill.ts` | 322 | update 后调用 |
| `packages/core/src/skill.ts` | 335 | remove 后调用 |

---

## Phase 4 — Agent 权限组合 ⚠️ 部分实现

### 4.1 PermissionV2.evaluate

| 文件 | 行号 | 说明 |
|------|------|------|
| `packages/core/src/permission.ts` | 76-86 | wildcard 匹配，找到最后一条匹配规则 |
| `packages/core/src/skill.ts` | 32 | `available()` 用 `PermissionV2.evaluate("skill", skill.name, agent.permissions)` 过滤 |
| `packages/core/src/skill/guidance.ts` | 50 | 检查是否需要屏蔽 skill 指导 |
| `packages/core/src/tool/skill.ts` | 76-83 | 运行时 `permission.assert()` 校验 |

### 4.2 内置 Agent skill: allow

| 实现 | 状态 |
|------|------|
| opencode v1（legacy）— build/plan/general 有 `skill: "allow"` | ✅ `packages/opencode/src/agent/agent.ts:150,166,191` |
| opencode v1 — explore 没有 skill allow（`"*": "deny"` 白名单） | ⚠️ `packages/opencode/src/agent/agent.ts:199-213` |
| core v2 — 无内置默认权限 | ❌ 所有 v2 agent 默认 permissions 为空 |

### 4.3 AND 组合（Scope + Agent Permission）⚠️ 不一致

| 代码路径 | Scope 过滤 | Agent 权限过滤 |
|----------|-----------|---------------|
| Guidance（system context） | ❌ 无 userContext | ✅ |
| HTTP API `/api/skill` | ✅ | ❌ 无 agent context |
| Tool 执行时 | ❌ 无 userContext | ✅ |
| opencode legacy list | ❌ 无 userContext | ✅ |

两个过滤机制都存在，但没有一个代码路径同时应用两者。

---

## 关键差异汇总

1. **Phase 4 v2 agent 缺少 skill:allow 默认值** — v2 的 agent 如果没有明确配置权限，skill 会被默认 deny 规则拦截（`missingAgentPermissions: [{ action: "*", resource: "*", effect: "deny" }]`）
2. **Scope + Agent 权限无一致的 AND 组合** — 不同代码路径应用了不同的过滤组合，没有统一的校验入口
3. **skill scope 字段标记为 optional** — schema 中 `Info.scope` 是 `pipe(optional)`，虽然运行时所有 skill 都有 scope，但类型上允许 undefined
4. **无 `GET /api/skill/:name` 单 skill 查询端点** — 只有 list 接口，客户端需要自己过滤