---
name: voa
description: 进行顶点算符代数 (vertex operator algebra) 的解析、符号化的计算。当需要计算顶点算符代数的 OPE、normal ordered product, Zhu's C2 代数，Zhu's 代数，associate variety 等对象时使用，辅助计算程序为 `pyope-voa` 和 `OPEdefs.wls`
compatibility: wolframscript, OPEdefs.m, OPEdefs.wls, pyope-voa
---


# vertex operator algebra

顶点算符代数的基本概念、定义、恒等式: [VOA-preliminaries](manual/VOA-preliminaries.md)

primary, quasi-primary, superconformal primary 等概念: [VOA-primaries](manual/VOA-primaries.md)

Zhu's $C_2$ 代数、Zhu's 代数与 associate variety 等对象: [VOA-Zhu](manual/VOA-Zhu.md)

Zhu's 递归公式: [Zhu-recursion](manual/VOA-recursion.md)


# Math convention (CAUTION!!!)

- 算符极点 $a(z) b(w)$ 可以展开为
  $$
  a(z) b(w) = \sum_{n} \frac{\{ab\}_n(w)}{(z - w)^n} 
  $$
  **WARNING**: 我们用**花括号 $\{...\}_n$**，但 Theilemanns 的符号用**中括号 `[ab]_n`**
- 正规乘积 (圆括号) $(ab)$ 也记为 $\operatorname{NO}(a,b)$
- quasi-primary 的 OPE 极点 $\{ab\}_n$ 一般不是 quasi-primary，但其中存在一个 quasi-primary 的分量 $(ab)_n$
  **WARNING**: 与正规乘积 $(ab)$ **不同**
  $$
   (\mathcal{O}_1\mathcal{O}_2)_n(z) = \sum_{p \geq 0} \mathcal{K}_{h_1,h_2,n,p}\, \partial_z^p \{\mathcal{O}_1\mathcal{O}_2\}_{n+p}(z)
   $$

   其中：

   $$
   \mathcal{K}_{h_1,h_2,n,p} = \frac{(-)^p\,(2h_1 - n - p)_p}{p!\,(2h_1 + 2h_2 - 2n - p - 1)_p}
   $$
- 同一顶点算符/state的 Fourier 展开有**两种**常见形式。对于 conformal weight (数学家称之为 degree) 为 $h_a$ 的顶点算符 $a$
  - 物理学家: $a(z) = \sum_{n \in \mathbb{Z} - h_a} a_{n} z^{- n - h_a}$
  - 数学家: $a(z) = \sum_{n \in \mathbb{Z}} a_{n} z^{- n - 1}$
  从而
  $$
  a^\text{phy}_{-h_a} = a^\text{math}_{-1}, \qquad
  a^\text{phy}_{- h_a + n} = a^\text{math}_{-1 + n}
  $$
- 对于物理学家记号 $a(z) = \sum_{n \in \mathbb{Z} - h_a} a_{n} z^{- n - h_a}$，零模 $o(a) = a_0$，对于数学家记号，$o(a) = a_{h_a - 1}$


# `OPEdefs` 索引文件
优点: 高性能，适用于复杂的 OPE、NO 计算
[OPEdefs-index](manual/OPEdefs-index.md)

源文件 [OPEdefs.wls](manual/scripts/OPEdefs.wls)

## CRITICAL WARNING

使用 `OPEdefs.wls` 时，算符声明的顺序与 `OPE` 声明中的顺序**必须**保持一致，否则 Wolfram Script 会出现**计算结果错误**

例子

```Mathematica
Bosonic[A, B] (* A first, B after *)
OPE[A, A] = MakeOPE[{One, 0}];
OPE[A, B] = MakeOPE[{2B}]; (* CORRECT order *); 
(* WRONG order OPE[B, A] = MakeOPE[{2B}]; WRONG order *); 
OPE[B, B] = MakeOPE[{-One, 0}];
```

例子

```Mathematica
Bosonic[A] (* A first *)
Fermionic[B] (* B after *)
OPE[A, A] = MakeOPE[{One, 0}];
OPE[A, B] = MakeOPE[{2B}]; (* CORRECT order *); 
(* WRONG order OPE[B, A] = MakeOPE[{2B}]; WRONG order *); 
OPE[B, B] = MakeOPE[{-One, 0}];
```


## Useful routines


# `pyope-voa` 索引文件
优点: 功能丰富，附带计算后端切换、Wolfram 批量规范化、Zhu's $C_2$ 代数、Zhu's 代数、有限维结合代数、associate variety、descendant 空间、null states 等功能模块

快速开始: [pyope-quick-start](manual/pyope-quick-start.md)

- **优先**使用本地版本 `pyope`：`~/pyope`

- **Fallback**: 若本地版本**不存在**，安装: `pip install pyope-voa`


## `pyope-voa` 使用提醒

- `clear_registry()` 清空算符注册表，用于重新声明算符，可以在所有声明前使用
- 用 `simplify_with_wolfram(expr)` 显式调用 Wolfram 端规范化做化简，可以传递以 `operator` 为中心的嵌套 `list`/`tuple`/`dict` 等载荷
- 使用 `set_compute_backend("wolfram", max_workder_number=X)` 让以下函数自动调用 `X` 个 `wolfram` 后端进行并行计算
- 若生成元含有**非正** conformal weight，构造 `LocalOperatorBasis` 时必须提供 `max_occurence`
- 需要自定义 SymPy/LaTeX 显示时，可使用 `BasicOperator(..., latex=...)`、`RealizedGenerator(..., latex=...)`，或者创建后用 `.set_latex(r"\beta")`
  ```python
  clear_registry()
  b = BasicOperator('b', fermionic=True, conformal_weight=Fraction(2))
  GW = b
  (GW,) = make_realized([GW])
  GW.set_latex(r"G_W")
  ```
- 需要研究 Zhu's 代数或有限维商代数时，优先查 `GenericZhuReducer`、`ZhuSpace`、`build_finite_dimensional_algebra`
- 需要研究 `C_2` 商、null states、singularity 约束时，优先查 `GenericC2Reducer`、`QuotientC2NullSearcher`、`SingularVectorAnalyzer`

模块文档的索引: [pyope-index](manual/pyope-index.md)

# `wls` Coding convention
1. **CRITICAL**: 多行表达式**必须用括号 `()`** 括起来作为一个整体
   ```Wolfram
   var = (term1
          + term2
          + term3
          + ...)
   ```
   否则 Wolfram Script 可能会**误解**表达式的结构，将第二行以及之后的行当成新的表达式，导致语法错误或计算错误
2. 函数要用**中括号** `[arg1, arg2, ...]` 包裹 arguments
3. **注意**: 变量名、argument 名字**不能**加**下划线**，除非是 `pattern`
4. 下划线代表 `pattern`，小心使用，例如 `var_` 是一个 pattern，可以匹配任何名字的变量，而 `var` 是一个具体的变量名


## Useful routines
find **null states** using **free field realization** with `pyope-voa`: [find-null-states](find-null-states.md)
