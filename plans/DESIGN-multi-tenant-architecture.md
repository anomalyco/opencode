# OpenCode Serve 多租户架构设计

> 本文档讲解 Phase 1-4 的设计思路：要解决什么问题、用了什么通用模式、具体怎么实现的、其他框架如何解决类似问题。

## 整体脉络

Phase 1-4 解决的是一个核心问题：**多人共用同一个 opencode serve 时，如何确保每个人的数据（Session、Skill）是隔离的，且权限是可控的。**

从最底层往上看，这 4 个 Phase 是逐层构建的：

```
Phase 1: 你是谁？       → 用户身份 + Session 隔离
Phase 2: 你能看到什么？ → Skill 按范围组织 + 列表过滤
Phase 3: 你能改什么？   → Skill CRUD 权限
Phase 4: Agent 执行时   → 双重权限校验
```

每一层建立在前一层之上，依赖清晰：

- Phase 1 提供了 `UserContext`，Phase 2-4 都需要
- Phase 2 提供了 scope 过滤能力，Phase 3-4 复用
- Phase 3 提供了写 API，依赖 Phase 2 的 scope 类型
- Phase 4 是运行时收尾，依赖 Phase 2 的列表过滤

---

## Phase 1 — 用户身份 + Session 归属

### 问题

opencode serve 原本只有一个密码（`OPENCODE_SERVER_PASSWORD`），所有人共享同一个 Basic Auth。服务器不知道请求是谁发的。结果：

- 你创建的 Session，别人也能看到、操作
- 没有"我的 Session"的概念
- 无法在多用户场景下运行

**场景**：上百人通过 Dashboard 与 Agent 对话，每个人应该只能看到自己的对话历史。

### 模式

**JWT 认证 + 资源归属 (Resource Ownership)**。

这是一个通用模式：
- **Authentication（认证）**：证明你是谁 → JWT
- **Authorization（授权）**：你能做什么 → 后面的 Phase
- **Resource Ownership（资源归属）**：数据属于谁 → 数据库加 owner 字段

资源归属是最基础的多租户模式。核心思想：**数据表加一个 owner 列，所有查询和操作都过一道 owner 过滤器。**

### 实现

分层实现，避开了 circular dependency：

```
Schema 层 (packages/schema/src/user-context.ts)
  └─ 定义 UserContext 类型 + Effect Service tag
  └─ Core 和 Server 都依赖 Schema，不违反依赖方向

Server 层 (packages/server/src/middleware/authorization.ts)
  └─ 从 Authorization header 提取 Bearer token
  └─ 验证 JWT 签名 + 过期时间
  └─ 解码后注入 Effect Context

Core 层 (packages/core/src/session/sql.ts + session.ts)
  └─ SessionTable 增加 user_id、user_department_code
  └─ session.create 时从 UserContext 写入
  └─ 查询/操作时走 canAccess() 过滤
```

JWT 中间件的关键设计决策：

```typescript
// JWT present → validate it (401 on invalid/expired)
// JWT absent  → fall back to Basic Auth
// Invalid JWT must NOT silently downgrade
```

这个"不降级"策略很重要：如果 JWT 存在但无效，直接返回 401，不会尝试 Basic Auth。防止攻击者用无效 JWT 绕过认证。

Session 归属的边界情况：

| 场景 | 行为 |
|------|------|
| 普通用户看自己 Session | ✅ 可见 |
| 普通用户看别人 Session | ❌ prompt 返回 404（防枚举），interrupt 返回 403 |
| 部门管理员看本部门 | ✅ 可见 |
| 部门管理员看 null departmentCode 的 Session | ❌ 不可见（防止旧数据泄露） |
| 全局管理员 | ✅ 全部可见 |

session.prompt 返回 404 而非 403 是有意为之：prompt 是幂等操作，暴露 404 防止调用者通过返回码枚举有效的 Session ID。interrupt 返回 403 因为调用者已经知道 Session 存在，403 提供更明确的反馈。

### 对比

| 框架 | 做法 |
|------|------|
| **Kubernetes** | 每个资源有 `metadata.ownerReferences`，RBAC 通过 SubjectAccessReview 校验 |
| **AWS IAM** | 资源自带 ARN（`arn:aws:s3:::my-bucket/*`），Policy 通过 Principal + Resource 匹配 |
| **GitHub** | Repository 有 owner，API 返回 404 而非 403 隐藏存在（与这里的 session.prompt 一致） |
| **PostgreSQL Row-Level Security** | `CREATE POLICY user_policy ON sessions FOR ALL USING (user_id = current_setting('app.user_id'))` |

这里选择的模式最接近 **GitHub 的 404 vs 403 策略**：列举类操作（prompt）返回 404，针对性操作（interrupt）返回 403。

---

## Phase 2 — Skill 范围 + 列表过滤

### 问题

所有 Skill 在一个扁平的全局命名空间里。没有"部门级的最佳实践"或"个人的快捷工具"的概念。

**场景**：
- 安全团队有一套 security-review Skill，只应该安全团队的人看到
- 前端团队有 deploy-guide Skill，只应该前端团队的人看到
- 我想给自己写一个笔记模板 Skill，不想让别人看到

### 模式

**分层命名空间 (Hierarchical Scopes)**。

典型的三层结构：

```
global/           → 全局可见（所有人）
dept_<code>/      → 部门可见（部门内成员）
user_<id>/        → 私有（仅自己）
```

这是一个 **Scope-based Visibility** 模式，在文件系统、配置管理、云资源组织中非常常见。核心思想是**用目录/路径来表达归属关系**，而不是在数据库里维护复杂的关联表。目录结构比标签更强制——你不可能误把 user 级别的文件放在 global 目录下。

### 实现

目录结构即是 scope 定义：

```
skills_root/
  global/code-review/SKILL.md         → scope = {type: "global"}
  dept_eng/deploy-guide/SKILL.md      → scope = {type: "department", departmentCode: "eng"}
  user_42/note-tmpl/SKILL.md          → scope = {type: "user", userID: "42"}
  my-flat-skill/SKILL.md              → scope = {type: "global"}  ← 兼容旧格式
```

`DirectorySource` 的改造是核心改动：

```typescript
// 1. 读取目录下所有条目
const entries = yield* fs.readDirectoryEntries(directory)

// 2. 区分 scope 目录和普通目录
const scopeDirs = entries.filter((e) => parseScopeDir(e.name) !== undefined)
const flatDirs  = entries.filter((e) => parseScopeDir(e.name) === undefined)

// 3. scope 目录按类型处理，打上对应的 scope 标签
for (const scopeDir of scopeDirs) {
  const scope = parseScopeDir(scopeDir.name)
  const files = yield* glob("**/SKILL.md", { cwd: scopeDir })
  for (const file of files)
    skills.push({ ...file, scope: scopeToTag(scope) })
}

// 4. flat 目录兼容旧格式，全部标为 global
for (const flatDir of flatDirs) {
  const files = yield* glob("**/SKILL.md", { cwd: flatDir })
  for (const file of files)
    skills.push({ ...file, scope: { type: "global" } })
}
```

`list()` 的过滤逻辑：

```typescript
if (scope.type === "global") return true
if (scope.type === "department")
  return scope.departmentCode === user.departmentCode
if (scope.type === "user")
  return scope.userID === user.userID
```

### 对比

| 方式 | 例子 | 特点 |
|------|------|------|
| **目录隔离** | 这里的方式、Kubernetes Namespace | 直观，文件系统即管理界面，不需要数据库 |
| **标签/Annotation** | Kubernetes Labels, AWS Tags | 灵活但查询复杂，缺乏强制约束 |
| **独立数据库 Schema** | SaaS 多租户（每个租户一个 schema） | 隔离最强但运维成本高，不适合 skill 这种轻量资源 |
| **路径前缀** | S3 的 `bucket/tenant-id/object` | 介于目录和标签之间 |

这里选择目录隔离是因为 Skill 本身就是 `.md` 文件，文件系统是最自然的存储介质。`parseScopeDir` 不匹配的目录全部走 flat 分支向后兼容。

---

## Phase 3 — Skill CRUD API

### 问题

Skill 只能通过直接写文件系统来管理，没有 API。Dashboard 无法让用户创建/编辑/删除 Skill。

**场景**：前端团队在 Dashboard 上点"新建 Skill"→ 填内容 → 选 scope → 保存。这个操作需要背后创建一个 `.md` 文件。

### 模式

**RESTful CRUD + Scope Enforcement**。

通用模式：
- 资源有 **scope/boundary** 属性
- 写操作在 API 层做 **scope ownership validation**
- 写操作触发 **cache invalidation**（因为底层是文件系统，不是数据库）

### 实现

三层校验链：

```
HTTP Request
  → Auth 中间件（JWT 验证，Phase 1）
    → checkScopeAccess（用户级权限，Phase 3）
      → SkillV2.Service.create/update/remove（写文件 + 刷新缓存）
```

`checkScopeAccess` 是权限核心：

```typescript
function checkScopeAccess(userContext, scope): Effect<void, ForbiddenError> {
  switch (scope.type) {
    case "global":
      if (userContext.role !== "global_admin")
        return Effect.fail(...)
    case "department":
      if (userContext.role === "global_admin") return Effect.void
      if (userContext.role !== "dept_admin") return Effect.fail(...)
      if (scope.departmentCode !== userContext.departmentCode) return Effect.fail(...)
    case "user":
      if (scope.userID !== userContext.userID) return Effect.fail(...)
  }
}
```

scope 类型使用**区分联合 (Discriminated Union)**，`departmentCode` 和 `userID` 在对应类型下是 required，编译器保证不会漏填：

```typescript
scope: { type: "department"; departmentCode: string }
     | { type: "user"; userID: string }
     | { type: "global" }
```

**Cache 策略**：全部清空。Skill 读多写少，cache 重建代价低。

### 对比

| 框架 | 做法 |
|------|------|
| **Kubernetes** | `POST /api/v1/namespaces/{ns}/pods` → API Server 做 Admission Control → 写入 etcd |
| **GitHub API** | `POST /repos/{owner}/{repo}/issues` → 校验 caller 是否有 push 权限 |
| **标准 REST CRUD** | `POST /api/resource` → 201, `GET /api/resource/:id` → 200/404, `DELETE` → 204 |

这里的实现与标准 RESTful CRUD 一致。scope 校验在 handler 层而非中间件层，因为校验需要读取请求体，而中间件只有 header 信息。

---

## Phase 4 — Agent 权限组合

### 问题

系统中同时存在两套权限：
1. **用户级 RBAC**（Phase 1-3）：控制"谁能看到/管理什么"
2. **Agent 级 Permission**（已有）：控制"Agent 运行时能做什么"

当用户通过 Agent 执行 Skill 工具时，这两套权限谁说了算？

**场景**：一个普通用户能看到 `code-review` Skill（通过了 scope 过滤），但他用的 Agent 配置是 `skill: deny`。应该允许还是拒绝？

### 模式

**AND 组合权限 (Permission Composition: AND)**。

多权限系统共存时，常见的组合策略：

| 策略 | 行为 | 类似场景 |
|------|------|---------|
| **OR** | 任一通过即可 | 防火墙白名单 |
| **AND** | 两者都必须通过 | 双因素认证、Kubernetes RBAC + OPA |
| **Deny Override** | Deny 优先 | AWS IAM（显式 Deny 覆盖任何 Allow） |

这里用的是 **AND**：用户级 scope 过滤 **AND** Agent 级 `skill:<name>` 规则都必须通过。

### 实现

```typescript
// 用户级：过滤用户能看到的 skill 列表（Phase 2）
const visibleSkills = yield* skill.list(userContext)

// Agent 级：Agent 执行 skill 工具时检查（Phase 4）
const allowed = PermissionV2.evaluate("skill", skillName, agent.permissions)
if (allowed.effect === "deny") return error("Agent denied this skill")
```

内置 Agent 配置更新是 Phase 4 的实际改动量：

```typescript
// 三个内置 Agent 都添加了 skill: allow
build:  { ..., skill: "allow" }
plan:   { ..., skill: "allow" }
explore: { ..., skill: "allow" }
```

这个改动虽小，但解决了核心问题：**用户级权限和 Agent 级权限不能互相绕过**。

### 对比

| 系统 | 组合方式 |
|------|---------|
| **Kubernetes RBAC + OPA/Gatekeeper** | RBAC 控制"能否操作"，OPA 控制"是否符合策略"——AND 组合 |
| **AWS IAM + SCP** | SCP 是账号级边界，IAM 是用户级——两者取交集（隐含 AND） |
| **Linux DAC + MAC (SELinux)** | DAC（owner/group/other）先过，MAC 再检查——AND 组合 |
| **这里** | 用户级 scope + Agent 级 permission —— AND 组合 |

**简化建议**：内置 Agent 全部设置 `skill: allow`。这意味着默认情况下只有用户级 scope 过滤在起作用，Agent 级权限变成一个可自定义的"安全阀门"，而不是日常的拦截器。

---

## 总结

```
Phase 1 — 身份 + 归属
  模式：JWT + Resource Ownership
  核心：数据表加 user_id，查询过滤

Phase 2 — 可见性
  模式：Scope-based Hierarchy
  核心：目录结构即 scope 定义，list 时过滤

Phase 3 — 可写性
  模式：RESTful CRUD + Scope Enforcement
  核心：三层校验链，写后清缓存

Phase 4 — 执行时
  模式：AND Permissions
  核心：用户级 Scope + Agent 级 Permission 都通过
```

这 4 个 Phase 构成了一个完整的**多租户权限模型**，覆盖从"你是谁"到"你执行时能做什么"的完整链路。每个 Phase 只做一件事，依赖关系清晰（Phase 1 → 2 → 3 → 4），这是设计上最值得借鉴的地方。
