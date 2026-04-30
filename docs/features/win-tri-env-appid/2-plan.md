---
feat-id: win-tri-env-appid
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# Windows 三档 AppId — 实施计划

> 实施日期:2026-04-30
> 上下文:`分支策略-v2` 切换完成后第一笔 feat,在 dev 主干上直接做(v2 模型下短命 feat 也可省 git 分支)。

---

## 一、动作清单(实际执行顺序)

| # | 动作 | 文件 / 工具 |
|---|---|---|
| 1 | 调研当前 .iss / pack-installer.ps1 / build-deskfox.ps1 / tauri-overrides 结构 | 读 4 个文件 |
| 2 | 生成 2 个新 GUID(beta / dev) | PowerShell `[System.Guid]::NewGuid()` |
| 3 | 改 `DeskFox.iss` — 加 `#if AppEnv` 三档分支 | 加 27 行 |
| 4 | 改 `pack-installer.ps1` — 加 `-Env` 参数 + ISCC `/D` 注入 + 产物路径按 env 选 suffix | +15 / -3 行 |
| 5 | 验证 .iss 预处理器结构 | 人眼检查 #if/elif/else/endif 平衡 + GUID 格式 |
| 6 | 改 `应用身份-命名规则.md` — 填实际 GUID 进 Win 三档表 | 治理文档同步 |
| 7 | 写 1-spec / 2-plan / 3-changelog 三文档 | 本目录 |
| 8 | 更新 `docs/features/INDEX.md` | 加 win-tri-env-appid 行 |
| 9 | typecheck + commit | `bun run typecheck` 全过 → 一笔 commit 落账 |

---

## 二、决策轨迹(开发中遇到的判断)

### 2.1 为什么不立独立 git 分支?

按规范 v2 改动规模分级:
- 规模:Medium(50-500 行,本次 ~200 行,含文档)
- v2 模型下"功能分支:`feat/<name>` 短命,合 dev 后即退役"

但本笔只是 2 个文件的代码改动 + 文档,实施可一次性完成,无中间状态。直接在 dev 上单笔 commit 即可,不需要"合到 dev"这个动作。短命 feat 分支适合**多笔 commit、可能要回退、需要协作 review** 的场景,本笔不符合。

### 2.2 GUID 怎么选

- **prod 沿用** `{F9F6F6C5-...}` — 已在 line 19 注释明确说"AppId 一旦发布禁止改"
- **beta / dev 新生成** — 用 `[System.Guid]::NewGuid()` 一次性生成两个,直接写进 .iss 锁死。**生成后再没生成第二次,避免被随机数迷惑**

### 2.3 命名 `DeskFox-Beta-` 中划线 vs 空格

参考 macOS 端 pack-installer.sh 已有约定:产物 `.dmg` 文件名用空格(因为 Mac 命令行处理空格容忍度高,且 `productName` 本身带空格)。

但 Windows 命令行处理空格需要双引号,且 Inno Setup 的 `OutputBaseFilename=DeskFox Beta-...` 在 ISCC 输出时也会处理空格成 `_` 或者直接报警。所以 Win 端 `OutputBase` 用中划线连接(`DeskFox-Beta`),`AppName`(显示名)仍用空格(跟 mac `productName` 一致)。

### 2.4 是否要让 N 序列按 env 拆?

不拆。理由见 1-spec.md 4.4 节。

### 2.5 `pack-installer.ps1` 的 envSuffix switch

写法上选了 `switch ($Env)` 而不是 `(Get-Culture).TextInfo.ToTitleCase($Env)`,因为后者依赖系统 culture(zh-CN 下 `dev` → `dev` 不变,en-US 下 → `Dev`)。`switch` 三档枚举死路明确,不依赖运行环境。

### 2.6 ISCC 预处理结构验证踩坑

最初想跑 `ISCC.exe /Qp /DAppEnv=prod DeskFox.iss` 做"语法检查"。但 ISCC 没有 dry-run 模式,Preprocessing 通过后会立刻进入 Compiling [Files] 段,那里需要 release 目录的实际 exe 存在,卡在那里。

最终采用方式:**人眼检查 .iss 结构**(#if/#elif/#else/#endif 平衡 + GUID 字面格式 + `{#...}` 引用都已定义)+ 后续用户实际 pack 时验证。如有问题,本笔可单独 revert(不影响 dev 主干其他工作)。

---

## 三、未结尾巴

| 事项 | 性质 |
|---|---|
| 用户实测三档 pack 产物正常装上 + 同机共存 | 验收测试,本 commit 后由用户跑 |
| 后续如加 `nightly` 第四档 | 加新 GUID + `#elif AppEnv == "nightly"` 分支即可,本架构已留好扩展位 |

落账细节见 [`./3-changelog.md`](./3-changelog.md)。
