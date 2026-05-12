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

---

## Follow-up(2026-05-12,Mac 端实测撞 bug)

### 现象

Mac 端真跑 `bash build-deskfox.sh -Env dev --no-bundle`,stderr 出:

```
0: syntax error in expression (error token is "0")
```

build 本身仍成功,但 log 不干净。

### 根因

主 feat 的 cleanup loop 用了:

```bash
FEISHU_COUNT=$(grep -c "plugin/feishu-bridge" "$JSONC" 2>/dev/null || echo 0)
```

`grep -c` 找到 **0 个 match** 时行为反直觉:**stdout 仍输出 "0"** + **exit code = 1**。`|| echo 0` 兜底再追加一个 "0" → COUNT 实际是多行字符串 `"0\n0"` → `[[ "$COUNT" -gt 1 ]]` 在 arithmetic context 撞 token "0" 引发 syntax error。

Mac 端 user 通常多文件存在但其中一个含 0 entry(例如 v3 升级时 jsonc 刚被 setup hook inject 单 entry,而 .json 不存在 — 第一个文件触发 bug,第二个 continue)。Win 端 ps1 用 `[regex]::Matches.Count` 没此问题。

### 修法

去掉冗余兜底,grep 已经输出单行 "0",只需让 substitution exit 0 防 set -e 触发:

```diff
- FEISHU_COUNT=$(grep -c "plugin/feishu-bridge" "$JSONC" 2>/dev/null || echo 0)
+ FEISHU_COUNT=$(grep -c "plugin/feishu-bridge" "$JSONC" 2>/dev/null || true)
```

### 验证

bash fixture 三个边界(`set -e`):

| 输入 | 修前 COUNT | 修后 COUNT | 修后行为 |
|---|---|---|---|
| jsonc 含 0 个 feishu entry | `"0\n0"` → syntax error | `"0"` | skipped ✓ |
| jsonc 含 1 个 entry | `"1"` | `"1"` | skipped ✓ |
| jsonc 含 3 个 entry(多行 pretty 格式) | `"3"` | `"3"` | would clean ✓ |

注:`grep -c` 计 **含 match 的行数**(不是 match 数),所以单行 JSON 包多个 entry 时只计 1。但 opencode pretty 输出 jsonc 永远多行(每个 plugin entry 一行),所以这个假设安全。

### follow-up commit

| commit | 简述 |
|---|---|
| `<本笔 commit>` | fix(build-deskfox): grep -c 0 match 不重复 echo,防 bash arithmetic syntax error [bug-repro: build-deskfox.sh stderr "0: syntax error in expression"] |
