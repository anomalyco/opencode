# opencode-fork — Claude Code 协作约束

> anomalyco/opencode 的衍生项目,目标:改造成非编码人员可用的日常工作工具。
> 此文件是 fork 自加,Claude Code 启动时自动加载。**任何在本项目工作的 agent 必读必守。**
>
> **上游 owner 历史**:`anomalyco/opencode` 即原 `sst/opencode`(GitHub 自动 redirect)。2026-05-24 user 拍板对齐:讲"opencode 官方/上游"一律指 anomalyco/opencode;forward-looking 文档统一改名,历史 archive(`docs/history/` / 旧 feat changelog / `docs/STATUS.md` / `改动日志.md` / `docs/installer-versions.md`)保留原 `sst/opencode` 字眼作为历史快照。

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
- **品牌字符串**(productName/identifier)→ 走 `packages/branding/tauri-overrides/{dev,beta,prod}.json` override(不改 base `tauri.conf.json`)。**应用身份命名规则**:Mac Bundle ID 三档(prod=`ai.deskfox.app` / beta=`...beta` / dev=`...dev`,reverse-DNS 与 `deskfox.ai` 域名对齐);Win AppId 三档独立 GUID(prod 锁死 `{F9F6F6C5-...}` / beta `{86413DCA-...}` / dev `{4C5D29F2-...}`,2026-04-30 落地 commit `21c3f80f9`),详见 [`docs/governance/应用身份-命名规则.md`](docs/governance/应用身份-命名规则.md)
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

### R5. 测试纪律(2026-05-07 立,渐进生效;v2 双清单 2026-05-07)

- **新 feat 必须含至少 1 个测试**(Medium ≥ 1 e2e 或 3 unit;Large ≥ 2 e2e + 5 unit)
- **修 bug 必须先写复现测试**,fix + 测试**同一 commit**,message 标 `[bug-repro: <一句话>]`
- **Tiny 改动 < 50 行 / docs / 配置 / 品牌资源 / R3 override / 上游 sync merge** 不强制(详见例外清单)
- **关键模块双清单**(v2):
  - **Logic 清单**(纯计算 / utility / helper)→ 单元测试**行覆盖率 ≥ 80%**
  - **View 清单**(SolidJS 组件 / view layer)→ **至少 1 个 e2e happy path**
  - 加入 / 移出双清单靠 user 拍板;helper extract 模式正式承认 — 组件抽出的 helper 进 Logic 清单,原组件留 View 清单
  - View 清单硬门槛**等 e2e 基础设施 setup 后**生效(opencode sidecar 或前端 mock mode)
- **测试 fail 绝不 retry / skip 一键掩盖** — flaky 测试 48 小时内修或移除
- **第 1 期实施时机由 user 单独决定**,本规则现在落地但 pre-push hook 守门待第 1 期接入

完整规范:[`docs/governance/自动化测试规范.md`](docs/governance/自动化测试规范.md)
长期规划(5 期分级 + KPI):[需求池](file:../OPENCODE-PLAN/需求池/自动化测试-长期规划.md)

### R6. 网络监听安全(2026-05-10 立,feishu-server-loopback-bind 教训)

- **任何新增 `Bun.serve` / `*.listen()` 必须显式指定 loopback hostname**(`127.0.0.1` / `localhost`)
- 默认 `0.0.0.0` 监听 = 暴露端口到所有网卡(LAN/公网)= Win Firewall 弹窗 + 安全风险(同 WiFi 任何人可探测端口,即使有 basic auth 攻击面也不该开)
- 例外:仅当确实需要公网监听(罕见),走 `[network-bind-public: <理由>]` commit message tag override
- pre-commit hook §4.5 自动拦截违规(scan staged 新增 `Bun.serve(` / `.listen(<num>)` 模式 + 同文件搜安全标记 → 失败则 block)
- 测试文件(`__tests__/` / `.test.` / `.spec.`)豁免

起源:2026-05-10 user 反馈装完 DeskFox 弹"Bun 是否允许公共网络访问"对话框,审计发现 plugin server `Bun.serve()` 缺 hostname 默认绑 0.0.0.0,LAN 任何人能扫到端口。修法 1 行(加 `hostname: "127.0.0.1"`),并立此规则 + commit 闸防止再犯。

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

> **2026-04-28 起**:opencode-plan 仓所有 fork 相关文档已迁入本仓 `docs/`,与上游 anomalyco/opencode 0 路径冲突(上游无 `docs/` 目录)。
> opencode-plan 仓只剩 prototype 原型代码 + 历史快照,不再维护。
> 完整导航见 [`docs/README.md`](./docs/README.md)。

| 文档 | 新路径 | 作用 |
|---|---|---|
| 治理总纲 | `docs/governance/fork-跟随升级与协作规范.md` | 完整原则 / 规范 / SOP |
| 改动规则细则 | `docs/governance/改动规则.md` | 白黑名单 / baseline tag / diff 阈值 / hook 体系 |
| **上游 merge SOP**(本次新增) | `docs/governance/UPSTREAM-MERGE-GUIDE.md` | 与 anomalyco/opencode 合并的完整 checklist + 自动化辅助 |
| DeskFox 品牌替换 | `docs/governance/DeskFox-品牌替换.md` | 已落地 |
| 应用身份命名规则 | `docs/governance/应用身份-命名规则.md` | 两端规则统一:Mac Bundle ID 三档(已落地,与 `deskfox.ai` 域名对齐)+ Win AppId 三档(已落地 2026-04-30,commit `21c3f80f9`),merge upstream 维护规则 |
| **版本号与发布渠道规范** | `docs/governance/版本号与发布渠道规范.md` | 3-tier 体系:Tier 1 稳定版(prod 无后缀)/ Tier 2 预览版(dev `-dev` 后缀,可对外发)/ Tier 3 本地测试版(raw exe 不发布);版本号 `YYYY.M.D.N[-env-suffix]` + N 序列双维度独立(平台 × env);Tier 1/2 ship 完整 SOP |
| **双端协作 SOP** | `docs/governance/双端协作-SOP.md` | feat 分支生命周期(短命,合 main 即销毁,新项目新名字)+ Win/Mac 同时开发流程(rebase / merge / 删分支)+ 协作约定 |
| **imbot 定制指南** | `docs/governance/imbot-定制指南.md` | DeskFox 用户怎么编辑 `~/.opencode/imbot-workspace/.opencode/agent/imbot.md` 定制 IM 桥接 bot 能力(2026-05-25 ADR 落地后的 user-facing 配套教程);架构决策详 `OPENCODE-PLAN/架构决策/im桥接-imbot单一架构.md` |
| 跨平台协作 | `docs/governance/跨平台协作.md` | 三端环境(目前已收口 Win) |
| 数字签名问题 | `docs/governance/数字签名问题.md` | installer 不签名决策 |
| 改动索引 | `本仓 改动日志.md` | feature 索引(规范 v2 起,详细在 docs/features/) |
| 项目概览 | `docs/PLANNING-OVERVIEW.md` | 立项 + 路线 + 当前快照 |
| 实施进度 | `docs/STATUS.md` | 分 Phase + 时间轴 + 里程碑 |
| 早期调研 | `docs/history/规划-archive/01..11-*.md` | Phase 0-2 用过现已超越,锁死保留 |
| 沟通历史 | `docs/history/沟通记录.md` | 关键决策时刻对话日志 |

## 默认仓库约定(分支策略 v2,2026-04-30 起;主分支 dev → main,2026-05-21 起)

> **分支名 ≠ env 代号**:主分支叫 `main`(代码集成),installer channel 仍叫 `prod/beta/dev`(发布渠道)。两个维度名字不撞,见下文。
> 历史 commit / 改动日志 / docs/history 里仍出现 "dev 分支"是 2026-05-21 前的称呼,语义指向当前 `main`,**不要回填改名**。

### 🚨 三条铁律(2026-05-08 立,绝对约束;2026-05-21 dev → main)

1. **永不直接在 main 上开发** — 任何代码改动必须先开 feat 分支(`feat/<name>` kebab-case),build script / 配置 / 一行 fix 都不例外
2. **所有合并到 main 必须 user 同意** — agent 不得自动 `git merge` / `git rebase` 影响 main 内容,先请示再执行
3. **所有 main → 远端 push 必须 user 同意** — agent 不得自动 `git push origin main` / `git push origin --tags`,先请示再执行

每层把关给 user 一次刹车机会。例外:开 feat 分支 / feat 分支内 commit / feat 分支 push origin(私有 work,不影响 main)agent 可自主。

- **默认分支**:`main` — **单一稳定主干**,不自动跟随 `upstream/dev`(上游主分支还叫 dev,这是 anomalyco/opencode 命名,跟我们解耦),合上游是主动决策(不是被动跟随)
- **功能分支**:`feat/<name>` — **一次性容器**,合 main = 销毁,**新项目用新名字,绝不复用**。`<name>` **全小写 + kebab-case**(中划线分词,行业常规),中英混合 OK 但英文部分必须小写。详见 [`docs/governance/双端协作-SOP.md`](docs/governance/双端协作-SOP.md)(feat 生命周期 + 命名规范 + Win/Mac 双端协作流程)
- **🌿 开任何新分支前必先拉最新 main**(硬规则,无例外):`git checkout -b feat/<name>` / `chore/<name>` / `sync/<日期>` 之前,**必须**先 `git checkout main && git pull --rebase`。理由:Win/Mac 双端协作 + 远端持续推进,基于 stale main 起 feat = 注定 rebase / 大概率冲突。实施超 30 min 时,合 main 前再 `git fetch && git log main..origin/main` 确认远端没新动。
- **上游同步**:临时分支 `sync/upstream-<日期>`,merge 完即删
- **三档 installer channel**(prod / beta / dev):靠 **build 参数**切换(`pack-installer.* -Env <env>`),**不靠分支** — 同一 commit 可出三档产物。**"dev" 在 channel 维度 = 预览版**(开发包,可对外发,稳定性低于 prod),跟分支名 `main` 完全独立的命名空间
- **tag 命名**:
  - `upstream-baseline`(同步起点)/ `pre-rebase-<日期>`(rebase 前)/ `pre-strategy-v2-<日期>`(关键切换兜底)
  - `ship-<env>-<版本>`,例 `ship-prod-2026.4.29.2`
- **远端**:
  - `origin` → GitHub 主仓(开源协作主平台,所有 PR / Issue / Star 在这里;国内 push 走 SSH + 代理)
  - `gitee` → Gitee 镜像(国内用户快速 clone;Gitee 后台定时从 GitHub 自动同步,无需手动 push)
  - `upstream` 只读指 anomalyco/opencode

> 完整模型与切换逻辑见 [`docs/features/分支策略-v2/1-spec.md`](docs/features/分支策略-v2/1-spec.md)。

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
  - `-Env dev|beta|prod` 三档 installer channel(平时验证用 `dev` 这档,跟分支名 `main` 无关);`-NoBundle` 跳过 NSIS bundler(SignTool 没装时用,不影响 exe)
  - **禁止**直接跑 `bun run --cwd packages/desktop tauri build`,那会出 `OpenCode.exe`,违反品牌规范
- **改完不起 tauri dev mode(`bun dev`),直接 build release exe 验证**(WebView2 + Tauri 在 dev mode 下行为可能与 release 不一致)
- **build 前必须先杀进程**:tauri build 会被运行中的 `DeskFox.exe` / `opencode-cli.exe` 锁文件导致 PermissionDenied。任何 release build 前**无条件**先执行,不询问 user:
  ```powershell
  Get-Process -Name DeskFox,OpenCode,opencode-cli -ErrorAction SilentlyContinue | Stop-Process -Force
  ```
  (兼容历史残留的 `OpenCode.exe`)。user 会自己重开新版 exe 验证。

## 健康指标(季度自查)

| 指标 | 目标 |
|---|---|
| **上游侵入率** = 修改上游文件数 / 总文件数 | < 5% |
| **漂移 commit 数** = `main..upstream/dev`(我们主分支 main / 上游 anomalyco/opencode 主分支仍叫 dev)| ≤ 100 |
| **override 累计笔数**(按 commit 算) | 每季 ≤ 2 笔 |

> 上游侵入率:纯新增 fork-only 文件不算侵入(P1 鼓励),只算改上游文件占比。新文件多反而稀释比例,是健康信号。

当前快照(2026-04-26):上游侵入率 ~3% / 漂移 3 / override 1 笔 — **健康**。

## 规范修订记录

- **v3.1(2026-05-07,选项 C)**:R5 决策 2 单清单 → **双清单**(Logic 行覆盖 80% + View e2e ≥ 1 happy path)。起源:D 系列实施(D1 / D2)发现 SolidJS 组件文件用 unit 测无意义,helper extract 模式自然形成。把这条结构性区分写进规则,长期防止 view layer 测试空白。详见 `docs/governance/自动化测试规范.md` v2 修订段。
- **v3(2026-05-07)**:R5 测试纪律新增(决策 1/2/3/4/5 一次性固化)。新 feat 必带测试 + 修 bug 必先写复现测试 + 关键模块覆盖率 ≥ 80% + 70/20/10 金字塔比例 + Claude 自审起步。详见 `docs/governance/自动化测试规范.md`。**只定纪律不启动开发**,第 1 期实施时机由 user 单独决定。
- **v2(2026-04-27)**:三文档分离(spec/plan/changelog 各自独立) + diff 阈值 200→500 + sprite/types 出黑名单 + commit message 加 `[feat: <feat-id>]` tag。理由见 `docs/features/规范-v2/1-spec.md`(略,首笔 v2 commit 同时落地)。
- **v1(2026-04-15)**:R1-R4 / P1-P5 / 健康指标基线建立(见 09-改动规则.md)。
