# PRD: OpenCode Serve 多租户 Skill 权限管理

## 问题陈述

我们在多台服务器上部署了 `opencode serve`，服务于来自不同部门的上百名用户。用户通过 Java + React 构建的 Dashboard（类似 Hermes Dashboard）与 OpenCode Agent 进行对话、文档上传/生成以及 Skill 管理。

当前 opencode serve 存在以下问题：

- 仅支持单密码的 Basic Auth，没有用户身份或多租户支持
- 所有 Skill 合并到一个扁平的全局命名空间，没有范围/组织隔离
- Session 数据没有归属者记录，所有用户互相可见
- 权限系统局限于 Agent 级别的规则，没有用户/部门层级

这导致无法实现：

- 限制特定用户或部门能查看/使用的 Skill
- 允许用户管理自己的个人 Skill
- 允许部门维护共享的 Skill
- 确保用户只能看到自己的 Session
- 在多服务器间规模化部署，且保持认证和数据隔离的一致性

## 解决方案

引入三层架构：

**1. 用户身份层**：由现有的 Java 后端（SSO + RBAC）签发 JWT，opencode serve 中间件验证。JWT 携带 userId、departmentCode 和 role/permissions。

**2. Skill 按范围分层**：将 Skill 组织为三个范围——全局（global）、部门（`dept_<deptCode>`）和个人（`user_<userId>`）——基于文件系统目录隔离。用户只能看到自己所属范围的 Skill。

**3. Session 归属机制**：每个 Session 打上创建者的 userId 标签。所有 Session 操作（list、get、prompt、interrupt）都会校验操作者身份。

## 用户故事

### 认证与授权

1. 作为平台管理员，我希望 opencode serve 能验证来自 Java 后端的 JWT 令牌，这样用户无需管理独立凭据即可完成认证。
2. 作为开发者，我希望部署 opencode serve 时无需配置共享密码，这样认证完全由上游 Dashboard 的 JWT 处理。
3. 作为运维人员，我希望迁移期间 JWT 和 Basic Auth 可以共存，这样现有客户端继续工作的同时新客户端逐步切换 JWT。
4. 作为安全工程师，我希望 JWT 密钥可通过环境变量配置，这样密钥轮换可以遵循我们的标准运维流程。

### Session 管理

5. 作为用户，我希望 Session 列表中只显示我自己的会话，这样我不会被其他用户的对话干扰。
6. 作为用户，我希望无法查看或操作其他用户的 Session，这样我的对话数据保持私密。
7. 作为部门管理员，我希望查看本部门成员创建的 Session，这样我可以审计或排查部门使用情况。
8. 作为全局管理员，我希望查看所有用户的 Session，这样我可以监控整体系统健康度和使用情况。
9. 作为用户，我希望创建 Session 时就打上我的身份标识，这样从第一次交互就确立了归属关系。

### Skill 浏览

10. 作为用户，我希望看到所有全局可用的 Skill，这样我可以使用组织级的最佳实践。
11. 作为用户，我希望看到本部门共享的 Skill，这样我可以遵循团队特定的工作流程和规范。
12. 作为用户，我希望只看到我自己的个人 Skill（看不到其他人的），这样我的私有指导保持私密。
13. 作为用户，我希望不同范围的 Skill 能清晰标注来源（全局/部门/个人），这样我了解哪些 Skill 适用于我。

### Skill 管理

14. 作为用户，我希望创建自己的个人 Skill，这样我可以为重复性任务定义自定义工作流程。
15. 作为用户，我希望编辑和删除自己的个人 Skill，这样我可以维护自己的私有指导库。
16. 作为部门管理员，我希望创建属于本部门的 Skill，这样我的团队可以受益于共享指导。
17. 作为部门管理员，我希望编辑和删除本部门的 Skill，这样我可以保持部门指导的更新。
18. 作为全局管理员，我希望创建、编辑和删除全局 Skill，这样我可以维护组织级的最佳实践。
19. 作为全局管理员，我希望能够管理任何部门的 Skill（紧急覆盖权限），这样当部门管理员不可用时我可以修复问题。

### Skill 权限执行

20. 作为用户，我希望无法在授权范围之外创建或修改 Skill，这样权限模型得到一致执行。
21. 作为用户，我希望 Agent 只加载我有权限查看的 Skill，这样基于 Skill 的指导遵循访问控制。
22. 作为运维人员，我希望 Skill 范围控制在 API 层执行（不仅仅是 UI 层），这样权限无法通过直接调用 API 绕过。

### 多服务器部署

23. 作为运维人员，我希望在负载均衡后面部署多个 opencode serve 实例，这样系统可以扩展到上百并发用户。
24. 作为运维人员，我希望 Session 数据存储在 PostgreSQL（而非 SQLite），这样任何服务器都可以处理任何用户的 Session。
25. 作为运维人员，我希望 Skill 文件存储在共享文件系统（NFS/EFS）上，这样所有服务器看到同一套 Skill。
26. 作为运维人员，我希望 Skill 缓存在多服务器间保持一致性（短 TTL 或显式刷新），这样 Skill 更新可以及时生效。

## 实现决策

### 模块划分

#### M1: UserContext 服务（深模块）
- 定义在 `packages/schema/src/user-context.ts`（Schema 层），类型和 Service tag 供 Core/Server 共同引用
- 封装 JWT 解析和验证逻辑
- 提供 `UserContext` 数据结构：`{userId, username, departmentCode, role, permissions}`
- 通过中间件注入到 Effect 请求上下文中
- 接口：`UserContext.Service.get()` → `UserContext`
- 可独立测试：给定有效/无效/过期的 JWT，返回正确的上下文或错误

#### M2: Session 归属（中等深度模块）
- Session Schema 增加 `userId`、`departmentCode` 字段（Drizzle ORM Schema，SQLite/PostgreSQL 共用）
- 在现有 Session CRUD 外层包装归属校验
- 接口：扩展现有 `Session.Service`，增加归属验证逻辑
- 归属规则：普通用户 → 仅自己；部门管理员 → 自己 + 同部门；全局管理员 → 全部

#### M3: Skill 范围（深模块）
- `Skill.Info` 增加 `scope` 字段（`{type, departmentCode?, userID?}`），departmentCode 和 userID 分开
- `list()` 接受 `UserContext`，按范围可见性规则过滤
- 接口：`SkillV2.Service.list(userContext)` → 过滤后的 Skill 列表
- 可独立测试：给定一组 Skill 和一个用户上下文，返回正确的子集

#### M4: Skill CRUD API（浅模块）
- 新增 REST 端点：POST/PUT/DELETE `/api/skill`
- 调用 M3 进行范围验证
- 将 Skill 文件写入共享文件系统上对应范围的目录
- 在变更后刷新 Skill 缓存

#### M5: Auth 中间件（浅模块）
- 与现有 Basic Auth 中间件共存
- 检测 `Authorization: Bearer <jwt>` → 通过 M1 验证
- JWT 不存在或无效时回退到 Basic Auth

### 权限组合策略

系统中存在两个独立的权限维度：

| 维度 | 控制点 | 作用时机 | 数据来源 |
|------|--------|----------|----------|
| **用户级 RBAC** | Skill 列表可见性、Session 归属、Skill CRUD | API 请求处理时 | JWT claims |
| **Agent 级 Permission** | Agent 运行时 tool 调用权限 | Agent 执行时 | Agent 配置 |

组合规则：
- Skill 列表展示：仅受 scope 过滤控制（用户级）
- Agent 执行 skill 工具：用户级 scope 过滤 + Agent 级 `skill:<name>` 规则 **两者都需要通过**
- Session 管理 / Skill CRUD：仅受用户级权限控制

**简化建议**：普通用户的 Agent 配置中设置 `skill:* = allow`，由用户级 RBAC 通过 scope 过滤兜底。

### 角色粒度扩展

三角色模型（`global_admin` / `dept_admin` / `user`）覆盖 MVP。建议 Phase 1 即采用 JWT 携带 `permissions: string[]` 的方式（如 `["skill.view", "skill.create:user"]`），避免硬编码角色名。

### Schema 变更

**Session 表新增字段（Drizzle ORM Schema，SQLite/PostgreSQL 共用）：**

- `user_id TEXT NOT NULL`
- `user_department_code TEXT`

**Skill.Info 新增字段：**

- `scope: { type: "global" | "department" | "user", departmentCode?: string, userID?: string }`

### API 契约

**新增端点（均需要有效 JWT）：**

```
POST   /api/skill          # 创建 Skill
  请求体: { name, description, content, scope: { type, departmentCode?, userID? } }
  响应: 201 { name, scope, location }

PUT    /api/skill/:name     # 更新 Skill
  请求体: { description?, content?, scope? }
  响应: 200 { name, scope, location }

DELETE /api/skill/:name     # 删除 Skill
  响应: 204 No Content
```

Skill 标识是 `name`（目录名），不引入独立 id 字段以避免冗余。

**修改的端点：**

```
GET    /api/skill           # 现在根据认证用户的身份过滤
  响应: 200 [{ name, description, content, scope, location }, ...]

GET    /api/session         # 现在根据认证用户的归属过滤
  响应: 200 { data: [...], cursor: {...} }
```

### 部署架构

| 组件 | 技术选型 | 规模说明 |
|------|----------|----------|
| 认证 | JWT（HS256/RS256） | 共享密钥或公钥 |
| Session 数据库 | SQLite → PostgreSQL | SQLite 适合 <50 用户，PG 适合 50+ |
| Skill 存储 | 共享文件系统（NFS/EFS） | 读多写少，并发关注度低 |
| Session 亲和性 | 基于用户哈希的路由 | 可选，简化初期部署 |

## 测试决策

### 测试理念

测试应验证外部行为，而非实现细节。对于本项目：

- 好的测试："给定 role=user 的 UserContext，list() 只返回 global + personal 的 Skill"
- 不好的测试："list() 用正确的参数调用了 filter()"

### 需要测试的模块

**M1 UserContext（需全面测试）：**

- 有效 JWT → 正确的 UserContext
- 过期 JWT → 认证错误
- 无效签名 → 认证错误
- 缺少令牌 → 回退到 Basic Auth
- 格式错误的令牌 → 优雅的错误处理

**M3 Skill 范围（需全面测试）：**

- 全局管理员看到所有 Skill
- 部门管理员看到全局 + 本部门的 Skill
- 普通用户看到全局 + 自己的个人 Skill
- 普通用户看不到其他人的个人 Skill
- 普通用户看不到其他部门的 Skill
- 无范围（遗留）Skill 默认为 global

**M2 Session 归属（需集成测试）：**

- Session 列表按用户过滤
- Session prompt 拒绝非归属者
- 部门管理员可列出本部门的 Session

**M4 Skill CRUD（需集成测试）：**

- 在有效范围内创建成功
- 在授权范围外创建失败（403）
- 删除自己的 Skill 成功
- 删除他人的 Skill 失败（403）

### 代码库中的参考案例

现有的 `packages/core/test/permission.test.ts` 演示了权限断言模式。`packages/core/test/tool-skill.test.ts` 展示了如何在测试层中用模拟数据设置 `SkillV2.Service`——M3 测试应复用此模式。

## 不在范围内

- 基于 Git 的项目代码操作（用户只与 Agent 对话，不操作代码）
- 实时协作功能（多人同时编辑同一个 Session）
- Skill 版本历史/回滚
- 审计日志（计划在 MVP 之后）
- 速率限制和使用配额
- OAuth2 / OpenID Connect 集成（JWT 信任模型已足够）
- Dashboard UI 实现（本 PRD 仅覆盖后端 API；UI 由 Java/React 团队构建）
- opencode 中的用户管理端点（用户数据存在于 Java 后端）

## 补充说明

1. **JWT 信任模型**：opencode serve 信任由 Java 后端签发的 JWT。共享密钥或公钥需要通过环境变量或配置文件分发给所有 opencode serve 实例。

2. **迁移路径**：所有变更向后兼容。没有 JWT 的现有部署继续使用 Basic Auth。
   - JWT 和 Basic Auth 共存策略：**有 JWT 时强制验证（无效则 401），无 JWT 时回退到 Basic Auth**
   - 无效的 JWT 不会降级到 Basic Auth，避免绕过 Java 后端认证

3. **多服务器缓存**：`LocationServiceMap` 有 60 分钟的空闲 TTL。对于多服务器部署，Skill 缓存 TTL 应降低到 30 秒，或增加显式失效端点。注意 `reload()` 必须正确处理 scope 目录（`dept_xxx`、`user_xxx`），防止将目录名误解析为 skill name。

4. **文档存储**：用户上传的文档应存储在 `user_<userId>/docs/` 目录下，实现自然隔离。

5. **user_department_code 为空处理**：departmentCode 为空的 Session 仅 owner 和 global_admin 可见，不暴露给 dept_admin。

6. **内置 Agent 权限变更**：简化建议要求所有内置 Agent（build、plan、explore）的配置中增加 `skill:* = allow`，由用户级 RBAC 兜底。