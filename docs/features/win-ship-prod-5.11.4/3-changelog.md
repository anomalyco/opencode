---
feat-id: win-ship-prod-5.11.4
status: done
related: ./3-changelog.md
---

# win-ship-prod-5.11.4 — changelog

## 一句话

Win 端 5.11.1 / 5.11.2 / 5.11.3 多次 ship 撞 **vite chunking 非确定性 bug** — 同一份源码不同时刻 build,产出有时 OK 有时崩。5.11.4 用"当前 known-working binary 直接 ISCC 重打 installer(不重新 vite build,避免再撞非确定性)"workaround 解 unblock user,**内部版本字段仍 5.11.2**(bundle 没重 build),UI 左下角显示 `v2026.5.11.2` / Windows 控制面板显示 `5.11.4` — 接受这个 mismatch 换稳定 ship。**根因还没真修**,留 backlog。

> Tiny ship chore — 3 文件 bump 副产物 + 5 文件 docs + 直接复用 已 build target/release / 0 重 build / 0 R4 / 0 上游侵入。

## bug 根因(当前已知)

### 现象

5.11.1 / 5.11.2 / 5.11.3 三次 ship 装出来的 DeskFox 启动期 UI 撞 **SolidJS `castError`**:
```
Error: Unknown error
    at castError (http://tauri.localhost/assets/index-OCidKBgv.js:1:10383)
    at http://tauri.localhost/assets/index-OCidKBgv.js:1:3246
原因:Object {}
```

### 真因(诊断结果)

1. **崩在 SolidJS `createResource` 的 fetcher Promise rejection**:`solid.js:372` `p.then(..., e => loadEnd(p, undefined, castError(e), lookup))`
2. **fetcher 源头** = `(id) => sync.session.sync(id)`(`packages/app/src/pages/directory-layout.tsx:28`)— DeskFox 启动期自动恢复上次 session 时调
3. **抛 `{}` 的真凶** = `packages/sdk/js/src/v2/gen/client/client.gen.ts` line 102 / 220 的 SDK fallback:
   ```ts
   finalError = finalError || ({} as unknown)   // ← 原 error 是 falsy 时 fallback {}
   if (opts.throwOnError) throw finalError
   ```
4. **为什么 5.11.x 撞 5.10.1 不撞** — bisect 排查了 5.10.1 → 5.11.1 之间所有 commit,**没有任何源代码改动直接引入 bug**。同一 commit 上**今天的 build 不复现**(我在 5.11.4 ship 前重 build 同 commit 测了多次都 OK,bundle 文件名相同但行为不同):
   - **结论**:bug 是 **vite/rollup chunking 非确定性**导致 minified bundle 偶尔凑出"SDK fallback 路径被特定调用栈触发"的状态
   - 表面上 bundle 文件名(content hash)相同,但**运行时行为不同** — vite 可能在 chunk graph 哈希计算之外还有非确定性变量(模块加载顺序 / closure 捕获顺序)

## 5.11.4 实际改动

| 文件 | 改动 | 说明 |
|---|---|---|
| `packages/branding/installer-versions.json` | `windows: 2026.5.11.2` → `2026.5.11.4` | 手工 bump(跳过本地坏 build 占用的 5.11.3)|
| `packages/branding/installer/DeskFox.iss` | `AppVersion "2026.5.11.2"` → `"2026.5.11.4"` | 同上,让 ISCC 产 5.11.4 文件名 |
| `docs/installer-versions.md` | +5.11.4 entry | 含 mismatch 警告 |
| `docs/features/win-ship-prod-5.11.4/3-changelog.md` | 新 | 本文 |
| `docs/features/INDEX.md` | +1 行 | 索引 |
| `改动日志.md` | +1 行 | 改动索引 |

**关键**:`target/release/DeskFox.exe` **不重 build** — 用 2026-05-11 22:53:13 那次 build dev tip 时产出的 working binary(经多轮实测 UI 正常)。`pack-installer.ps1 -Env prod -SkipBump -SkipBuild` 跑,只做 ISCC compile。

## installer 产物

`packages/branding/installer/Output/DeskFox-2026.5.11.4-setup.exe` — 59.2 MB,本地 build,**走 [win-ship-local-pack-switch](../win-ship-local-pack-switch/3-changelog.md) 流程**。

## 内部内容跟外部版本的 mismatch(明确接受)

| 显示位置 | 显示内容 | 原因 |
|---|---|---|
| installer 文件名 | `DeskFox-2026.5.11.4-setup.exe` | ISCC 用 .iss `AppVersion=2026.5.11.4` 拼 |
| Windows 控制面板 "已安装应用" | DeskFox 版本 2026.5.11.4 | Inno Setup 注册表写 AppVersion |
| DeskFox UI 左下角版本牌 | `v2026.5.11.2` | vite bundle 烧的是 build 时的 `installer-versions.json` = 5.11.2(没重 build,5.11.4 没烧进 bundle)|

user 反馈接受这个 mismatch — 换 ship 稳定性 vs 重 build 再撞非确定性。

## bug 调查过程(沉淀)

### bisect 路径(7 commit 测了 5 个)

| commit | 测试结果 |
|---|---|
| `39e487f75` (5.10.1 bump) | ✅ A |
| `183183119` (4 笔机制 fix merge) | ✅ A |
| `8d86d440d` (permission card feat merge) | ✅ A |
| `b91e5f353` (pack-installer 重 build merge) | ✅ A |
| `31e0a2987` (5.11.1 封档 merge) | ✅ A |
| `72cea30c9` (allow-always docs) | (跳过 — 纯 docs)|
| `9e9fca5bb` (5.11.1 ship 最终) | ✅ A(**矛盾** — 跟 user 之前装 5.11.1 installer 崩不一致) |
| `b268ce694` (dev tip,含 imbot)| ✅ A(本次 ship 用的就是这次 build 的 binary) |

### 矛盾的解释

`9e9fca5bb` build NOW = 工作,但**当时 ship 的 5.11.1 installer = 崩**。意味着同一 commit 不同时刻 build 行为不同。

可能原因(优先级排序):
1. **vite/rollup chunking 算法在 module 加载顺序、字符串哈希、closure 捕获顺序上有非确定性**(高可能)
2. **node_modules cache state 跟随多次 build 漂移**(`Resolved, downloaded and extracted [N]` 提示每次 build 都重做依赖解析,即使 bun.lock 不变)— bun cache 内部状态可能影响产物
3. **operating system 级缓存**(WebView2 cache / Tauri target/release incremental)— 但我做了 cargo clean 之后仍崩,所以不只是 cargo

均**未实际锁定**。本次 ship 不深查,留 backlog。

## debug 期间的临时 patch(已撤回)

调试中临时打 patch 帮定位:
- `node_modules/.bun/solid-js@1.9.10/.../solid.js:castError` — 加 console.error 打印 err 详情(撤)
- `node_modules/.bun/solid-js@1.9.10/.../solid.js:createResource fetcher 调用点` — wrap with `.then` observer 打印 fetcher 源码(撤)
- `packages/sdk/js/src/v2/gen/client/client.gen.ts` — fetch / response-not-ok 路径加 console.error 打印 URL / status(撤)
- `packages/desktop/src-tauri/Cargo.toml` — 临时加 `devtools` feature 强开 release F12(撤)

所有 patch 在调试结束后 git checkout 还原,本笔 ship 不带任何 debug 代码。

## ship 流程(走 [win-ship-local-pack-switch](../win-ship-local-pack-switch/3-changelog.md))

```
1. 手工 bump installer-versions.json + DeskFox.iss → 5.11.4    ✅
2. pack-installer.ps1 -SkipBump -SkipBuild(只 ISCC pack)        ✅
3. 文档落盘 + git commit                                          [本笔]
4. merge → dev + push origin dev + push tag ship-prod-5.11.4    [本笔]
5. gh release create --draft + 5.11.4 .exe attached             [本笔]
6. Gitee API create release + mirror-asset upload .exe          [本笔]
```

## 关联

- `feishu-bridge-imbot-agent`([changelog](../feishu-bridge-imbot-agent/3-changelog.md))— 飞书桥接 imbot 安全 agent,本次随 5.11.4 ship 给 Win 用户(对齐 Mac 5.11.1)
- `win-ship-imbot-5.11.2` / `win-ship-imbot-5.11.3`(失败 ship,均因本 bug 撤回)— 5.11.4 是这俩的成功重做
- `win-ship-local-pack-switch`([changelog](../win-ship-local-pack-switch/3-changelog.md))— 本地打包流程,5.11.4 是第三次实战(前两次撞非确定性 bug 撤回)

## 后续 backlog

- 🔴 **vite chunking 非确定性根因深查**:在 `packages/desktop/vite.config.ts` 加 `output.manualChunks` 显式分块策略,or 调研 vite 7.1.4 是否有 known 非确定性 issue
- 🔴 **SDK falsy-error fallback 真修**:`packages/sdk/js/src/v2/gen/client/client.gen.ts` 102/220 行换 `finalError || new Error("Empty fetch error")` 给 castError 一个有效 Error,避免 `{}` 抛出
- 🟡 **5.11.4 → 5.11.5 干净 rebuild**:下次 ship 时 rebuild bundle 让 5.11.4 真正烧进 UI 版本号,消除 mismatch

## R4 / 上游侵入 / 测试

- 0 R4 override(纯 ship chore)
- 0 上游侵入
- 无新增单测

## 回退方法

```sh
git revert <merge-commit>
```

回退后:
- installer-versions.json + .iss + installer-versions.md 三档回到 5.11.2(dev tip 状态)
- 已发 GitHub Release / Gitee Release 需手动 delete
- user 已装 5.11.4 不受影响(数据目录共用,可手动装回 5.10.1 或更老)
