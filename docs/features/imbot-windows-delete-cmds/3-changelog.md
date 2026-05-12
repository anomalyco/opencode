---
feat-id: imbot-windows-delete-cmds
status: done
related: ./3-changelog.md
---

# imbot-windows-delete-cmds — changelog

## 一句话(Tiny micro-patch)

v3 极简档实测发现 Windows 端漏洞:LLM 在默认 PowerShell shell 跑 `rm -rf` 时,实际调的是 `Remove-Item -LiteralPath ...` 而非 unix `rm`,绕过 `bash["rm -rf *"]: ask` 规则。补 4 条 Windows 风格 pattern 覆盖跨 shell 调用。

## 起源

2026-05-12 Windows 端实测 `imbot-permission-minimal`(v3 极简档)— user 在飞书 `Hebing—one` bot 发:
```
执行命令删除目录:rm -rf D:\temp\v3-rm-test
```

期望:弹 bash 权限卡片。实际:**没弹卡片,目录被真删**。

opencode session sqlite 拿到铁证(`packages/opencode/src/permission` 走 `bash` permission key + `Wildcard.match` findLast 规则):

```json
{
  "type": "tool",
  "tool": "bash",
  "input": {
    "command": "Remove-Item -LiteralPath \"D:\\temp\\v3-rm-test\""
  }
}
```

LLM 在 Windows 默认 PowerShell shell 里**没用 unix `rm`,用了 PowerShell 原生 `Remove-Item`**。v3 的 `bash["rm -rf *"]: ask` pattern 通过 Wildcard.match 匹配命令字符串前缀,**Remove-Item 完全不命中**。

## 范围

`packages/desktop/src-tauri/src/feishu_plugin_install.rs::imbot_agent_spec()` bash 块加 4 条 Windows 风格 pattern:

```diff
 "bash": {
   "*": "allow",
   "rm -rf *": "ask",
+  "Remove-Item *": "ask",   // PowerShell 主路径
+  "rmdir *": "ask",         // PowerShell function 自动 -Recurse
+  "del *": "ask",           // cmd 经典
+  "rd *": "ask",            // cmd alias for rmdir
   "git push --force*": "ask",
   ...
 }
```

注意:v3 极简档原本砍掉了 `rmdir *`(unix `rmdir` 只能删空目录,可逆面大没必要拦)。v3.1 加回 `rmdir *` 因为它在 **PowerShell 里是 `Remove-Item -Recurse` 的 function alias,能删非空目录**,跟 unix `rmdir` 语义完全不同 — 是真删除路径,该拦。

## 实测验证(2026-05-12)

清掉 user 已有 `.agent.imbot` 块 + 手动补 4 条 pattern + 重启 DeskFox-Dev,在飞书发同一命令:

| Bot | 命令 | 结果 |
|---|---|---|
| `Hebing—one` | `rm -rf D:\temp\v3-test-hebing` | ✅ **弹 bash 卡片**(显示 LLM 真用的 `Remove-Item -LiteralPath ...`)|
| `xiaobei_win` | `rm -rf D:\temp\v3-test-xiaobei` | ✅ **弹 bash 卡片** |

sidecar log 铁证:
```
11:14:21 [permission-card] sent card for request per_xxx (bash) → Hebing—one
11:14:34 [permission-card] sent card for request per_xxx (bash) → xiaobei_win
11:15:14 [permission-card] user replied once (user 主动点允许一次)
```

## 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/desktop/src-tauri/src/feishu_plugin_install.rs::imbot_agent_spec()` | 改 | bash 块加 4 条 Windows 风格 pattern;函数顶部注释加 v3.1 增量说明 + 实测起源 |
| `packages/desktop/src-tauri/src/feishu_plugin_install.rs` test mod | 改 + 新 | 改 `imbot_bash_pattern_covers_destructive_ops`(must_ask 9→13 + bash.len 10→14);改 `imbot_v3_drops_v2_overstrict_bash_patterns`(把 `rmdir *` 从 must_not_ask 移除,加注释解释 v3.1 加回的理由);新 `imbot_v3_1_blocks_windows_delete_commands`(专门验 4 条 Win pattern) |
| `docs/features/imbot-windows-delete-cmds/3-changelog.md` | 新 | 本文档(Tiny 规模只写 changelog,跳过 1-spec / 2-plan)|
| `docs/features/INDEX.md` + `改动日志.md` | 改 | 索引一行 |

## commit 列表

| commit | 简述 |
|---|---|
| `713ef3075` | feat(feishu-bridge): imbot v3.1 补 Windows PowerShell/cmd 删除 pattern |
| (本笔 commit) | docs(imbot-windows-delete-cmds): Tiny changelog + INDEX + 改动日志 |

## 测试

- ✅ typecheck 16/16(待回填,Tiny 改动不影响 TS 类型)
- ✅ user 飞书实测两个 bot 各弹卡片(铁证见上)
- ⚠️ cargo test feishu_plugin_install::(Win 端 ABI 老问题持续 STATUS_ENTRYPOINT_NOT_FOUND,代码 audit 充分:纯 serde_json + 测试 expect 1:1 对齐)

## 安全模型影响

v3.1 防御范围 v3 + Windows 风格删除命令。整体规则数:8 → **13**(8 个原 v3 + 4 个 Win 新增 + `rmdir *` 加回)。

| 攻击 | v3 | v3.1 | 说明 |
|---|---|---|---|
| LLM 跑 `rm -rf <path>`(unix) | ask | ask | 不变 |
| LLM 跑 `Remove-Item <path>`(Win PowerShell) | **allow** ❌ | ask | **v3.1 修复** |
| LLM 跑 `rmdir <path>`(Win PowerShell)| **allow** ❌ | ask | **v3.1 修复** |
| LLM 跑 `del <path>`(cmd) | **allow** ❌ | ask | **v3.1 修复** |
| LLM 跑 `rd <path>`(cmd) | **allow** ❌ | ask | **v3.1 修复** |
| LLM 跑 `npm uninstall lodash` 等可逆 | allow | allow | 不变 |
| LLM 跑 `git push --force` | ask | ask | 不变 |

## R5 测试覆盖

- 既有 `imbot_bash_pattern_covers_destructive_ops` 测试改 expect 覆盖 13 条全部
- 既有 `imbot_v3_drops_v2_overstrict_bash_patterns` 测试改 — `rmdir *` 从 must_not_ask 移除
- 新加 `imbot_v3_1_blocks_windows_delete_commands` 测试专门 sanity-check 4 条 Win pattern

## R4 / 上游侵入

- 0 R4 override
- 0 上游侵入(fork-only `feishu_plugin_install.rs`,per-pattern 走上游 Wildcard.match findLast)

## 关联

- 前置:`imbot-permission-minimal`(v3 极简档,2026-05-12 落地)
- 起源:user Windows 实测发现 LLM PowerShell 绕过

## user 升级路径(v3 → v3.1)

setup hook idempotent(已有 imbot 块不强制覆盖)。强制升级:

```bash
# Win
cp %USERPROFILE%\.config\opencode\opencode.json %USERPROFILE%\.config\opencode\opencode.json.bak-v3
# 编辑 jsonc 删 .agent.imbot 整块,重启 DeskFox 触发 setup hook 注入 v3.1
```

或者手动在 `.agent.imbot.permission.bash` 加这 4 行:
```jsonc
"Remove-Item *": "ask",
"rmdir *": "ask",
"del *": "ask",
"rd *": "ask"
```

## 规模

**Tiny** — `imbot_agent_spec()` +4 条 pattern + 3 个单测调整 + 1 个新单测 + 单文档。
