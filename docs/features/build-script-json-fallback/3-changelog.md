---
feat-id: build-script-json-fallback
status: done
related: ./3-changelog.md
---

# build-script-json-fallback — changelog

## 一句话(Tiny micro-patch)

`build-deskfox.{ps1,sh}` 的 post-build jsonc 清理逻辑(`feishu-plugin-dedup-decision` 立的)**只查 `.jsonc`**,user 用 `.json`(无 c)的开发者享受不到。补 fallback — 两种都查。

## 起源

2026-05-12 Win 端实测 `imbot-permission-minimal`(v3 极简档)期间,user 撞双推 message → 查 jsonc 发现 plugin 数组累积 3 entries:

```json
"plugin": [
  "file:///D:/project/opencode-fork/.../target/release/plugin/feishu-bridge",
  "file:///D:/softwares/DeskFox/plugin/feishu-bridge",
  "file:///D:/softwares/DeskFox%20Dev/plugin/feishu-bridge"
]
```

正是 `feishu-plugin-dedup-decision` 那笔 feat 描述的"开发机多档累积"症状。**理论上 `build-deskfox.ps1` post-build cleanup 应该自动清**,但实测没清 — 查代码发现 cleanup 只查 `opencode.jsonc`:

```ps1
$jsonc = Join-Path $env:USERPROFILE ".config\opencode\opencode.jsonc"
if (Test-Path $jsonc) {
    # ... cleanup logic
}
```

而 user 实际用的是 `opencode.json`(无 c 后缀)— Rust setup hook `resolve_user_config_path` 也是优先 `.jsonc` fallback `.json`,但 cleanup 漏了 fallback。

## 范围

`packages/branding/scripts/build-deskfox.ps1`:

```diff
- $jsonc = Join-Path $env:USERPROFILE ".config\opencode\opencode.jsonc"
- if (Test-Path $jsonc) {
-     # ... cleanup
- }
+ $configDir = Join-Path $env:USERPROFILE ".config\opencode"
+ foreach ($fileName in @("opencode.jsonc", "opencode.json")) {
+     $jsonc = Join-Path $configDir $fileName
+     if (-not (Test-Path $jsonc)) { continue }
+     # ... cleanup
+ }
```

`packages/branding/scripts/build-deskfox.sh`(Mac):

```diff
- JSONC="$HOME/.config/opencode/opencode.jsonc"
- if [[ -f "$JSONC" ]]; then
-     # ... cleanup
- fi
+ CONFIG_DIR="$HOME/.config/opencode"
+ for FILE_NAME in opencode.jsonc opencode.json; do
+     JSONC="$CONFIG_DIR/$FILE_NAME"
+     if [[ ! -f "$JSONC" ]]; then continue; fi
+     # ... cleanup
+ done
```

cleanup 逻辑本身不变(grep -v 删行 + 修悬空逗号 + 备份),只是**包了一层 for 循环**对两种文件名都跑一遍。

## 影响范围

**只影响开发者**:
- `build-deskfox.{ps1,sh}` 是开发机编译脚本,普通用户拿 installer 装的成品**根本不会跑**这个脚本
- 普通用户的 jsonc 维护走 `DeskFox.exe` 启动时的 Rust setup hook(`feishu_plugin_install::inject_plugin`),**本 patch 不动那个逻辑**
- 普通用户 `0 影响` — 安装 / 升级 / 启动行为完全不变

## 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/branding/scripts/build-deskfox.ps1` | 改 | post-build cleanup 段从单 `$jsonc` 变 `foreach` 跑两种文件名,逻辑本身不变 |
| `packages/branding/scripts/build-deskfox.sh` | 改 | 同理,从单 `$JSONC` 变 `for FILE_NAME in opencode.jsonc opencode.json` 循环 |
| `docs/features/build-script-json-fallback/3-changelog.md` | 新 | 本文档(Tiny 规模只 changelog,跳过 1-spec / 2-plan)|
| `docs/features/INDEX.md` + `改动日志.md` | 改 | 索引一行 |

## commit 列表

| commit | 简述 |
|---|---|
| `34574ebb5` | feat(build-deskfox): jsonc/json 双 fallback post-build cleanup |
| (本笔 commit) | docs(build-script-json-fallback): Tiny changelog + INDEX + 改动日志 |

## 测试

- ✅ `bash -n build-deskfox.sh` 语法通过
- ✅ ps1 改动是 foreach 包装,语义保留(本机后续 build 自然 trigger 验证 — `pack-installer.ps1` 跑会调 build-deskfox.ps1,顺手跑过即验证)
- ⚠️ Mac sh 等下次 Mac 端跑 build-deskfox.sh 时实战 trigger 验证(本笔 spec 阶段不开 Mac VM)

## R5 测试覆盖豁免

Tiny + post-build script + 改动是控制流包装(逻辑本身不变)+ 不影响生产用户,**测试豁免**(对齐 `feishu-plugin-dedup-decision` 本身的测试豁免决策)。

## R4 / 上游侵入

- 0 R4 override
- 0 上游侵入(fork-only branding scripts)

## 关联

- 起源:`feishu-plugin-dedup-decision`(2026-05-12,Mac 端立的 post-build cleanup,只查 `.jsonc`)
- 跟 `imbot-windows-delete-cmds`(同一天,Win 端实测期间发现)是同一 user 实测会话的两笔独立 micro-patch

## 规模

**Tiny** — ps1 +6 行 / sh +6 行 / 单文档。
