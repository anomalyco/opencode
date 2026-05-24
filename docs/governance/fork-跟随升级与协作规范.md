# 12 — fork 跟随升级与协作规范

> 目标:用最少的规则,把"长期跟住上游"和"持续自有开发"两件事的总成本压到最低。**稳定压一切。**
>
> 适用:`D:\project\opencode-fork`(anomalyco/opencode 衍生项目)

---

## Context

我们既要长期吸纳上游 anomalyco/opencode 的迭代,又要持续做自有开发(可编辑文件查看器、Markdown 渲染、媒体预览、Office 预览、文件树右键菜单、品牌定制、主题等)。这是经典的**开源衍生项目治理**问题。

调研发现:11 笔 commit 已经让 3 个上游热区文件累积 600+ 行侵入式改动:

- `packages/app/src/pages/session/file-tabs.tsx`(session UI 核心,500+ 行定制)
- `packages/ui/src/components/file-media.tsx`(媒体渲染通道,加 office-pdf-ref 分支)
- `packages/opencode/src/file/index.ts`(协议层,扩展 Content schema)

当前漂移仅 +3/-3 commit,**正是立规范的最佳窗口**。再过半年,所有改动按"想到哪改哪"累积,治理成本指数级上升。

---

## 元原则(凌驾于所有具体规则之上)

> **稳定 > 简洁 > 一切。** 任何让规范变重、让架构变复杂、让团队多记一条规则的提案,先回答"它是不是非加不可"。如果有同等效果的更轻方案,选轻的。**避免业务无限扩大,避免文档无限膨胀。**

四条衍生意涵:
- **一套界面 / 一套规范 / 一种用户视角** — 不分层、不双套、不双轨
- **上游能用的就用上游**,不要重写
- **改动越少越好**,新增文件优于改上游文件
- **工具能强制的就工具强制**,不靠"约定"

---

## 五条设计原则(Why)

### P1. 隔离(Isolation)

新功能尽可能放新文件,与上游零冲突。改上游文件是**例外**,需要理由。

### P2. 配置化(Config over Code)

**换皮性质**的改动(品牌名、主题色、icon 资源)走配置文件 / CSS 变量 / 资源映射,**不改源码常量**。配置文件存自己目录,上游不知道它存在 → 永远不冲突。

### P3. 适配层(Adapter)

对上游内部 API 的依赖统一穿过 adapter 层。上游 API 变了,只改 adapter 一个文件。代价是多一层间接,收益是 rebase 成本可控。

### P4. 可逆(Reversibility)

任何对上游的侵入,必须可以 `git revert` 一笔回到上游。**一笔 commit 干一件事**,禁止"改上游 + 写新功能"混提。

### P5. 显性化(Explicit)

改上游文件**必须**加 `// FORK: <reason> <date>` 注释。pre-commit hook 强制检查。改动日志写"上游 contract 假设"(我们假设上游 X 不变),rebase 时第一时间 grep 检查。

> **刻意不收纳**:回流原则、最小漂移原则、用户分层、可解释性 — 不属于"稳定 + 跟随升级 + 低维护"的核心。

---

## 四条团队规范(How — 可机械执行)

### R1. 新功能开发"三级跳"

```
1. 能不能完全在新文件里完成? → 能 → 走新文件,结束
2. 能不能新文件 + 上游文件加 ≤5 行接口? → 能 → 走"薄注入"
3. 必须深度改上游? → 改前先发一段话到 review,说明为什么 1/2 走不通
```

**Review 标准**:新增行数 / 改上游行数 ≥ 3:1 是健康基线。

### R2. 改上游文件必须打 FORK marker

- 单点改:`// FORK: <reason> <YYYY-MM-DD>`
- 多行改:`// FORK-BEGIN: <reason>` ... `// FORK-END`
- pre-commit hook 检查:动了上游文件没 FORK marker → **拒绝提交**
- 例外:仅追加依赖到 `package.json` / `Cargo.toml` 不需要 marker(无业务逻辑)

### R3. 三类 hardcode 禁令

| 类别 | 反例(禁) | 正例(推荐) |
|---|---|---|
| 品牌字符串(产品名/identifier) | 改 `tauri.conf.json` 的 `productName` 硬编码 | `process.env.OPENCODE_PRODUCT_NAME ?? "OpenCode"` + 自己的 `.env.fork` |
| 主题色 / 字号 | 改 `packages/ui/` 内部 token | 自己入口 CSS `:root { --primary: ... }` 覆盖 |
| icon / 启动图资源 | 直接覆盖 `packages/desktop/src-tauri/icons/*.png` | 自己目录放新资源 + build 脚本替换 |

**存放位置**:统一 `packages/branding/`(新建),fork 特化集中一处,sync 时一目了然。

> **R3 与 09 黑名单的关系**:R3 推荐路径触动的 `tauri.conf.json` / `packages/ui/` / `packages/desktop/src-tauri/icons/` 等都在 09 节 4.1 黑名单内 — 这不是冲突,是**机制嵌套**。R3 告诉你"该怎么改",R4 告诉你"改时要走 override 流程"。两者叠加生效,不绕过任何一道。

### R4. 黑名单 override(团队场景双签 / single-person 场景 AI 二次确认)

改黑名单文件(详见 `09-改动规则.md` 节 4.1)需三步:

1. commit message 标 `[override-blacklist: <理由>]`
2. 改动日志里写"为什么 wrapper 替代方案不可行"(逐文件论证)
3. **二次确认**(按场景选其一):
   - **团队场景**:第二人 review 确认
   - **single-person 场景**:实施 agent 在 commit 前出"复核报告"(wrapper 不可行性 / 风险评估 / 改动日志论证审阅 三项)→ user 审 → 点头 commit。无冷却期,复核嵌在"测试通过 → commit"间隙,不阻塞迭代节奏

季度 review:override 笔数 > 2 笔 → **红色警报**,评估能否退化成 wrapper。

> **配额按 commit 笔数算**,不是按文件条目数。一笔 commit 同时触动多个黑名单文件(例:换皮专项一次改 conf + ui + icons + vite.config)算 1 笔。同笔 commit 同时挂 `[override-blacklist] + [large-diff]` 等多个标也算 1 笔(标只是描述破例的不同维度,归属同一次决策)。配额测的是"破例频率",不是"破例严重度"。

### R5. 分支生命周期与双端协作

`feat/<name>` 是**一次性容器**:从最新 main 切出来,做完合 main 后**立刻销毁**(本地 + 远端),**新项目用新名字,绝不复用**。Win / Mac 双端同时开发的具体步骤(谁先合 / 谁后 rebase / 命令清单 / 常见坑)详见 [`双端协作-SOP.md`](./双端协作-SOP.md)。

> **主分支名注**:2026-05-21 起本仓主分支 `dev` → `main`(对齐 GitHub 默认 + 跟 installer channel `dev` 解耦)。上游 anomalyco/opencode 主分支仍是 `dev`,所以 `upstream/dev` 字面量在 SOP 命令里保留。

> R5 是 v2 分支模型的操作落地,与 R1-R4 正交(R1-R4 讲"哪些文件能改",R5 讲"分支怎么走")。

---

## 三个健康指标(刚刚够,不再多)

| 指标 | 目标 | 超阈值动作 |
|---|---|---|
| **上游侵入率** = 修改上游文件数 / 总文件数 | < 5% | 评估能否退化部分改动到 wrapper |
| **漂移 commit 数** = `main..upstream/dev`(本仓 main / 上游 anomalyco/opencode 仍是 dev) | ≤ 100 | 触发 ad-hoc 中期 sync |
| **override 累计笔数** | 每季 ≤ 2 笔 | 红色警报,追溯 R4 是否走过 |

> **关于"上游侵入率"**:测的是"我们对上游做了多少侵入式改动"。**纯新增 fork-only 文件不算侵入**(P1 隔离原则鼓励的就是这种),只算"改上游文件占比"。新文件多反而稀释这个比例,是健康信号(代码总量大 ≠ 偏离上游)。
>
> **关于 override 配额**:按 commit 笔数算,不按文件条目数。详见 R4 配套说明。

**当前快照**(2026-04-26 立规范时):上游侵入率 ~3% ✅ / 漂移 3 ✅ / override 1 笔 ✅。**健康。**

---

## 操作 SOP

### A. 季度强制对齐(每季度首月)

```bash
cd D:/project/opencode-fork

# 1. 漂移评估
git fetch upstream
git log --oneline main..upstream/dev | wc -l                     # 上游新增数(main=本仓主分支 / upstream/dev=上游主分支)
for f in packages/app/src/pages/session/file-tabs.tsx \
         packages/ui/src/components/file-media.tsx \
         packages/opencode/src/file/index.ts; do
  echo "$f: $(git log --oneline main..upstream/dev -- $f | wc -l) commits"
done

# 2. 打 baseline tag(回退锚点)
git tag pre-rebase-$(date +%Y-%m-%d) main

# 3. rebase
git checkout main && git rebase upstream/dev
git checkout feat/editable-file-viewer && git rebase main

# 4. 静态验证 + release build + 抽样冒烟(改动日志的 R 矩阵抽几条)
bun run typecheck
bun run --cwd packages/desktop tauri build

# 5. 推送(rebase 改写历史,需 force-with-lease)
git push origin main --force-with-lease
git push origin feat/editable-file-viewer --force-with-lease

# 6. 更新 baseline tag(下次同步起点)
git tag -f upstream-baseline main
git push origin upstream-baseline --force
```

### B. Ad-hoc cherry-pick(平时想要某上游特性)

```bash
git fetch upstream
git tag pre-cherry-$(date +%Y-%m-%d) feat/editable-file-viewer
git cherry-pick <commit-sha>
# 验证 + 推送
```

**不更新 baseline tag**,漂移仍累积,等下季度对齐统一收。

### C. 热区冲突解决三步

1. **理解上游意图**:`git log -p upstream/dev <fileX>` 把上游每个 commit 的 diff + msg 读一遍。重点是"上游为什么改",不是"改了哪几行"。
2. **决策**:
   - 与我们改动**正交** → 接受上游 + 用 FORK marker 找位置重新插入
   - 与我们改动**同一处逻辑** → 评估能否弃我们的(可能上游已经做了类似的事)
   - 上游**重命名 / 移动文件** → 必须 git mv 同步,否则 rebase 后我们的改动消失到旧文件里
3. **解决后强制完整验证**:typecheck + cargo check + release build + R 矩阵抽样,**不只跑 typecheck**

---

## 工具配套(让规范有牙齿)

### 必做(本季度内)

**FORK marker pre-commit hook** — 扩展 `D:/project/opencode-fork/scripts/install-hooks.sh`:

- 检查 staged diff 中如果有上游文件改动且没 `FORK:` 字样 → 拒绝
- 例外列表:`*.lock`、`package.json`(仅 deps 字段)、`Cargo.toml`(仅 deps 段)

### 可选(没空可以不做)

**健康度脚本** — 新建 `D:/project/opencode-fork/scripts/fork-health.sh` 一键算 3 个指标。手算也不慢,工具是锦上添花。

---

## 验证

策略文档不是代码,验证是"能否照着用 + 不让团队感到累赘"。

- **冷验证**(写完文档立即做):把 SOP A 的命令逐条 dry-run 跑只读部分,确认每条产出预期信号
- **热验证**(下次实操时):
  - 软件更名 / 主题变更走 R3 配置化路径,验证不动 ui 包内部
  - 下笔上游文件改动加 FORK marker,验证 R2 可操作性
  - 下季度首月跑一次完整 SOP A,记录每步实际耗时,反哺改进 SOP

---

## 关键文件路径速查

| 用途 | 路径 |
|---|---|
| 本文档 | `docs/governance/fork-跟随升级与协作规范.md`(2026-04-28 起,原 `opencode-plan/规划/12-...` 已迁入本仓) |
| 改动规则(总纲) | `docs/governance/改动规则.md` |
| 上游 merge SOP | `docs/governance/UPSTREAM-MERGE-GUIDE.md` |
| **双端协作 SOP** | `docs/governance/双端协作-SOP.md`(feat 生命周期 + Win/Mac 双端流程,2026-04-30 立) |
| FORK marker hook(待实现) | `scripts/install-hooks.sh`(扩展) |
| Branding 目录 | `packages/branding/`(已落地) |
| 改动日志(每次 commit 配套) | `改动日志.md`(根目录索引)+ `docs/features/<feat-id>/3-changelog.md`(详情) |
