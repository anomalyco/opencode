# OpenCode 记忆增强项目 — 多架构 RAG 替代方案与 500K/1M 深水区极限压测

> 更新时间：2026-03-15 (基于 v8/v11 进度更新)
> 项目路径：https://github.com/s572915912/opencode/tree/feat/beam_rag/packages/opencode/rag
> 核心贡献：**探索长文本场景下原生 Compaction 的替代方案，设计 4 套 RAG 架构进行消融实验，并完成 500K/1M 级别的时序感知检索压测，产出横向对比基线。**

---

## 一、 核心动机与痛点

在团队推进 v7、v8（优化 Compaction Prompt）的过程中，我发现纯粹依赖“滚动压缩”处理长上下文（Long Context）存在一个难以避免的痛点：**极长上下文的“传话筒效应”（Information Decay）**。

随着 Context 长度飙升至 500K 甚至 1M，无论 Prompt 多么优秀，LLM 在多次迭代压缩中必然会发生**细节磨损**（如特定版本号、精准的 API 延迟数据、局部变量名的丢失），并且极度消耗 Token 成本。

因此，开启了 **RAG（检索增强生成）独立架构探索分支**，试图用“无损外挂硬盘”思路解决超长文本记忆的细节留存难题。

---

## 二、 100K 级别：4 套 RAG 架构消融实验与数据对比

为探寻最优检索范式，我在 BEAM 100K 规格（Case 0）下设计了 4 套层层递进的 RAG 架构，并与 OpenCode 原生机制进行了横向对比：

### 1. 评分标准对齐说明
本阶段采用快速混合评分法：当 LLM Judge 评分 $\ge$ 0.8 时直接采信；否则执行混合计算：
`Combined Score = 0.6 * LLM_Judge + 0.25 * Token_F1 + 0.15 * Keyword_Overlap`

### 2. 架构演进与设计思路
* **方案 1：基础 RAG (Vanilla RAG)**
    * **机制**：固定 Token 滑动窗口截断 + Dense 余弦相似度检索。
* **方案 2：全局前缀 + 混合检索 (Contextual Hybrid RAG)**
    * **文献溯源**：参考 Anthropic 最新提出的 **Contextual Retrieval (上下文检索)** 理念。
    * **机制**：零 Token 成本提取对话前 300 字作为“全局背景”强制挂载至各切片头部，结合 BM25（稀疏）+ Dense（稠密）双路召回与 RRF 融合打分。
* **方案 3：LLM摘要增强 + 交叉编码器精排 (Premium RAG)**
    * **文献溯源**：参考斯坦福 ICLR 2024 **RAPTOR (递归抽象树状检索)**。
    * **机制**：调用 GPT-5.4 为切片生成摘要，并引入 `ms-marco` 交叉编码器精排。
* **方案 4：时序感知混合 RAG (Chronological Hybrid RAG)**
    * **文献溯源**：针对长序列事件推理中的 **Temporal RAG（时序检索）** 痛点。
    * **机制**：在方案 2 的基础上注入绝对物理时间标签（Segment ID），扩大召回池至 Top-10 后，**强制绕过相似度得分，执行时序重组 (Chronological Forced Sort)**，恢复事件因果链。

### 3. 100K 核心实验数据对比
*(数据来源：100K Case 0 快速跑分)*

| 测试维度 (Question Type) | OpenCode 原生 | RAG 方案1 (基础版) | RAG 方案2 (全局混合) | RAG 方案3 (精排摘要) | RAG 方案4 (时序重排) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **综合总分 (Overall)** | 49.7% | 44.7% | **52.8%** | 40.8% | 50.3% |
| **信息提取 (Info Extraction)**| 38.7% | 76.0% | **74.2%** | 50.0% | 34.8% |
| **知识更新 (Knowledge Update)** | 95.0% | 46.1% | 90.0% | 18.1% | **100.0%** |
| **时间推理 (Temporal Reasoning)** | 44.5% | 45.0% | **85.0%** | 47.0% | 51.6% |
| **全文总结 (Summarization)** | 36.9% | 0.1% | 16.4% | 40.2% | **39.5%** |
| **多会话推理 (Multi-session)** | **50.6%** | 8.8% | 0.0% | 0.0% | 2.2% |

**分析**：
* **细节提取的统治力**：方案 2 的信息提取能力高达 74.2%，远超原生的 38.7%，证明带有全局语境的 RAG 是解决长文本细节磨损的最佳方案。
* **时序重排的逻辑纠偏**：传统语义检索（方案3）在知识更新上彻底崩盘（仅18.1%），而引入时序重排的方案 4 直接拿到 100% 满分，成功修复了 RAG 经常将“旧方案”误认为“新决策”的短板。

---

## 三、 500K / 1M “深水区”极限压测与方案对比

100K 仅为热身。为探明超长上下文下 RAG 的真实抗压能力，筛选出 100K 中表现最优的 **方案 2 (Scheme 2)** 和 **方案 4 (Scheme 4)**，针对 5 个极长编程 Cases（2×500K + 3×1M）进行了全量压测。
此阶段评分已**全面对齐官方 v11 标准**（Official Nugget + Kendall tau-b + 15 线程并发）。

### 1. 方案 2 (全局前缀混合 RAG) 压测数据
> 优势在于零成本附加语境，极致保留微观实体细节。

**表 3.1.1：Scheme 2 官方 v11 评分总结**
| Case | Split | 官方得分 (Official) | 快速得分 (Combined) |
| :--- | :--- | :--- | :--- |
| Case 2 | 500K | 43.5% | 45.8% |
| Case 4 | 500K | 56.9% | 57.0% |
| Case 0 | 1M | 31.5% | 32.0% |
| Case 2 | 1M | 49.6% | 51.0% |
| Case 3 | 1M | 48.3% | 51.0% |
| **平均** | - | **45.9%** | **47.4%** |

**表 3.1.2：Scheme 2 各 Question Type 官方得分分解 (5 cases 平均)**
| 类别 (Type) | 500K C2 | 500K C4 | 1M C0 | 1M C2 | 1M C3 | **平均** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| abstention | 50.0% | 50.0% | 50.0% | 100.0% | 100.0% | **70.0%** |
| contradiction_resolution | 43.8% | 43.8% | 0.0% | 25.0% | 43.8% | **31.2%** |
| event_ordering | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | **0.0%** |
| information_extraction | 50.0% | 100.0% | 100.0% | 75.0% | 95.0% | **84.0%** |
| instruction_following | 50.0% | 100.0% | 33.3% | 58.3% | 25.0% | **53.3%** |
| knowledge_update | 50.0% | 75.0% | 0.0% | 75.0% | 50.0% | **50.0%** |
| multi_session_reasoning | 0.0% | 0.0% | 25.0% | 62.5% | 31.2% | **23.8%** |
| preference_following | 62.5% | 100.0% | 50.0% | 50.0% | 100.0% | **72.5%** |
| summarization | 41.7% | 0.0% | 18.8% | 0.0% | 0.0% | **12.1%** |
| temporal_reasoning | 87.5% | 100.0% | 37.5% | 50.0% | 37.5% | **62.5%** |

---

### 2. 方案 4 (时序感知混合 RAG) 压测数据
> 通过强制时间戳重排，有效遏制纯语义检索在长文本下的时序幻觉。

**表 3.2.1：Scheme 4 官方 v11 评分总结**
| Case | Split | 官方得分 (Official) | 快速得分 (Combined) |
| :--- | :--- | :--- | :--- |
| Case 2 | 500K | 60.0% | 60.1% |
| Case 4 | 500K | 61.3% | 53.0% |
| Case 0 | 1M | 38.8% | 42.4% |
| Case 2 | 1M | 53.6% | 58.7% |
| Case 3 | 1M | 49.3% | 58.4% |
| **平均** | - | **52.6%** | **54.5%** |

**表 3.2.2：Scheme 4 各 Question Type 官方得分分解 (5 cases 平均)**
| 类别 (Type) | 500K C2 | 500K C4 | 1M C0 | 1M C2 | 1M C3 | **平均** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| abstention | 50.0% | 100.0% | 50.0% | 100.0% | 75.0% | **75.0%** |
| contradiction_resolution | 18.8% | 56.2% | 0.0% | 43.8% | 43.8% | **32.5%** |
| event_ordering | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | **0.0%** |
| information_extraction | 100.0% | 100.0% | 91.7% | 75.0% | 65.0% | **86.3%** |
| instruction_following | 50.0% | 100.0% | 33.3% | 83.3% | 25.0% | **58.3%** |
| knowledge_update | 100.0% | 62.5% | 50.0% | 75.0% | 50.0% | **67.5%** |
| multi_session_reasoning | 70.8% | 0.0% | 50.0% | 54.2% | 43.8% | **43.8%** |
| preference_following | 100.0% | 100.0% | 50.0% | 50.0% | 100.0% | **80.0%** |
| summarization | 22.9% | 43.9% | 25.0% | 5.0% | 40.6% | **27.5%** |
| temporal_reasoning | 87.5% | 50.0% | 37.5% | 50.0% | 50.0% | **55.0%** |

### 3. Scheme 2 vs Scheme 4 表现分析
* **总分跨越**：引入强制时序重排后，Scheme 4（52.6%） 显著拉开了与 Scheme 2（45.9%） 的差距。
* **逻辑纠偏奏效**：在 `knowledge_update` 上，Scheme 4 (67.5%) 较 Scheme 2 (50.0%) 有质的飞跃，成功拦截了被召回的废旧案，使大模型得以读取最新决策。
* **长程宏观骨架修复**：受惠于更大的召回池 (Top-10) 与时序重排，Scheme 4 在 `multi_session_reasoning` 上达到 43.8%，远高于 Scheme 2 的 23.8%。

---

## 四、 横向全对比：RAG 路线 vs OpenCode版本 (v7/v8/v11 Compaction)

为了全面评估 RAG 路线与团队目前优化的 Compaction 路线，制作以下跨版本终极对比表（所有数据均采用v11评分）：

**表 4.1：Per-Case 跨版本极限对比 (官方 Nugget)**
| Case | Split |  v7 |  v8 |  v11 | **RAG Sch2** | **RAG Sch4** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Case 2 | 500K | 9.0% | 45.1% | 57.3% | 43.5% | **60.0%** |
| Case 4 | 500K | 44.2% | 43.8% | 59.6% | 56.9% | **61.3%** |
| Case 0 | 1M | 14.0% | 35.1% | 43.1% | 31.5% | 38.8% |
| Case 2 | 1M | 31.5% | 47.3% | **67.1%** | 49.6% | 53.6% |
| Case 3 | 1M | 17.0% | 51.7% | **56.8%** | 48.3% | 49.3% |
| **平均** | - | 23.1% | 44.6% | **56.8%** | 45.9% | **52.6%** |

### 对比分析洞察

1. **RAG 极具竞争力的抗压底座**：
   在尚未耗费 Token 进行总结提炼的情况下，Scheme 4 凭借时序索引硬生生拿到了 **52.6%** 的均分，超越了 v8 增强版 (44.6%)，并极其逼近重度优化的 v11 (56.8%)。这意味着“不压缩的物理寻址”是一条完全走得通的高效路径。
2. **不同路线对比**：
   * **RAG 路线（微观）**：Scheme 4 在 `information_extraction` (86.3%) 上具有绝对的统治力。在面对 1M 级别的海量 Token 时，只要信息还在库里，RAG 的双路检索就不会像 Compaction 那样把它无情“压缩掉”。
   * **Compaction 路线（宏观）**：v11 依然在 `multi_session_reasoning` 等需要超大跨度总结骨架的题目上更具优势，因为压缩机制天然是在高维抽象层面构建的剧情大纲。纯 RAG 会受限于 Top-K 截断而无法管中窥豹。
3. **共同问题**：
   无论哪条路线，在面对极其严苛的 Kendall tau-b `event_ordering` 测试时，均未取得理想成绩。这是 LLM 的固有弱点，也是后续亟待攻克的难点。

---

## 五、 下一步架构演进构想：融合处理

历经 100K 消融实验与 500K/1M 深水区压测，单一架构无法通吃极长文本：**纯压缩必然丢细节，纯 RAG 缺乏宏观大纲。**

**推进“Macro-Compaction + Micro-Temporal-RAG”双轨融合架构**
* **Macro (宏观图谱)**：沿用团队基于 v11 优化的 Compaction 机制，但大幅降低压缩频次。让其专职生成“全局剧情大纲”，以填补 `multi_session` 跨度盲区。
* **Micro (微观纠偏)**：底层并行挂载设计的 **Scheme 4 (时序感知混合 RAG)** 作为无损细节存储库。
* **Runtime 融合**：在 Generation 问答生成阶段，将高浓缩的“宏观大纲”与检索拦截出的“Top-K 时序精确切片”同步喂给大模型。

## 六、 文件结构 (RAG 架构分支)

| 文件 / 目录 | 说明 | 状态 |
| :--- | :--- | :--- |
| `beam_rag_eval_[1-4].py` | 分别对应 4 种 RAG 架构的主评测脚本。**注：在 500K 和 1M 深水区极限测试中，仅实装并运行了表现最优的方案 2 (`beam_rag_eval_2.py`) 和 方案 4 (`beam_rag_eval_4.py`)**。 | ✅ 新增 |
| `RAG多架构消融实验报告.md` | 100K 数据下的初步消融实验报告，包含 4 种 RAG 模型的详细原理介绍与架构演进思路。 | ✅ 新增 |
| `run_all.sh` | 自动化批处理脚本，用于一键串行跑完方案 2 与方案 4 在超长文本下的 10 个 Cases。 | ✅ 新增 |
| `beam_rubric_scorer.py` | v11 官方 BEAM rubric 评分脚本。已重构为自动扫描、智能去重、支持 Kendall tau-b 及 15 并行，并输出四表合一 TXT 报告。 | ✅ 已修改 |
| `/beam_results/*.json` | 自动化脚本跑出的 10 个 Case 的详细大模型回答源文件，以及对应的断点续传 `checkpoint` 文件。 | ✅ 数据 |
| `/beam_results/*.txt` | 伴随 JSON 生成的 10 个单 Case 快速评分可视化表格，以及最终生成的 `final_4_tables_official_report.txt` 官方综合打分表。 | ✅ 数据 |

---

## 七、 运行说明

### Step 1: 自动化快速跑分 (生成模型回答与基础评估) 

考虑到 500K 和 1M 的测试耗时较长，且需要分别对 2 个方案跑 5 个 Case，建议使用自动化脚本一键执行，无需手动输入 10 次指令。

**1. 创建自动化批处理脚本：**
在终端输入以下命令创建并编辑脚本文件：
```bash
nano run_all.sh 
```

**2. 复制粘贴执行逻辑：**
```bash
#!/bin/bash

# 定义公共参数
PROVIDER="openai"
MODEL="gpt-5.4"

echo "🚀 开始批量执行 10 个 RAG 评估任务..."

# ================= 方案 2 (Scheme 2) =================
echo "▶️ [1/10] 运行 方案2 | 500K | Case 2"
python3 beam_rag_eval_2.py --split 500K --cases 2 --provider $PROVIDER --model $MODEL

echo "▶️ [2/10] 运行 方案2 | 500K | Case 4"
python3 beam_rag_eval_2.py --split 500K --cases 4 --provider $PROVIDER --model $MODEL

echo "▶️ [3/10] 运行 方案2 | 1M | Case 0"
python3 beam_rag_eval_2.py --split 1M --cases 0 --provider $PROVIDER --model $MODEL

echo "▶️ [4/10] 运行 方案2 | 1M | Case 2"
python3 beam_rag_eval_2.py --split 1M --cases 2 --provider $PROVIDER --model $MODEL

echo "▶️ [5/10] 运行 方案2 | 1M | Case 3"
python3 beam_rag_eval_2.py --split 1M --cases 3 --provider $PROVIDER --model $MODEL

# ================= 方案 4 (Scheme 4) =================
echo "▶️ [6/10] 运行 方案4 | 500K | Case 2"
python3 beam_rag_eval_4.py --split 500K --cases 2 --provider $PROVIDER --model $MODEL

echo "▶️ [7/10] 运行 方案4 | 500K | Case 4"
python3 beam_rag_eval_4.py --split 500K --cases 4 --provider $PROVIDER --model $MODEL

echo "▶️ [8/10] 运行 方案4 | 1M | Case 0"
python3 beam_rag_eval_4.py --split 1M --cases 0 --provider $PROVIDER --model $MODEL

echo "▶️ [9/10] 运行 方案4 | 1M | Case 2"
python3 beam_rag_eval_4.py --split 1M --cases 2 --provider $PROVIDER --model $MODEL

echo "▶️ [10/10] 运行 方案4 | 1M | Case 3"
python3 beam_rag_eval_4.py --split 1M --cases 3 --provider $PROVIDER --model $MODEL

echo "✅ 10 个任务全部执行完毕！结果保存在 /tmp/beam_results/ 目录下。"
```

**3. 保存并运行：**
按 Ctrl+O 保存，按回车确认，按 Ctrl+X 退出。
给脚本加上运行权限并启动：
```bash
chmod +x run_all.sh
./run_all.sh
```
### Step 2: v11 官方 Nugget 评分 (读取结果，不重新提问) 
当 run_all.sh 执行完毕， /tmp/beam_results/ 目录下集齐 10 个 JSON 文件后，直接运行官方评分脚本。该脚本会自动扫描目录、智能排重、并行打分，并生成最终的对照表。
```bash
python3 beam_rubric_scorer.py
```
注意事项：
Step 1 支持后台挂机与自动化批处理，所有原始生成数据和断点续传文件均自动保存在 /tmp/beam_results/ 目录中。

Step 2 只读取 checkpoint 和 JSON 中的模型回答，调用 Judge API 逐条评分，不会重新让模型回答，极大节省 Token 开销。

官方评分脚本运行结束后，不仅会在终端打印结果，还会自动输出 final_4_tables_official_report.txt 文件，内含完整的方案对比及 Question Type 拆解数据。