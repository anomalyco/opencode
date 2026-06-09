# OPEdefs 源码模块 2: 算子系统

**源文件**: `computations/OPEdefs.wls`
**行范围**: 702-813

## 概览

本模块处理算子的声明、排序、类型检测和宇称判定。这是 OPE 计算的前置基础设施。

## 功能块

### Derivative 规则 (行 702-731)

重定义 Mathematica 的 `Derivative`，使其对算子表达式生效：

- `Derivative[i__][A_Plus]` — 对求和分配求导
- `Derivative[i__][A_ s_]` — 系数提出：`(c * OP)' = c * OP'`（`OP` 须满足 `OperatorQ`）
- `Derivative[_][0] = 0`

**效率注释**: 模式匹配顺序经过优化，避免对每个因子重复调用 `OperatorQ`。

### 算子声明 (行 738-768)

- `Bosonic[A, B, ...]` — 声明玻色算子（`OPEParity = 0`, `BosonQ = True`）
- `Fermionic[A, B, ...]` — 声明费米算子（`OPEParity = 1`, `BosonQ = False`）
- `OPEOperator[{A, pA}, {B, pB}, ...]` — 声明具有符号宇称的算子

内部辅助：
- `BosonicHelp[A]` / `FermionicHelp[A]` — 单算子声明核心逻辑
- `OPEOperatorHelp[A, p]` — 整数宇称走 Bosonic/Fermionic 路径，符号宇称走通用路径
- `OperatorList` — 全局算子列表（按声明顺序）
- `OPEpositionCounter` — 声明计数器，决定算子排序

### 算子排序 (行 770-789)

- `OPEOrder[a, b]` — 返回排序值：`>0` 表示 a < b（已序），`=0` 表示相同，`<0` 表示需交换
  - 基于 `OPEposition`（声明顺序）
  - 同模式算子使用 Mathematica 内置 `Order`
- `OPEOrder[A_, B_NO] = 1` / `OPEOrder[A_NO, B_] = -1` — 正规序积总排在后面

### OperatorQ (行 791-806)

类型检测谓词，判断表达式是否为算子：

- `OperatorQ[A_+B_]` — 和式：检查第一项
- `OperatorQ[A_Times]` — 乘积：任一因子是算子即为算子
- `OperatorQ[Derivative[_][A_]]` — 导数：递归检查
- `OperatorQ[_] = False` — 默认非算子
- `OperatorQ[0] = True` — 零是算子

### 宇称 (行 808-813)

- `BosonQ[Derivative[_][A_]]` — 导数继承宇称
- `OPEParity[Derivative[_][A_]]` — 导数继承宇称
- `OPEParity[A_+B_]` — 和式取第一项宇称
- `OPEParity[a_ A_]` — 系数不影响宇称
