# VOA.wls 使用索引

**源文件**: [VOA.wls](scripts/VOA.wls)  
**依赖**: [OPEdefs.wls](scripts/OPEdefs.wls) 与 `VOA.wls` 启动时导入的运行时文件 `freeFieldVOA.m`  
**定位**: 面向 Mathematica / Wolfram Language 的 VOA 计算辅助脚本，用于自由场实现、OPE 展开、强闭合检查、固定权重算符空间、null relation 搜索和 Zhu 递推。它更像一组 notebook 辅助函数，而不是带有完整 package context 的独立包。

`VOA.wls` 是由 Mathematica notebook 自动生成的 initialization 文件。文件头明确说明不要直接编辑该 `.wls` 文件；如果需要改源码，应改对应 notebook，再由 Mathematica 自动导出。

---

## 文档入口

1. [初始化、场声明与 Lie 代数化简](voa-01-setup-and-fields.md)  
   解释如何加载脚本、声明自由场和复合生成元的宇称，并说明 `simplifyLieAlgebra` 中的指标缩并规则。

2. [完整 OPE、极点与强闭合检查](voa-02-ope-and-closure.md)  
   说明 `OPEFull`、`Bracket`、`Completion` 和 `CheckStrongClosure` 的用途，以及如何用 realization 验证候选强生成元是否闭合。

3. [固定权重算符空间与关系搜索](voa-03-operator-spaces-and-relations.md)  
   说明 `ListLettersAtWeight`、`ListOpsAtPartition`、`ListOpsAtWeight` 与 `ListRelations`，用于构造固定 conformal weight 的正规序算符基底并找线性关系。

4. [Zhu 递推、环面迹与 Eisenstein 化简](voa-04-zhu-recursion.md)  
   说明 `ZhuRecursion`、`str`、`o`、`qDq`、`DDbi`、`EEE`、`EEi` 的工作方式，以及递推输出中常见符号的含义。

相关背景文档：

- [VOA Preliminaries](VOA-preliminaries.md): OPE、正规序、导数规则和 Jacobi 恒等式。
- [VOA Primaries](VOA-primaries.md): primary / quasiprimary 条件与 OPE 的协变形式。
- [Zhu's recursion formula](VOA-recursion.md): Zhu 递推公式的数学背景。
- [VOA 中的 Zhu 代数、$C_2$ 代数与 Associated Variety](VOA-Zhu.md): Zhu 代数与 $C_2$ 代数背景。
- [OPEdefs.wls 源码功能块索引](OPEdefs-index.md): 底层 OPE 引擎说明。

---

## 文件总体结构

| 行范围 | 区域 | 说明 |
| --- | --- | --- |
| 1-25 | 启动与依赖 | 切换到 notebook 目录，导入 `freeFieldVOA.m`，设置输出格式。 |
| 29-140 | Lie 代数指标化简 | `simplifyLieAlgebra`、`ffContraction`、`KfContraction`、`fffContraction`，处理 Killing form、结构常数和若干仿射流正规序缩并。 |
| 141-149 | notebook 自动导出设置 | 保存 notebook 时删除旧 `.wls` 并复制 `.m` 为 `.wls`。 |
| 153-221 | 场声明与顶点场包装 | `Declare`、`IsBosonicField`、`IsFermionicField`、`MakeVertexField`。 |
| 225-245 | 完整 OPE 展开 | `OPEFull` 结合自由场 OPE 与顶点算子 OPE，输出指定阶数的级数。 |
| 249-263 | 固定权重算符枚举 | `ListLettersAtWeight`、`ListOpsAtPartition`、`ListOpsAtWeight`。 |
| 266-281 | 强闭合检查 | `CheckStrongClosure` 逐对检查 realized generators 的 OPE 极点能否由候选算符空间线性表示。 |
| 286-315 | 关系搜索 | `ListRelations` 在抽象算符或 realization 下寻找线性关系。 |
| 319-327 | bracket 与 quasiprimary completion | `Bracket` 统一正负极点记号，`Completion` 从极点组合准初级分量。 |
| 331-363 | trace 表达式包装与非交换乘法 | `str`、`o` 和 `NonCommutativeMultiply` 的线性规则。 |
| 366-574 | Zhu 递推与 Eisenstein 化简 | `ZhuRecursion` 将正规序单点迹递推为低阶 bracket、$q$ 导数、$b$ 导数和 Eisenstein 系列组合。 |

---

## 核心工作流

### 1. 加载与声明

```wolfram
Get["VOA.wls"]

Declare[{phi}][{T, J}][{psi}]
```

`Declare[freefields][bosons][fermions]` 会记录自由基本场、玻色顶点场和费米顶点场，并把后两类传给底层 `Bosonic` / `Fermionic` 声明。

在命令行 kernel 中使用时，需要先确认 `NotebookDirectory[]` 是否可用；如果不是从 notebook 运行，建议先切换到包含运行时依赖的目录，再加载脚本。

### 2. 设置生成元、权重和 OPE

`VOA.wls` 假设底层 OPE 系统已经知道：

- 生成元列表 `generators`
- conformal weight 函数 `h[op]`
- 奇异 OPE 数据 `OPE[A, B]` 或 `OPEPole[n][A, B]`
- 正规序积 `NO[...]`
- 真空算符 `One`

这些通常来自 `OPEdefs.wls`、`freeFieldVOA.m` 和用户自己的模型定义。

### 3. 枚举固定权重算符

```wolfram
ListOpsAtWeight[3]
ListOpsAtWeight[4, {T, J, W}]
```

这一步用于生成候选右端项，例如检查 OPE 极点是否可以写成某个固定 conformal weight 空间中的线性组合。

### 4. 检查强闭合

```wolfram
CheckStrongClosure[generators, realization, True]
```

返回 `{closure, OPEresult}`。若 `closure` 为 `True`，脚本找到了每个候选极点在抽象生成元空间中的线性表示。

### 5. 做 Zhu 递推

```wolfram
ZhuRecursion[str[o[NO[A, B]]]]
```

递推会把正规序单点迹改写为 zero-mode 乘法、OPE bracket、$q$ 导数、$b$ 导数和 twisted Eisenstein 系列。

---

## 主要公开函数速查

| 函数 | 用途 | 详见 |
| --- | --- | --- |
| `Declare[freefields][bosons][fermions]` | 声明自由场、玻色场和费米场 | [voa-01](voa-01-setup-and-fields.md) |
| `IsBosonicField[expr]` / `IsFermionicField[expr]` | 判断表达式是否由已声明场构成 | [voa-01](voa-01-setup-and-fields.md) |
| `MakeVertexField[expr][z]` | 给抽象算符表达式补上坐标变量 | [voa-01](voa-01-setup-and-fields.md) |
| `simplifyLieAlgebra[expr]` | 化简 Killing form、结构常数和部分仿射流表达式 | [voa-01](voa-01-setup-and-fields.md) |
| `OPEFull[o1, o2][z, w][n]` | 合并自由场部分和顶点算子部分，计算完整 OPE 级数 | [voa-02](voa-02-ope-and-closure.md) |
| `Bracket[O1, O2][n]` | 统一表示第 $n$ 阶 OPE 极点、正规序积和负阶正则项 | [voa-02](voa-02-ope-and-closure.md) |
| `Completion[O1, O2][m]` | 按准初级投影公式组合极点及导数 | [voa-02](voa-02-ope-and-closure.md) |
| `CheckStrongClosure[generators, realization, printResult]` | 检查 realized generators 的 OPE 是否在抽象生成元空间中闭合 | [voa-02](voa-02-ope-and-closure.md) |
| `ListLettersAtWeight[n]` | 枚举权重为 $n$ 的单个 letter | [voa-03](voa-03-operator-spaces-and-relations.md) |
| `ListOpsAtPartition[partition]` | 对给定权重分拆生成正规序复合算符 | [voa-03](voa-03-operator-spaces-and-relations.md) |
| `ListOpsAtWeight[n]` | 枚举总权重为 $n$ 的复合算符候选基底 | [voa-03](voa-03-operator-spaces-and-relations.md) |
| `ListRelations[ops]` / `ListRelations[ops, realization]` | 求算符列表中的线性关系 | [voa-03](voa-03-operator-spaces-and-relations.md) |
| `ZhuRecursion[f]` | 对环面单点迹表达式应用 Zhu 递推和 Eisenstein 化简 | [voa-04](voa-04-zhu-recursion.md) |

---

## 使用注意

- `VOA.wls` 不是独立包。它依赖 `freeFieldVOA.m` 和底层 OPE 定义中的 `OPE`、`OPEPole`、`NO`、`Bosonic`、`Fermionic`、`OPEData` 等符号。当前手册目录下能看到 [OPEdefs.wls](scripts/OPEdefs.wls)，但 `freeFieldVOA.m` 需要由运行环境提供。
- 很多函数读取全局变量，例如 `generators`、`h[...]`、`Q[...]`、`freefields`、`T`、`J`、`q`、`b`、`cch`。运行前应先在当前 kernel 中建立这些定义。
- `Declare` 写入的自由场列表变量名是 `freeFundFields`，但 `ListRelations` 的部分规则读取 `freefields`。如果你的计算依赖 relation 搜索，请确认两者是否都按预期定义。
- `ListOpsAtPartition` 调用 `LettersAtWeight[part]`，而本文件中公开定义的是 `ListLettersAtWeight`。如果加载链没有额外定义 `LettersAtWeight[n]`，需要先补别名或手动确认该函数可用。
- `ListOpsAtWeight` 使用半整数分拆 `1/2 IntegerPartitions[2n]`，所以可以处理整数或半整数 conformal weight。
- `CheckStrongClosure` 中的候选空间来自全局 `generators`。如果传入的第一个参数和全局 `generators` 不一致，候选空间可能不是你想要的空间。
- `ZhuRecursion` 的输出是符号表达式，不等同于自动求解模微分方程；它负责把 trace 表达式按脚本内置递推规则重写。
