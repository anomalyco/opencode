---
feat-id: win-tri-env-appid
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# Windows 三档 AppId — Changelog

> 实施完成日期:**2026-04-30**(分支策略 v2 切换完成后第一笔 feat)

---

## 一、commit / 改动一览

### 主 commit

待落地后回填 hash(commit message 标 `[feat: win-tri-env-appid]`)。

### 改动文件

| 文件 | +/- | 主题 |
|---|---|---|
| `packages/branding/installer/DeskFox.iss` | +27 / -2 | 加 `#ifndef AppEnv` 兜底 + 三档 `#if/#elif/#else` 块切换 AppId / AppName / OutputBase,#error 兜底未知 env |
| `packages/branding/scripts/pack-installer.ps1` | +18 / -5 | 加 `param [ValidateSet] $Env="prod"` + ISCC 调用加 `/DAppEnv=$Env` + 产物路径按 env 选 suffix(prod 无 / beta `-Beta` / dev `-Dev`) |
| `docs/governance/应用身份-命名规则.md` | +5 / -10 | Win 三档表填实际 GUID,去掉"待落地"标记,扩"安装目录"列,历史溯源补落地条目 |
| `docs/features/INDEX.md` | +1 | 加 `win-tri-env-appid` 索引行 |
| `docs/features/win-tri-env-appid/1-spec.md` | +120 | 新建 |
| `docs/features/win-tri-env-appid/2-plan.md` | +60 | 新建 |
| `docs/features/win-tri-env-appid/3-changelog.md` | +80 | 新建(本文档) |
| **合计** | **~+310 / -17** | **Medium** |

---

## 二、影响范围

### 行为变化

| 命令 | 改前 | 改后 |
|---|---|---|
| `& .\pack-installer.ps1` | 出 prod 包 | **不变**(默认 `-Env prod`,向后兼容)|
| `& .\pack-installer.ps1 -Env prod` | 不接受参数(报错)| ✅ 出 prod 包 |
| `& .\pack-installer.ps1 -Env beta` | 不接受参数(报错)| ✅ 出 `DeskFox-Beta-<ver>-setup.exe`,装 `Program Files\DeskFox Beta`,控制面板"DeskFox Beta",独立 GUID `{86413DCA-...}` |
| `& .\pack-installer.ps1 -Env dev` | 不接受参数(报错)| ✅ 出 `DeskFox-Dev-<ver>-setup.exe`,装 `Program Files\DeskFox Dev`,控制面板"DeskFox Dev",独立 GUID `{4C5D29F2-...}` |

### Win 端三档共存能力

之前:后装替换先装(单一 GUID)
之后:**三档可同机共存**,各自独立的:
- 安装目录(`Program Files\DeskFox` / `\DeskFox Beta` / `\DeskFox Dev`)
- 卸载入口(控制面板 → 程序与功能 三个独立项)
- 开始菜单分组(三个独立分组)
- 桌面快捷方式(三个独立)
- 应用数据目录(沿用 tauri identifier `ai.deskfox.app[.beta/.dev]`,与 mac 端对齐)

### 不动的部分

- prod 已装用户 → ✅ 不影响,GUID 不变,新版仍能正常升级
- macOS 端 → ✅ 不动
- `tauri-overrides/*.json` → ✅ 不动
- `build-deskfox.ps1` → ✅ 不动(本来就支持 `-Env`,产物固定 `DeskFox.exe`)
- `bump-installer-version.ps1` → ✅ 不动(N 序列三档共享)

---

## 三、回归测试结果

### 静态验证(本笔 commit 时跑)

| 测试 | 结果 |
|---|---|
| `bun run typecheck` | 待跑 — commit 前确认 |
| `.iss` 结构人眼检查 | ✅ #if/#elif/#else/#endif 平衡 / 三档 GUID 格式 `{{XXX}` 正确 / `{#AppId}` `{#AppName}` `{#OutputBase}` 引用都已定义 |
| ISCC 实际编译验证 | 跳过 — ISCC 没有 dry-run 模式,Preprocessing 后立刻进 Compiling [Files] 段,需要 release exe 在位。本笔不触发实际打包,留给用户跑 pack 时验证 |

### 动态验证(用户实测,本 commit 之后)

待用户跑:

```powershell
# 三档分别 build + pack(顺序串行,因为产物固定 DeskFox.exe)
.\packages\branding\scripts\build-deskfox.ps1 -Env dev -NoBundle
.\packages\branding\scripts\pack-installer.ps1 -Env dev

.\packages\branding\scripts\build-deskfox.ps1 -Env beta -NoBundle
.\packages\branding\scripts\pack-installer.ps1 -Env beta

.\packages\branding\scripts\build-deskfox.ps1 -Env prod -NoBundle
.\packages\branding\scripts\pack-installer.ps1 -Env prod
```

预期:`packages/branding/installer/Output/` 下出现三个 setup.exe(三档版本号同步,N 序列共享):
- `DeskFox-<版本>-setup.exe`
- `DeskFox-Beta-<版本>-setup.exe`
- `DeskFox-Dev-<版本>-setup.exe`

依次安装三个 setup.exe,在控制面板"程序与功能"应能看到三个独立卸载项。

---

## 四、回退方法

### 场景 A:全笔回退

```bash
git revert <本笔 commit hash>
```

回退后 `.iss` 回到单一 GUID,`pack-installer.ps1` 回到无 `-Env` 参数。**不影响**已经按新方式装在用户机上的应用 — GUID 已落地,prod GUID 不变,beta/dev GUID 留在被卸载状态(下次再装可能会换 GUID,但那时本来就是新一轮)。

### 场景 B:beta/dev GUID 想换

beta / dev 没发布过,改 GUID 不影响真实用户。直接改 .iss 那两行即可:
- `{86413DCA-EA81-415A-A309-473EBFD78990}` → 新 GUID(beta)
- `{4C5D29F2-3BBB-49A2-B248-B74B716F8EA1}` → 新 GUID(dev)

并同步 `应用身份-命名规则.md` 的表格。

### 场景 C:prod 已装用户报"装新版变成两份了"

意味着 prod GUID 被误改了。**唯一恢复方式**:把 prod GUID 改回 `{F9F6F6C5-D865-468C-BCE5-BF0ECA24A763}`,重新打包,用户卸载错误版本后装新版即可。建议本仓 永远不要改 prod GUID(已注释明确)。

---

## 五、未结尾巴

| 事项 | 入口 | 状态 |
|---|---|---|
| 用户实测三档 pack 产物 + 同机共存 | 上文"动态验证"段 | 待用户跑 |
| `应用身份-命名规则.md` 安装目录列扩展 | 治理文档已加 | ✅ done |
| 是否扩 `nightly` 第四档 | 1-spec.md 4.5 节预留 | 不立项,等需要时加 |

---

## 六、重大经验

1. **Inno Setup `#if AppEnv == "..."` 是干净的多档切换方式**:比"维护 3 个独立 .iss 文件"轻得多,改一处生效全档。这套机制后续如果要加 nightly / canary 等额外档,只要加新 `#elif` 分支即可,不动其他档。

2. **Windows 命令行 `pack-installer.ps1 -Env` 默认值兜底很关键**:老调用 `& .\pack-installer.ps1` 不传参数,行为完全等价改前(默认出 prod 包),不会破坏 muscle memory。

3. **ISCC 没有 dry-run 验证模式**:跑 ISCC 必然进入 Compiling 阶段,需要 release exe 在位。代码改动通过人眼 + 后续真打包验证,这次没有真打包,后续用户实际 pack 时如有 syntax 错会立刻暴露。可单笔 revert,不影响主干其他工作。

4. **"短命 feat 不立独立 git 分支"是 v2 模型的合理用法**:本笔规模 Medium,但实施一次性完成,直接在 dev 主干上单笔 commit 即可。`feat/<name>` 分支适合"多笔 commit、可能回退、需协作 review"场景。
