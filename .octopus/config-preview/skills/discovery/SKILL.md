---
name: discovery
description: 需求澄清方法和查重规则，供 analyst agent 在 P0 Discovery 阶段使用
---

# Discovery Skill

此 Skill 仅供 analyst Agent 使用。

## 需求澄清方法

### 5 Whys 追问

从用户的一句话 idea 出发，追问五层：

1. 表层: "用户说了什么？"
2. "为什么需要这个？解决什么问题？"
3. "为什么那个问题是问题？"
4. "为什么现有的方案不够？"
5. "根本原因是什么？"

### 区分 want vs need

- Want: 用户提出的具体方案（"加一个 dark mode 开关"）
- Need: 背后的真实需求（"在低光环境下舒适地使用产品"）

要做到：从 want 推导到 need，然后基于 need 提出 1~N 个方案选项。

## 查重规则

P0 开始时必须执行：

1. **搜索 `.octopus/discovery/`** — 查看是否已有相同需求的 discovery 文档
2. **搜索 CHANGELOG.md** — 查看该功能是否已在某个版本中发布
3. **搜索 GitHub Issues** — 搜索 open + closed Issue，关键词匹配 + 语义相似判断
4. **判定**:
   - 已实现（CHANGELOG 有） → 告知用户，建议关闭
   - 已有 discovery 文档 → 读取，告知进度，询问是否继续
   - 已有 Issue → 告知 Issue 链接，询问用户意图

## Issue 拆解原则

### INVEST 原则

| 字母 | 含义        | 检查                                |
| ---- | ----------- | ----------------------------------- |
| I    | Independent | 每个 Issue 可独立开发？             |
| N    | Negotiable  | 实现细节可协商？                    |
| V    | Valuable    | 每个 Issue 独立交付价值？           |
| E    | Estimable   | 文件数可预估？                      |
| S    | Small       | 单个 Issue ≤ 150 文件（L 级）？     |
| T    | Testable    | 验收标准可用 Given/When/Then 描述？ |

### 拆解策略

1. **按模块拆**: 一个包 = 一个 Issue（如 `packages/core` 迁移）
2. **按依赖拆**: 前置工作 → 核心实现 → 适配层
3. **按角色拆**: core-dev 负责的 vs feature-dev 负责的
4. **标注关系**: blocked-by / blocks / parallel-with

### 并行策略标注

拆解时必须为每个 Issue 标注并行策略：
- `parallel-with: #N,#M` — 文件集无交集，可同时启动
- `serial-after: #N` — 同文件或有产出消费关系
- `blocked-by: #N` — 上游未完成前不可启动

Discovery 文档的 Issue 列表表头增加 "并行策略" 列。

### 粒度控制

- XL (>500 文件) → 必须拆解为多个 ≤L 级 (≤500) 的 Issue
- L (150-500) → 建议拆解为多个 M 级
- XS (<10) → 考虑是否应合并到更大 Issue 中

## 代码库探索

判定影响范围时关注：

- `package.json` workspaces — 包列表和依赖关系
- 包间 import 图 — `@project/core` → `@project/ui` 等
- 关键目录结构 — 每个包的 `src/` 子目录

### 双维度影响范围评估

P0 必须从两个维度交叉评估影响范围，避免单维度盲区（历史教训：v0.2.0 i18n 低估 3×，CI/CD 低估 25%）：

**维度 1: 文件类型分布**

```
rg <pattern> --count -g '*.ts'     # 代码文件
rg <pattern> --count -g '*.json'   # 配置/i18n
rg <pattern> --count -g '*.mdx'    # 文档
rg <pattern> --count -g '*.yml'    # CI/CD
```

**维度 2: 目录拓扑分布**

```
rg <pattern> --count -g 'packages/*/'  | awk -F: '{print $1}' | cut -d/ -f1-3 | sort | uniq -c
```

输出示例：
```
120 packages/core
 50 packages/ui
 51 packages/web/src/content/i18n   ← 容易被遗漏的子目录
 25 .github/workflows               ← 不在 packages/ 下
```

**交叉判定**: 两个维度的结果必须在 Discovery 文档中并列表格，差距 >20% 的标注为 ⚠️。

不做的事：

- 不读具体代码实现
- 不分析架构细节
- 不评估技术难度
- 不写代码

## 参考

`.octopus/WORKFLOW.md`
