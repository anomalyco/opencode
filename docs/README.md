# DeskFox / opencode-fork 文档导航

> **本目录全部 fork-only**(上游 anomalyco/opencode 没有 `docs/` 目录,与上游 merge 0 路径冲突)。
> 一切关于本 fork 的需求 / 规划 / 治理 / 历史档案 / 功能文档统一收口于此。

## 目录结构

```
docs/
├── README.md                       # 本文(导航总入口)
├── PLANNING-OVERVIEW.md            # 项目立项 + 路线 + 当前快照(高层视图)
├── STATUS.md                       # 实施进度(分 Phase + 时间轴 + 里程碑)
├── office-viewer-plan.md           # office 文件预览方案(已落地的早期独立设计)
│
├── features/                       # 功能文档(规范 v2,每 feature 一目录)
│   ├── INDEX.md                    # 全 feature 索引
│   └── <feat-id>/{1-spec,2-plan,3-changelog}.md
│
├── governance/                     # 治理 / 规则 / 协议 — 当前活规则
│   ├── 改动规则.md                 # 白黑名单 / hook / diff 阈值 / 回滚演练
│   ├── 跨平台协作.md               # Win/Linux/Mac 三端环境 + 提拉流程
│   ├── fork-跟随升级与协作规范.md  # 治理总纲(原则 / SOP / 健康指标)
│   ├── 双端协作-SOP.md             # ⭐ feat 分支生命周期 + Win/Mac 双端流程
│   ├── DeskFox-品牌替换.md         # 品牌注入策略(productName / icon / 资源)
│   ├── 数字签名问题.md             # installer 不签名决策 + SmartScreen 应对
│   └── UPSTREAM-MERGE-GUIDE.md     # ⭐ 与 anomalyco/opencode 合并的 SOP
│
└── history/                        # 历史档案(快照,非维护态;改动会破坏历史)
    ├── 沟通记录.md                 # 关键决策时刻的对话日志
    ├── 规划-archive/01..11-*.md    # 早期调研(Phase 0-2 用过现已超越)
    └── GitHub-Issues/              # 轨道 1 issue 草稿(轨道已搁置)
```

## 入口图谱

| 你想…… | 看哪 |
|---|---|
| 第一次接手项目,想理解全貌 | [PLANNING-OVERVIEW.md](./PLANNING-OVERVIEW.md) → [STATUS.md](./STATUS.md) |
| 上手开发,要知道改什么文件能 commit | [governance/改动规则.md](./governance/改动规则.md) |
| 双端(Win+Mac)同时开发,要知道分支怎么走 | ⭐ [governance/双端协作-SOP.md](./governance/双端协作-SOP.md) |
| 准备从上游 anomalyco/opencode 拉新版合并 | ⭐ [governance/UPSTREAM-MERGE-GUIDE.md](./governance/UPSTREAM-MERGE-GUIDE.md) |
| 改东西不知道走 fork 路径还是上游路径 | [governance/fork-跟随升级与协作规范.md](./governance/fork-跟随升级与协作规范.md) — R1 三级跳决策 |
| 改品牌相关(name / icon / 主题色) | [governance/DeskFox-品牌替换.md](./governance/DeskFox-品牌替换.md) + [governance/改动规则.md](./governance/改动规则.md) R3 |
| 想看某个 feature 的完整来龙去脉 | [features/INDEX.md](./features/INDEX.md) → 对应 feat-id 目录 |
| 想做新 feature 拿模板 | 任一 features/<feat-id>/ 目录抄三文档骨架 |
| 调研某个早期决策为啥这么定 | [history/沟通记录.md](./history/沟通记录.md) + [history/规划-archive/](./history/规划-archive/) |
| installer 打包后产物在哪 | [features/installer-打包/3-changelog.md](./features/installer-打包/3-changelog.md) |

## 文档维护原则

1. **`docs/` 全 fork-only**:与上游 merge 不冲突,随便加(但避免在 features 之外瞎散文件)
2. **新 feature 用 v2 三文档**:`docs/features/<feat-id>/{1-spec,2-plan,3-changelog}.md`,头三行 frontmatter 必填,详见 [`/CLAUDE.md`](../CLAUDE.md) "完整文档链路"
3. **governance/ 改了要谨慎**:这些是当前活规则,改动逻辑等同改 CLAUDE.md;通常先 spec/plan 再改
4. **history/ 锁死**:只追加不修改;如果历史结论被推翻,在新 governance 文档里写,history 留作时光胶囊
5. **`改动日志.md`(根目录)是 commit 索引表**:每 feature 一行,详细内容在 `features/<feat-id>/3-changelog.md`

## 与上游(anomalyco/opencode)合并的关键

详见 [governance/UPSTREAM-MERGE-GUIDE.md](./governance/UPSTREAM-MERGE-GUIDE.md)。一句话总结:**fork 改动尽量不踩上游路径,新 feature 走 `docs/` + `packages/branding/` + 新文件;上游路径上的改动必须有 FORK marker**。
