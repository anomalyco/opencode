# VOA.wls Zhu 递推、环面迹与 Eisenstein 化简

本文件说明 [VOA.wls](scripts/VOA.wls) 中的 `ZhuRecursion`，以及它使用的 `str`、`o`、`qDq`、`DDbi`、`EEE`、`EEi` 等符号。

背景公式可参考 [Zhu's recursion formula](VOA-recursion.md) 和 [VOA 中的 Zhu 代数、$C_2$ 代数与 Associated Variety](VOA-Zhu.md)。

---

## 输入表达式的包装：`str` 与 `o`

脚本用两个形式符号表示环面 trace 相关对象：

| 符号 | 含义 |
| --- | --- |
| `o[A]` | 算符或态 `A` 的 zero-mode 插入 |
| `str[o[A]]` | 带有 supertrace / trace 语义的单点函数表达式 |
| `cch` | 真空字符或待求的基础 character |

这里的 `str` 与 `o` 是脚本内部的形式包装，不是 Mathematica 内置函数。它们的作用是给 `ZhuRecursion` 提供可匹配的表达式形状。

`str` 和 `o` 都实现了对和式与数值倍数的线性性。例如：

```wolfram
str[o[A + B]]
o[lambda NO[A, B]]
```

会按脚本规则拆开。

基础替换包括：

```wolfram
str[o[One]] -> cch
o[lambda_?NumericQ One] := lambda
str[lambda_?NumericQ One] := lambda cch
```

---

## 非交换 zero-mode 乘法

脚本对 `NonCommutativeMultiply` 添加线性规则，使 `**` 可以表示 zero-mode 插入的非交换乘法：

```wolfram
str[o[A] ** o[B]]
```

在 `ZhuRecursion` 中，若 `NO[A, B]` 的左因子电荷为零，递推会产生：

```wolfram
KroneckerDelta[Q[A], 0] str[o[A] ** o[B]]
```

并且对特殊生成元有规则：

```wolfram
str[o[T] ** o[op___]] :> qDq[str[o[op]]]
str[o[J] ** o[op___]] :> DDbi[1][1, str[o[op]]]
```

这里 `T` 通常表示 stress tensor，`J` 表示一个 $U(1)$ 流。

---

## `ZhuRecursion`: 主接口

接口：

```wolfram
ZhuRecursion[f]
```

它对输入表达式 `f` 反复应用 `zhusRecursion`，再应用 `EisensteinIdentities`，最后返回展开后的符号表达式。

典型输入：

```wolfram
ZhuRecursion[str[o[NO[A, B]]]]
ZhuRecursion[str[o[NO[Derivative[1][A], B]]]]
ZhuRecursion[str[o[Derivative[2][A]]]]
```

---

## 正规序项的 Zhu 递推规则

### 带导数的正规序项

脚本对以下结构：

```wolfram
str[o[NO[Derivative[n][A], B]]]
```

应用规则：

```wolfram
n! (-1)^n Sum[
  Binomial[k - 1, n]
  EEE[k][{{E^(2 Pi I h[A])}, {b^Q[A]}}][q]
  str[o[Bracket[A, B][k - n]]],
  {k, n + 1, h[A] + h[B] + n}
]
```

这对应 Zhu 递推中负模式或导数后裔的降阶表达。

### 单个导数场

对：

```wolfram
str[o[Derivative[n][A]]]
```

脚本使用类似规则，将其写成 `Bracket[A, One][...]` 的组合。

### 不带导数的正规序项

对：

```wolfram
str[o[NO[A, B]]]
```

一般规则是：

```wolfram
KroneckerDelta[Q[A], 0] str[o[A] ** o[B]]
  + Sum[
      EEE[k][{{E^(2 Pi I h[A])}, {b^Q[A]}}][q]
      str[o[Bracket[A, B][k]]],
      {k, 1, h[A] + h[B]}
    ]
```

若 `Q[A] == 0`，脚本还包含一个从 `k = 2` 开始、第二个特征写成 `{1}` 的专门规则。实际匹配时，Wolfram Language 会按规则顺序尝试，因此有具体数值电荷时应先让 `Q[A]` 化到可判定的形式。

---

## `EEE` 与 `EEi`: Eisenstein 系列符号

脚本使用：

```wolfram
EEE[k][{{pm}, {bexpr}}][q]
EEi[k][q]
```

其中 `EEE` 表示带特征的 twisted Eisenstein 系列，可记作：

$$
E_k\left[\begin{matrix}\phi \\ \theta\end{matrix}\right]\!(\tau)
$$

在脚本中：

```wolfram
EEE[k][{{E^(2 Pi I h[A])}, {b^Q[A]}}][q]
```

对应特征：

$$
\phi = e^{2\pi i h_A}, \qquad \theta = b^{Q_A}
$$

`EEi[k][q]` 表示普通 Eisenstein 系列 $E_k(\tau)$ 的内部符号。脚本会做一些特化：

```wolfram
EEE[k_?EvenQ][{{1}, {1}}][q] :> EEi[k][q]
EEE[k_ /; OddQ[k] && k > 1][{{pm_}, {1}}][q] :> 0
```

---

## $q$ 导数与 $b$ 导数

`ZhuRecursion` 在模块内部定义两个导数算符：

| 符号 | 作用 |
| --- | --- |
| `qDq[expr]` | 表示 $q \partial_q$ 作用，并对和、积、幂满足 Leibniz 规则 |
| `DDbi[i][n, expr]` | 表示第 `i` 个 flavor fugacity 的第 `n` 阶导数结构 |

特殊规则：

```wolfram
str[o[T]] -> qDq[cch]
str[o[J]] -> DDbi[1][1, cch]
qDq[cch] -> MMDO[1, cch]
qDq[MMDO[n, cch]] :> MMDO[n + 1, cch] - 2 n EEi[2][q] MMDO[n, cch]
```

这里 `MMDO[n, cch]` 是脚本中用于表示 modular-covariant $q$ 导数序列的形式符号。

---

## Eisenstein 恒等式化简

`EisensteinIdentities` 包含三类化简。

### 1. 对 twisted Eisenstein 的 $b$ 导数

例如脚本对：

```wolfram
DDbi[1][1, EEE[n][{{-1}, {b[1]^m}}][q]]
DDbi[1][1, EEE[n][{{1}, {b[1]^m}}][q]]
```

按奇偶性分别改写成更高权重 `EEE`、普通 `EEi` 和低阶乘积的组合。

### 2. 高阶 `DDbi`

对 `n > 1` 的 `DDbi`，脚本递归拆成一阶导数重复作用：

```wolfram
DDbi[1][n, EEE[k][{{pm}, {b}}][q]]
  :> DDbi[1][n - 1, DDbi[1][1, EEE[k][{{pm}, {b}}][q]]]
```

### 3. 普通 Eisenstein 的 $q$ 导数

脚本内置了：

```wolfram
qDq[EEi[2][q]] -> 5 EEi[4][q] - EEi[2][q]^2
qDq[EEi[4][q]] -> 14 EEi[6][q] - 4 EEi[2][q] EEi[4][q]
qDq[EEi[6][q]] -> 60/7 EEi[4][q]^2 - 6 EEi[2][q] EEi[6][q]
```

以及 twisted Eisenstein 的 $q$ 导数与 `DDbi` 的转换：

```wolfram
qDq[EEE[k][{{pm}, {b[1]^m}}][q]] :> -(k/m) DDbi[1][1, EEE[k + 1][{{pm}, {b[1]^m}}][q]]
```

---

## 输出整理步骤

`ZhuRecursion` 的末尾还会做几类规范化：

1. 把 `b^Q` 改写成 `b[1]^Q`；
2. 若 `Q` 是列表，把它改写成多个 `b[i]` 的乘积；
3. 把 `EEE[k][{{pm}, {b}}][q]` 中的单变量 `b` 规范成 `b[1]`；
4. 对负幂使用：

   ```wolfram
   EEE[k][{{pm}, {b[1]^lambda_}}][q] :> (-1)^k EEE[k][{{pm}, {b[1]^(-lambda)}}][q]
   ```

5. 合并嵌套的 `DDbi[i][m, DDbi[i][n, expr]]`，但对 `EEE` 头部表达式保留递推处理。

---

## 使用建议

- 先确保 `h[A]` 和 `Q[A]` 有定义，否则 `EEE` 的特征会保持形式符号。
- `Bracket[A, B][k]` 会调用 `OPEPole` 或 `NO`，所以 Zhu 递推依赖已有 OPE 数据。
- `T` 和 `J` 在脚本中有特殊规则。如果你的模型使用不同名字表示 stress tensor 或 $U(1)$ 流，需要先做替换或补充规则。
- `DDbi` 和 `MMDO` 在 `ZhuRecursion` 末尾被 `Clear`，但返回表达式中仍可能以这些 head 的形式出现。后续如果要继续化简，需要在同一表达式语境下重新定义相应规则或再次调用递推函数。
- `ZhuRecursion` 的目标是符号化递推，不是自动证明模性，也不是自动求解 character。
- 多行 Wolfram Language 表达式建议用括号包住，避免命令行 kernel 把换行后的部分当成独立表达式。
