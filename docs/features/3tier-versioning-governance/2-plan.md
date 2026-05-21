---
feat-id: 3tier-versioning-governance
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 3tier-versioning-governance — 2-plan

## 实施步骤

### Step 1:新治理 doc `docs/governance/版本号与发布渠道规范.md`(centerpiece)

九段结构:
1. **3-tier 体系总览**(表)
2. **命名空间分离**(Git 分支 vs Installer channel)
3. **版本号规则**(格式 + N 序列双维度独立 + Inno Setup VersionInfoVersion strip)
4. **各 tier 详细规则**(操作命令 / AppId / 安装目录 / Output 文件名 / Git tag / workflow / 分发去向 / UI 显示)
5. **操作 SOP**(Tier 1 / 2 / 3 三套可复制命令)
6. **决策记录**(摘录,详细在 feat 1-spec)
7. **follow-up**(Tier 2 workflow / 官网入口 / 升级提示等未做项)
8. **关联文档**(cross-link 表)
9. **修订记录**

### Step 2:5 处现有文件 cross-link / 文案补丁

- `README.md` line ~122 "Engineered packaging" 文案补 channel 语义 + link
- `README.zh.md` 同
- `docs/governance/应用身份-命名规则.md` 顶部加"关联规范"行
- `CLAUDE.md` 文档链路表加 1 行(在"应用身份命名规则"后)
- `packages/branding/scripts/pack-installer.ps1` 头注加 3-tier 段
- `packages/branding/scripts/pack-installer.sh` 同 .ps1

### Step 3:feat 三文档 + INDEX + 改动日志索引

按规范 v2 Medium 三文档全套。

### Step 4:typecheck + commit + 等 user merge 授权

无代码改动,typecheck 不强制但跑一遍 sanity check。

## 决策轨迹

### 治理 doc 命名

候选:
- `版本号与发布渠道规范.md` ← user 选
- `installer-channel-tier.md`(英文化)
- `三档发布规范.md`(简短)

User 选第一个 — 标题表意最完整(同时提到"版本号"和"发布渠道",两个核心维度)。

### `beta` 怎么处理(规范文中如何提)

候选:
- A. 不提 beta — 用户视角"反正不用"
- B. 提一句"储备" — 留扩展能力
- C. 详细写 beta 规则 — 但暂不主动用

选 **B**:正文 §一 开头加一句"`beta` 是 RC 储备,日常不用",§四 详细 tier 段不展开 beta。理由:已落地 AppId,**不写=未来 6 个月后忘掉这能力存在**;写少量保持可发现性,但不消耗规范注意力。

### Tier 3 (本地测试)的 channel 代号

候选:
- 沿用 `dev`(跟 Tier 2 同代号,靠 `--no-bundle` 区分是否走 installer)
- 新增 `local` env 代号(完全独立)

选 **沿用 `dev`**:
- raw exe build 跟 installer build 都是 vite 同一个流程,channel 区分跟 build 阶段无关,在 pack 阶段才发生
- 新增 `local` env 意味着新 AppId GUID / 新 override JSON / 新 SOP — 巨大复杂度,无对应收益(本地用不上 AppId)
- "tier 3 = dev + --no-bundle" 这套口径在治理 doc §一脚注明示

### Tier 2 workflow 自动化要不要本笔做

候选:
- A. 本笔补 `release-deskfox-prerelease.yml` 监听 `ship-dev-*` tag
- B. 本笔不做,治理 doc 写 follow-up

选 **B**:
- 当前无 Tier 2 ship 计划
- workflow 实施量 ~200 行(对齐 Tier 1 workflow 加 prerelease 标 flag)
- 等真要 ship 第一次 Tier 2 时再做,先用本地 `gh release create --prerelease` 兜底
- 治理 doc §四 / §七 明示 follow-up

### 现有文档触动范围最小化

候选:
- 一次性把所有提"三档"的地方都加 channel 语义(15+ 处)
- 只补面向 user 的文档(README × 2 + 治理 doc + CLAUDE.md + pack-installer 头注)— **采用**

理由:历史 feat changelog / docs/history / 分支策略-v2 spec 是历史快照,加 channel 语义反而失真。改 active 文档即可,future agent 看新 doc + cross-link 链路足够。

## 不做的(本笔范围外)

- **Tier 2 workflow `release-deskfox-prerelease.yml`** — 等首次 Tier 2 ship 时再补
- **官网"预览版"独立入口** — `deskfox.ai` 站点改,跟仓库分离
- **跨 tier 升级提示**(Tier 1 user 看到 Tier 2 / Tier 3 是否提示)— 复杂产品决策,本笔不展开
- **历史 feat changelog 回填 channel 术语** — 不动,历史快照原则
