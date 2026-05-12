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

要做到：从 want 推导到 need，然后基于 need 提出 1~N 个方案选项（见下文「方案发散」）。

## 方案发散

want→need 推导完成后、Issue 拆解之前，必须做方案发散，避免直接跳到第一个想到的方案。

### 何时触发

| 场景                       | 策略                          |
| -------------------------- | ----------------------------- |
| 新功能、新模块             | 必做发散                      |
| 架构/技术选型              | 必做发散，推荐升级到 LLM Panel |
| Bugfix、明确的依赖升级     | 跳过                          |
| 已有 discovery 文档的延续  | 跳过（沿用既有方案空间）       |

### 默认方法：HMW + 方案矩阵

**1. HMW（How Might We）改写**

把 need 改写为开放问句：

- need: "在低光环境下舒适地使用产品"
- HMW: "我们如何能够让 UI 在不同光照条件下都保持舒适？"

HMW 比 need 更利于发散——它显式邀请多种解法。

**2. 方案矩阵**

至少列 3 个候选方案，覆盖三个象限：

| 象限   | 含义                         | 示例（dark mode）            |
| ------ | ---------------------------- | ---------------------------- |
| 保守   | 最小改动、最低风险           | 手动开关 + 两套 CSS 变量     |
| 标准   | 主流方案、社区有先例         | 跟随 OS prefers-color-scheme |
| 激进   | 反直觉、能力升级、长远收益   | 全主题系统 + 用户自定义调色板 |

每个方案标注：核心思路 / 主要 trade-off / 预估文件影响范围。

**3. 类比迁移**

- 翻 `CHANGELOG.md` 找同类历史功能的方案
- 参考同类开源项目（如 VS Code、Zed）的实现
- 把别处的方案套到当前场景，检查是否成立

### 升级方法：7 方 LLM Panel Brainstorm

遇到关键架构决策时，调用 7 方 LLM 并行发散。这是 `peer-review` skill 机制的镜像应用：评审收敛投票，brainstorm 发散保留差异。

**与 peer-review 的关键差异**：

- **不投票**——多样性即价值，少数派意见恰是核心收益
- **鼓励差异**——prompt 显式要求"避免最显然的方案"
- **analyst 综合**——7 方输出去重合并后由 analyst 筛选 3-5 个进入 Discovery 文档

**Prompt 模板**（< 500 字，自包含）：

```
你是产品方案设计师。针对以下需求，提出 2-3 个差异化方案。

【需求陈述】
<need 一句话>

【已知约束】
<技术栈/包拓扑/兼容性要求，< 200 字>

【发散要求】
- 至少给出一个"反直觉"或"非常规"方案
- 避免重复其他人可能想到的最显然方案
- 每个方案标注：核心思路 / 主要 trade-off / 预估文件影响范围

【输出格式】
方案A: <名称> | 思路 | trade-off | 范围
方案B: <名称> | 思路 | trade-off | 范围
方案C(可选): <名称> | 思路 | trade-off | 范围
```

**执行方式**：

```bash
cat > /tmp/brainstorm-prompt.txt << 'EOF'
<上述模板，内联 need 和约束>
EOF

for model in \
  "opencode/claude-opus-4-7" \
  "github-copilot/gpt-5.5" \
  "github-copilot/gemini-3.1-pro-preview" \
  "deepseek/deepseek-v4-pro" \
  "opencode-go/qwen3.6-plus" \
  "opencode-go/kimi-k2.6" \
  "opencode-go/minimax-m2.7"; do
  name=$(echo "$model" | tr '/:' '_')
  opencode run -m "$model" "$(cat /tmp/brainstorm-prompt.txt)" \
    2>/dev/null > "/tmp/brainstorm-${name}.txt"
  echo "Done: $model"
done
```

模型清单与 `peer-review` skill 一致，详见该 skill。

**综合规则**：

1. 收集 7 方输出，预计 14-21 个候选方案
2. **去重**：相同思路合并（保留 trade-off 描述最完整的版本）
3. **聚类**：按象限（保守/标准/激进）归类
4. **筛选**：每个象限挑 1-2 个最强方案，总数 3-5 个
5. **归档**：写入 Discovery 文档"方案空间"章节，标注每个方案的来源模型

### Discovery 文档章节

发散结果在 Discovery 文档中至少占一个章节：

```markdown
## 方案空间

### HMW
<开放问句>

### 候选方案

#### 方案 A（保守）: <名称>
- 思路: ...
- trade-off: ...
- 范围: ~N 文件
- 来源: <HMW 推导 | LLM:claude-opus-4-7>

#### 方案 B（标准）: <名称>
...

#### 方案 C（激进）: <名称>
...

### 推荐
<analyst 综合判断 + 理由>
```

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

### 粒度控制

- XL (>500 文件) → 必须拆解为多个 ≤L 级 (≤500) 的 Issue
- L (150-500) → 建议拆解为多个 M 级
- XS (<10) → 考虑是否应合并到更大 Issue 中

## 代码库探索

判定影响范围时关注：

- `package.json` workspaces — 包列表和依赖关系
- 包间 import 图 — `@project/core` → `@project/ui` 等
- 关键目录结构 — 每个包的 `src/` 子目录

不做的事：

- 不读具体代码实现
- 不分析架构细节
- 不评估技术难度
- 不写代码

## 参考

`.octopus/WORKFLOW.md`
