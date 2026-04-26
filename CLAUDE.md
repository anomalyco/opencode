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
- **品牌字符串**(productName/identifier)→ 走 `process.env.OPENCODE_*` + 自己的 `.env.fork`,**不改** `tauri.conf.json` 硬编码
- **主题色/字号** → 自己入口 CSS `:root { --primary: ... }` 覆盖,**不改** `packages/ui/` 内部 token
- **icon/启动图资源** → 自己目录放新资源 + build 脚本替换,**不直接覆盖** `packages/desktop/src-tauri/icons/`

存放位置:统一 `packages/branding/`(待建)。

### R1. 新功能"三级跳"决策
```
1. 能完全在新文件做? → 走新文件,结束
2. 不能 → 新文件 + 上游加 ≤5 行接口注入
3. 必须深度改上游? → 改前先评审 1/2 走不通的理由
```
新增行数 / 改上游行数 ≥ 3:1 是健康基线。

### R4. 黑名单 override 双签
改黑名单文件需:① commit message 标 `[override-blacklist: <理由>]` ② 改动日志写"为什么 wrapper 替代不可行" ③ 第二人 review 确认。

## 五条设计原则(背后逻辑)

- **P1 隔离**:新功能尽量放新文件,改上游是例外
- **P2 配置化**:换皮性质改动走配置 / CSS 变量
- **P3 适配层**:对上游内部 API 的依赖统一穿过 adapter
- **P4 可逆**:一笔 commit 干一件事,可单独 git revert
- **P5 显性化**:改上游必加 FORK marker(R2 是它的具体执行)

## 完整文档链路

| 文档 | 路径 | 作用 |
|---|---|---|
| 治理总纲 | `D:/project/opencode-plan/规划/12-fork-跟随升级与协作规范.md` | 完整原则 / 规范 / SOP |
| 改动规则细则 | `D:/project/opencode-plan/规划/09-改动规则.md` | 白黑名单 / baseline tag / diff 阈值 / hook 体系 |
| 改动日志 | `本仓 改动日志.md` | 每笔 commit 必填 |
| DeskFox 品牌替换计划 | `D:/project/opencode-plan/规划/13-DeskFox-品牌替换-最小可见档.md` | 当前进行中的品牌落地 |

## 默认仓库约定

- 默认分支:`dev`(跟随 `upstream/dev`)
- 功能分支:`feat/<name>`,例 `feat/editable-file-viewer`
- baseline tag:`upstream-baseline`(同步起点),`pre-rebase-<日期>`(rebase 前)
- 远端:`origin` 双 push gitee + github;`upstream` 只读指 sst/opencode

## 验证约定

- **typecheck**:`bun run typecheck`(monorepo 全量,turbo 缓存)
- **release exe**:`bun run --cwd packages/desktop tauri build` → `packages/desktop/src-tauri/target/release/OpenCode.exe`
- **改完不起 dev,直接 build release exe 验证**(WebView2 + Tauri 在 dev 模式下行为可能与 release 不一致)

## 健康指标(季度自查)

| 指标 | 目标 |
|---|---|
| fork 偏离指数 = 修改上游文件数 / 总文件数 | < 5% |
| 漂移 commit 数 = `dev..upstream/dev` | ≤ 100 |
| override 累计数 | 每季 ≤ 2 |

当前快照(2026-04-26):偏离 ~3% / 漂移 3 / override 1 — **健康**。
