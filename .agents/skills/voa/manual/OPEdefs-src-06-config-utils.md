# OPEdefs 源码模块 6: 配置、验证与工具

**源文件**: `computations/OPEdefs.wls`
**行范围**: 1659-1999

## 概览

本模块包含 Jacobi 恒等式验证、常数算子 `One`、中间结果缓存管理、全局选项系统、输出格式化和废弃函数。

## 功能块

### OPEJacobi (行 1659-1702)

验证三个算子的 Jacobi 恒等式：

$$[A [BC]_p]_q = (-1)^{|A||B|} [B [AC]_q]_p + \sum_{l=1}^{q} \binom{q-1}{l-1} [[AB]_l C]_{p+q-l}$$

- `OPEJacobi[A, B, C, opts]` — 返回二维列表，所有元素应为零
- 接受 `Function -> f` 选项控制系数化简
- **性能提示**: `op1 <= op2 <= op3`（按声明顺序）时计算最快

### 常数算子 One (行 1705-1720)

- `DefineConstantOperator[op_Symbol]` — 通用常数算子定义模板
  - 导数为零
  - 与任何算子的 OPE 正则
  - 正规序积中消去
- `One` — 单位算子实例

### 中间结果缓存 (行 1723-1765)

- `ClearOPESavedValues[]` — 清除所有缓存（Clear + Redefine 各量子/经典辅助函数）
- `OPESave[filename_String]` — 将缓存序列化到文件（供下次会话读取）

缓存的函数：
- `OPECompositeHelpR/L` (量子/经典)
- `NOCompositeHelpR/L` (量子/经典)

### 全局选项 SetOPEOptions (行 1769-1914)

`SetOPEOptions[option, value]` — 统一的选项设置接口。

#### OPESaving (行 1783-1800)

控制是否缓存中间结果：
- `True`（默认）: `CallAndSave[f, arg] := (f[arg] = f[arg])` — memoization
- `False`: `CallAndSave[f, arg] := f[arg]` — 不缓存
- 动态表达式: `MaxMemoryUsed[] < 6*10^6` — 条件缓存

#### NOOrdering (行 1805-1807)

- `n < 0`（默认）: 高阶导数在左
- `n > 0`: 低阶导数在左
- `n == 0`: 不重排（不推荐）

#### SeriesArguments (行 1809-1814)

设置 `OPEToSeries` 和 `TeXForm` 使用的变量，默认 `{z, w}`。

#### ParityMethod (行 1818-1830)

- `0`（默认）: 使用 `BosonQ` 布尔判定，速度快
- `1`: 使用 `(-1)^OPEParity` 幂次判定，支持符号宇称

控制 `SwapSign` 函数的实现。

#### OPEMethod (行 1834-1883)

- `QuantumOPEs`（默认）: 完整量子 OPE（多重收缩 + 正规序）
- `ClassicalOPEs`: Poisson bracket（无多重收缩 + graded-commutative associative 正规序）

通过 `setQuantum[]` / `setPB[]` 切换所有辅助函数指针。

#### EnableDummies (行 1888-1905)

加载 `Dummies` 包，扩展 `Renumber`、`NewDummies`、`DummySimplify`、`SumDummy` 对 `OPEData` 的支持。自动关闭 `OPESaving`。

### 输出格式化 (行 1917-1968)

- `Format[OPEData[...]]` — 标准显示：`<< 4|| c/2 One ||3|| 0 ||2|| 2T ||1|| T' >>`
- `Format[OPEData[...], InputForm]` — 输出为 `MakeOPE[...]` 形式
- `Format[OPEData[...], TeXForm]` — 转换为 Laurent 级数的 TeX
- `OPEToSeries[ope, {z1, z2}]` — 转换为 Mathematica `SeriesData`

### 废弃函数 (行 1971-1993)

- `SMap` → 使用 `OPEMap`
- `Term[A, n]` → 使用 `OPEPole[-n][A]`
- `StripArg[expr]` → 剥离算子参数（仅供特殊用途）
