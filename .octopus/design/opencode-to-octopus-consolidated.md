# P5 方案设计：OpenCode → Octopus 全量品牌迁移

> **版本**: v0.1.0 | **设计日期**: 2026-05-11
> **上游**: P3 `.octopus/research/opencode-to-octopus-rebrand.md` | 版本计划 `.octopus/version-plans/v0.1.0.md`
> **LLM Panel 评审**: P4 已通过 (7/7 Go)

## 设计总览

| 设计文档                                               | 负责 Agent | 关键交付                                                     |
| ------------------------------------------------------ | ---------- | ------------------------------------------------------------ |
| `.octopus/design/opencode-to-octopus-automation.md`    | core-dev   | verify-rebrand.ts + rebrand-smoke.ts + sed 命令 + git mv     |
| `.octopus/design/opencode-to-octopus-compat.md`        | compat     | env 双读、migrate 命令、CLI alias、npm deprecation、XDG 迁移 |
| `.octopus/design/opencode-to-octopus-ci-cd.md`         | platform   | workflow 变更、Secrets 双轨、发布管线、Docker/Nix            |
| `.octopus/design/opencode-to-octopus-test-strategy.md` | qa         | 五层测试门、27 项冒烟、Canary 监控、回归风险                 |

---

### 架构审定 — architect

**整体架构影响**: **低** — 无算法/系统架构变更，全部为字符串替换和标识符重命名。

**关键架构决策**:

1. `global.ts:9` 单点变量 `app = "opencode"` → `app = "octopus"` 控制所有 XDG 路径 — 单点修改，风险可控
2. `flag.ts` 集中 ~50 个 Flag — 通过 `readFromEnv()` 辅助函数实现双读，不改 Flag 调用模式
3. 发布拓扑: `script → core → sdk → ui/plugin/app → octopus (CLI)` 自底向上
4. 迁移数据流: 旧 env var → 双读 → 新 env var (3 minor 版本窗口)

---

### 任务拆解清单

|  #  | 子任务                                            | 负责人      | 预估工时 | 依赖 | 验收门                     |
| :-: | ------------------------------------------------- | ----------- | :------: | :--: | -------------------------- |
| 1.1 | `sed` 替换 `@opencode-ai` → `@octopus-ai` 全仓    | core-dev    |    1h    |  —   | grep 零残留                |
| 1.2 | 更新 package.json name + turbo.json + bun.lock    | core-dev    |    1h    | 1.1  | bun install + typecheck    |
| 2.1 | `git mv packages/opencode packages/octopus`       | core-dev    |   0.5h   | 1.2  | 目录不存在                 |
| 2.2 | 全仓路径引用替换                                  | core-dev    |   0.5h   | 2.1  | rg 零残留                  |
| 3.1 | API 标识符重命名 (createOpencode*→createOctopus*) | feature-dev |   1.5h   | 2.2  | rg -i 零残留 + test 通过   |
| 4.1 | Flag/env 重命名 + 双读 helper                     | core-dev    |    1h    | 2.2  | grep 零残留 + test:ci 通过 |
| 5.1 | `.opencode/` → `.octopus/` + 配置查找逻辑更新     | core-dev    |    1h    | 2.2  | 配置正确加载               |
| 5.2 | `octopus migrate` 命令实现                        | compat      |   1.5h   | 5.1  | migrate 测试通过           |
| 6.1 | 主题/CSS/图标重命名                               | feature-dev |   0.5h   | 2.2  | Storybook 主题正常         |
| 7.1 | VS Code + Zed 扩展更新                            | feature-dev |   0.5h   | 2.2  | VSIX 打包成功              |
| 8.1 | workflow 文件重命名 + 内容更新                    | platform    |    1h    | 2.2  | CI 全绿                    |
| 8.2 | GitHub Secrets 双轨设置 (人工)                    | platform    |   0.5h   |  —   | 新 Secret 就绪             |
| 9.1 | MDX 文档批量替换 + 人工校对                       | feature-dev |   2-4h   | 1-7  | 路径/命令/品牌名一致       |
| 9.2 | i18n key + 翻译值更新                             | feature-dev |   1-2h   | 1-7  | locale 加载正确            |
| A.1 | `script/verify-rebrand.ts` 实现                   | core-dev    |    1h    | 2.2  | 9 组验证全部通过           |
| A.2 | `script/rebrand-smoke.ts` 实现                    | core-dev    |    1h    | 1-7  | 27 项冒烟通过              |
| A.3 | `readFromEnv` 双读 helper 实现                    | compat      |   0.5h   | 4.1  | 新旧 env var 均生效        |
