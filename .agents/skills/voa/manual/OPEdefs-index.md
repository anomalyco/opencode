# OPEdefs.wls 源码功能块索引

**源文件**: [OPEdefs.wls](scripts/OPEdefs.wls)
**版本**: OPEdefs 3.1 beta 4 — Kris Thielemans

OPEdefs 是一个通用 Mathematica 包，用于计算亚纯共形场论中复合算子的算子积展开 (OPE)。给定一组"基本"场的 OPE，可以自动计算任意复杂复合算子的 OPE，并将正规序积化为标准形式。

## 文件总体结构
| 行范围 | 区域 | 说明 |
|--------|------|------|
| 1-47 | 包头 | 版权、版本、作者信息 |
| 49-149 | 变更历史 | v2.0→3.0 和 v3.1 的变更日志 |
| 152-441 | 导出符号 | `BeginPackage` + 所有 `::usage` 声明 |
| 449-1993 | **实现** | `Begin["\`Private\`"]` ... `End[]` |
| 1998-1999 | 包尾 | `EndPackage[]` |

## 功能模块一览

### 模块 1: [核心数据结构与简化工具](OPEdefs-src-01-data-structures.md)
**行 449-700** | OPEData · MakeOPE · OPESimplify · OPEMap · GetCoefficients/GetOperators

OPE 的内部表示 `OPEData[{pole_list}]`，构造接口 `MakeOPE`，以及围绕它的简化、映射和系数提取工具。

### 模块 2: [算子系统](OPEdefs-src-02-operator-system.md)
**行 702-813** | Derivative · Bosonic/Fermionic/OPEOperator · OPEOrder · OperatorQ · Parity

算子的声明、排序规则、类型检测 (`OperatorQ`) 和宇称判定。Derivative 的重定义使其正确作用于算子表达式。

### 模块 3: [OPE 计算引擎](OPEdefs-src-03-ope-engine.md)
**行 815-1188** | OPE rules · DerivativeHelp · CommuteHelp · CompositeHelp (Quantum/Classical)

OPE 计算的核心：线性性、导数处理、交换关系 $[BA]_q \leftrightarrow [AB]_l$、复合算子的 OPE 展开。同时实现量子 OPE 和经典 Poisson bracket 两种模式。

### 模块 4: [OPEPole 计算](OPEdefs-src-04-opepole.md)
**行 1191-1431** | OPEPole rules · PoleHelpR/L (Quantum/Classical) · PoleCommuteHelp

直接计算 OPE 的特定极点 `OPEPole[n][A, B]`，无需计算完整 OPE。在只需单个极点时比 `OPE[A,B]` 更高效。

### 模块 5: [正规序 (Normal Ordering)](OPEdefs-src-05-normal-ordering.md)
**行 1434-1656** | NO rules · NODerivativeHelp · NOCommuteHelp · NOCompositeHelp (Quantum/Classical)

正规序积 `NO[A, B]` 的化简规则。将所有正规序积化为标准形式：右嵌套、算子按声明顺序、高阶导数在左。

### 模块 6: [配置、验证与工具](OPEdefs-src-06-config-utils.md)
**行 1659-1999** | OPEJacobi · One · Saving · SetOPEOptions · Format · Obsolete

Jacobi 恒等式验证、常数算子 One、中间结果缓存 (`OPESaving`)、全局选项 (`SetOPEOptions`)、输出格式化和废弃函数。

## 核心调用链

```
用户输入: OPE[A, B] 或 OPEPole[n][A, B]
  │
  ├─ 线性性 (Plus/Times 分配)
  ├─ 导数处理 (DerivativeHelpL/R)
  ├─ 交换 (CommuteHelp: [BA] ↔ [AB])
  ├─ 复合展开 (CompositeHelpR/L)
  │   ├─ 量子模式 (*Q): 含多重收缩
  │   └─ 经典模式 (*PB): 仅单收缩
  └─ NO 标准化
      ├─ NOCommuteHelp
      ├─ NOCompositeHelpR/L
      └─ NODerivativeHelp
```

## 量子 vs 经典模式

通过 `SetOPEOptions[OPEMethod, ...]` 切换。内部通过函数指针（`setQuantum[]` / `setPB[]`）将所有 `*Help` 函数指向对应的 `*Q` 或 `*PB` 变体：

| 函数指针 | 量子 (QuantumOPEs) | 经典 (ClassicalOPEs) |
|----------|-------------------|---------------------|
| `OPECompositeHelpR` | `OPECompositeHelpRQ` | `OPECompositeHelpRPB` |
| `OPECompositeHelpL` | `OPECompositeHelpLQ` | `OPECompositeHelpLPB` |
| `NOCommuteHelp` | `NOCommuteHelpQ` | `NOCommuteHelpPB` (= 0) |
| `NOCompositeHelpR` | `NOCompositeHelpRQ` | `NOCompositeHelpRPB` |
| `NOCompositeHelpL` | `NOCompositeHelpLQ` | `NOCompositeHelpLPB` |
| `OPEPoleHelpR` | `OPEPoleHelpRQ` | `OPEPoleHelpRPB` |
| `OPEPoleHelpL` | `OPEPoleHelpLQ` | `OPEPoleHelpLPB` |
