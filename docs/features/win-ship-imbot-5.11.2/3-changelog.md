---
feat-id: win-ship-imbot-5.11.2
status: done
related: ./3-changelog.md
---

# win-ship-imbot-5.11.2 — changelog

## 一句话

Win 端补 ship 5.11.2 把 `feishu-bridge-imbot-agent` 安全 agent 推给 Win 用户 — 5.11.1 ship 时序撞 imbot 合并之前导致 Win 5.11.1 不含 imbot,跟同号 Mac 5.11.1 内容不一致,本笔补齐。

> Tiny:1 新 feat 目录 / 3 文件 bump 副产物 + 1 placeholder 回填 + INDEX + 改动日志 = 5 文件 / ~30 行 / 0 R4 / 0 上游侵入。

## 起源

时间线(全 2026-05-11):

| 时间 | 事件 | imbot? |
|---|---|---|
| 10:24 | Win `ship-prod-2026.5.11.1` (commit `9e9fca5bb`) | ❌ |
| 13:14 | `feat(feishu-bridge): imbot 安全 agent` merge (commit `5e81491f8`) | — |
| 13:53 | Mac `ship-mac-prod-2026.5.11.1` (commit `1cbba5756`) | ✅ |

`installer-versions.json` 两边都写 `2026.5.11.1`,**但 Win/Mac 内容不一致** — Win 5.11.1 用户飞书桥接仍走 build agent 全权限(unattended RCE 等价裸奔),Mac 用户走 imbot 受 permission card 保护。安全 regression(相对 Mac),本笔补齐。

## 审计前置(chore/win-port-audit-mac-pack-installer 分支,已销毁)

User 拉完 dev 后让审计"Mac 端修改的这个 Win 要不要做适配"。审计结论:

**Win 端代码 0 改动需求** — `feishu-bridge-imbot-agent` feat 的代码(`feishu_plugin_install.rs` 207 行 + `config-schema.ts` 1 行 + `account-store.ts` 1 行 + `feishu-edit-account-dialog.tsx` 3 行注释 + 2 单测)**全部跨平台原生设计**:

- `to_file_url`(line 95-112)已显式处理 Win UNC 前缀 `\\?\` strip + 反斜杠转 + 空格 `%20`
- `path_still_valid`(line 281-288)有 `#[cfg(target_os = "windows")]` strip 前导 `/`
- `resolve_user_config_path`(line 68-92)三平台统一走 `~/.config/opencode`
- `imbot_agent_spec` 同一 spec 含两平台敏感目录:`**/Library/Keychains/**` (Mac) + `**/AppData/Roaming/Microsoft/Crypto/**` (Win) + 通用 `**/.ssh/**` / `**/.aws/**` / `**/.kube/**` / `**/.gnupg/**`
- TS 改动 `?? "build"` → `?? "imbot"` 纯逻辑

剩 ship 层 gap — 走 Win 5.11.2 ship 流程交付。

## Win 端 end-to-end 验证(本笔 ship 前必跑)

走三层验证,全过 → 信心走 prod ship:

### 1. Rust 编译层

`cargo test --lib feishu_plugin_install:: --no-run` 在 Win 上编译过(1m02s)。test 二进制执行时撞 `STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139)`(Tauri lib test 链 WebView2/Win runtime DLL 通病,**不是 imbot 代码问题**),改用下一层验证。

### 2. Rust 行为层(独立 binary 绕 Tauri 依赖)

抽 `inject_imbot_agent` + `imbot_agent_spec` + `strip_comments` 三函数写独立 Rust 项目(`serde_json` 一个依赖),在 Win 真实文件系统操作 jsonc,5 场景:

| 场景 | 输入 | 验证 | 结果 |
|---|---|---|---|
| A. 空 config | `{"$schema":"..."}` | bash/webfetch/Win Crypto/Mac Keychain/`*.env.example` 全对 | ✅ |
| B. idempotent | user 改 `imbot.bash=allow` | 第二次 inject 完全跳过,mtime 不变 | ✅ |
| C. merge | 已有 `my_custom` agent | imbot 加入,my_custom 不被动 | ✅ |
| D. jsonc 注释 | `// 行注释` + `/* 块注释 */` | `strip_comments` fallback 工作 | ✅ |
| E. read 10 globs 全配齐 | `{}` | 全部 10 个 glob 值精确匹配 | ✅ |

### 3. TS 默认值层

`bun test packages/adapter-feishu-lark/src/feishu/__tests__/account-store.test.ts` — 16/16 pass(含 2 新 imbot 默认 test + 老账号 build 不被强制 migrate test)。

### 4. 实地 dev installer 端到端(GUI 测)

`pack-installer.ps1 -Env dev -SkipBump` 出 `DeskFox-Dev-2026.5.11.1-setup.exe`(59.2 MB,6m25s build)→ user 装到 `D:\softwares\DeskFox Dev\` → 启动 → setup hook 15 秒内触发 → 检查 `~/.config/opencode/opencode.jsonc`:

```jsonc
"agent": {
  "imbot": {
    "description": "DeskFox IM 桥接专用 agent — 同 build 能力,但 unattended 场景下危险工具默认 ask",
    "permission": {
      "bash": "ask", "edit": "ask", "write": "ask",
      "apply_patch": "ask", "webfetch": "ask",
      "read": { /* 10 globs 全在 */ }
    }
  }
}
```

✅ 注入完整对齐 spec,Win 端 imbot 跨平台代码端到端跑通。

### 5. 飞书桥接实测一句话回复

User 装完 dev 发飞书消息撞**测试残留**:`opencode.jsonc.plugin` 数组 3 条路径(本笔实施期间留下 — target/release + 旧 prod + 新 dev),sidecar 加载 3 个 plugin 实例 / 3 个 WSS 连同账号 → 飞书消息广播给 3 个实例处理冲突 → 无回复。trim 到单条 dev 路径 + 重启后正常。

**新用户场景不会撞** — 干净机器只装 1 次 prod,plugin 数组只有 1 条。本笔 ship 不影响 — 5.11.2 prod installer 走标准 install path,不带测试残留。

## commit 列表

| commit | 简述 |
|---|---|
| (待填) | `chore(ship): bump Win 2026.5.11.2 + win-ship-imbot-5.11.2 三文档 + installer-versions 回填` |

## 改动文件

| 文件 | 改动 | 说明 |
|---|---|---|
| `packages/branding/installer-versions.json` | `windows: 2026.5.11.1` → `2026.5.11.2` | 自动 bump |
| `packages/branding/installer/DeskFox.iss` | `AppVersion "2026.5.11.1"` → `"2026.5.11.2"` | 自动 bump |
| `docs/installer-versions.md` | +1 entry(2026.5.11.2)| placeholder 回填 |
| `docs/features/win-ship-imbot-5.11.2/3-changelog.md` | 新建 | 本文 |
| `docs/features/INDEX.md` | +1 行 | 索引 |
| `改动日志.md` | +1 行 | 改动索引表 |

## installer 产物

`packages/branding/installer/Output/DeskFox-2026.5.11.2-setup.exe` — 59.4 MB,2026-05-11 15:22:38 build,**本地 build**(GitHub Actions 自动出包流程已停,见 [`win-ship-local-pack-switch`](../win-ship-local-pack-switch/3-changelog.md))。

## ship 流程(本地打包 + 手动上传 GitHub + Gitee API + mirror-asset)

```
1. pack-installer.ps1 -Env prod         → bump 5.11.2 + build + ISCC = ✅
2. 文档落盘 + git commit                 → 本笔
3. git push origin dev + push tag       → 本笔
4. gh release create --draft + .exe     → 本笔(user 审 draft → publish)
5. curl Gitee API 创 release             → 本笔
6. mirror-asset-to-gitee.ps1 上传 .exe   → 本笔
```

## 关联

- `feishu-bridge-imbot-agent` ([changelog](../feishu-bridge-imbot-agent/3-changelog.md))— 本笔 ship 的源 feat
- `mac-pack-installer-and-gitee-rename` ([changelog](../mac-pack-installer-and-gitee-rename/3-changelog.md))— Mac 端同期补完整 ship 路径,Win 端本笔补
- `win-ship-local-pack-switch` ([changelog](../win-ship-local-pack-switch/3-changelog.md))— 本地 build + 手动上传 GitHub + Gitee 流程在 5.11.2 走第二次

## 已知 backlog

- **dev/prod sidecar 共用 `~/.config/opencode/opencode.jsonc`**:开发者一台机器装多个 build(prod + dev + 直跑 target/release exe)会累积多个 plugin path entries → 多实例运行。本笔实测期间撞,trim 后修。新用户不会撞。FUTURE 可考虑 `-Env dev` build 写到独立 `~/.config/opencode-dev/`
- **`inject_imbot_agent` 不处理 UTF-8 BOM**:Win user 用 notepad 默认存 jsonc 带 BOM 会让 `serde_json::from_str` 失败 fallback 到 `strip_comments` 路径再失败。实际触发概率低(VS Code / 多数编辑器默认不写 BOM),触发即修(`raw.trim_start_matches('\u{feff}')` 一行)

## R4 / 上游侵入 / 测试

- 0 R4 override(纯 ship chore + docs)
- 0 上游侵入(只动 fork-only `installer/` 配置 + docs)
- 无新增单测(Tiny ship chore;源 feat `feishu-bridge-imbot-agent` 已带 Rust 5 + TS 2 单测,本笔走 e2e 验证不补 unit)

## 回退方法

```sh
git revert <merge-commit>
```

回退后:
- installer-versions.json + .iss + installer-versions.md 三档回到 5.11.1
- 已发 GitHub Release / Gitee Release 不会被 git revert 影响,需手动从两端 delete release
- user opencode.jsonc 里已注入的 imbot agent **不强制清**(idempotent 反向不动)

完整 ship 撤回需 GitHub + Gitee 两侧 delete release。
