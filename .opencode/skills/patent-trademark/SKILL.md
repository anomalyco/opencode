---
name: patent-trademark
description: 商标全流程服务 — 检索、分析、申请撰写、异议、复审、侵权分析
version: "1.1.0"
plugin_version: ">=0.1.0"
tools:
  - trademark_research
  - trademark_search
  - trademark_analyze
  - trademark_draft
  - trademark_opposition
  - trademark_review
---

# 商标智能体工作流

基于 Obsidian 知识库（商标法、审查审理指南、司法解释、实务指南）提供商标全流程服务。

## 可用工具

| 工具 | 用途 |
|------|------|
| `trademark_research` | 商标法规研究（understand/search/analyze） |
| `trademark_search` | 商标检索（文字/类别/语义） |
| `trademark_analyze` | 商标分析（显著性/近似/混淆/侵权/驰名/商品类似） |
| `trademark_draft` | 商标申请撰写（5 步骤编排） |
| `trademark_opposition` | 商标异议与答辩（攻守双向） |
| `trademark_review` | 商标复审/撤销/无效 |

## 工作流 1：商标注册申请

```
用户：我申请注册一个商标 "X科技"
```

步骤：
1. `trademark_draft` action=understand — 理解商标特征
2. `trademark_search` query="X科技" — 近似检索
3. `trademark_analyze` action=显著性 target="X科技" — 显著性评估
4. `trademark_draft` action=specification — 撰写商标说明
5. `trademark_draft` action=goods — 选择商品分类
6. `trademark_draft` action=integrate — 整合申请文件

## 工作流 2：商标异议

```
用户：有人注册了"Y科技"与我近似，我要提出异议
```

步骤：
1. `trademark_analyze` action=近似 target="Y科技" reference="已有商标" — 近似比对
2. `trademark_opposition` action=analyze — 分析异议理由
3. `trademark_opposition` action=oppose role=异议人 — 撰写异议申请
4. `trademark_opposition` action=evidence role=异议人 — 整理证据清单

## 工作流 3：异议答辩

```
用户：收到异议通知，需要答辩
```

步骤：
1. `trademark_opposition` action=parse — 解析异议通知
2. `trademark_opposition` action=analyze — 分析异议理由
3. `trademark_analyze` action=近似 — 反向近似分析
4. `trademark_opposition` action=defend role=被异议人 — 撰写答辩意见
5. `trademark_opposition` action=evidence role=被异议人 — 整理证据

## 工作流 4：驳回复审

```
用户：商标被驳回了，需要申请复审
```

步骤：
1. `trademark_review` action=parse review_type=驳回复审 — 解读驳回决定
2. `trademark_review` action=analyze — 分析应对策略
3. `trademark_review` action=respond review_type=驳回复审 — 撰写复审请求书
4. `trademark_review` action=validate — 质量审查

## 工作流 5：商标侵权分析

```
用户：发现有人在同类商品上使用了与我注册商标近似的标识
```

步骤：
1. `trademark_analyze` action=近似 target="侵权标识" reference="注册商标" — 近似比对
2. `trademark_analyze` action=混淆可能性 — 混淆分析
3. `trademark_analyze` action=侵权 — 侵权类型分析
4. `trademark_research` action=search topic="商标侵权 A57" — 法规查询

## 知识库数据源

- **商标法**：73 条正文 + 实施条例
- **审查审理指南**：1115 个审查实例
- **司法解释**：9 部相关解释
- **实务指南**：13 个实务操作指南

所有法律文件生成后标记为"草案"，需经专业审校后提交。
