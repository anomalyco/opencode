# OPEdefs 源码模块 1: 核心数据结构与简化工具

**源文件**: `computations/OPEdefs.wls`
**行范围**: 449-700

## 概览

本模块实现了 OPE 包的基础数据结构 `OPEData`，以及围绕它的构造、简化、映射和系数提取工具。

## 功能块

### OPEData (行 499-537)

`OPEData[{pole_list}]` 是 OPE 的内部表示，以极点列表存储。最高阶极点在列表前端。

- `OPEData /: n_ * OPEData[A_List]` — 标量乘法
- `A1_OPEData + A2__OPEData` — OPE 加法（自动补零对齐长度）
- `extend[A_List, n_Integer]` — 将列表扩展到长度 `n`（前端补零）
- `OPEData[{(0).., A___}]` — 自动去除前导零

### MakeOPE (行 540-563)

用户构造 OPE 的接口函数。两种方式：

1. **列表方式**: `MakeOPE[{c/2 One, 0, 2T, T'}]` — 直接列出各阶极点处的算子
2. **级数方式**: `MakeOPE[series + Ord[z,w,0]]` — 通过 Laurent 级数构造

内部辅助：
- `Ord[z_, w_, i_Integer]` — 标记级数截断
- `SeriesDataToOPEData` — 将 Mathematica `SeriesData` 转换为 `OPEData`
- `checkOne[ope]` — 对非算子极点自动乘上单位算子 `One`

### Simplification (行 565-622)

以 **ExtractOperators** 提取算子，以 **PoleSimplify** 合并同类项：

- `ExtractOperators[expr]` — 从展开式中提取算子列表（假定 `expr` 已 Expand）
- `PoleSimplify[term]` / `PoleSimplify[term, func]` — 按算子收集系数，可指定系数化简函数
- `OPESimplify[ope, func]` — 对 OPE 的每个极点执行 `PoleSimplify`；也可作用于算子表达式或列表
- `Options[OPESimplify] = {Function -> Expand}` — 默认系数化简函数

### Mapping (行 626-641)

- `OPEMap[f, ope, levelspec]` — 对 OPE 所有极点映射函数 `f`
- `OPEMapAt[f, ope, position]` — 对指定位置的极点映射函数 `f`

### GetCoefficients / GetOperators (行 644-674)

- `GetCoefficients[expr]` — 返回表达式中所有算子的系数列表（Listable）
- `GetOperators[expr]` — 返回表达式中所有算子的列表（Listable）
