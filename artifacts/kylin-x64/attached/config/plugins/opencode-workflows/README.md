# LingxiCode Workflows 使用指导

> 适用版本：**v0.1.6**（LingxiCode 1.18.18 离线集成版，插件已内置默认启用，无需安装）

**Workflows** 是多 Agent 编排框架：把「需求 → 设计 → 编码 → 测试」这类反复执行的多步骤工作
固化为可复用的 workflow，由框架调度多个子 Agent 并行/串行完成，全程可监控、可断点续跑。

## 核心能力

- **多 Agent 编排**：并行扇出（branch）、流水线（pipeline）、审查门控 Ralph Loop（gate）、
  子 Workflow 内联（subflow）。
- **四个内置 Workflow**：PRD / Design / Code / Test，开箱即用（自带默认配置）。
- **企业配置桥接**：为每个 workflow 喂入模板 / 规约 / 审查清单并指定产出路径，配置驱动
  而无需改脚本。
- **⭐ 对话式创建（自主编排）**：敲 `/workflows-create`，用一句话描述你的流程，模型多轮
  对话引导，框架自动生成可运行的多 Agent 编排脚本并落盘全局目录、跨项目复用——不写一行
  代码即可自定义 workflow（也可用 `/workflows-studio` 的「新建」走表单式向导）。

---

## 1. 八条斜杠命令

入口是 TUI 输入框的 **8 条 `/workflows-*` 斜杠命令**（每条带 `wf-*` 短别名）。命令从输入框
自动补全列表**选中触发**——不要敲「命令 + 空格 + 参数」，带空格的尾随文本会关闭补全面板、
整段被当普通对话发给模型。运行所需参数（如需求文本）由命令选中后**弹出的对话框**收集。

| # | 命令 | 别名 | 作用 |
|---|------|------|------|
| 1 | `/workflows-create` | `/wf-create` | ⭐ **对话式创建自定义 workflow**：一句话需求 → 模型引导多轮对话生成并落盘 |
| 2 | `/workflows-run` | `/wf-run` | 选 workflow → 输入需求 → 后台启动运行 |
| 3 | `/workflows-studio` | `/wf-studio` | Workflow **类型**增删改查：浏览 / 表单式新建 / 改配置 / 改结构 / 删除 |
| 4 | `/workflows-resume` | `/wf-resume` | 选非 running 的 run → 断点续跑 |
| 5 | `/workflows-cancel` | `/wf-cancel` | 选 running/paused 的 run → 确认 → 取消 |
| 6 | `/workflows-pause` | `/wf-pause` | 选 running 的 run → 暂停 |
| 7 | `/workflows-delete` | `/wf-delete` | 选非 running 的 run → 确认 → 删除运行产物 |
| 8 | `/workflows-monitor` | `/wf-monitor` | 打开三层下钻全屏监控界面 |

> **两条创建路径，按习惯选**：`/workflows-create` 是**对话式**（AI 问你答，适合想让模型替你
> 规划）；`/workflows-studio` →「新建」是**表单式**全屏向导（自己逐字段填，适合精确把控）。
> 两者产物等价，都落盘到 `~/.opencode-workflows/`（全局目录，跨项目复用）。

## 2. ⭐ 创建 Workflow：`/workflows-create`

核心能力：**不写一行代码，用对话描述流程，框架生成可运行的多 Agent 编排脚本**。

**三步用起来**

1. **触发**：补全列表选中 `/workflows-create`，弹出输入框。
2. **一句话描述需求**：例如「从需求到概要设计、详细设计，再到 TDD 代码开发」。提交后模型调用
   内置的 `workflow-create` 工具，开始多轮对话式引导。
3. **回答模型的提问框**：点选或在「Type your own answer」直接输入。

**模型先让你二选一节奏**

| 模式 | 适合 | 流程 |
|------|------|------|
| **详细规划** | 精确控制每个阶段、资源、产出 | 逐项问：阶段划分 → 资源类别 → 资源路径 → 审查轮次 + 产出形态 → 输出路径 |
| **直接生成** | 快速拿到可用版本 | 模型自动推断，直达「生成前确认」 |

「详细规划」依次问到：**名称**（kebab-case，如 `req-to-code`）→ **描述** → **阶段划分** →
**各阶段资源类别**（template 模板 / rules 规约 / review 审查清单，多选）→ **资源路径**（相对
项目根写 `docs/x.md`；暂不配置写 `none`）→ **审查轮次**（1–10，默认 3）+ **产出形态**
（文档=框架落盘 / 代码=子 Agent 直接写仓库 / 仅中间结果）→ **输出路径**（支持 `<FEATURE>` /
`<RUNID>` 占位符）。

**生成前确认**：模型给出文字摘要 + ASCII 流程图，你确认后才生成。脚本经契约校验后落盘到
`~/.opencode-workflows/<name>.mjs` 并自动注册；校验不过会自我修正重试（最多 3 轮）。

**实用建议**

- 路径写法：落项目里写相对路径 `docs/x.md`，开头**不要加 `/`**（会被当绝对路径解析到盘符根）。
- 不确定就先「直接生成」，拿到能跑的版本后再用 `/workflows-studio` 精修。
- 资源是**只读输入**：模板/规约只被子 Agent 用 `read` 读取，不会被改写。
- 阶段别拆太碎：3 步能完成别硬拆 7 步；审查门控只在真正需要校验的阶段加（门控消耗轮次与 token）。

## 3. 运行 Workflow：`/workflows-run`

选中后两步：**选 workflow**（4 个内置 `default-*` + 全局自定义，自定义带 `(user)` 标记）→
**输入需求**（本次运行的需求/提示词，以 `ctx.args.feature` 注入脚本；留空脚本回退默认值）。

启动后**立即返回 runId**（后台运行，主对话不阻塞），自动跳转全屏监控界面，左侧 Sidebar 同时
出现该 run 的实时进度。

**四个内置 Workflow**

| name | 阶段 | 说明 |
|------|------|------|
| `default-prd` | PRD | 并行检索 → 任务规划 → 概要设计/PRD 文档 → 审查门控 → 落盘 |
| `default-design` | Design | 同上 + 设计一致性审查维度 |
| `default-code` | Code | 检索 → 环境检测+规划 → TDD 红灯 → 实现 → TDD 绿灯 → 代码审查 |
| `default-test` | Test | 检索 → 规划 → 测试编写 → 执行+覆盖率门控 → 测试审查 → 报告落盘 |

## 4. 全屏监控：`/workflows-monitor`

三层下钻，`↑/↓` 选择、`Enter` 进入、`Esc` 逐层返回：

```
L1 列表        所有 run（状态 / 需求标签 / agent 数 / token / 耗时）
  └ L2 phases  选中 run 的阶段双栏（左栏阶段、右栏该阶段 agent 列表）
      └ L3 详情 单个 agent：元信息 / Prompt 全文 / Activity 会话日志 / Outcome 输出
```

**运行态信息怎么看**

| 显示 | 含义 |
|------|------|
| ▶ `running`，耗时 `—`、tokens `0` | 该 agent 处于运行中——但完成前这些字段**不更新**（快照在完成时才回填），**判断是否真在产出请下钻 L3 看 Activity 段**：会话日志（含 AI 思考文字）持续增长 = 在产出；长时间无增长 = 等待 LLM 响应或已挂起 |
| ✔ `done · 7m06s · 87.9k tok` | 终态：时长定格、token/模型回填（真实模型如 `enterprise-llm/glm-5.2`） |
| L2 右栏多个 agent 同为 `running` | 脚本用 `ctx.parallel` 并行扇出，它们确实同时启动；各自是否真在产出需逐个下钻 L3 确认 |

**控制快捷键**（L1/L2 均可用，作用于当前选中 run）：

| 键 | 作用 |
|----|------|
| `p` | 暂停（running 才可） |
| `r` | 恢复续跑（非 running/pausing 才可） |
| `x` | 终止（弹二次确认，running/pausing/paused 可） |
| `d` | 删除产物（弹二次确认，仅 L1 列表层、非 running 可） |

操作成功会**向你的工作 session 对话流注入一条回执**（如「✅ 已恢复 …」），操作痕迹可追溯。

**L3 内**：`j/k` 滚动、`e` 展开/折叠多行 Prompt、`↑/↓` 切换 agent。

## 5. 运行控制与断点续跑语义

| 操作 | 语义 |
|------|------|
| `pause` | 运行中 run 暂停（非终态）；在途子 Agent 被近实时中止，resume 时**重跑** |
| `resume` | 从断点续跑：**已完成且 prompt 一致的 agent 复用缓存**（不重跑、不重复烧 token）；失败/被打断的 agent 沿原编号重跑 |
| `cancel` | 二次确认后取消，子 Agent 级联终止 |
| `delete` | 二次确认后删除该 run 全部产物（脚本归档、journal、快照） |

**两个重要行为特征**（实测确认）：

1. **运行中 agent 的耗时/token 不实时更新**——快照字段在 agent 完成时才回填，运行期间显示
   `—` / `0` 是当前版本的设计；实时进展请看 L3 的 Activity 会话日志。
2. **resume 重放是逐步推进的**——复用的 agent 瞬间完成，重跑的 agent 按真实时长执行；被打断
   的 agent 重跑成功后，其耗时/token/模型按新一轮执行结果回填。

## 6. 回执与「Workflows」收件箱

- 斜杠命令（run/resume/pause/cancel/delete）与 monitor 按键操作成功后，都会向对话流注入一条
  **不触发模型**的回执消息（操作类型 / workflow 名 / runId / 查看引导）。
- 若操作时你正停留在 **home 主界面**（无对话 session），框架会自动创建一个名为
  **「Workflows」** 的 session 承载回执——monitor 里按 Esc 返回时会落在该 session 页
  （session 页才有 Sidebar 面板）。同一进程内所有回执汇入同一收件箱，不会重复创建。
- 收件箱只是回执载体，**任务执行本身在各 agent 独立的子 session 中进行**，互不干扰。

## 7. 企业配置：`<name>.config.json`

推荐经 `/workflows-studio` →「改配置」编辑——为每个 workflow 输入外部模板 / 规约 / 审查清单并指定产出落盘路径，配置驱动、无需改脚本。

**位置与解析优先级**（单文件模型：一个 workflow 一个独立配置文件）：

| 层级 | 来源 | 优先级 |
|------|------|--------|
| 单文件配置 | `~/.opencode-workflows/<name>.config.json` | 最高 |
| 内置脚本默认 | 仅 `default-*` 四个内置 | 中 |
| 空配置降级 | 全缺失时按空配置运行（不报错） | 最低 |

> 单文件一旦落盘即**整体生效**：文件里未写的字段不会回退内置默认——如未写 `output_path`
> 则该阶段不落盘（写 `none` 同样不落盘）。

**内置 default workflow 的开箱默认**（未经 studio 落盘配置时）：

| Workflow | 落盘路径 | 审查轮次 | 资源 |
|----------|---------|---------|------|
| `default-prd` | `docs/prd.md` | 3 | `none`（占位） |
| `default-design` | `docs/design.md` | 3 | `none` |
| `default-code` | 不支持配置，代码由子 Agent 按项目结构写入 | 3 | `none` |
| `default-test` | `docs/test.md` | 3 | `none` |

资源占位 `none` 即「未配置」：审查门控对该维度无对照基准，直接判过。经 `/workflows-studio`
「改配置」填入本地路径并落盘后即覆盖默认。

**纯 per-phase 格式**（顶层即配置块，按阶段嵌套）：

```jsonc
// ~/.opencode-workflows/default-prd.config.json
{
  "resources": {
    "PRD": {
      "template": ["./ai-agent/templates/PRD模板.md"],
      "rules": ["./ai-agent/rules/PRD工程规约.md"],
      "review": ["./ai-agent/review/概要设计审查清单.md"]
    }
  },
  "output_path": { "PRD": "docs/<FEATURE>/概要设计文档.md" },
  "max_review_rounds": { "PRD": 3 }
}
```

- `resources`：外层键 = **阶段名**，内层键 = 类别名（template/rules/review 或自定义），值为路径或路径数组；留空或 `none` = 该类别不生效。
- `output_path` / `max_review_rounds` 均为**字典**（阶段名 → 值）；`output_path` 支持占位符
  `<RUNID>`（短 runId）与 `<FEATURE>`（从需求提取的标签，提取失败回退短 runId），引擎启动
  run 时替换；`max_review_rounds` 钳制 [1,10]、缺省 3。
- 相对路径以 LingxiCode 启动目录绝对化，绝对路径原样保留；路径值首尾的成对引号自动剥离
  （Windows「复制为路径」可直接粘贴）。
- 框架只解析路径、不读内容；模板由子 Agent 运行时用 `read` 工具读取；文件缺失 / 非法 JSON
  不报错，按上方优先级表回退。

## 8. 类型增删改查：`/workflows-studio`

全屏 Studio，首屏意图菜单（`↑/↓` 选择、`Enter` 进入、`Esc` 逐层返回）：

- **📖 浏览类型 / 查看详情**：来源 / 描述 / 适用场景 / 阶段 / 脚本路径（只读）。
- **✨ 新建 workflow（表单式）**：全屏向导逐字段填写，与 `/workflows-create` 产物等价。
- **⚙ 改配置**：选类型（含内置）编辑 `.config.json`（资源 / 输出路径 / 轮次）。
- **🛠 改结构**：编辑自定义 workflow 的完整阶段编排（带结构草稿的才可改）。
- **🗑 删除类型**：仅用户自定义可删（二次确认），内置不可删。

## 9. 运行产物目录

所有**运行产物**写入项目目录下的 `.opencode/workflows/`（storageRoot）：

```
.opencode/workflows/
├── runs/wf_<runId>.json           # Run 快照（状态/进度/token/logs，Sidebar 与 Monitor 据此渲染）
├── journal/<runId>/journal.jsonl  # agent 事件流（resume 复用判定 + 审计）
└── scripts/<name>-wf_<runId>.mjs  # 本次运行脚本的归档副本
```

> 区分两个目录：`.opencode/workflows/`（**运行产物**，随项目）与 `~/.opencode-workflows/`
> （**自定义脚本 + 全局配置**，跨项目复用）。

## 10. 常见问题

| 现象 | 处理 |
|------|------|
| 补全列表没有 `/workflows-*` | 检查 `config/plugins/opencode-workflows/` 目录存在，且 `config/opencode.json` 与 `config/tui.json` 的 `plugin` 数组均含 `./plugins/opencode-workflows`（两个声明各激活一个入口，缺一不可） |
| Sidebar 无 Workflow 区域 | 面板仅显示在 session 页（home 页没有）；若 session 页也无，检查插件加载与 `storageRoot` |
| 自定义 workflow 不被发现 | 脚本须放在全局目录 `~/.opencode-workflows/` |
| `ctx.config` 全为空 | 配置文件名须为 `<workflow 全名>.config.json`，且用 per-phase 字典格式 |
| 子 Agent 全部超时/失败 | 企业 LLM 服务不可用或网络中断；网络恢复后 `/workflows-resume` 续跑（含门控自愈重试） |
| run 永远卡在 running | 多为窗口曾被关闭/进程崩溃（引擎随 TUI 进程死亡）；重启 LingxiCode 会自动回收孤儿 run，或 `/workflows-cancel` 手动清理 |
| 完成的 agent 模型显示 `—` | 旧版本数据缺失（resume 复用历史 agent 时未记录模型）；v0.1.6+ 新数据正常显示 |
| monitor 列表短暂闪空 | 快照写入与读取的瞬时竞态，2 秒内自动恢复，无需处理 |

---

*本指导基于 LingxiCode 1.18.18 离线集成版（插件 v0.1.6）整理。*
