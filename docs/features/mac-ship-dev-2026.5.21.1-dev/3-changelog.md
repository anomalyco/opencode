---
feat-id: mac-ship-dev-2026.5.21.1-dev
status: done
related: ./3-changelog.md
---

# mac-ship-dev-2026.5.21.1-dev — changelog

## 一句话(Tiny ship)

Mac 端**首次 Tier 2 预览版**ship(对应 Win 端 `win-ship-dev-2026.5.21.1-dev` 同期发车,2026-05-22 bump / 2026-05-23 对外发布闭环),自 [macOS] `2026.5.12.1`(2026-05-12 prod)以来主线 22+ 笔 commit。**特殊性**:bump 在 2026-05-22 落地(`b6916bd90`),但 ship 对外发布在 2026-05-23 当天补完 — 包内容包含 post-bump 的 `feishu-pipeline-401-fix`(因后者修的就是 Tier 2 预览版核心闭环 sidecar baked channel 问题,user 决议一次性走完)。

## 包内容(本笔 ship,bump → 对外发布期间含)

bump 时刻(`b6916bd90`)主线已合的 feat:

- **sdk-falsy-empty-body-fix**(SDK `wrapFetchWithFalsyGuard` layer 2,user 能看到真错误 URL+status)
- **frontend-stale-session-fallback**(stale session id 启动恢复降级而非崩,接力闭环)
- **abandon-cloud-build-workflows**(云端 build workflow 永久废止决策)
- **ship-scripts-naming-fix** / **installer-naming-cleanup** / **3tier-versioning-governance** / **rename-dev-to-main** / **installer-version-env-suffix**(5 笔治理规范同期落地)
- **large-file-preview-guard**(大文件预览 4 层防护,REQ-025)
- 其他 chat/UX 改进集合

post-bump 含(2026-05-23 ship 时主线新增):

- **feishu-pipeline-401-fix**(`262a353f8` + `49c95852d` + merge `f1bd32503`):锁 sidecar baked CHANNEL=prod 修飞书桥接 reply 401 全静默 bug + DB 一次性幂等迁移 hook(`opencode-dev.db` → `opencode.db`)

## 改动文件(本笔 ship 自带)

| 文件 | 改动 |
|---|---|
| `packages/branding/installer-versions.json` | macos `2026.5.12.1` → `2026.5.21.1-dev`(bump commit `b6916bd90`) |
| `docs/installer-versions.md` | 加 [macOS] 2026.5.21.1-dev entry(bump commit `b6916bd90`,~35 行) |
| `docs/features/mac-ship-dev-2026.5.21.1-dev/3-changelog.md` | 新 — 本文档(2026-05-23 ship 闭环时补) |
| `docs/features/INDEX.md` + `改动日志.md` | 索引行(2026-05-23 ship 闭环时补) |

## 三铁律走流程

| 步骤 | 状态 |
|---|---|
| 2026-05-22 在 main 上直接 commit bump(`b6916bd90`)| ⚠️ **历史包袱** — bump 当天没开 feat 分支,直接落 main 本地(commit message 备注"下一步:push user 同意");不符合 v2 铁律 ① 但因当时正在 ship 流程中未细究,后续严格遵守 |
| 本地 commit 不动远端 main | ✅(2026-05-22 → 2026-05-23 一直只在本地)|
| → origin/main push user 同意 | ✅(2026-05-23 一次性推 6 笔:本笔 3 笔 + feishu fix 3 笔,user 明确授权)|
| `ship-mac-dev-2026.5.21.1-dev` tag user 同意 | ✅(2026-05-23,tag on HEAD `f1bd32503`= user 实测过的 build commit)|
| GitHub Release prerelease publish | ✅(2026-05-23,`gh release create --prerelease` + .dmg asset)|
| Gitee Release publish + .dmg 上传 | ✅(2026-05-23,Gitee API POST 创 release id=689661 + `mirror-asset-to-gitee.sh` 上传 82 Mbps / 6s)|

## Build 过程(2026-05-23 ship 闭环当天)

1. **不 bump installer-versions.json**(已在 bump commit `b6916bd90` 落)
2. **quit DeskFox** + 跑 `bash packages/branding/scripts/build-deskfox.sh -Env dev`(从 merged main HEAD `f1bd32503` build,含 feishu fix)
3. **cargo build 25s** + Tauri bundling → 出 `DeskFox Dev.app` + `DeskFox Dev_1.14.33_aarch64.dmg`(Tauri 内部版本 1.14.33 命名)
4. **cp raw binary 兜底**:`cp target/release/DeskFox .app/Contents/MacOS/DeskFox`(memory `feedback_full_build_doesnt_update_app_binary.md` 经验)
5. **手动 rename** `DeskFox Dev_1.14.33_aarch64.dmg` → `DeskFox-Dev-2026.5.21.1_aarch64.dmg`(productName 空格转横杠 + NumericVer strip `-dev` 后缀,对齐 `pack-installer.sh` rename 逻辑)
6. **三轮 user 双轮验证**(memory `feedback_stale_state_ship_validation.md`)+ 飞书 reply 回归全过

## 验证(2026-05-23)

- 自动:Rust 单测 fork_db_migrate_tests 6/6 / sidecar prod baked / `strings` 验 e2e-mock 0 注入生产 bundle / typecheck 16/16 / fork-db-migrate 编进 binary
- user 手测三轮:
  - 测试 1:`opencode.db` 已存在 → DEBUG skip(已存在分支)启动 OK
  - 测试 2:mv 走整个 `~/.local/share/opencode/` 干净启动 → sidecar 找的是 `opencode.db`(prod channel 生效证实)+ 自建空 DB
  - 测试 3:干净状态发飞书消息 → reply 正常,session archived 持久化进新 `opencode.db`
- 日志层面三轮全佐证(`10-19-02.log` 看到迁移 3 文件 cp / `11-28-55.log` skip already-exists / `11-29-56.log` skip source-missing + sidecar 自建 `opencode.db`)

## 产物

- **`DeskFox-Dev-2026.5.21.1_aarch64.dmg`**(arm64,64.5 MB,不签名,首次打开需右键 → 打开)
- Bundle ID:`ai.deskfox.app.dev`(与 prod 同机共存)
- 版本号:installer-versions.json macos = `2026.5.21.1-dev`(N=1 序列,Tier 2 dev 维度独立计数)

## 外发链接

- **GitHub Release**:<https://github.com/zoulukuang/deskfox/releases/tag/ship-mac-dev-2026.5.21.1-dev>(prerelease)
- **Gitee Release**:<https://gitee.com/zoulukuang/deskfox/releases/tag/ship-mac-dev-2026.5.21.1-dev>(prerelease,release id=689661)

## 回退方法

如发现本 ship 含的 feishu fix / 其他 feat 翻车:

1. **删 tag + 删 GitHub Release**:
   ```bash
   gh release delete ship-mac-dev-2026.5.21.1-dev --repo zoulukuang/deskfox --yes
   git push --delete origin ship-mac-dev-2026.5.21.1-dev
   git tag -d ship-mac-dev-2026.5.21.1-dev
   ```
2. **删 Gitee Release**:web UI 或 `curl -X DELETE "$GITEE_API/repos/zoulukuang/deskfox/releases/689661?access_token=$GITEE_TOKEN"`
3. **bump 下一档**(2026.5.23.1-dev 或 fix 后版本)出新预览版,**不要回退 `b6916bd90` bump commit**(history rewrite 不值得)

## 关联

- bump commit:`b6916bd90`(2026-05-22)
- ship 闭环 push commit:`f1bd32503`(2026-05-23 merge feishu-pipeline-401-fix)
- 同期 Win 端 ship:`win-ship-dev-2026.5.21.1-dev`(`6471c9144`,2026-05-21 落地)
- 前一档 Mac ship:`mac-ship-prod-5.12.1`(prod,2026-05-12)
