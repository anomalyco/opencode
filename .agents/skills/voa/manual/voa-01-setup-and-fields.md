# VOA.wls 初始化、场声明与 Lie 代数化简

本文件说明 [VOA.wls](scripts/VOA.wls) 的加载方式、场声明接口，以及脚本中用于 Lie 代数指标表达式的化简规则。

---

## 加载方式

`VOA.wls` 的开头执行：

```wolfram
SetDirectory[NotebookDirectory[]];
Import["freeFieldVOA.m"]
SetOptions[EvaluationNotebook[], CommonDefaultFormatTypes -> {"Output" -> StandardForm}]
```

因此它默认在 Mathematica notebook 环境中使用，并假设运行时能在当前目录找到 `freeFieldVOA.m`。若在命令行 kernel 或 wolframscript 中加载，需要确保当前路径和依赖文件位置正确。当前手册的 `scripts/` 目录列出了 `VOA.wls` 和 `OPEdefs.wls`，但没有列出 `freeFieldVOA.m`；实际运行时需要补齐这个依赖。

常见加载形式：

```wolfram
Get["/path/to/VOA.wls"]
```

注意：`VOA.wls` 是自动生成文件。文件头说明它来自 notebook initialization cells，保存 notebook 时会重新生成；不要直接把长期修改写在 `.wls` 文件里。

---

## `Declare`: 声明自由场、玻色场和费米场

接口形式为：

```wolfram
Declare[freefields][bosons][fermions]
```

含义：

| 参数 | 含义 | 脚本内记录 |
| --- | --- | --- |
| `freefields` | 自由基本场列表 | 赋给 `freeFundFields` |
| `bosons` | 玻色顶点场列表 | 赋给 `bosonicFields`，并执行 `Bosonic @@ bosons` |
| `fermions` | 费米顶点场列表 | 赋给 `fermionicFields`，并执行 `Fermionic @@ fermions` |

示例：

```wolfram
Declare[{phi}][{T, J}][{psi}]
```

这表示：

- `phi` 是自由基本场；
- `T`、`J` 按玻色顶点场处理；
- `psi` 按费米顶点场处理。

`Bosonic` 和 `Fermionic` 来自底层 OPE 系统，通常由 `OPEdefs.wls` 或 `freeFieldVOA.m` 提供。

源码中自由场列表写入变量 `freeFundFields`。后续某些关系搜索代码使用的名字则是 `freefields`，所以在实际 notebook 中通常还需要确认 `freefields` 是否已经由其他初始化单元或用户代码定义。

---

## `IsBosonicField` 与 `IsFermionicField`

脚本用两个判断函数识别表达式是否由已声明的场构成：

```wolfram
IsBosonicField[expr]
IsFermionicField[expr]
```

它们支持以下形式：

- 场本身，例如 `T[z]`、`psi[z]`；
- 导数场，例如 `Derivative[1][T][z]`；
- 数值倍数，例如 `3 T[z]`；
- 部分简单线性组合；
- `One[z]` 被视为玻色场。

脚本内注释给出的检查示例是：

```wolfram
Declare[{phi}][][{psi}]

{
  IsFermionicField[psi[z]] == True,
  IsFermionicField[Derivative[1][psi][z]] == True,
  IsFermionicField[3 Derivative[1][psi][z]] == True,
  IsFermionicField[3 phi[z]] == False
}
```

这些判断主要服务于 `MakeVertexField`，用于决定哪些抽象符号需要补上坐标变量。它们是面向当前 notebook 表达式形状写的 pattern 规则，不是完整的代数化简器；如果输入表达式很复杂，建议先 `Expand` 或手动整理成脚本能识别的形式。

---

## `MakeVertexField`: 把抽象表达式变成带坐标的顶点场

接口：

```wolfram
MakeVertexField[expr][z]
```

规则：

- `NO[o___]` 会变成 `NO[o][z]`；
- 已声明为玻色或费米的场会变成 `field[z]`；
- 其他符号保持原样。

示意：

```wolfram
MakeVertexField[NO[T, J]][z]
MakeVertexField[T + 2 J][z]
```

这个函数是 `OPEFull` 的前置步骤之一。`OPEFull` 会先从表达式中提取顶点算子部分，再把自由场部分和顶点算子部分的 OPE 合并。

---

## `simplifyLieAlgebra`: Lie 代数指标缩并

接口：

```wolfram
simplifyLieAlgebra[expr]
```

它对表达式展开后反复应用规则，主要覆盖以下对象：

| 符号 | 解释 |
| --- | --- |
| `KK[a, b]` | 上指标 Killing form 或用于升指标的度量记号 |
| `KKD[a, b]` | 下指标 Killing form 或用于降指标的度量记号 |
| `δ[a, b]` | Kronecker delta 型指标替换；源码中使用 Wolfram 的 escaped Greek symbol 写法 |
| `f[a,b,c][]` | 全上指标结构常数 $f^{abc}$ |
| `f[a,b][c]` | 两上一本指标结构常数 |
| `f[a][b,c]` | 一上两下指标结构常数 |
| `f[][a,b,c]` | 全下指标结构常数 $f_{abc}$ |
| `dimg` | Lie 代数维数 |
| `hcheck` | 对偶 Coxeter 数或脚本中同类常量 |

### 指标度量与 delta

典型规则包括：

- `KK[a,b] KKD[c,d]` 共享一个指标时化为剩余指标之间的 delta；
- 两个指标都共享时化为 `dimg`；
- delta 乘上表达式 `x` 时，会在 `x` 中替换指标；
- `δ[a,a]`、`δ[a,b]^2` 这类全缩并表达式化为 `dimg`。

### 结构常数缩并

脚本内置了两类常见缩并：

- 两个结构常数共享两个或三个指标时调用 `ffContraction`；
- 三个结构常数两两共享一个指标时调用 `fffContraction`。

例如，脚本注释中标明的结构包括：

$$
f^{ab}{}_{c} f^{d}{}_{ab} = 2 h^\vee \delta_c{}^d
$$

以及全缩并形式：

$$
f^{abc} f_{abc} = 2 h^\vee \dim \mathfrak{g}
$$

### 与仿射流正规序的规则

`simplifyLieAlgebra` 还包含两条与流 `J[a]` 的正规序表达式相关的规则：

```wolfram
f[a][b, c] NNO[J[b], J[c]] :> I hcheck Derivative[1][J[a]]
f[a][b, c] NNO[J[c], J[b]] :> -I hcheck Derivative[1][J[a]]
```

这说明该函数不只是纯指标化简，也带有某些当前 VOA 计算中常用的流代数化简约定。

---

## 使用建议

- 先声明场，再调用需要识别场宇称的函数，例如 `MakeVertexField` 和 `OPEFull`。
- 如果同时使用 relation 搜索，除 `Declare` 外还应确认 `freefields`、`generators` 和 `h[...]` 等全局变量已经在当前 kernel 中定义。
- `simplifyLieAlgebra` 会反复替换直到稳定。输入中若含有自动生成的 dummy index，最好避免和已有指标重名。
- `f[...]` 的指标顺序会被脚本按 `Sort` 和 `Signature` 标准化；如果外部代码使用不同排序约定，应先统一。
- 该脚本使用 Wolfram Language pattern。自定义变量名不要随意带下划线；在 Wolfram Language 中，下划线表示 pattern。
