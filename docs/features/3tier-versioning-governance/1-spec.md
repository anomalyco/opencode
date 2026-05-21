---
feat-id: 3tier-versioning-governance
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 3tier-versioning-governance — 1-spec

> 3-tier 发布渠道 + 版本号体系正式立规

## 需求来源

2026-05-21 user 落地 `installer-version-env-suffix`(B2 env suffix)+ `rename-dev-to-main`(主分支重命名)后,核心命名问题已解,但**对外发布语义还没固化**。同日 user 提出:

> 我理解以后我们会有三种安装包,第 1 个稳定版,第 2 种是预览版,第 3 种是不向外发布的本地不需要安装的测试版。如何对他们进行管理,版本号应该如何定?

讨论后 user 拍板 **3-tier 体系**(本规范主体)+ 要求"落实为文档"+"看下项目需要调整的"。

## 3-tier 体系总览

| Tier | 对外名 | 内部代号 | 做什么的 | 谁用 |
|---|---|---|---|---|
| **1** | **稳定版**(Stable)| `prod` | 主推的发布物,所有功能测过 | 99% 普通用户 |
| **2** | **预览版**(Preview)| `dev` | 公开但标"开发版"的发布物 | 主动 opt-in 早鸟用户 / 内部测试 |
| **3** | **本地测试版** | `dev` + `--no-bundle` | 不打包,raw exe 自测 | Claude / 开发者本机 |

`beta` 内部代号 = RC 候选发布渠道**储备**,日常不主动 ship。

## 验收标准

| ID | 验证 | 期望 |
|---|---|---|
| A1 | 新治理 doc 存在 | `docs/governance/版本号与发布渠道规范.md`(centerpiece)|
| A2 | 3 tier 操作命令清单可复制 | doc §五 SOP 段 |
| A3 | 版本号格式定义清晰 | `YYYY.M.D.N[-env-suffix]`,B2 后缀规则 |
| A4 | N 序列双维度独立 | 平台 × env 各自一套 |
| A5 | Tier 3 不分配新版本号 | 本地 raw exe build 不 bump、不 commit |
| A6 | README 对外口径对齐 | README.md / README.zh.md 加 channel 语义 |
| A7 | 相关现有 doc 加 cross-link | 应用身份-命名规则 / CLAUDE.md / pack-installer.{ps1,sh} 头注 |

## 架构选型

### 为什么 3-tier 而不是 2-tier 或 4-tier

候选讨论(详 [`rename-dev-to-main/1-spec.md`](../rename-dev-to-main/1-spec.md) section "3 个候选方案"):
- **A. 2-tier**(只 stable + preview) — 否决:DeskFox 三档 AppId 已落地,沉没成本要利用;砍掉 beta AppId 浪费已发布资产
- **B. 3-tier 完整**(stable + beta + dev) — 否决:团队小,beta 实际"养不住",日常 90% 不用
- **C. 3-tier + 砍中间**(主用 prod + dev,beta 储备)— **采用**

C 方案的精髓:**保留 3 档基础设施(AppId / 脚本)+ 文案对齐(对外 stable / preview)+ beta 储备不主动**。这样既不浪费已落地资产,又保持 user 心智简单。

### 为什么 Tier 3 不分配新版本号

候选:
- Tier 3 用 `-local` / `+build` 等后缀 → 增加复杂度,无收益(不分发,版本号对外无意义)
- Tier 3 沿用 JSON 当前值 → **采用**(简单,且 raw exe 给开发者本人用,看 git commit 即可定位)

### 为什么主分支重命名 main 是这套规范的前置

`main` 解耦了"分支名"和"installer channel `dev`"两个命名空间。否则 Tier 2 用 `dev` 后缀 + 主分支也叫 `dev` = 二义性大。详 [`rename-dev-to-main/1-spec.md`](../rename-dev-to-main/1-spec.md)。

## 改动范围

| 文件 | 性质 | 改动 |
|---|---|---|
| 🆕 `docs/governance/版本号与发布渠道规范.md` | 新建 | centerpiece(~200 行)|
| `README.md` | 改 | "三档(prod/beta/dev)"补 channel 语义 + cross-link 到治理 doc |
| `README.zh.md` | 改 | 同 README.md 中文版 |
| `docs/governance/应用身份-命名规则.md` | 改 | 顶部加 1 行 cross-link |
| `CLAUDE.md` | 改 | 文档链路表加 1 行 |
| `packages/branding/scripts/pack-installer.ps1` | 改 | 头注加 3-tier 说明 |
| `packages/branding/scripts/pack-installer.sh` | 改 | 同 .ps1 |
| `docs/features/INDEX.md` | 改 | feat 索引加 1 行 |
| `改动日志.md` | 改 | feat 索引加 1 行 |

## R 合规

- **R2** 文档级改动,无 FORK marker 需求(治理 doc / README / 脚本头注全 fork-only)
- **R3** 不涉及品牌/主题/icon
- **R4** 0 override(全 fork 白名单)
- **R5** 治理类 feat,无代码改动,豁免 unit test(Medium 文档治理)
- **R6** 不涉及网络监听
