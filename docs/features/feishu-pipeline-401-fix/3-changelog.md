---
feat-id: feishu-pipeline-401-fix
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-pipeline-401-fix — 3-changelog(实际改动 + 回退)

> **状态**:✅ 已落地 + 合 main + Mac Tier 2 预览版外发(2026-05-23)
> **commit hash**:`262a353f8`(fix,rebase 自 `21eda9533`)+ `49c95852d`(docs)+ merge `f1bd32503`
> **规模**:Medium(~157 行 fork-only,0 黑名单 override,large-diff override 1 笔 — 三文档同步 632 行)

---

## 改动文件

### 1. `packages/branding/scripts/build-deskfox.sh`(+18 行)

在 sidecar 检测 RUST_TARGET 之前 export `OPENCODE_CHANNEL=prod`,FORK marker 段含完整背景注释(指向 effect-httpapi 两个 sub-bug + 引导走 Hono legacy)。

```bash
# === 0. 确保 sidecar 已 build ===
# ...
# FORK-BEGIN: feishu-pipeline-401-fix(2026-05-23)
# 锁 sidecar baked CHANNEL=prod,避免 git branch 名漂移触发上游 HTTPAPI 默认 ON 路径。
# (完整背景见 marker 段注释)
export OPENCODE_CHANNEL=prod
# FORK-END
```

### 2. `packages/branding/scripts/build-deskfox.ps1`(+9 行)

Win 端同步,内容简短(完整背景指向 sh 版单一来源)。

```powershell
# FORK-BEGIN: feishu-pipeline-401-fix(2026-05-23)
$env:OPENCODE_CHANNEL = "prod"
# FORK-END
```

### 3. `packages/desktop/src-tauri/src/lib.rs`(+130 行)

#### 3a. import 扩 `Path`

```rust
path::{Path, PathBuf},  // 原来只 PathBuf
```

#### 3b. `initialize()` 头部加迁移调用

```rust
async fn initialize(app: AppHandle) {
    tracing::info!("Initializing app");

    // FORK: feishu-pipeline-401-fix(2026-05-23)
    // (一段完整注释解释为什么)
    migrate_pre_prod_db();
    // ... 原有逻辑
}
```

#### 3c. 加 `migrate_pre_prod_db()` + `migrate_db_files(source, target)`

- `migrate_pre_prod_db()`:从 `opencode_db_path()` 拿 target,推算 source(同目录下 `opencode-dev.db`),委托 `migrate_db_files`
- `migrate_db_files(source, target)`:核心逻辑(可测)
  - target 存在 → skip(幂等)
  - source 不存在 → skip(fresh install)
  - 二者都满足 → cp 3 文件:`.db` / `.db-wal` / `.db-shm`(SQLite WAL 模式),源保留不删
  - 失败抛 WARN,不阻断启动(sidecar 会自建空 DB 兜底)

#### 3d. 加 6 个 unit test(`#[cfg(test)] mod fork_db_migrate_tests`)

| test | 覆盖 |
|---|---|
| `skips_when_target_already_exists` | 幂等性:目标存在不覆盖 |
| `skips_when_source_missing` | fresh install:源不存目标不创建 |
| `copies_main_only` | 单 .db 文件 cp,不存的 wal/shm 不创建 |
| `copies_main_wal_shm_all` | 三文件全 cp |
| `idempotent_second_run_is_noop` | 第二次跑不刷新 |
| `preserves_source_after_migration` | 源文件保留不删(回退兜底)|

`cargo test fork_db_migrate` 6/6 pass。

---

## 影响范围

| 维度 | 影响 |
|---|---|
| 飞书桥接 reply | ✅ 修复(curl /session/X/message 200,user 端飞书 e2e 待验) |
| GUI session list | ✅ 历史 session 经迁移 hook 保留可见 |
| 现役 prod 1.14.33 用户 ship 升级 | ✅ 首次启动自动迁移 DB,无感知 |
| 新装用户 | ✅ 迁移 hook skip,直接用 fresh `opencode.db` |
| 安全 | ✅ 401 仅在真无 auth / 错 pwd 时触发(回归验证)|
| auth_token query 路径 | ✅ Hono basicAuth 内置支持(WebSocket 端用) |
| 上游 effect-httpapi 两个 sub-bug | ⚠️ 留着没修(我们走 Hono 绕开),推到上游或下次决定 dogfood 再处理 |
| sidecar baked CHANNEL | 改为 `prod`(原本随 git branch 漂移)|
| `~/.local/share/opencode/` 下 DB 文件 | 新增 `opencode.db` / `opencode.db-wal` / `opencode.db-shm`;原 `opencode-<channel>.db` 系列保留不删 |

## 回归测试(curl 直测,已通过)

```bash
# 主修目标
curl -u opencode:$PWD "http://127.0.0.1:$PORT/session/$SID/message?directory=$HOME/.opencode/feishu-workspace"
# → STATUS:200, 4 messages

# 单 GET assistant message(原 400 — StepFinishPart 编码 bug)
curl -u opencode:$PWD "http://127.0.0.1:$PORT/session/$SID/message/$ASS_ID?directory=..."
# → STATUS:200

# 安全 1:无 auth
curl "http://127.0.0.1:$PORT/session/$SID/message?directory=..."
# → STATUS:401

# 安全 2:错 password
curl -u opencode:WRONG "http://127.0.0.1:$PORT/session/$SID/message?directory=..."
# → STATUS:401

# WebSocket 路径:auth_token query 替代 basic header
B64=$(echo -n "opencode:$PWD" | base64)
curl "http://127.0.0.1:$PORT/session/$SID/message?directory=...&auth_token=$B64"
# → STATUS:200

# /session list 回归
curl -u opencode:$PWD "http://127.0.0.1:$PORT/session?directory=..."
# → STATUS:200, 45 sessions(含历史 archived)
```

## 回退方法

如果发现本 fix 有问题:

1. **revert 3 个 fork-only 文件**:
   ```bash
   git revert <commit-hash>
   ```
2. **手动恢复 DB**:
   - 删 `~/.local/share/opencode/opencode.db*`(迁移生成的)
   - 重启 DeskFox,sidecar 重新 build 后用 `opencode-dev.db`(老 DB 保留没删)
3. **revert 影响**:
   - sidecar baked CHANNEL 回到 git branch 名,HTTPAPI 又可能 ON,飞书桥接 reply 复挂
   - 备选:手动设置环境变量 `OPENCODE_EXPERIMENTAL_HTTPAPI=false` 关 HTTPAPI(脏 workaround)

## ship 注意事项

- **Tier 2 dev ship 双轮验证**(memory `feedback_stale_state_ship_validation.md`):
  - 第 1 轮 stale state:安装新 .app,保留旧 `opencode-dev.db`,启动应自动迁移
  - 第 2 轮 clean state:mv 走 state(包括 `~/.local/share/opencode/*.db*`),启动应能创建 fresh `opencode.db` 跑通

- **Win 端**:本 fix 同样适用,Win build script 已同步。Win 端 user 升级是否触发 DB 迁移取决于他们之前 baked 的 channel —— 如果 channel=feat 分支名,DB 是 `opencode-feat-<name>.db`,**当前迁移 hook 只覆盖 `opencode-dev.db` 这一种**,Win 用户老 DB 可能仍读不到。**后续行动**:观察 Win ship 后用户反馈,如果有 session 丢失投诉,扩展迁移 hook 兼容 `opencode-*.db` 通配。

## merge + ship 闭环(2026-05-23 当天)

合 main 步骤完整记录(铁律 ②③ 双人把关):

1. `git fetch origin && git pull --rebase`(本地 main 跟上远端 10 笔 e2e-mock commit)
2. feat 分支 `git rebase main` — 自动 patch-id 去重 3 笔旧 Mac ship-dev commits(同名异 hash)
3. `git merge --no-ff feat/feishu-pipeline-401-fix` 合 main(merge commit `f1bd32503`,user 同意后执行)
4. **从 merged main HEAD 重 build** + 自动验证全过:Rust 单测 6/6 / sidecar prod baked / `strings` 验 e2e-mock 0 注入生产 bundle / typecheck 16/16 / fork-db-migrate 编进 binary(9 个 strings 引用)
5. user 双击 .app + 飞书 reply 一条回归通过 → `git push origin main`(6 commits 上去,含 3 笔 2026-05-22 累积未推的 Mac ship-dev 工作)
6. **Mac Tier 2 预览版 5.21.1-dev 对外发布**(SOP 闭环):
   - `.dmg` 重命名 `DeskFox-Dev-2026.5.21.1_aarch64.dmg`(64.5 MB)
   - `git tag ship-mac-dev-2026.5.21.1-dev` + push 到 origin(tag on HEAD `f1bd32503`,user 测过的状态)
   - `gh release create --prerelease`(GitHub Release,含 .dmg asset)
   - Gitee API 创 release(id=689661)+ `mirror-asset-to-gitee.sh` 上传 .dmg(82 Mbps / 6s)
7. `git branch -d feat/feishu-pipeline-401-fix`(规范 v2 feat 用完即销毁)

**ship 对外链接**:
- GitHub: https://github.com/zoulukuang/deskfox/releases/tag/ship-mac-dev-2026.5.21.1-dev
- Gitee: https://gitee.com/zoulukuang/deskfox/releases/tag/ship-mac-dev-2026.5.21.1-dev

**整合细节**:本 .dmg build commit 在原 5.21.1-dev bump(`b6916bd90`,2026-05-22)之后,**含 feishu-pipeline-401-fix 本笔修复**。两笔变更同期 ship 而非分开,因 feishu fix 修的是 sidecar baked channel 问题 — 直接影响 Tier 2 预览版核心闭环,user 决议一次性走完。Release notes 里有说明。
