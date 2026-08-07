# OpenCode Serve 多租户权限管理方案

## 背景

多台服务器部署 `opencode serve`，多个部门的多个人通过 Java + React 应用与 OpenCode 的 Agent 进行对话交互，类似 Hermes Dashboard。需要在页面管理 Skill 并支持个人/部门/全局三级权限。

> **关键约束**：用户只与 Agent 对话（不上传/操作项目代码），交互包括文本对话、Skill 管理、文档上传/生成。不存在多人共用 Git 工作目录的文件冲突问题。

## 现有架构现状

### 认证
- 仅支持 HTTP Basic Auth（单用户名/密码 `OPENCODE_SERVER_PASSWORD`）
- 无用户体系、无角色、无多租户

### Location 隔离
- 每个请求通过 `location` 参数（directory + workspace）确定上下文
- `LocationServiceMap` 按 `Location.Ref` 缓存独立的 Service 实例，空闲 60 分钟 TTL

### Skill 系统
- `SkillV2.Service` 提供 `sources()`, `list()`, `transform()`, `reload()`
- 三种来源：`directory`、`url`（远程拉取）、`embedded`（内置）
- 当前所有 Source 合并到一个全局 `Map<name, Info>`，**无 scope/namespace/owner 概念**

### 权限系统
- `PermissionV2` 规则引擎：`(action, resource) => effect`，支持通配符匹配
- 规则挂在 Agent 上（`agent.permissions`），有 `PermissionSaved` 持久化
- 无用户/部门层级概念

### Agent 系统
- Agent 定义包含 ID、权限规则集、模型等配置
- 默认提供 `build`、`plan`、`explore` 等 Agent

## 整体架构

```
┌──────────────────────────────────────────────────────────┐
│                   你的 Java + React 应用                  │
│  (Dashboard - 用户管理 / Skill 管理 / 会话管理)           │
│                                                          │
│  SSO ─▶ @PreAuthorize ─▶ scopeOrgCode/scopeDeptCode     │
└──────────────┬──────────────────────────────┬────────────┘
               │ JWT (userId / dept / role)   │ API 调用
               ▼                              ▼
┌──────────────────────────────────────────────────────────┐
│              opencode serve (Server 层)                   │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │ Auth 中间件   │  │ User Context │  │ Session Owner  │ │
│  │ (JWT 验证)   │─▶│ (user/dept)  │─▶│ 校验 + 过滤    │ │
│  └──────────────┘  └──────────────┘  └────────────────┘ │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │           SkillV2.Service (扩展)                  │    │
│  │                                                   │    │
│  │  global/        dept_<orgCode>/   user_<id>/    │    │
│  │  ├─ code-review  ├─ dept-tools    ├─ my-scripts  │    │
│  │  ├─ security     ├─ deploy-guide  ├─ note-tmpl   │    │
│  │  └─ ...          └─ ...           └─ ...         │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │           PermissionV2 (扩展)                      │    │
│  │  user -> role -> ruleset                          │    │
│  │  全局管理员: skill.*:* = allow                    │    │
│  │  部门管理员: skill.*:dept_<X>/* = allow          │    │
│  │  普通用户:  skill.view+use = allow               │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

## 方案详述

### 1. 用户身份层

#### 对接方式

你的 Java 后端已有 SSO 认证 + RBAC 权限体系，`opencode serve` 只需信任由 Java 后端签发的 JWT：

- Java 后端在用户登录后签发 JWT，包含 `user_id`、`username`、`department_code`（对应 `scopeDeptCode`）、`role`
- `opencode serve` 增加 JWT 验证中间件，解码后注入 Effect Context
- 权限判定依据 JWT 中的 role + department_code

#### User Context 定义

```typescript
interface UserContext {
  userID: string
  username: string
  departmentCode: string      // 对应 scopeDeptCode
  role: "global_admin" | "dept_admin" | "user"
}
```

#### 部署示意

```
用户 ─▶ SSO ─▶ Java 后端 ─▶ 签发 JWT ─▶ React 页面 ─▶ opencode serve
                           (含 user/dept/role)        (验证 JWT + API 调用)
```

### 2. Session 用户隔离

#### 现状
- `SessionTable` 在 SQLite 中，没有 `user_id` 字段
- `session.list` 返回所有 Session，不做用户过滤
- `session.get`/`session.prompt` 不校验 ownership

#### 改造

1. **SessionTable 增加字段**：`user_id`、`user_department_code`
2. **Session 创建时记录用户身份**：从 `UserContext` 写入
3. **查询/操作时校验**：
   - `session.list` → 只返回当前用户的 Session（部门管理员可看本部门）
   - `session.get` → 校验 owner
   - `session.prompt` → 校验 owner
   - `session.interrupt` → 校验 owner

### 3. Skill 分层管理

#### 目录约定

Skill 按 scope 通过目录隔离（兼容现有文件系统 discovery 机制）：

```
<skills_root>/
  global/                  # 全局 Skill（全局管理员管理）
    code-review/SKILL.md
    security-checklist/SKILL.md
  dept_<deptCode>/         # 部门 Skill（部门管理员管理）
    deploy-guide/SKILL.md
  user_<userId>/           # 个人 Skill（用户自己管理）
    note-template/SKILL.md
```

#### SkillV2.Service 改造

```typescript
interface SkillScope {
  type: "global" | "department" | "user"
  owner?: string  // departmentCode 或 userId
}

// Skill.Info 增加 scope 字段
interface SkillInfo {
  name: string
  description?: string
  location: AbsolutePath
  content: string
  scope: SkillScope  // 新增
}
```

`list()` 按用户身份过滤：
- `global` → 所有人可见
- `department` → scope.owner === user.departmentCode 的用户可见
- `user` → scope.owner === user.userID 的用户可见

#### Skill CRUD API（由 React Dashboard 调用）

| 方法 | 路径 | 说明 | 权限需求 |
|------|------|------|----------|
| GET | `/api/skill` | 列表（按用户身份过滤） | skill.view |
| GET | `/api/skill/:name` | 详情 | skill.view |
| POST | `/api/skill` | 创建 | skill.create + scope 归属校验 |
| PUT | `/api/skill/:name` | 更新 | skill.edit + scope 归属校验 |
| DELETE | `/api/skill/:name` | 删除 | skill.delete + scope 归属校验 |

**Scope 归属校验规则**：
- `global` scope → 仅 `global_admin` 可 CRUD
- `dept_*` scope → `dept_admin` 只能管理本部门的；`global_admin` 可以管理所有
- `user_*` scope → 只能自己管理自己的

### 4. 权限规则扩展

利用已有的 `PermissionV2.Rule` 引擎，定义分级权限：

```typescript
const ACTIONS = {
  SKILL_VIEW:   "skill.view",
  SKILL_USE:    "skill.use",
  SKILL_CREATE: "skill.create",
  SKILL_EDIT:   "skill.edit",
  SKILL_DELETE: "skill.delete",
  SKILL_MANAGE: "skill.manage",  // 全部权限
  SESSION_LIST: "session.list",
}

// role -> ruleset 映射（在 Java 后端维护，JWT 中携带 role）
ROLE_RULES = {
  global_admin: [
    { action: "*", resource: "*", effect: "allow" },
  ],
  dept_admin: [
    { action: "skill.*", resource: "dept_<deptCode>/*", effect: "allow" },
    { action: "session.*", resource: "dept_<deptCode>/*", effect: "allow" },
    { action: "skill.view", resource: "*", effect: "allow" },
    { action: "skill.use", resource: "*", effect: "allow" },
  ],
  user: [
    { action: "skill.view", resource: "*", effect: "allow" },
    { action: "skill.use", resource: "*", effect: "allow" },
    { action: "skill.*", resource: "user_<userId>/*", effect: "allow" },
    { action: "session.*", resource: "self", effect: "allow" },
  ],
}
```

## 隐患分析（已排除 Git 文件冲突）

由于用户只跟 Agent 对话，不操作项目代码，以下隐患已**不适用**：

- ❌ ~~多人共用工作目录 → 文件覆盖冲突~~ → 不需要 Git worktree
- ❌ ~~Git 操作并发问题~~ → 不存在项目 Git 操作
- ❌ ~~npm install / node_modules 污染~~ → 不存在

### 仍然存在的隐患

| 隐患 | 影响 | 严重度 | 方案 |
|------|------|--------|------|
| Session 数据互相可见 | 信息泄露 | **高** | Session 表加 `user_id`，API 层过滤 |
| Session 可被他人操作 | 数据安全 | **高** | `session.prompt`/`interrupt` 校验 owner |
| 多服务器无 Session 协调 | 请求路由到无状态的服务器 | **中** | Session 亲和性路由 |
| Skill 缓存不一致（多服务器） | 管理操作后列表未刷新 | **中** | 短 TTL 或显式失效 API |
| 权限规则缓存 | 角色变更后未生效 | **低** | 短 TTL，或 Java 后端通知刷新 |
| 文档存储权限 | 用户上传的文档被他人访问 | **中** | 文档按用户目录隔离 |

## 多服务器部署方案

### 服务器规模

上百用户，建议 **3-5 台** opencode serve 实例起步：

| 角色 | 数量 | 说明 |
|------|------|------|
| opencode serve | 3-5 台 | 横向扩展，承载用户 Session |
| PostgreSQL / MySQL | 1 套 | 共享 Session 数据（替代 SQLite） |
| 共享文件系统（NFS/EFS） | 1 套 | 存储 Skill 文件、用户文档 |
| Java 后端 | 现有 | 认证 + RBAC + 路由 |
| Redis（可选） | 1 套 | Session 亲和性 + 分布式锁（文档操作） |

### Session 亲和性

```
                           ┌───────────────────────┐
                    ┌─────│  opencode serve A      │─────┐
                    │     │  /data/skills/         │     │
                    │     │  /data/docs/           │     │
                    │     └───────────────────────┘     │
┌──────────┐  route │     ┌───────────────────────┐     │┌──────────────┐
│  Java    │──by────┼─────│  opencode serve B      │─────┤│ PostgreSQL   │
│  Backend │  user  │     │  /data/skills/         │     ││ Session DB   │
│  (Router)│  or    │     │  /data/docs/           │     │└──────────────┘
└──────────┘  ses   │     └───────────────────────┘     │
                    │     ┌───────────────────────┐     │
                    └─────│  opencode serve C      │─────┘
                          │  /data/skills/         │
                          │  /data/docs/           │
                          └───────────────────────┘

存储层:
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │ NFS/EFS      │  │ PostgreSQL   │  │ Redis (可选)  │
  │ (skills/docs)│  │ (sessions)   │  │ (协调/锁)    │
  └──────────────┘  └──────────────┘  └──────────────┘
```

### 数据库迁移策略

| 阶段 | 数据库 | 说明 |
|------|--------|------|
| 初期（< 50 用户） | SQLite | 每台服务器独立，Session 亲和性路由 |
| 中期（50-200 用户）| PostgreSQL | 共享 Session 表，任一服务器可处理任一用户的 Session |
| 后期（200+ 用户） | PostgreSQL + 读写分离 | 同上 |

## Skill 管理与架构深度解耦

### Skill 存储

Skill 文件存储在共享文件系统（NFS/EFS）：

```
/data/opencode/skills/
  global/           # 全局 Skill
    code-review/
      SKILL.md
  dept_<deptCode>/  # 部门 Skill
  user_<userId>/    # 个人 Skill
```

### Skill 生命周期

```
Dashboard (React)              opencode serve               文件系统
      │                             │                          │
      │ POST /api/skill             │                          │
      │ (JWT + name + scope + md)   │                          │
      │──────▶│                     │                          │
      │        │ 校验 JWT + 权限      │                          │
      │        │ 写入 SKILL.md       │──────▶                   │
      │        │ 刷新 Skill 缓存     │                          │
      │◀──────│ 返回 201             │                          │
      │                             │                          │
      │ 用户使用 Session            │                          │
      │──────▶│ Agent 调用 skill    │                          │
      │        │ SkillV2.list()     │──────▶ 读取目录           │
      │        │ 按 user 过滤 scope  │                          │
      │        │ 返回可见 Skill      │                          │
```

## 实现路径

### Phase 1 — 用户身份接入

- Server 层增加 JWT 验证中间件（与现有 Basic Auth 共存）
- 定义 `UserContext` 并注入 Effect 链路
- Session 表增加 `user_id`、`user_department_code`
- Session 创建时记录用户身份
- `session.list`/`session.get`/`session.prompt` 增加 owner 校验

### Phase 2 — Skill 分层 + 列表过滤

- `Skill.Info` 增加 `scope` 字段
- `SkillV2.Service.list()` 接受 `UserContext`，按身份过滤
- 目录按 scope 组织（global/dept/user），兼容现有 discovery 机制
- 已有未分类 Skill 目录默认为 `global` scope，向后兼容

### Phase 3 — Skill CRUD API

- 新增 `POST/PUT/DELETE /api/skill`
- 实现 scope 归属校验（谁可以创建/编辑/删除什么 scope 的 Skill）
- Skill 文件写入共享文件系统
- Skill 缓存刷新机制（多服务器场景）

### Phase 4 — 多服务器 & 数据库升级

- 从 SQLite 迁移到 PostgreSQL
- Session 亲和性支持
- 共享文件系统部署
- 缓存一致性方案

### Phase 5 — 前端集成

- React 应用接入 opencode API
- Skill 管理页面（列表/创建/编辑/删除，按 scope 分类展示）
- 用户登录态打通（JWT 流转）

### Phase 6 — 管理后台增强（可选）

- 部门管理员分配界面
- 权限规则管理界面
- 使用量 / 审计日志

## 改造文件清单

| 文件 | 改动 | Phase |
|------|------|-------|
| `packages/server/src/auth.ts` | 增加 JWT 验证逻辑，新增 `JwtConfig` | P1 |
| `packages/server/src/middleware/user-context.ts` | **新文件**—从 JWT 解码用户信息，注入 Effect Context | P1 |
| `packages/server/src/middleware/authorization.ts` | 扩展支持 Bearer Token + Basic Auth 共存 | P1 |
| `packages/core/src/session.ts` | Session 创建/查询增加 user_id 维度 | P1 |
| `packages/core/src/session/sql.ts` | SessionTable 增加 user_id 列 | P1 |
| `packages/protocol/src/groups/session.ts` | session.list 支持按用户过滤 | P1 |
| `packages/server/src/handlers/session.ts` | session.get/prompt 等增加 owner 校验 | P1 |
| `packages/schema/src/skill.ts` | Skill.Info 增加 scope 字段 | P2 |
| `packages/core/src/skill.ts` | list() 按 scope + 用户身份过滤 | P2 |
| `packages/protocol/src/groups/skill.ts` | 增加 CRUD 端点定义 | P3 |
| `packages/server/src/handlers/skill.ts` | 实现 CRUD handler，注入权限检查 | P3 |
| `packages/core/src/database/database.ts` | SQLite → PostgreSQL 驱动切换 | P4 |

## 注意事项

1. **向后兼容性**：现有的 Basic Auth + 未分类 Skill 目录仍能正常工作
   - JWT 中间件与 Basic Auth 共存，JWT 优先
   - 无 scope 的已有 Skill 默认为 `global`
2. **JWT 信任模型**：opencode serve 信任由 Java 后端签发的 JWT，需共享签名密钥（HMAC Shared Secret 或 RSA Public Key）
3. **Skill 缓存一致性**：多服务器场景下，Skill 变更需要广播失效。初期可采用短 TTL（30s）的惰性过期，后期可加 Redis Pub/Sub
4. **文档存储**：用户上传的文档应存储在 `user_<userId>/docs/` 目录下，天然隔离
5. **Session 数据库**：初期 SQLite 够用，到 50+ 用户时建议切 PostgreSQL，避免多服务器数据孤岛