# Multi-Tenant Architecture — 如何验证

> 本文档说明如何手动验证多租户架构各 Phase 的正确性。
> 前置条件：`OPENCODE_JWT_SECRET` 和 `OPENCODE_SERVER_PASSWORD` 已配置，server 已启动。

## 测试用户准备

```bash
# JWT Secret（与 server 配置一致）
JWT_SECRET="your-secret"

# 生成不同角色和部门的 JWT Token
# 全局管理员
GLOBAL_ADMIN_TOKEN=$(echo -n '{"header":{"alg":"HS256","typ":"JWT"},"payload":{"user_id":"admin1","username":"admin","department_code":"eng","role":"global_admin","permissions":[]}}' | \
  jq -r '.header + "." + .payload' | \
  openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | base64 | tr -d '=' | tr '/+' '_-')

# 部门管理员（eng 部门）
DEPT_ADMIN_TOKEN=...  # role: dept_admin, department_code: eng

# 普通用户（eng 部门）
USER_ENG_TOKEN=...    # role: user, department_code: eng

# 普通用户（其他部门）
USER_OTHER_TOKEN=...  # role: user, department_code: finance
```

---

## Phase 1 — 用户身份 + Session 归属

### 1.1 JWT 认证 — Bearer Token 流程

```bash
# 1. 无认证请求应返回 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:3080/api/sessions
# 期望: 401

# 2. 有效 Bearer Token
curl -s -H "Authorization: Bearer $USER_ENG_TOKEN" http://localhost:3080/api/sessions \
  | jq '.data[0].user_id'
# 期望: 返回自己的 session 列表

# 3. 无效 JWT 不应降级到 Basic Auth（返回 401 而非 200）
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer invalid.jwt.token" \
  http://localhost:3080/api/sessions
# 期望: 401
```

### 1.2 Session 创建写入 user_id

```bash
# 创建 session 后检查返回数据中的 user_id
curl -s -X POST \
  -H "Authorization: Bearer $USER_ENG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"test-session"}' \
  http://localhost:3080/api/sessions | jq '.user_id'
# 期望: 等于 token 中的 user_id
```

### 1.3 Session 隔离 — 用户只能看到自己的

```bash
# 用户 A 创建 session
SESS_A=$(curl -s -X POST -H "Authorization: Bearer $USER_ENG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"session-a"}' \
  http://localhost:3080/api/sessions | jq -r '.sessionID')

# 用户 B 看不到用户 A 的 session
curl -s -H "Authorization: Bearer $USER_OTHER_TOKEN" \
  http://localhost:3080/api/sessions/$SESS_A -o /dev/null -w "%{http_code}"
# 期望: 404（普通用户看不到别人的）
```

### 1.4 prompt vs interrupt — 404 vs 403

```bash
SESS_ID=...  # 别人的 session ID

# 访问别人的 session.prompt → 404
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $USER_OTHER_TOKEN" \
  http://localhost:3080/api/sessions/$SESS_ID/prompt
# 期望: 404（SessionNotFoundError，防枚举）

# interrupt 别人的 session → 403
curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $USER_OTHER_TOKEN" \
  http://localhost:3080/api/sessions/$SESS_ID/interrupt
# 期望: 403（ForbiddenError，调用者已知 session 存在）
```

### 1.5 部门管理员可见本部门 Session

```bash
# 部门管理员可以看到本部门用户的所有 session
curl -s -H "Authorization: Bearer $DEPT_ADMIN_TOKEN" \
  http://localhost:3080/api/sessions | jq '.data | length'
# 期望: 包含本部门所有用户的 session
```

### 1.6 全局管理员全可见

```bash
curl -s -H "Authorization: Bearer $GLOBAL_ADMIN_TOKEN" \
  http://localhost:3080/api/sessions | jq '.data | length'
# 期望: 包含所有用户的 session（数量 >= 单个用户的）
```

---

## Phase 2 — Skill 范围 + 列表过滤

### 2.1 目录结构设置

在 skill 根目录下创建测试目录结构：

```
skills_root/
  global/public-skill/SKILL.md         → scope: global
  dept_eng/eng-skill/SKILL.md          → scope: department, dept: eng
  dept_finance/fin-skill/SKILL.md      → scope: department, dept: finance
  user_42/private-skill/SKILL.md       → scope: user, user: 42
  legacy-flat-skill/SKILL.md           → scope: global（兼容旧格式）
```

### 2.2 验证 Skill 列表按 scope 过滤

```bash
# 普通用户（eng 部门）只能看到 global + 本部门 + 自己的
curl -s -H "Authorization: Bearer $USER_ENG_TOKEN" \
  http://localhost:3080/api/skill | jq '.data[].name'
# 期望: ["public-skill", "eng-skill", "legacy-flat-skill"]
# 不应包含: "fin-skill"（其他部门），不包含 "private-skill"（别人私有）

# 如果 user_42 的 token：应看到 "private-skill"
```

### 2.3 验证部门隔离

```bash
# finance 部门用户看不到 eng 部门的 skill
curl -s -H "Authorization: Bearer $USER_OTHER_TOKEN" \
  http://localhost:3080/api/skill | jq '.data[].name'
# 期望: ["public-skill", "fin-skill", "legacy-flat-skill"]
# 不应包含 eng-skill
```

### 2.4 验证 scope 目录解析

通过启动日志或添加调试日志验证 `parseScopeDir` 的输出：

```
parseScopeDir("global")        → { type: "global" }
parseScopeDir("dept_eng")      → { type: "department", owner: "eng" }
parseScopeDir("user_42")       → { type: "user", owner: "42" }
parseScopeDir("other")         → undefined（flat 目录，按 global 处理）
```

---

## Phase 3 — Skill CRUD API

### 3.1 创建 Skill

```bash
# 全局管理员可以创建 global scope 的 skill
curl -s -X POST \
  -H "Authorization: Bearer $GLOBAL_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "new-global-skill",
    "content": "# New Global Skill\n\nA test skill.",
    "scope": {"type": "global"}
  }' \
  http://localhost:3080/api/skill
# 期望: 201，返回 skill info

# 普通用户无法创建 global scope 的 skill
curl -s -o /dev/null -w "%{http_code}" \
  -X POST -H "Authorization: Bearer $USER_ENG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"user-global","content":"...","scope":{"type":"global"}}' \
  http://localhost:3080/api/skill
# 期望: 403

# 普通用户可以创建自己的 user scope skill
curl -s -o /dev/null -w "%{http_code}" \
  -X POST -H "Authorization: Bearer $USER_ENG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-skill","content":"...","scope":{"type":"user","userID":"'"$USER_ENG_ID"'"}}' \
  http://localhost:3080/api/skill
# 期望: 201
```

### 3.2 更新 Skill

```bash
# 只有有权限的用户可以更新 skill
curl -s -X PUT \
  -H "Authorization: Bearer $USER_ENG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"# Updated\n\nNew content."}' \
  http://localhost:3080/api/skill/my-skill
# 期望: 200（自己是 owner）

# 其他人更新别人的 skill
curl -s -o /dev/null -w "%{http_code}" \
  -X PUT -H "Authorization: Bearer $USER_OTHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"hacked"}' \
  http://localhost:3080/api/skill/my-skill
# 期望: 403
```

### 3.3 删除 Skill

```bash
curl -s -X DELETE -H "Authorization: Bearer $USER_ENG_TOKEN" \
  http://localhost:3080/api/skill/my-skill -o /dev/null -w "%{http_code}"
# 期望: 204
```

### 3.4 验证 Cache 失效

创建/更新/删除后立即调用 list，验证新 skill 出现或旧 skill 消失：

```bash
# 创建后 list 应包含新 skill
SKILL_COUNT_BEFORE=$(curl -s -H "Authorization: Bearer $GLOBAL_ADMIN_TOKEN" \
  http://localhost:3080/api/skill | jq '.data | length')

# 创建 ...

SKILL_COUNT_AFTER=$(curl -s -H "Authorization: Bearer $GLOBAL_ADMIN_TOKEN" \
  http://localhost:3080/api/skill | jq '.data | length')
echo "Before: $SKILL_COUNT_BEFORE, After: $SKILL_COUNT_AFTER"
# 期望: After = Before + 1
```

---

## Phase 4 — Agent 权限组合

### 4.1 Agent Permission 生效

```bash
# 启动 server 并创建一个 agent 配置，设置 skill: deny
# 在 config 中配置：
# agent:
#   my-agent:
#     permission:
#       skill: deny
#
# 以该 agent 身份执行时，所有 skill 工具应返回 permission denied
```

### 4.2 内置 Agent 默认允许 Skill

检查配置：

```bash
grep -A3 'skill' packages/opencode/src/agent/agent.ts | grep -E 'build|plan|explore|general'
# 期望:
#   build: { ..., skill: "allow" }
#   plan: { ..., skill: "allow" }
#   general: { ..., skill: "allow" }  （subagent）
#   explore: 不含 skill: allow（使用 "*": "deny" 白名单）
```

### 4.3 验证 Scope + Agent 双重过滤

端到端测试流程：

1. 用户能看到 scope 允许的 skill（Phase 2）
2. Agent 配置允许 skill 工具（Phase 4）
3. 用户通过 Agent 执行 skill 时，工具调用应通过两道检查

```bash
# 启动交互式 session 并发送 prompt 调用 skill
# 通过日志确认两道检查都通过

# 检查点 1: Skill 列表是否已按 scope 过滤
grep "skill.list" /path/to/server.log | head -5

# 检查点 2: Skill 工具调用时是否做了 permission check
grep "permission.*skill" /path/to/server.log | head -5
```

---

## 边界情况测试

### B1. 旧 flat 目录兼容性

```bash
# 验证 flat 目录的 skill 被当作 global 处理
curl -s -H "Authorization: Bearer $USER_ENG_TOKEN" \
  http://localhost:3080/api/skill | jq '.data[] | select(.name=="legacy-flat-skill") | .scope'
# 期望: {"type":"global"}
```

### B2. 部门管理员不能看 null departmentCode 的旧 Session

```bash
# 创建一个 user_department_code 为空的旧 session
# 部门管理员 list 不应包含它
# 验证: list 结果数量是否匹配预期
```

### B3. 全局管理员跨部门操作

```bash
# 全局管理员应该可以操作任何部门的 skill
curl -s -X DELETE -H "Authorization: Bearer $GLOBAL_ADMIN_TOKEN" \
  http://localhost:3080/api/skill/eng-skill -o /dev/null -w "%{http_code}"
# 期望: 204（全局管理员可以删除部门 skill）
```

### B4. 无认证请求

```bash
# 所有需要认证的接口在无 token 时返回 401
for endpoint in "/api/skill" "/api/sessions"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3080$endpoint)
  echo "$endpoint: $code"
done
# 期望: 全部 401
```

---

## 快速验证脚本

保存为 `verify-multi-tenant.sh`：

```bash
#!/bin/bash
set -euo pipefail

SERVER="http://localhost:3080"
JWT_SECRET="${JWT_SECRET:?Set JWT_SECRET}"

# === 工具函数 ===

b64url() { echo -n "$1" | base64 | tr -d '=' | tr '/+' '_-' | tr -d '\n'; }

gen_token() {
  local header="{}"  # 简化处理
  local payload="$1"
  local h=$(b64url "$header")
  local p=$(b64url "$payload")
  local sig=$(echo -n "$h.$p" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | base64 | tr -d '=' | tr '/+' '_-')
  echo "$h.$p.$sig"
}

ADMIN_TOKEN=$(gen_token '{"user_id":"admin","role":"global_admin","department_code":"eng","permissions":[]}')
DEPT_TOKEN=$(gen_token '{"user_id":"dept1","role":"dept_admin","department_code":"eng","permissions":[]}')
USER_TOKEN=$(gen_token '{"user_id":"user1","role":"user","department_code":"eng","permissions":[]}')
OTHER_TOKEN=$(gen_token '{"user_id":"user2","role":"user","department_code":"finance","permissions":[]}')

# === Phase 1 ===
echo "=== Phase 1: Unauthenticated → 401 ==="
curl -s -o /dev/null -w "%{http_code}\n" "$SERVER/api/sessions"

echo "=== Phase 1: Invalid JWT → 401 (no downgrade) ==="
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer bad.token.here" "$SERVER/api/sessions"

echo "=== Phase 1: Session isolation ==="
# 创建 session
SESS=$(curl -s -X POST -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"verify-test"}' \
  "$SERVER/api/sessions" | jq -r '.sessionID')
echo "Created session: $SESS"

# 其他用户查看 → 404
code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $OTHER_TOKEN" "$SERVER/api/sessions/$SESS")
echo "Other user access (expect 404): $code"

echo "=== Phase 1: Dept admin sees more ==="
dept_count=$(curl -s -H "Authorization: Bearer $DEPT_TOKEN" "$SERVER/api/sessions" | jq '.data | length')
user_count=$(curl -s -H "Authorization: Bearer $USER_TOKEN" "$SERVER/api/sessions" | jq '.data | length')
echo "Dept admin sees $dept_count, user sees $user_count (dept >= user: $([ "$dept_count" -ge "$user_count" ] && echo YES || echo NO))"

# === Phase 2 ===
echo "=== Phase 2: Skill list scope filtering ==="
echo "Admin skills:  $(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" "$SERVER/api/skill" | jq '.data[].name')"
echo "User skills:   $(curl -s -H "Authorization: Bearer $USER_TOKEN" "$SERVER/api/skill" | jq '.data[].name')"
echo "Finance user:  $(curl -s -H "Authorization: Bearer $OTHER_TOKEN" "$SERVER/api/skill" | jq '.data[].name')"

# === Phase 3 ===
echo "=== Phase 3: Skill CRUD permissions ==="
# 普通用户创建 global → 403
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"test-global","content":"# Test","scope":{"type":"global"}}' \
  "$SERVER/api/skill")
echo "User create global (expect 403): $code"

# 管理员创建 global → 201
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"test-global","content":"# Test","scope":{"type":"global"}}' \
  "$SERVER/api/skill")
echo "Admin create global (expect 201): $code"

# 清理
curl -s -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$SERVER/api/skill/test-global" -o /dev/null

echo "=== DONE ==="
```

---

## 已知差距（不需要覆盖到验证脚本中）

1. **v2 Agent 默认无 skill:allow** — 当前 v2 系统依赖用户主动配置 agent permissions
2. **Scope + Agent 权限无一致 AND 组合** — 不同代码路径应用不同的过滤，但核心场景（HTTP API list + tool 执行时）各自覆盖了一边
3. **scope 字段类型上允许 undefined** — 运行时所有 skill 都有 scope，类型安全不是运行时问题