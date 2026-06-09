# VOA.wls 完整 OPE、极点与强闭合检查

本文件说明 [VOA.wls](scripts/VOA.wls) 中与 OPE 展开、极点提取、准初级 completion 和强闭合检查相关的函数。

---

## 依赖的底层对象

本页函数不是从零实现 OPE 引擎，而是建立在底层 `OPEdefs.wls` 与 `freeFieldVOA.m` 的符号之上。常见依赖包括：

| 符号 | 作用 |
| --- | --- |
| `OPE[A, B]` | 计算两个算符的奇异 OPE 数据 |
| `OPEPole[n][A, B]` | 取第 $n$ 阶极点 |
| `OPEData[...]` | OPE 极点列表数据结构 |
| `OPEToSeries` | 把 OPE 数据转成级数表达式 |
| `OPEFree[...]` | 自由场部分的 OPE |
| `MakeField[...]` | 从表达式中抽取或规范化场表达；由运行时依赖提供 |
| `NO[...]` | 正规序积 |
| `One` | 真空或单位算符 |
| `h[op]` | conformal weight |
| `generators` | 当前抽象生成元列表 |

如果这些符号没有在当前 kernel 中定义，`VOA.wls` 的高层函数只能停留在形式表达式，不能完成实际计算。

---

## `OPEFull`: 合并自由场和顶点算子部分

接口：

```wolfram
OPEFull[o1, o2][z, w][n]
```

含义：计算 `o1(z) o2(w)` 在指定展开阶数 `n` 下的完整级数。脚本对左右输入都实现了线性性：

```wolfram
OPEFull[o1 + o2, o3][z, w][n]
OPEFull[o1, o2 + o3][z, w][n]
```

都会自动拆成和式。

### 内部步骤

`OPEFull` 的主体逻辑是：

1. 用运行时依赖提供的 `MakeField` 和临时坐标 `ztemp` 从输入中提取顶点算子部分；
2. 把剩余部分交给 `OPEFree` 计算自由场 OPE；
3. 用 `OPE[V1, V2] // OPEToSeries` 计算顶点算子 OPE；
4. 根据自由场部分和顶点算子部分的 leading power，补上正则项中的正规序导数：

   ```wolfram
   Sum[(z - w)^nn/Factorial[nn] MakeVertexField[NO[Derivative[nn][V1], V2]][w], ...]
   ```

5. 将两部分相乘并按 `{z, w, n}` 做级数展开。

### 使用骨架

```wolfram
Declare[freeFields][bosonicGenerators][fermionicGenerators]

(* 先在底层系统中定义 OPE、h、generators 等 *)
OPEFull[A, B][z, w][order]
```

`order` 是传给 `Series` 的展开阶数。若你只关心奇异极点，通常直接用 `OPE[A, B]` 或 `OPEPole[n][A, B]` 更清晰。

---

## `Bracket`: 统一极点、正规序积和负阶项

接口：

```wolfram
Bracket[O1, O2][n]
```

定义：

| 条件 | 输出 |
| --- | --- |
| `n > 0` | `OPEPole[n][O1, O2]` |
| `n == 0` | `NO[O1, O2]` |
| `n < 0` | `1/Abs[n]! NO[Derivative[Abs[n]][O1], O2]` |

对应的数学记号是：

$$
[O_1 O_2]_{-n} = \frac{1}{n!}\mathrm{NO}(\partial^n O_1, O_2)
$$

因此 `Bracket` 可以把 OPE 的奇异部分和正则部分放在一个统一接口里。`ZhuRecursion` 也依赖这个函数表示递推中的模式作用。

---

## `Completion`: 从极点组合准初级分量

接口：

```wolfram
Completion[O1, O2][m]
```

它实现的结构是：

```wolfram
Sum[
  coefficient[n] Derivative[n][Bracket[O1, O2][m + n]],
  {n, 0, 2 h[O1] - m}
]
```

系数由 `Pochhammer`、`h[O1]`、`h[O2]` 和目标极点 `m` 给出。它的用途是从 OPE 极点及其导数组合出与准初级投影相关的表达式。

对应背景可参考 [VOA Primaries](VOA-primaries.md) 中从 OPE 极点提取准初级场的公式。

---

## `CheckStrongClosure`: 检查 realized generators 是否强闭合

接口：

```wolfram
CheckStrongClosure[generators, realization, printResult_: False]
```

返回：

```wolfram
{closure, OPEresult}
```

其中：

- `closure` 是布尔值；
- `OPEresult[i, j]` 是脚本重构出的 `generators[[i]]` 与 `generators[[j]]` 的 `OPEData`；
- `printResult` 为 `True` 时会打印每一对生成元的 OPE 数据。

### 检查逻辑

对每对生成元 `generators[[i]]`、`generators[[j]]`，脚本依次检查每个可能极点 `n`：

```wolfram
For[n = 1, n <= h[generators[[i]]] + h[generators[[j]]], n++, ...]
```

第 $n$ 阶极点的 conformal weight 是：

$$
h_i + h_j - n
$$

脚本调用：

```wolfram
candidates = ListOpsAtWeight[h[generators[[i]]] + h[generators[[j]]] - n]
```

生成同权重候选算符，然后求解线性方程：

```wolfram
OPEPole[n][OPE[generators[[i]] /. realization, generators[[j]] /. realization]]
  - Array[aaa, Length[candidates]] . candidates
```

这里的 `realization` 把抽象生成元替换成自由场或其他已知表达式。若某个极点不能表示为候选空间的线性组合，`closure` 会被置为 `False`。

### 使用骨架

```wolfram
generators = {T, J, W};

realization = {
  T -> (* free-field expression *),
  J -> (* free-field expression *),
  W -> (* free-field expression *)
};

{closure, opeResult} = CheckStrongClosure[generators, realization, True];
```

若闭合，`opeResult[i, j]` 可以作为抽象 OPE 数据继续使用或手工整理。

---

## 重要注意

- `CheckStrongClosure` 的第一个参数名也是 `generators`，但 `ListOpsAtWeight` 默认读取全局 `generators`。实际使用时，应确保传入列表与全局 `generators` 一致。
- `CheckStrongClosure` 内部只遍历 `i < j` 的生成元对，不检查自 OPE。若你的闭合性问题依赖 `A` 与 `A` 的 OPE，需要单独检查或扩展循环。
- `Solve` 若无解，脚本会把 `closure` 设为 `False`。如果表达式未充分化简，可能导致本来存在的线性表示没有被识别；这时应先对 realization 后的表达式使用合适的简化规则。
- `OPEresult[i, j]` 以 `OPEData[...]` 存储，并且脚本在构造时对极点列表执行 `Reverse`，以匹配底层 OPE 数据的高阶极点到低阶极点顺序。
- `Completion` 依赖 `h[...]` 返回可用于求和上界的数值或符号值；实际计算中通常需要具体 conformal weight。
