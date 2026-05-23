---
feat-id: feishu-pipeline-401-fix
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-pipeline-401-fix — 2-plan(实施轨迹 + 决策记录)

> **基于**:[1-spec.md](./1-spec.md)
> **分支**:`feat/feishu-pipeline-401-fix`
> **实施时间**:2026-05-22 ~ 2026-05-23(单次会话)

---

## 实施步骤

### Phase 1:实测复现 + 根因定位

1. **现场日志 grep** — `~/Library/Logs/ai.deskfox.app/opencode-desktop_*.log` 看到 3 条 `messages fetch failed status=401` + `empty reply for chat=...`
2. **curl 直测 sidecar** — 拿正确 auth + 各种 path 组合,发现:
   - `/session list` 200 ✅
   - `/session/X` 200 ✅
   - `/session/X/diff` / `/todo` / `/children` / `/status` 全 200 ✅
   - **`/session/X/message` 401 空体 ❌**
3. **首版猜测**:archived session 引起 401(memory 里有 `reference_opencode_plugin_quirks.md` 提过 archived 401)→ 实测发现非 archived session 同样 401,证伪
4. **二版猜测**:sidecar 漂移导致 5-11 prod 老 binary 有 bug → rebuild today 同 source 出新 binary 验证 → 同样 401,证伪。`git log packages/opencode/src` 自 5-11 起 0 改动确认

### Phase 2:加诊断,坐实多 security AND bug

5. 加 console.log 到 `authorizationRouterMiddleware`(router 层)+ `validateCredential`(endpoint 层)+ `workspaceRouterMiddleware`(workspace 层)+ messages handler 内部
6. rebuild sidecar + cp 进 Dev.app + curl 复现,看 log 模式:
   ```
   [diag-auth-endpoint] user=opencode ok=true   ← basic check pass
   [diag-msg-handler] reached sessionID=...     ← handler 进了
   [diag-auth-endpoint] user= ok=false           ← 第二次 auth,空 credential,失败
   ```
7. 验证猜测:带 `auth_token` query 再测 → 401 变 400(auth 过了,schema 拒)
8. **根因 1 坐实**:Effect HttpApi `security: { basic, authToken }` 实现成 AND,缺一返 401

### Phase 3:第一版 fix 撞 schema bug

9. 改 `authorization.ts`:把 authToken 从 security 声明里拿掉,在 basic handler 里手动 fallback 检查 `auth_token` query
10. rebuild + 验证 → 401 变 400(同样 400),处理掉 auth 但暴露下层 schema bug
11. **根因 2 浮现**:加诊断 Schema.encodeUnknownSync 报 `Missing key at ["parts"][2]["reason"]`
12. 看 `StepFinishPart` schema:`reason: Schema.String`(必填),writer 写入 `value.finishReason`(可能 undefined)→ JSON 丢字段 → 编码挂

### Phase 4:重选方案 A

13. 第一版 fix 走的是「方案 B(改上游)」路线,但发现 schema 改动 + auth 改动 = 黑名单 2 笔,代价大
14. 提出方案 A(build script 锁 CHANNEL=prod 走 Hono legacy 绕开两个 bug),给 user 决策
15. user 选方案 A
16. **revert 所有 packages/opencode/ 诊断改动**(R4 0 override)

### Phase 5:方案 A 落地

17. 改 `packages/branding/scripts/build-deskfox.sh` + `.ps1` 各加一行 `export OPENCODE_CHANNEL=prod`(带完整 FORK marker + 背景注释)
18. rebuild sidecar,验证 baked version=`0.0.0-prod-...`
19. 重装 Dev.app + curl 验证 `/session/X/message` → 200 ✅,但 **list 返 0 sessions ❌**
20. **副作用浮现**:`getChannelPath()` 对 prod channel 用 `opencode.db`,对其他用 `opencode-<channel>.db`,DB 文件改名,old session 在 `opencode-dev.db` 看不到

### Phase 6:DB 迁移 hook

21. user 决定加 lib.rs setup hook 做一次性 DB 迁移(0 override,fork-only 文件)
22. 在 `packages/desktop/src-tauri/src/lib.rs` `initialize()` 头部加 `migrate_pre_prod_db()` 调用
23. 抽出核心逻辑 `migrate_db_files(source, target)` 给单测调用
24. 实现:目标存 / 源不存 → skip;两者都满足 → cp `.db` + `.db-wal` + `.db-shm` 3 文件,源保留不删
25. 加 6 个 unit test(target-exists skip / source-missing skip / main-only / all-three-files / idempotent / source-preserved)
26. `cargo test fork_db_migrate` 6/6 pass

### Phase 7:实测验收

27. 删 `opencode.db` 模拟现役 prod 用户升级场景(留 `opencode-dev.db`)
28. rebuild full DeskFox + cp 进 Dev.app + 启动
29. log 验证迁移:
    ```
    [fork-db-migrate] migrating opencode-dev.db → opencode.db (one-time, idempotent)
    [fork-db-migrate] cp opencode-dev.db → opencode.db (4263936 bytes)
    [fork-db-migrate] cp opencode-dev.db-wal → opencode.db-wal (32768 bytes)
    [fork-db-migrate] cp opencode-dev.db-shm → opencode.db-shm (32768 bytes)
    [fork-db-migrate] done, 3 file(s) migrated
    ```
30. curl 验证 6 条:V1-V6 全 pass(`/session list` 返 45 sessions / `/session/X/message` 200 / 单 GET assistant 200 / 无 auth 401 / 错 pwd 401 / auth_token query work)

---

## 决策轨迹

### 决策 1:方案 B 还是 方案 A?(Phase 4 转折点)

**讨论**:
- 方案 B(改上游 2 个 sub-bug)修得最彻底,但黑名单 override × 2,季度配额(≤ 2 笔)直接吃满
- 方案 A(锁 CHANNEL=prod)是手术级修复 — 不动 bug 本身,改 build script 让我们走稳定的 Hono 路径,**这条路是上游 prod 用户 + Win 端实际在跑的**
- 方案 C(plugin 改 dispatcher)放弃 session.messages API 走自治,但上游 bug 留着别处再撞

**结论**:方案 A。**理由**:fork 元原则 R1 「改上游侵入率最小化」 + R4 配额节省 + 跟上游 stable 用户对齐(降低风险)。

### 决策 2:DB 迁移要不要做?(Phase 5 → 6)

**讨论**:
- 方案 A 副作用是 DB 文件名切换(`opencode-dev.db` → `opencode.db`),user 升级后 GUI session list 暂时空
- 选项:① 接受体验回归 ② 加 Tauri Rust 迁移 hook ③ 退到方案 B(避免迁移问题)
- user 选 ②(推荐),0 override(`packages/desktop/src-tauri/src/lib.rs` 不在黑名单)

**结论**:加 idempotent 迁移 hook,cp 3 个 SQLite 文件,源保留作回退。

### 决策 3:迁移代码 source/target 是否 take 参数?

**讨论**:
- 直接在 `migrate_pre_prod_db()` 里写死路径(简洁)vs 抽 `migrate_db_files(source, target)`(可测)
- R5 测试纪律要求 Medium ≥ 3 unit,抽出来才好测

**结论**:抽 `migrate_db_files`,`migrate_pre_prod_db` 是 thin wrapper 解析 path 后委托。

---

## 改动文件清单

| 文件 | 改动 | 估行 |
|---|---|---|
| `packages/branding/scripts/build-deskfox.sh` | +`export OPENCODE_CHANNEL=prod`(带 FORK marker 段) | +18 |
| `packages/branding/scripts/build-deskfox.ps1` | +`$env:OPENCODE_CHANNEL = "prod"`(带 FORK marker 段) | +9 |
| `packages/desktop/src-tauri/src/lib.rs` | +`migrate_pre_prod_db()` + `migrate_db_files()` + 6 unit test;`initialize()` 头部调用 | +130 |

**总计:~157 行 fork-only,0 上游侵入。**

## 黑名单 override 检查

| 黑名单文件 | 触动? |
|---|---|
| `packages/opencode/` 全树 | ❌ 不触 |
| `packages/desktop/src-tauri/{tauri.*.conf.json,build.rs,capabilities/,icons/,entitlements.plist}` | ❌ 不触 |
| `.github/` / `bun.lock` / `*.config.ts` / 根 `package.json` 等 | ❌ 不触 |

**override 笔数:0**。

## 测试

- Rust unit:6 个测试用例,`cd packages/desktop/src-tauri && cargo test fork_db_migrate` 6/6 pass
- 手动 e2e:curl 6 条 + 飞书 reply 实测(user 端)
- 双轮 ship 验证(memory 规范):stale state 模拟用户升级路径已过,干净状态可后续 mv 走 state 再测

## 工期

实际:1 次会话(含投错路撤回 + 重选)。
预估:0.5-1 小时(根因定位 + fix + 测试)。
