# 专利智能体模块 - 第二阶段实施方案

> **日期：** 2026-05-27
> **范围：** 代码质量修复、测试覆盖、功能补全、集成验证
> **前置：** 第一阶段（Tasks 1-13）已完成

---

## 一、现状概述

### 1.1 已完成工作（第一阶段）

- ✅ 8 个 Effect Service：PatentKG, PatentKnowledge, PatentLaw, PatentIPC, PatentSearch, PatentTemplate, PatentDocument, PatentDrawing
- ✅ PatentWorkflow + PatentQuality Service
- ✅ 5 个 Tool：patent_convert, patent_research, patent_search, patent_analyze, patent_check
- ✅ 2 个 Agent（patent-draft, patent-oa）prompt 文件已创建
- ✅ 配置模块 `src/config/patent.ts`
- ✅ 部分测试文件：kg.test.ts, knowledge.test.ts, law.test.ts, ipc.test.ts, search.test.ts, workflow.test.ts, quality.test.ts, document.test.ts

### 1.2 当前问题

**严重问题（阻塞运行）：**
- ❌ 类型检查失败：`test/patent/kg.test.ts` 中 `full_ref` 字段 `null` 赋值类型错误
- ❌ Agent 未注册：`src/agent/agent.ts` 中尚未添加 patent-draft 和 patent-oa Agent 定义
- ❌ Tools 未注册：虽然 registry.ts 中有 import，但未添加到 builtin 数组

**重要问题（影响质量）：**
- ⚠️ 缺少测试：template.test.ts, drawing.test.ts, patent-convert.test.ts, patent-research.test.ts, patent-analyze.test.ts, patent-search.test.ts, patent-check.test.ts
- ⚠️ 测试覆盖不足：现有测试主要为 happy path，缺少错误处理和边界条件测试
- ⚠️ 占位实现：部分 Service 可能包含占位逻辑（如 PatentSearch, PatentDrawing）

**次要问题（可延后）：**
- 📝 集成测试缺失：缺少端到端的 Agent 调度验证
- 📝 数据资产部署：patent_kg.db 等数据库的符号链接或复制脚本缺失

---

## 二、第二阶段任务分解

### 阶段 A：代码质量修复（优先级最高）

#### Task A1: 修复类型错误

**预期产出：** `bun typecheck` 通过

**子任务：**

1. **修复 test/patent/kg.test.ts 类型错误**
   - 文件：`test/patent/kg.test.ts:14, 46`
   - 问题：`full_ref: null` 赋值给 `string | undefined` 类型
   - 修复：使用 `undefined` 或修改 Schema 定义

2. **修复 Effect layer 类型不匹配**
   - 影响：多处测试 layer 类型错误
   - 根因：Layer 的 R 类型（requirements）推断问题
   - 修复：在测试中显式提供所需的 layer 依赖

**验收标准：**
- `bun typecheck` 输出 0 errors
- `bun test test/patent/*.test.ts` 通过

---

### 阶段 B：测试覆盖补充

#### Task B1: Service 测试补全

**预期产出：** 每个 Service 有完整的单元测试

**缺失的测试文件：**

1. **template.test.ts**
   - 文件：`test/patent/template.test.ts`
   - 测试内容：
     - `getSpecificationTemplate()` 返回有效模板
     - `getClaimsTemplate()` 不同专利类型返回不同模板
     - `getOATemplate()` 返回答复模板
     - 模板文件不存在时的降级处理

2. **drawing.test.ts**
   - 文件：`test/patent/drawing.test.ts`
   - 测试内容：
     - `analyzeDrawing()` 调用 Provider 的多模态能力
     - `extractDrawingElements()` 返回结构化元素
     - 图片路径不存在时的错误处理
     - 使用 mock Provider Service

3. **document.test.ts**（已存在，需补充）
   - 文件：`test/patent/document.test.ts`
   - 补充测试：
     - DOCX 文件转换为 Markdown
     - PDF 文件转换为 Markdown（需 mock pdf-parse）
     - TXT/MD 文件直接读取
     - 不支持的格式返回错误
     - OCR 模式测试（可选）

**验收标准：**
- 每个 Service 测试覆盖所有公开方法
- 测试包含正常路径和错误路径
- 测试通过率达到 100%

---

#### Task B2: Tool 测试补全

**预期产出：** 每个 Tool 有完整的单元测试

**缺失的测试文件：**

1. **patent-convert.test.ts**
   - 文件：`test/patent/patent-convert.test.ts`
   - 测试内容：
     - `action: "convert"` 调用 PatentDocument Service
     - `action: "analyze_drawing"` 调用 PatentDrawing Service
     - `action: "batch_convert"` 批量处理多个文件
     - 参数校验（必填字段、枚举值）
     - 使用 mock Service layer

2. **patent-research.test.ts**
   - 文件：`test/patent/patent-research.test.ts`
   - 测试内容：
     - 并行调用 4 个 Service（KG, Law, Knowledge, IPC）
     - 不同 scope 过滤输出
     - 不同 depth 影响输出详细程度
     - 所有 Service 返回空时的降级处理

3. **patent-search.test.ts**
   - 文件：`test/patent/patent-search.test.ts`
   - 测试内容：
     - `isAvailable() === false` 时返回提示
     - 可用时调用 PatentSearch Service
     - 参数校验

4. **patent-analyze.test.ts**
   - 文件：`test/patent/patent-analyze.test.ts`
   - 测试内容：
     - `action: "compare"` 对比分析
     - `action: "novelty"` 新颖性分析
     - `action: "inventiveness"` 创造性分析
     - `action: "prior_art"` 现有技术分析
     - 调用 Provider LLM + 可选 PatentKG

5. **patent-check.test.ts**
   - 文件：`test/patent/patent-check.test.ts`
   - 测试内容：
     - 调用 PatentQuality Service
     - `auto_fix: true` 时触发修复逻辑
     - 参数校验
     - 输出格式验证

**验收标准：**
- 每个 Tool 测试覆盖所有参数组合
- 测试包含成功路径和失败路径
- 使用 `testEffect` 模式
- 测试通过率达到 100%

---

### 阶段 C：占位功能补全

#### Task C1: PatentSearch Service 真实实现

**当前状态：** 空壳，`isAvailable()` 默认返回 false

**实现计划：**

1. **配置驱动的后端选择**
   ```ts
   // Config
   interface PatentSearchConfig {
     backend: "none" | "local" | "google" | "custom"
     connectionString?: string
   }
   ```

2. **实现 local 后端**
   - 读取 `patent_search.db`（SQLite）
   - FTS5 全文检索
   - 按字段过滤（applicant, ipc, field）

3. **实现 google 后端**
   - 调用 Google Patents API
   - 结果转换为统一格式

**验收标准：**
- `isAvailable()` 正确反映配置状态
- `search()` 在不可用时返回错误
- `search()` 在可用时返回结果

---

#### Task C2: PatentDrawing Service 多模态集成

**当前状态：** 可能是占位实现

**实现计划：**

1. **通过 Provider 调用多模态模型**
   - 使用 Provider Service 的 `chat()` 方法
   - 传入 `image_url` 参数
   - 模型选择：支持 vision 的模型（Claude, GPT-4o, Gemini）

2. **图纸结构化分析**
   - 识别组件、连接关系、标注
   - 返回 JSON 格式分析结果

**验收标准：**
- `analyzeDrawing()` 能识别图片内容
- `extractDrawingElements()` 返回结构化数据
- 错误处理：图片路径不存在、模型不支持 vision

---

#### Task C3: PatentTemplate Service 模板文件

**当前状态：** 模板文件可能缺失

**实现计划：**

1. **创建模板目录**
   ```
   src/patent/templates/
   ├── specification-device.txt
   ├── specification-method.txt
   ├── specification-system.txt
   ├── specification-composition.txt
   ├── claims-device.txt
   ├── claims-method.txt
   ├── claims-system.txt
   ├── claims-composition.txt
   └── oa-response.txt
   ```

2. **模板内容**
   - 参照设计文档第 3.9 节
   - 包含占位符（如 `{{技术领域}}`）

**验收标准：**
- 模板文件存在且可读
- `getSpecificationTemplate()` 返回正确模板
- 模板占位符可被替换

---

### 阶段 D：集成验证

#### Task D1: Agent 注册验证

**预期产出：** patent-draft 和 patent-oa Agent 能被正确调度

**子任务：**

1. **在 src/agent/agent.ts 中注册 Agent**
   - 位置：在 `agents` 对象中添加两个新 Agent
   - 模式：参照现有 `explore` Agent
   - 权限：包含 patent_* tools + read + write
   - Prompt：导入 `patent-draft.txt` 和 `patent-oa.txt`

2. **端到端测试**
   - 测试：`test/patent/integration.test.ts`
   - 验证：
     - `Agent.Service.get("patent-draft")` 返回定义
     - `Agent.Service.get("patent-oa")` 返回定义
     - Agent 的 permission 配置正确
     - Agent 的 steps 字段正确（5步）

**验收标准：**
- Agent 注册代码通过 typecheck
- 集成测试通过
- Agent 的所有字段符合设计文档

---

#### Task D2: Tool 注册验证

**预期产出：** 5 个专利 Tool 能被正确调用

**子任务：**

1. **在 src/tool/registry.ts 中注册 Tool**
   - 位置：`builtin` 数组中追加
   - 代码：`yield* PatentConvertTool` 等 5 个 Tool
   - 位置：在现有工具之后

2. **端到端测试**
   - 测试：`test/patent/integration.test.ts`
   - 验证：
     - `ToolRegistry.Service.all()` 包含 5 个专利 Tool
     - Tool 的 `id` 字段正确（patent_research, patent_search, patent_analyze, patent_check, patent_convert）
     - Tool 的 `parameters` Schema 正确

**验收标准：**
- Tool 注册代码通过 typecheck
- 集成测试通过
- 所有 5 个 Tool 能被列举

---

#### Task D3: 数据资产部署脚本

**预期产出：** 自动化数据资产部署

**子任务：**

1. **创建部署脚本**
   - 文件：`scripts/setup-patent-data.sh`
   - 功能：
     - 检查 `patent.dataDir` 配置
     - 创建符号链接到数据库文件
     - 复制 cards/ 目录（如不存在）
     - 复制 审查指南/ 目录（如不存在）
     - 复制 复审无效/ 目录（如不存在）

2. **更新 .gitignore**
   - 排除数据库文件（*.db, *.db-shm, *.db-wal）
   - 排除数据目录（data/cards/, data/审查指南/, data/复审无效/）

**验收标准：**
- 脚本能正确创建符号链接
- 脚本能正确复制文件
- .gitignore 正确排除数据资产

---

### 阶段 E：后续批次规划

#### Task E1:创造性判断 Agent（patent-creativity）

**设计参考：** 设计文档第 5 节

**工作流步骤：**
1. 技术方案理解（三元组提取）
2. 现有技术检索与对比
3. 创造性分析（三步法）
4. 技术效果论证
5. 创造性结论报告

**依赖：**
- patent_search Tool
- patent_research Tool
- patent_analyze Tool

**预期产出：**
- Agent prompt 文件：`src/agent/prompt/patent-creativity.txt`
- Agent 注册：`src/agent/agent.ts`
- 测试文件：`test/patent/creativity.test.ts`

---

#### Task E2:复审请求 Agent（patent-reexam）

**设计参考：** Athena 业务流程 `knowledge-graph-reexam.md`

**工作流步骤：**
1. 复审请求前置分析（驳回理由确认）
2. 复审理由深度分析
3. 证据收集与准备
4. 复审请求书撰写
5. 最终验证与打包

**依赖：**
- patent_research Tool
- patent_analyze Tool
- patent_check Tool

**预期产出：**
- Agent prompt 文件：`src/agent/prompt/patent-reexam.txt`
- Agent 注册：`src/agent/agent.ts`
- 测试文件：`test/patent/reexam.test.ts`

---

#### Task E3:无效宣告 Agent（patent-invalidation）

**设计参考：** 设计文档第 5 节

**工作流步骤：**
1. 目标专利分析（技术方案 + 权利要求）
2. 现有技术检索
3. 无效理由构建（新颖性/创造性/公开不充分/修改超范围）
4. 证据组合策略
5. 无效宣告请求书撰写

**依赖：**
- patent_search Tool
- patent_research Tool
- patent_analyze Tool
- patent_check Tool

**预期产出：**
- Agent prompt 文件：`src/agent/prompt/patent-invalidation.txt`
- Agent 注册：`src/agent/agent.ts`
- 测试文件：`test/patent/invalidation.test.ts`

---

#### Task E4:商标 Agent（patent-trademark）

**设计参考：** 业务需求文档

**工作流步骤：**
1. 商标检索与近似分析
2. 类别确定（45个类别）
3. 显著性分析
4. 商标注册申请撰写
5. 异常情况处理

**依赖：**
- 新增商标检索 Tool
- 新增商标分类 Tool

**预期产出：**
- Agent prompt 文件：`src/agent/prompt/patent-trademark.txt`
- Agent 注册：`src/agent/agent.ts`
- 测试文件：`test/patent/trademark.test.ts`

---

## 三、实施顺序建议

### 第一批（紧急，1-2天）
- Task A1: 修复类型错误
- Task B1: Service 测试补全（优先 template, drawing）
- Task D1: Agent 注册验证
- Task D2: Tool 注册验证

### 第二批（重要，3-5天）
- Task B1: Service 测试补全（补充 document 测试）
- Task B2: Tool 测试补全（全部 5 个 Tool）
- Task C1: PatentSearch Service 真实实现
- Task D3: 数据资产部署脚本

### 第三批（优化，2-3天）
- Task C2: PatentDrawing Service 多模态集成
- Task C3: PatentTemplate Service 模板文件
- 补充集成测试和边界条件测试

### 第四批（后续批次，5-7天）
- Task E1: 创造性判断 Agent
- Task E2: 复审请求 Agent
- Task E3: 无效宣告 Agent
- Task E4: 商标 Agent

---

## 四、文件清单

### 需要修复的文件
```
test/patent/kg.test.ts                      ← 类型错误修复
src/agent/agent.ts                          ← 添加 Agent 定义
src/tool/registry.ts                        ← 添加 Tool 注册
```

### 需要创建的测试文件
```
test/patent/template.test.ts                ← Task B1
test/patent/drawing.test.ts                 ← Task B1
test/patent/patent-convert.test.ts          ← Task B2
test/patent/patent-research.test.ts         ← Task B2
test/patent/patent-search.test.ts           ← Task B2
test/patent/patent-analyze.test.ts          ← Task B2
test/patent/patent-check.test.ts            ← Task B2
test/patent/integration.test.ts             ← Task D1, D2
```

### 需要创建的模板文件
```
src/patent/templates/specification-device.txt      ← Task C3
src/patent/templates/specification-method.txt       ← Task C3
src/patent/templates/specification-system.txt       ← Task C3
src/patent/templates/specification-composition.txt  ← Task C3
src/patent/templates/claims-device.txt              ← Task C3
src/patent/templates/claims-method.txt               ← Task C3
src/patent/templates/claims-system.txt               ← Task C3
src/patent/templates/claims-composition.txt          ← Task C3
src/patent/templates/oa-response.txt                ← Task C3
```

### 需要修改的实现文件
```
src/patent/search.ts                      ← Task C1（补充实现）
src/patent/drawing.ts                     ← Task C2（补充实现）
src/patent/template.ts                    ← Task C3（补充实现）
```

### 需要创建的脚本
```
scripts/setup-patent-data.sh              ← Task D3
```

### 后续批次文件
```
src/agent/prompt/patent-creativity.txt    ← Task E1
src/agent/prompt/patent-reexam.txt        ← Task E2
src/agent/prompt/patent-invalidation.txt  ← Task E3
src/agent/prompt/patent-trademark.txt     ← Task E4
test/patent/creativity.test.ts            ← Task E1
test/patent/reexam.test.ts                ← Task E2
test/patent/invalidation.test.ts          ← Task E3
test/patent/trademark.test.ts             ← Task E4
```

---

## 五、验收标准

### 代码质量
- ✅ `bun typecheck` 通过（0 errors）
- ✅ `bun test` 通过（100% pass）
- ✅ 无 `any` 类型（Effect Service 中）
- ✅ 遵循项目代码规范（Effect 规则、命名约定）

### 测试覆盖
- ✅ 每个 Service 至少有 1 个测试文件
- ✅ 每个 Tool 至少有 1 个测试文件
- ✅ 测试覆盖所有公开方法
- ✅ 测试包含正常路径和错误路径
- ✅ 使用 `testEffect` 模式（Effect 测试）

### 功能完整性
- ✅ 所有 Service 方法实现真实逻辑（无占位）
- ✅ 所有 Tool 能被正确调用
- ✅ 所有 Agent 能被正确调度
- ✅ 配置系统完整（patent.ts）
- ✅ 数据资产部署脚本可用

### 集成验证
- ✅ Agent 能通过 `Agent.Service.get()` 获取
- ✅ Tool 能通过 `ToolRegistry.Service.all()` 列举
- ✅ Agent 的 permission 配置正确
- ✅ Tool 的 parameters Schema 正确
- ✅ 端到端调用成功（模拟场景）

---

## 六、风险评估

### 高风险
- **类型错误影响范围大：** Effect layer 类型问题可能影响多个测试
- **数据资产依赖：** 缺少数据库文件时测试会降级，可能掩盖问题

### 中风险
- **Provider 依赖：** PatentQuality 和 PatentDrawing 依赖 Provider Service
- **多模态模型支持：** 需要确认 Provider 是否支持 vision 模型

### 低风险
- **模板文件内容：** 可以在运行时动态调整
- **后续批次 Agent：** 不影响第一批功能

### 缓解措施
- 提前创建 mock 数据和 mock Service layer
- 使用 `testEffect` 的 mock 功能隔离依赖
- 优先修复类型错误，再补充测试

---

## 七、后续工作

### Phase 3：移除 opencode-patent-plugin
- 删除 `opencode-patent-plugin` 包引用
- 迁移剩余功能到内置实现
- 更新 Professional Router 提示词

### 性能优化
- PatentKG Service 缓存热点查询
- PatentKnowledge Service 并行优化
- PatentSearch Service 分页支持

### 文档完善
- API 文档（Effect Service 接口）
- Agent 使用指南
- Tool 参数说明
- 配置说明文档

---

## 附录：代码示例

### A1. 修复 test/patent/kg.test.ts 类型错误

```ts
// 修复前
full_ref: null,

// 修复后（方案 1）
full_ref: undefined,

// 或修复后（方案 2）
full_ref: null as (string | null),
```

### D1. 在 src/agent/agent.ts 中注册 Agent

```ts
import PROMPT_PATENT_DRAFT from "./prompt/patent-draft.txt"
import PROMPT_PATENT_OA from "./prompt/patent-oa.txt"

// ... 在 agents 对象中添加
"patent-draft": {
  name: "patent-draft",
  description: "专利申请文件撰写。从技术交底书出发，5步骤产出完整申请文件。",
  mode: "subagent",
  prompt: PROMPT_PATENT_DRAFT,
  steps: 5,
  permission: Permission.merge(defaults, Permission.fromConfig({
    patent_convert: "allow",
    patent_research: "allow",
    patent_search: "allow",
    patent_analyze: "allow",
    patent_check: "allow",
    read: "allow",
    write: "allow",
  }), user),
  options: {},
},
"patent-oa": {
  name: "patent-oa",
  description: "审查意见答复。5步骤产出完整答复文件包。",
  mode: "subagent",
  prompt: PROMPT_PATENT_OA,
  steps: 5,
  permission: Permission.merge(defaults, Permission.fromConfig({
    patent_convert: "allow",
    patent_research: "allow",
    patent_search: "allow",
    patent_analyze: "allow",
    patent_check: "allow",
    read: "allow",
    write: "allow",
  }), user),
  options: {},
},
```

### D2. 在 src/tool/registry.ts 中注册 Tool

```ts
// 在 builtin 数组中追加
yield* PatentConvertTool,
yield* PatentResearchTool,
yield* PatentSearchTool,
yield* PatentAnalyzeTool,
yield* PatentCheckTool,
```

### D3. 数据资产部署脚本示例

```bash
#!/bin/bash

# scripts/setup-patent-data.sh

set -euo pipefail

# 数据源目录
DATA_SOURCE="$HOME/YunPat/data"
# 目标目录
DATA_TARGET="$HOME/.opencode/patent/data"

# 创建目标目录
mkdir -p "$DATA_TARGET"

# 符号链接数据库
ln -sf "$DATA_SOURCE/patent_kg.db" "$DATA_TARGET/patent_kg.db"
ln -sf "$DATA_SOURCE/semantic-index.db" "$DATA_TARGET/semantic-index.db"
ln -sf "$DATA_SOURCE/laws.db" "$DATA_TARGET/laws.db"

# 复制文件目录（如果不存在）
if [ ! -d "$DATA_TARGET/cards" ]; then
  cp -r "$DATA_SOURCE/cards" "$DATA_TARGET/cards"
fi

if [ ! -d "$DATA_TARGET/审查指南" ]; then
  cp -r "$DATA_SOURCE/审查指南" "$DATA_TARGET/审查指南"
fi

if [ ! -d "$DATA_TARGET/复审无效" ]; then
  cp -r "$DATA_SOURCE/复审无效" "$DATA_TARGET/复审无效"
fi

echo "✓ Patent data assets deployed to $DATA_TARGET"
```

---

**文档结束**