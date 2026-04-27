---
feat-id: 规范-v2
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 规范 v2 — spec

## 触发原因

GetBot 接入(feat-id: getbot-接入)开发过程暴露 v1 规范几个痛点:

1. **改动日志单条 9 段必填**仪式感太重,小修复也要写完整模板,长期 → 开发者会摸鱼跳过
2. **planning + execution + record 混在一条 changelog**,看历史时分不清"当时计划的"和"踩坑改的"
3. **200 行 commit 阈值**太紧,真实 feature 普遍 200-400 行,`[large-diff]` 频繁覆盖等于规则失效
4. **黑名单含 sprite.svg / types.ts**误报 — 这俩本就是 append-only 注册扩展点,每次加新 provider 必改

## 验收标准

- [x] 文档拆三份:`docs/features/<feat-id>/{1-spec,2-plan,3-changelog}.md`
- [x] 三文档共享 `feat-id` tag,头三行统一标
- [x] commit message 加 `[feat: <feat-id>]` tag,grep 反查到对应文档
- [x] 改动规模分级(tiny/medium/large)决定三文档要写多少
- [x] pre-commit threshold 200 → 500
- [x] sprite.svg / types.ts 从黑名单豁免
- [x] `本仓 改动日志.md` 角色调整为索引(指向 docs/features/)
- [x] 老条目 #1-#12 保留不动(向后兼容)

## 不做什么

- **不删 v1 R1-R4 / P1-P5 / 健康指标**:核心原则不变,只改流程层
- **不动 09-改动规则.md / 12-fork-跟随升级.md**(它们在 opencode-plan 项目里,需另起 PR)
- **不强制旧 feature 迁移**:#1-#12 留在改动日志.md,新 feature 走 v2

## 架构选型

走"**追加式修订**":CLAUDE.md 加新段(完整文档链路 v2 / 规范修订记录),不删旧段。pre-commit 同样追加豁免,不重写主逻辑。理由:升级路径平滑,risk 低。
