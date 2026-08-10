# Plan: OpenCode Serve 多租户权限管理

> 来源 PRD: https://github.com/xingyun0812/opencode/issues/1

## 架构决策

适用于所有阶段的持久性决策：

- **认证策略**：JWT（HS256/RS256）与现有的 Basic Auth 共存。有 JWT 时强制验证（无效/过期返回 401），无 JWT 时回退到 Basic Auth。无效 JWT 不能静默降级。
- **UserContext 层**：定义在 `packages/schema/src/user-context.ts`（Schema 层），作为 Effect Service tag，供 Core 和 Server 共同引用，避免循环依赖。
- **数据库**：SQLite via Drizzle ORM（内置，`bun:sqlite` / `node:sqlite`）。Schema 用 Drizzle ORM 定义，与驱动无关。切换到 PostgreSQL 时需重新生成迁移文件。
- **Skill 存储**：文件系统（带 frontmatter 的 `.md` 文件），按 scope 目录组织。多服务器时使用共享文件系统（NFS/EFS）。
- **权限组合**：用户级 RBAC 控制"能否看到/管理"（API 层），Agent 级权限控制"运行时能否执行"（Agent 层）。两者必须都通过——AND 关系。
- **Skill 标识**：以 `name`（目录名）作为标识，不引入独立 ID 字段。
- **角色模型**：JWT 携带 `permissions: string[]` claim，而非硬编码角色名，便于未来扩展。
- **文档存储**：用户上传的文档由 Java/React Dashboard 层管理，opencode serve 只管理 Skill 文件。

---

## Phase 1: 用户身份 + Session 归属

**用户故事**: #1, #2, #3, #4, #5, #6, #7, #8, #9

### 构建内容

一条贯穿所有层的垂直切片，拆为 A/B 两层：

**A 层 — UserContext 服务 + JWT 认证中间件：**

1. 在 Schema 层定义 `UserContext` 类型和 Effect Service tag（`packages/schema/src/user-context.ts`）
2. 实现 JWT 验证逻辑（解码、验签、提取 claims）
3. 新增中间件，检测 `Authorization: Bearer <jwt>`，验证后将 `UserContext` 注入 Effect 请求上下文
4. 与现有 Basic Auth 中间件共存（有 JWT → 验证；无 JWT → Basic Auth 回退；无效 JWT → 401）
5. 编写集成测试：发送带有效 JWT 的请求，验证 `UserContext.Service.get()` 返回正确的用户信息

**B 层 — Session 归属：**

6. Session 表增加 `user_id TEXT NOT NULL` 和 `user_department_code TEXT` 列（Drizzle ORM Schema 迁移）
7. `session.create` 在创建时记录 `UserContext.userID` 和 `UserContext.departmentCode`
8. `session.list` 按用户身份过滤（普通用户 → 自己的；部门管理员 → 自己 + 同部门；全局管理员 → 全部）
9. `session.get`、`session.prompt`、`session.interrupt` 校验请求用户是否为 Session 的归属者
   - `session.prompt` 返回 404（隐藏其他用户的 Session 是否存在——防止 Session ID 枚举）
   - `session.interrupt` 返回 403（调用者已知 Session 存在，403 提供更清晰的反馈）
10. 处理边界情况：`departmentCode` 为 null 的 Session 仅 owner 和 global_admin 可见

所有过滤和归属校验在 Server handler 层完成，使用 `UserContext`。Protocol 定义只新增可选的筛选参数。

### 验收标准

- [ ] 提供有效 JWT 时，`UserContext.Service.get()` 返回解码后的用户信息
- [ ] 无效/过期 JWT 返回 401，不回退到 Basic Auth
- [ ] 无 JWT 的请求通过现有 Basic Auth 继续工作
- [ ] JWT 密钥可通过环境变量配置
- [ ] 集成测试：带有效 JWT 的请求 → UserContext 正确填充
- [ ] JWT 验证的单元测试（有效、过期、无效签名、格式错误）
- [ ] 新创建的 Session 带有认证用户的 ID 和部门代码
- [ ] `GET /api/session` 普通用户只看到自己的 Session
- [ ] 部门管理员看到自己 + 同部门的 Session
- [ ] 全局管理员看到所有 Session
- [ ] `session.prompt` 非归属者返回 404（不暴露其他用户 Session 是否存在）
- [ ] `session.interrupt` 非归属者返回 403（调用者已知 Session 存在）
- [ ] `departmentCode` 为 null 的 Session 不暴露给部门管理员查询
- [ ] 无 user_id 的存量 Session 迁移处理优雅
- [ ] Session 过滤和归属校验的集成测试
- [ ] 现有测试不变

---

## Phase 2: Skill Scope 类型定义 + 列表过滤

**用户故事**: #10, #11, #12, #13, #20

### 构建内容

一条贯穿所有层的垂直切片：

1. 在 Schema 层定义 `SkillScope` 类型（`packages/schema/src/skill.ts`）：
   ```typescript
   interface SkillScope {
     type: "global" | "department" | "user"
     departmentCode?: string  // type === "department" 时使用
     userID?: string          // type === "user" 时使用
   }
   ```
2. 在 `Skill.Info` 中增加 `scope: SkillScope` 字段
3. 更新 `SkillV2.Service.list()`，接受可选的 `UserContext` 参数并按 scope 过滤：
   - `global` → 所有用户
   - `department` → 用户的 departmentCode 匹配
   - `user` → 用户的 userID 匹配
4. 更新 `DirectorySource` 的 Skill 发现逻辑，从目录结构解析 scope：
   - 当前 `DirectorySource` 将每个子目录视为一个 skill name，需要改为识别 `global/`、`dept_<code>/`、`user_<id>/` 作为 scope 父目录并跳过——只有它们的子目录才是 skill。
   - 解析规则：
     - `global/<name>/` → `{type: "global"}`
     - `dept_<code>/<name>/` → `{type: "department", departmentCode: "<code>"}`
     - `user_<id>/<name>/` → `{type: "user", userID: "<id>"}`
     - 顶层 Skill（无 scope 目录）→ `{type: "global"}`（向后兼容）
5. 将 `GET /api/skill` 接入过滤逻辑，基于认证用户返回可见 Skill

本阶段不添加 CRUD 端点——仅读端过滤。Skill 仍通过文件系统管理。

### 验收标准

- [ ] 全局管理员看到所有 scope 的 Skill
- [ ] 部门管理员看到全局 + 本部门的 Skill
- [ ] 普通用户看到全局 + 自己的个人 Skill
- [ ] 普通用户看不到其他部门的 Skill
- [ ] 普通用户看不到其他人的个人 Skill
- [ ] 遗留的扁平 Skill（无 scope 目录）默认为 `global` 可见性
- [ ] `GET /api/skill` 只返回认证用户授权的 Skill
- [ ] 所有 scope 过滤场景的单元测试

---

## Phase 3: Skill CRUD API

**用户故事**: #14, #15, #16, #17, #18, #19, #21, #22

### 构建内容

一条贯穿所有层的垂直切片：

1. 实现 scope 归属校验逻辑：
   - `global` scope → 仅拥有 `skill.manage:global` 权限的用户可 CRUD
   - `department` scope → 仅该部门的 dept_admin（或 global_admin）可 CRUD
   - `user` scope → 仅归属用户自己可 CRUD
2. `POST /api/skill` — 创建 Skill
   - 校验 scope 与用户权限
   - 写入 `SKILL.md` 到对应 scope 目录
   - 触发 Skill 缓存刷新
3. `PUT /api/skill/:name` — 更新 Skill
   - 校验 scope 归属与用户权限
   - 更新 `SKILL.md` 文件
   - 触发 Skill 缓存刷新
4. `DELETE /api/skill/:name` — 删除 Skill
   - 校验 scope 归属
   - 删除 Skill 目录
   - 触发 Skill 缓存刷新
5. Skill 缓存失效策略（单服务器：立即刷新；多服务器：短 TTL 或显式刷新端点）
6. 错误响应：无权限（403）、Skill 不存在（404）、名称重复（409）

GET 端点已在 Phase 2 中改造——本阶段只添加写操作。

### 验收标准

- [ ] 用户可以创建个人 Skill（`user_<userID>/` 目录）
- [ ] 部门管理员可以创建部门 Skill（`dept_<deptCode>/` 目录）
- [ ] 全局管理员可以创建全局 Skill（`global/` 目录）
- [ ] 用户不能在授权 scope 外创建 Skill（403）
- [ ] 用户可以编辑/删除自己的个人 Skill
- [ ] 部门管理员可以编辑/删除本部门的 Skill（但不能操作其他部门的）
- [ ] 全局管理员可以编辑/删除任意 Skill
- [ ] 同一 scope 内名称重复返回 409
- [ ] 每次写操作后缓存被刷新
- [ ] 所有 CRUD + scope 校验场景的集成测试

---

## Phase 4: Agent 权限组合

**用户故事**: #21（运行时执行）

> **说明**：本阶段内容较薄，可与 Phase 3 同期交付（两者触及独立的代码路径——Agent 配置 vs Skill API）。

### 构建内容

一条贯穿所有层的垂直切片：

1. 更新所有内置 Agent（build、plan、explore）的权限配置，增加 `skill:* = allow`
2. 确保权限组合逻辑正确串联：Agent 执行 `skill` 工具时，**同时**校验用户级 scope（Phase 2）和 Agent 级 `skill:<name>` 规则
3. 为运维人员编写权限流程文档（如何自定义 Agent 配置）

本阶段特意设置得较薄——它闭环了运行时权限执行。用户级 RBAC（Phase 2-3）是主闸门，Agent 权限是执行时的副闸门。

### 验收标准

- [ ] 所有内置 Agent 默认配置包含 `skill:* = allow`
- [ ] Agent 执行 skill 工具时同时检查用户级 scope 和 Agent 级权限
- [ ] 用户能看到 Skill（通过 scope 过滤）但使用的 Agent 配置了 `skill:* = deny` 时收到权限拦截
- [ ] 自定义 Agent 配置可以覆盖默认的 `skill:* = allow` 规则

---

## Phase 5: 多服务器部署 + PostgreSQL 迁移（未来）

**用户故事**: #23, #24, #25, #26

> **说明**：本阶段推迟到系统规模达到 SQLite 瓶颈时再进行（>50 并发用户）。Phase 1-4 的 Schema 和代码变更为数据库无关的设计。切换到 PostgreSQL 时需要重新生成 Drizzle 迁移文件（`drizzle-kit generate` 使用 `pg` driver 产生不同的 SQL DDL）。

### 构建内容

一条贯穿所有层的垂直切片：

1. 将 SQLite 驱动替换为 PostgreSQL 驱动（Drizzle ORM 处理 Schema 翻译——运行时查询代码不变）
2. 重新生成 PostgreSQL 方言的 Drizzle 迁移文件
3. 通过环境变量配置数据库连接字符串
4. 针对 PostgreSQL 运行 Schema 迁移
5. 部署共享文件系统（NFS/EFS）用于 Skill 存储
6. 实现跨服务器缓存失效（Redis Pub/Sub 或短 TTL）
7. 编写多服务器部署架构文档

### 验收标准

- [ ] 所有现有功能在 PostgreSQL 上正常工作
- [ ] Schema 迁移在服务启动时自动运行
- [ ] 多台服务器实例可以操作同一数据库
- [ ] Skill 缓存在各服务器间保持一致（在可配置的容忍范围内）
- [ ] 部署文档完整