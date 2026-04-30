# opencode-fork — Claude Code 协作约束

> sst/opencode 的衍生项目,目标:改造成非编码人员可用的日常工作工具。
> 此文件是 fork 自加,Claude Code 启动时自动加载。**任何在本项目工作的 agent 必读必守。**

## 元原则

**稳定 > 简洁 > 一切。** 只服务三件事:① 跟随上游 opencode 升级 ② 满足自有开发需要 ③ 维护成本最低。

**绝对单一**:一套界面 / 一套规范 / 一种用户视角。**不分层、不双套、不双轨**,不区分开发者 vs 业务用户。

任何"是否要新加规则 / 原则 / 文档章节 / 检查项"提案,先答"是不是非加不可,有没有更轻方案"。**避免业务无限扩大,避免文档无限膨胀。**

## 硬约束(写代码前必读)

### R2. 改上游文件必加 FORK marker
- 单点改:`// FORK: <reason> <YYYY-MM-DD>`
- 多行改:`// FORK-BEGIN: <reason>` ... `// FORK-END`
- 例外:仅追加依赖到 `package.json` / `Cargo.toml` 不需要 marker

### R3. 三类 hardcode 禁令
- **品牌字符串**(productName/identifier)→ 走 `packages/branding/tauri-overrides/{dev,beta,prod}.json` override(不改 base `tauri.conf.json`)。**应用身份命名规则**:Mac Bundle ID 三档(prod=`ai.deskfox.app` / beta=`...beta` / dev=`...dev`,reverse-DNS 与 `deskfox.ai` 域名对齐);Win AppId 三档(prod GUID 锁死、beta/dev 待落地 `feat/win-tri-env-appid`),详见 [`docs/governance/应用身份-命名规则.md`](docs/governance/应用身份-命名规则.md)
- **主题色/字号** → 自己入口 CSS `:root { --primary: ... }` 覆盖,**不改** `packages/ui/` 内部 token
- **icon/启动图资源** → 自己目录放新资源 + build 脚本替换,**不直接覆盖** `packages/desktop/src-tauri/icons/`

存放位置:统一 `packages/branding/`(已建)。

### R1. 新功能"三级跳"决策
```
1. 能完全在新文件做? → 走新文件,结束
2. 不能 → 新文件 + 上游加 ≤5 行接口注入
3. 必须深度改上游? → 改前先评审 1/2 走不通的理由
```
新增行数 / 改上游行数 ≥ 3:1 是健康基线。

### R4. 黑名单 override(团队双签 / single-person AI 二次确认)
改黑名单文件需:① commit message 标 `[override-blacklist: <理由>]` ② 改动日志逐文件论证"为什么 wrapper 替代不可行" ③ 二次确认:**团队场景**第二人 review;**single-person 场景**实施 agent commit 前出复核报告(wrapper 不可行性 / 风险评估 / 改动日志论证 三项)→ user 审 → 点头 commit。无冷却期,复核嵌在测试通过 → commit 间隙。
**配额按 commit 笔数算**:一笔 commit 触动多个黑名单文件、同时挂多个 override 标都算 1 笔。

## 五条设计原则(背后逻辑)

- **P1 隔离**:新功能尽量放新文件,改上游是例外
- **P2 配置化**:换皮性质改动走配置 / CSS 变量
- **P3 适配层**:对上游内部 API 的依赖统一穿过 adapter
- **P4 可逆**:一笔 commit 干一件事,可单独 git revert
- **P5 显性化**:改上游必加 FORK marker(R2 是它的具体执行)

## 完整文档链路(规范 v2,2026-04-27 起)

### 三文档结构(每个 feature 一份目录)

```
docs/features/<feat-id>/
├── 1-spec.md       # 需求 + 验收标准 + 架构选型(签名后锁版,只补不改)
├── 2-plan.md       # 实施计划 + 决策轨迹(开发中实时追加 note,记录踩坑/方案推翻)
└── 3-changelog.md  # 实际改动 + commit hash 列表 + 行数 + 影响范围 + 回归测试 + 回退方法(commit 后填)
```

`<feat-id>` 命名:`getbot-接入` / `editable-file-viewer` 等(中英混合 OK,语义清晰即可)。
三个文档头三行**必须**统一标:`feat-id: <id>` / `status: spec | in-progress | done` / `related: ./1-spec.md ./2-plan.md ./3-changelog.md`。

总索引 `docs/features/INDEX.md` 列出所有 feat-id + status,一眼看完整 feature 池。

### commit message 格式

`<type>(<scope>): <一句话> [feat: <feat-id>]`

例:`feat(provider): GetBot 接入 — 热门首位 + 推荐标 [feat: getbot-接入]`。
grep `[feat: <id>]` 能反查到对应文档。

### 改动规模分级(决定三文档要写多少)

| 规模 | 触发条件 | 三文档要求 |
|---|---|---|
| **Tiny** | <50 行 / 1 文件 / bug fix 或文案 | 只写 3-changelog.md(简版 1-2 段),1-spec / 2-plan 可省 |
| **Medium** | 50-500 行 / 单一主题 | 三文档全要,1-spec / 2-plan 各 1 页够 |
| **Large** | >500 行 **或** 触动 ≥5 个上游文件 | 三文档详细,**1-spec 改前 user 审签** |

### 老的"改动日志"角色调整

`本仓 改动日志.md` 不再存详细条目,改为**索引表**:每个 feature 一行,指向 `docs/features/<feat-id>/3-changelog.md`。历史条目 #1-#12 保留不动。

### 规划 / 治理 / 历史档案 — 全部收口于 `docs/`

> **2026-04-28 起**:opencode-plan 仓所有 fork 相关文档已迁入本仓 `docs/`,与上游 sst/opencode 0 路径冲突(上游无 `docs/` 目录)。
> opencode-plan 仓只剩 prototype 原型代码 + 历史快照,不再维护。
> 完整导航见 [`docs/README.md`](./docs/README.md)。

| 文档 | 新路径 | 作用 |
|---|---|---|
| 治理总纲 | `docs/governance/fork-跟随升级与协作规范.md` | 完整原则 / 规范 / SOP |
| 改动规则细则 | `docs/governance/改动规则.md` | 白黑名单 / baseline tag / diff 阈值 / hook 体系 |
| **上游 merge SOP**(本次新增) | `docs/governance/UPSTREAM-MERGE-GUIDE.md` | 与 sst/opencode 合并的完整 checklist + 自动化辅助 |
| DeskFox 品牌替换 | `docs/governance/DeskFox-品牌替换.md` | 已落地 |
| 应用身份命名规则 | `docs/governance/应用身份-命名规则.md` | 两端规则统一:Mac Bundle ID 三档(已落地,与 `deskfox.ai` 域名对齐)+ Win AppId 三档(待落地 `feat/win-tri-env-appid`),merge upstream 维护规则 |
| 跨平台协作 | `docs/governance/跨平台协作.md` | 三端环境(目前已收口 Win) |
| 数字签名问题 | `docs/governance/数字签名问题.md` | installer 不签名决策 |
| 改动索引 | `本仓 改动日志.md` | feature 索引(规范 v2 起,详细在 docs/features/) |
| 项目概览 | `docs/PLANNING-OVERVIEW.md` | 立项 + 路线 + 当前快照 |
| 实施进度 | `docs/STATUS.md` | 分 Phase + 时间轴 + 里程碑 |
| 早期调研 | `docs/history/规划-archive/01..11-*.md` | Phase 0-2 用过现已超越,锁死保留 |
| 沟通历史 | `docs/history/沟通记录.md` | 关键决策时刻对话日志 |

## 默认仓库约定

- 默认分支:`dev`(跟随 `upstream/dev`)
- 功能分支:`feat/<name>`,例 `feat/editable-file-viewer`
- baseline tag:`upstream-baseline`(同步起点),`pre-rebase-<日期>`(rebase 前)
- 远端:`origin` 双 push gitee + github;`upstream` 只读指 sst/opencode

## 产品名

**软件叫 DeskFox**(2026-04-27 起定名)。任何用户可见文案 / 文档 / commit message / build 产物都用 "DeskFox"。
**不是** "OpenCode"(那是上游) / "OpenCode Desktop" / "OpenCode Dev"。
源码内部 package 名 / binary 标识仍可保留 `opencode-*`(那是上游 contract,改了上游会冲突,品牌通过 tauri-overrides 注入)。

## 验证约定

- **typecheck**:`bun run typecheck`(monorepo 全量,turbo 缓存)
- **release exe**:**必须**走 DeskFox 品牌 wrapper,产物是 `DeskFox.exe`:
  ```powershell
  D:\project\opencode-fork\packages\branding\scripts\build-deskfox.ps1 -Env dev -NoBundle
  ```
  - 产物路径:`packages/desktop/src-tauri/target/release/DeskFox.exe`
  - `-Env dev|beta|prod` 三档(平时用 dev);`-NoBundle` 跳过 NSIS bundler(SignTool 没装时用,不影响 exe)
  - **禁止**直接跑 `bun run --cwd packages/desktop tauri build`,那会出 `OpenCode.exe`,违反品牌规范
- **改完不起 dev,直接 build release exe 验证**(WebView2 + Tauri 在 dev 模式下行为可能与 release 不一致)
- **build 前必须先杀进程**:tauri build 会被运行中的 `DeskFox.exe` / `opencode-cli.exe` 锁文件导致 PermissionDenied。任何 release build 前**无条件**先执行,不询问 user:
  ```powershell
  Get-Process -Name DeskFox,OpenCode,opencode-cli -ErrorAction SilentlyContinue | Stop-Process -Force
  ```
  (兼容历史残留的 `OpenCode.exe`)。user 会自己重开新版 exe 验证。

## 健康指标(季度自查)

| 指标 | 目标 |
|---|---|
| **上游侵入率** = 修改上游文件数 / 总文件数 | < 5% |
| **漂移 commit 数** = `dev..upstream/dev` | ≤ 100 |
| **override 累计笔数**(按 commit 算) | 每季 ≤ 2 笔 |

> 上游侵入率:纯新增 fork-only 文件不算侵入(P1 鼓励),只算改上游文件占比。新文件多反而稀释比例,是健康信号。

当前快照(2026-04-26):上游侵入率 ~3% / 漂移 3 / override 1 笔 — **健康**。

## 规范修订记录

- **v2(2026-04-27)**:三文档分离(spec/plan/changelog 各自独立) + diff 阈值 200→500 + sprite/types 出黑名单 + commit message 加 `[feat: <feat-id>]` tag。理由见 `docs/features/规范-v2/1-spec.md`(略,首笔 v2 commit 同时落地)。
- **v1(2026-04-15)**:R1-R4 / P1-P5 / 健康指标基线建立(见 09-改动规则.md)。
