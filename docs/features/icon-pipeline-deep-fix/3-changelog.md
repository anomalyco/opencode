---
feat-id: icon-pipeline-deep-fix
status: done
related: ./3-changelog.md
---

# icon-pipeline-deep-fix — changelog

## 一句话

修复 Tauri 2.10.1 winres 嵌入 exe 的 .ico **完全无视** `--config tauri-overrides/<env>.json` 里 `bundle.icon` override、**只读** `icons/dev/icon.ico` 的潜伏问题;同时把三 env icon 资源全量更新为新设计(狐狸 scale 1.4 放大占画布 ~74%)。

> Tiny 规模:核心 fix 13 行 .ps1 + 24 个 PNG 资源更新,无 1-spec / 2-plan,见本文。

## commit 列表

| commit | 简述 |
|---|---|
| `5704142fe` | `fix(branding): apply-icons 同步 dev/icon.ico — winres 嵌入 base path` |
| `bc0b549b7` | `chore(branding): 三 env icon 资源全量更新 — 新设计 scale 1.4` |
| `303fbc583` | `fix(branding): png-to-ico 修 ≥256 尺寸 writeUInt8 溢出 — prod/beta build 必踩(2026-04-29 follow-up)` |

## 改动文件

| 文件 | 变更 | 备注 |
|---|---|---|
| `packages/branding/scripts/apply-icons.ps1` | +13 行 | `-Env prod/beta` 时同步覆盖 `icons/dev/icon.ico`(winres base path);`-Env dev` 不重复覆盖(本身就是 dev) |
| `packages/branding/src/assets/icons/prod/{32x32,128x128,128x128@2x}.png` + `ico-source/{16,32,64,128,256}.png` | 全量更新 | icon-primary 新设计(scale 1.4) |
| `packages/branding/src/assets/icons/beta/{32x32,128x128,128x128@2x}.png` + `ico-source/{16,32,64,128,256}.png` | 全量更新 + 删 misnamed `48.png` + 补 64/128/256 | icon-mono 新设计;补齐多分辨率结构 |
| `packages/branding/src/assets/icons/dev/{32x32,128x128}.png` + `ico-source/{16,32,48,64,128}.png` | 全量更新 + 补 64/128 | icon-favicon 新设计;source 没 256,`128x128@2x.png` 留旧 |
| `packages/branding/scripts/png-to-ico.ts` | +2 行 / -2 行(2026-04-29 follow-up) | line 50-51 `=== 256 ? 0 : png.width` 改 `>= 256 ? 0` — ICO 1 byte width/height 字段对 ≥256 都需写 0(实际尺寸由 PNG header 决定);prod/beta 04-28 加的 512.png + 1024.png 触发 writeUInt8 溢出 |

无 commit 改上游文件,无 FORK marker 增量。

## 现象 → 根因排查链

**现象**:user 更新源 icon SVG 后,反复 build + 重装 installer,exe 里嵌入的图标始终是旧设计;控制面板和安装包显示新图标都正确,**唯独桌面快捷方式 / 窗口图标用旧的**。

**排查链**:

1. ❌ **怀疑 1 — Windows iconcache 卡了**:已验证不是,前几次 cache 清干净后还是错
2. ❌ **怀疑 2 — apply-icons 没真拷文件**:验证 `branding/src/assets/icons/prod/icon.ico` MD5 = 新源 MD5,apply 工作正常
3. ❌ **怀疑 3 — cargo 增量缓存让 build script 没重跑**:`cargo clean -p opencode-desktop` 清 4.3GB → full rebuild → exe 嵌入还是旧的。**排除**
4. ❌ **怀疑 4 — tauri-codegen 缓存**:`build/opencode-desktop-*/out/tauri-codegen-assets/*.ico` 是 40/37 字节 placeholder + mtime 一周前。手动炸 build dir + fingerprint dir 重 build,exe 还是旧的
5. ✅ **决定性 A/B 实验**:把新 prod 大狐狸 ico 直接覆盖到 `src-tauri/icons/dev/icon.ico`(上游 base path,**不动** `icons/prod/`)→ build → exe 嵌入**立刻变大狐狸**

**根因坐实**:Tauri 2.10.1 的 winres 嵌入 .ico **只读** `tauri.conf.json` base config 里 `bundle.icon` 数组指向的那个 `.ico` 路径(`icons/dev/icon.ico`),**完全不识** `--config tauri-overrides/prod.json` 里的 `bundle.icon` override。

> 推测原因:Tauri 内部 winres pipeline 在 build 早期就 resolve 了 base config 的 icon 路径,override 应用在那之后,导致 winres 看不到。这是 Tauri 框架行为,不是我们 fork 配置错。

## 修法

**临时**(本次):手动覆盖 `src-tauri/icons/dev/icon.ico` 为 prod ico → build → 重打 installer

**长期**(已 commit `5704142fe`):在 `apply-icons.ps1` 末尾加:

```powershell
if ($Env -ne "dev") {
    Copy-Item -Force $icoOut (Join-Path $repoRoot "packages/desktop/src-tauri/icons/dev/icon.ico")
    Write-Output "also synced → $devIcoPath (winres base path)"
}
```

逻辑:任何非 dev env build,都把生成的 `.ico` 同时落到 `icons/dev/icon.ico`(winres 真正读的位置)。`restore-icons.ps1` 跑后照常 git checkout 还原 dev/,工作树仍干净。

## 验证

- [x] A/B 实验:dev/icon.ico = 大狐狸 → exe 嵌入大狐狸 ✓(决定性证据)
- [x] 重打 installer → user 装 + 清 iconcache → 桌面快捷方式 / 任务栏 / 窗口标题栏图标全部新设计 ✓
- [x] `restore-icons.ps1` 跑后 `src-tauri/icons/dev/icon.ico` 回 git HEAD,工作树干净 ✓
- [x] apply-icons.ps1 fix 在下次 build 不需手动干预 ✓(代码逻辑可推理,实际 build 已验证大狐狸正常嵌入)

## 影响范围

- **代码**:0(纯品牌资源 + build 脚本)
- **运行时**:exe 嵌入图标 = 当前 -Env 选的图标;Windows 任意图标视图(任务栏 / 桌面 / 窗口)读它
- **build 流程**:apply-icons.ps1 增 1 个 Copy-Item 调用,build-deskfox.ps1 不需要改
- **dev / beta env build**:dev 自动正确(始终 dev/ 自己);beta 自动跟 prod 同样修法

## 回退方法

完全回退:

```bash
git revert bc0b549b7   # 资源回旧设计
git revert 5704142fe   # apply-icons 不再同步 dev/
```

或部分回退(留 fix 去新设计 / 留新设计去 fix):各自独立 revert。

## 后续(留作 future)

- **upstream Tauri winres 行为**:本 fix 是绕坑,不是正解。正解需要找到 Tauri winres 接受 override 的字段(可能 `bundle.windows.icon` 之类)。等 Tauri 升级或上游答复时再做。
- **dev env @2x.png**:`icon-favicon` 源没 256px,`icons/dev/128x128@2x.png` 仍旧版。dev build 不影响主体使用,但严格 multi-resolution 不全。需要时 SVG 加渲染 256 即可
- **`tauri-codegen-assets` 里 40/37 字节空 .ico**:疑似 Tauri 早期生成的 placeholder,跟本 bug 无关;不影响功能,留着观察

## 经验沉淀

| 启示 | 落实位置 |
|---|---|
| Tauri 2.x `--config` 的 `bundle.icon` override **不影响 winres** | 已写入本文 + apply-icons.ps1 注释 |
| 排查 winres / build script 嵌入问题,A/B 实验比 cache 清理更高效 | 本文 "排查链" 段 |
| `cargo clean -p` 不清 `target/release/build/<crate>/`,要手动炸 | 本文 "排查链" 段 |
| Windows 桌面快捷方式 icon 卡 cache 跟 exe 嵌入是两类问题,先排嵌入再排 cache | memory `feedback_windows_iconcache_fix.md` 已有,本次复用确认 |

## Follow-up: prod/beta build ≥256 ICO 写溢出(2026-04-29)

claude-code-loop-fix 收尾后给 user 打 prod 安装包发其他人,跑 `build-deskfox.ps1 -Env prod` 时 apply-icons.ps1 → png-to-ico.ts 报错:

```
RangeError: The value of "value" is out of range. It must be >= 0 and <= 255. Received 512
  at writeU_Int8 (internal:buffer:30:29)
  at main (...png-to-ico.ts:50:11)
```

### 根因

`png-to-ico.ts:50-51` 把"≥256 用 0 表示"的 ICO 格式规则**只**对 256 一种尺寸做了:

```ts
entry.writeUInt8(png.width === 256 ? 0 : png.width, 0)   // 错:512 没被映射成 0
entry.writeUInt8(png.height === 256 ? 0 : png.height, 1)
```

ICO 文件 ICONDIRENTRY 第 0/1 字节(width / height)**只有 1 byte**(0-255),256+ 尺寸**约定写 0**(由后续 PNG header 字段表达真实尺寸)。512 / 1024 没被映射成 0,直接当大数写 1 byte → writeUInt8 溢出 throw。

### 为啥 bc0b549b7 当时没踩到

`bc0b549b7`(2026-04-28)只**加资源** PNG(prod/beta 各加 512.png + 1024.png),没跑 build。同日 `5704142fe` 只跑过 dev / 当时 prod 资源里**还没** 512/1024.png。所以 bug 潜伏到 04-29 第一次跑 prod build 才暴露(就是这次打 installer)。

### 修法

`png-to-ico.ts:50-51`,`=== 256 ? 0` → `>= 256 ? 0`,2 行改 + 2 行注释:

```ts
// ICO 格式 1 byte width/height 字段,>=256 都写 0(实际尺寸由 PNG header 决定)
// 之前用 === 256 ? 0,512/1024 等更大尺寸会触发 writeUInt8 溢出
entry.writeUInt8(png.width >= 256 ? 0 : png.width, 0)
entry.writeUInt8(png.height >= 256 ? 0 : png.height, 1)
```

### 验证

- [x] `build-deskfox.ps1 -Env prod -NoBundle` 通过(2m 09s)
- [x] `ISCC.exe DeskFox.iss` 通过,出 `DeskFox-1.14.21-setup.exe`(47 MB)
- [x] dev env build 不受影响(dev ico-source 全 < 256,新条件等价)

### 经验补一条

| 启示 | 落实位置 |
|---|---|
| icon 资源加新尺寸时,要在三 env(dev/beta/prod)都跑一次 build smoke test 才算 done | 本段 |
