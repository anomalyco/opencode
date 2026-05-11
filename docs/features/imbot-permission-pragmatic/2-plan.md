---
feat-id: imbot-permission-pragmatic
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# imbot-permission-pragmatic — plan

## 决策轨迹

### 1. 攻击面再评估 → 退到 webfetch + read 敏感

v1 假设"危险工具全 ask 才安全"。实测后发现 user 体验"寸步难行",必须重新分析。

**关键洞察**:prompt injection 完整链路 3 步,**第 1 步**(webfetch 拉网页)和**第 2 步**(read 敏感数据)是数据进出系统的瓶颈,**第 3 步**(bash 执行)只是搬运工。截断第 1/2 步就行,不必同时截断第 3 步。

→ **bash/edit/write/apply_patch 全 allow** 在"read 敏感 ask + webfetch ask"防线下仍然安全。

### 2. 删除类例外:bash 默认 allow 但删除必 ask

虽然 bash 不是攻击瓶颈,**删除/不可逆操作**(rm / git reset --hard / kubectl delete 等)失误代价高,不可逆 — 这跟"主动 prompt injection 攻击防御"是两个独立维度:**这里防的是 LLM hallucination 跑错命令** + **user 自己手误指令**。

per-pattern bash rule + `Wildcard.match` 支持(opencode source 验证),把高 30 个删除 pattern 配 ask。

### 3. timeout 5min → 30min

v1 5min 是默认值,实测中 user 在飞书慢慢点(尤其同时多卡片)5min 不够。改 30min 对齐 promptTimeoutMs。

### 4. user 升级路径:不强制 force-reseed

setup hook 仍 idempotent — user 已有 imbot v1 块不强制覆盖。理由:
- 尊重 user 显式修改(可能 user 自己改过 imbot v1 加了 patterns)
- force-reseed 跟 idempotent 原则冲突

升级方法手动一行 `jq del`,**简单可逆**(jsonc 备份在 .bak 文件)。

### 5. edit/write/apply_patch 不重新 ask 的逻辑

v1 把这三个 + bash 全 ask。v2 既然 bash 全 allow,这三个单独 ask **没意义** — `bash echo "evil" >> ~/.zshrc` 跟 `write ~/.zshrc` 等价能力。把它们设 ask 只是让 user 多点几次,**安全等价**。

## 顺序

1. 改 `imbot_agent_spec()` 新 spec
2. 改 `permission-card.ts::DEFAULT_TIMEOUT_MS` 5→30 min
3. 改 / 新增 cargo test(v1 测 bash="ask" → v2 测 bash["*"]="allow" + bash["rm *"]="ask"  + edit/write 不存在)
4. 跑 cargo test + bun test + typecheck 全过
5. 三文档落盘
6. user 一键升级 jsonc(jq del + 重启 DeskFox)
7. commit + 合 dev + push
8. 后续 ship 5.11.2-mac 真飞书实测(单独决策时机)

## 不做(scope-limited)

- 不批改 user `~/.config/opencode/opencode.jsonc` 内容(让 setup hook 注入,user 自己 decide 是否 jq del 升级)
- 不为 bash 删除 pattern 单独 i18n 化卡片描述
- 不做 "delete 操作专属红色 header" 视觉差异化(后续视 user 反馈决定)

## 关联

- 起源:`feishu-bridge-imbot-agent` v1 实测中 user 反馈"寸步难行 + 始终允许不起作用"
- 依赖知识:`packages/opencode/src/permission/{arity,evaluate}.ts` 行为
- 后续:跟 `feishu-bridge-permission-card` 一起 ship 5.11.2 验证
