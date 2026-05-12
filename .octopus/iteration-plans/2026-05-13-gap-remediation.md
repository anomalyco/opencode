# 迭代计划: 品牌闭环 + 残留清洗

> 迭代: `2026-05-13-gap-remediation`
> 制定日期: `2026-05-13`
> 状态: ✅ R2 评审通过 (6/7 Go)

## 一、迭代目标

完成 5 份 Discovery 全量审计发现的 11 个缺口修复：
- **品牌闭环**（6 Issue）：章鱼视觉在 Web/CLI/桌面/邮件/品牌色全触点覆盖
- **残留清洗**（4 Issue）：README/i18n/CI/测试中的 opencode 品牌引用彻底清理
- **资产清理**（1 Issue）：旧 OpenCode mark 删除

## 二、候选 Issue 来源

| 来源 | 引用 |
|------|------|
| D3 视觉形象 (`2026-05-12-octopus-visual-identity.md`) | Issue A1–A6 |
| D4 残留清理 + D2 代码清洗 | Issue B1–B4 |
| 审计发现 | Issue C1 |

## 三、去重说明

| 检查项 | 结果 | 操作 |
|--------|------|------|
| CHANGELOG 交叉比对 | v0.1.0–v0.4.0 无章鱼形象相关发布 | 无冲突 |
| 已有 Issue 比对 | #11（品牌资产替换，OPEN）被 #36 + #46 完全覆盖 | 已关闭 #11 |
| 语义去重 | 11 个 Issue 各自描述不同目标 | 无合并必要 |
| 已有关联 PR merge | 无关联 PR | — |
| 影响范围交叉 | 文件集零交集 | 无需合并 |

## 四、冲突检测

交叉比对 11 个 Issue 的文件集（详见 `.octopus/discovery/2026-05-13-gap-remediation.md` §审计证据）：

| Issue A | Issue B | 同文件? | 判定 |
|---------|---------|:-------:|------|
| A1 (ui/components/logo) | A2 (console/brand/) | 不同包 | ✅ |
| A1 (ui/assets/favicon) | A4 (ui/assets/images) | 同包不同子目录 | ✅ |
| A1 (console/logo*.svg) | A2 (console/brand/) | 同包不同子目录 | ✅ |
| A3 (desktop/icons) | 其余全部 | 不同包 | ✅ |
| A5 (octopus/src/cli) | B4 (octopus/test) | 源码 vs 测试 | ✅ |
| B3 (.github/workflows) | 其余全部 | 不同目录 | ✅ |

**结论**: 11 个 Issue 文件集完全不相交 → **无 file/git merge 冲突**

## 五、排序与执行序列

### 依赖关系

| 依赖 | 原因 |
|------|------|
| #38 → #36 | Desktop icons 依赖章鱼母版在 Web 场景验证定型 |
| #46 → #36 | 删除旧 mark 应在 #36 新资产上线确认后执行，避免"无 logo"中间态 |
| #45 ↔ 其余 | 测试文件替换与 UI 修改无依赖，可全并行 |

### 执行 Waves

```
Wave 1 (9 Issue 全并行):
  [S]  A1  #36  Web, UI & Favicon 章鱼集成     ← 章鱼母版已存在，直接集成
  [S]  A2  #37  Console Brand Kit 迁移
  [XS] A4  #39  Marketing Assets 更新
  [XS] A5  #40  CLI ASCII Octopus 重写
  [XS] A6  #41  CSS Brand Palette Refresh
  [S]  B1  #42  README 多语言删除 & 清洗
  [S]  B2  #43  i18n JSON opencode 清洗
  [XS] B3  #44  CI/CD workflow 残留清洗         ← Fast-track
  [S]  B4  #45  测试文件 opencode 残留清洗

Wave 2 (依赖 Wave 1 产出):
  [L]  A3  #38  Desktop App Icons 重新生成     ← 章鱼母版定型 + platform 脚本就绪
  [XS] C1  #46  删除旧 OpenCode mark.svg        ← #36 新资产上线确认后执行
```

## 六、级别分布

| 级别 | 数量 | Issue |
|:----:|:----:|-------|
| L | 1 | #38 |
| S | 5 | #36, #37, #42, #43, #45 |
| XS | 5 | #39, #40, #41, #44, #46 |

## 七、Fast-track 判定

| Issue | 判定 | 理由 |
|-------|:----:|------|
| #44 (CI/CD) | Fast-track | ≤8 文件 XS 级，纯品牌文本替换，无需 P3/P4/P5 |
| #46 (删除 mark) | Standard | 非独立执行——等 Wave 1 #36 新资产落地后执行，纳入 Wave 2 |
| #40 (CLI ASCII) | Standard | 虽仅 2 文件，但涉及 TUI 渲染需要视觉确认 |
| #36–#43, #45 | Standard | 涉及 UI 组件/i18n 修改需 P3 需求分析 |

## 八、Agent 分派

| Issue | Agent | 理由 |
|-------|-------|------|
| #36–#42, #46 | feature-dev | UI/展示/文档/i18n |
| #43 (i18n) | feature-dev | 同 i18n 领域 |
| #44 (CI/CD) | platform | workflow 维护 |
| #45 (测试) | core-dev | 代码级替换，需保证测试通过 |
| #38 (图标-生成) | feature-dev + platform | UI 设计 + 批量生成脚本 |

## 九、风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|:----:|:----:|---------|
| A3 章鱼在 16×16 下不可辨识 | 中 | 高 | 提前验证，简化剪影方案 |
| E2E 测试因 favicon 替换失败 | 低 | 高 | P7 质量门会检测 |
| i18n key 重命名导致前端引用断裂 | 低 | 高 | P7 质量门 + typecheck |
| #44 CI workflow 替换导致 pipeline 语法错误 | 中 | 高 | 替换后执行 `gh workflow lint` 语法验证 |
| #46 删 mark.svg 前未扫描引用 | 中 | 中 | 执行前 grep `mark.svg` 确认零引用 |
| #38 批量脚本与章鱼母版版本不同步 | 低 | 中 | 同 agent (feature-dev) 控制输出 + Wave 2 串行 |

## 十、评审记录

| 轮次 | 日期 | Go/NoGo | 修正要点 |
|:----:|:----:|:-------:|---------|
| R1 | 2026-05-13 | 2/7 Go | #38 拆 Wave 2 + #46 加时序约束 + 增补风险条目 |
| R2 | 2026-05-13 | **6/7 Go** | ✅ 通过，准予 P3 执行 |
