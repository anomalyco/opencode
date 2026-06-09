---
description: 寻找 null states
compatibility: pyope-voa
---

# 用 `pyope` 和 free field realization 寻找 null states

有一些顶点算符代数有 free field realization，比如 $\mathcal{W}_{\mathbb{Z}_3}$。在特殊的 realization 中，null states 的 free field realization 恰好为零

参考文献: [arXiv:1810.03612](https://arxiv.org/abs/1810.03612)

定义自由场算符
```python
# 定义自由场算符
# bc 系统（鬼场）：b 权重 2, c 权重 -1
clear_registry()
b = BasicOperator('b', fermionic=True, conformal_weight=Fraction(2))
c = BasicOperator('c', fermionic=True, conformal_weight=Fraction(-1))

# βγ 系统：β 权重 3/2, γ 权重 -1/2
β = BasicOperator('β',  conformal_weight=Fraction(3, 2))
γ = BasicOperator('γ',  conformal_weight=Fraction(-1, 2))
OPE[b, c] = MakeOPE([One])
OPE[β, γ] = MakeOPE([-One])
```

玻色生成元 $T, J, W, \bar W$, 费米生成元 $G, \bar G, G_W, \bar G_{\bar W}$
```python
J = 2 * NO(b, c) + 3 * NO(β, γ)

G = NO(γ, b)
Gbar = 2 * NO(d(β), c) + 3 * NO(β, d(c))

T = - 2 * NO(b, d(c)) - Fraction(3,2) * NO(β, d(γ)) - NO(d(b), c) - Fraction(1,2) * NO(d(β), γ)


W = β  # 权重 3/2
GW = b    # 权重 2

Wbar = (NO(β, NO(β, NO(γ, NO(γ, γ))))
      + 2 * NO(β, NO(γ, NO(γ, NO(b, c))))
      - 4 * NO(β, NO(d(γ), γ))
      - Fraction(4, 3) * NO(γ, NO(b, d(c)))
      + Fraction(2, 3) * NO(γ, NO(d(b), c))
      + Fraction(2, 3) * NO(d(β), NO(γ, γ))
      - Fraction(8, 3) * NO(d(γ), NO(b, c))
      + Fraction(10, 9) * d(d(γ)))

GbarWbar = (Fraction(8, 3) * NO(b, NO(d(d(c)), c))
       + 3 * NO(β, NO(β, NO(γ, NO(γ, d(c)))))
       - 4 * NO(β, NO(γ, NO(b, NO(d(c), c))))
       - 4 * NO(β, NO(γ, d(d(c))))
       - 4 * NO(β, NO(d(γ), d(c)))
       - Fraction(2, 3) * NO(d(b), NO(d(c), c))
       + 2 * NO(d(β), NO(β, NO(γ, NO(γ, c))))
       - Fraction(8, 3) * NO(d(β), NO(d(γ), c))
       + Fraction(2, 3) * NO(d(d(β)), NO(γ, c))
       + Fraction(10, 9) * d(d(d(c))))


generators = [T, J, W, Wbar, G, Gbar, GW, GbarWbar]

# make_realized 会按照 argument generators 里面的算符顺序进行算符注册
# 后续 .list() 方法产生的 NO 乘积也是按照这个顺序进行排列
(T, J, W, Wbar, G, Gbar, GW, GbarWbar) = make_realized(generators)
generators = [T, J, W, Wbar, G, Gbar, GW, GbarWbar]

GW.set_latex(r"G_W");
Gbar.set_latex(r"\bar G");
Wbar.set_latex(r"\bar W");
GbarWbar.set_latex(r"{\bar G_{\bar W}}");
```

计算由 generators 自由生成的 $weight=4$ 算符空间里有哪些线性组合 $= 0$ 的 relations
```python

weight=4
basis = LocalOperatorBasis(generators)
# 列举由 generators 生成的 weight=4 的算符
list_of_ops = [op for op in basis.list(weight=weight)]
list_of_ops_realized = [op.realize() for op in basis.list(weight=weight)]
len(list_of_ops)
# 用 Wolfram 计算后端 简化算符
list_of_ops_realized = simplify_with_wolfram(list_of_ops_realized)

# 用 b, c, β, γ 所生成的算符空间
bc_basis = LocalOperatorBasis([b, c, β, γ], max_occurence=6)
relations = bc_basis.list_zero_relations(list_of_ops_realized)

null = sum([relations[6]["coefficients"][i] * list_of_ops[i]
           for i in range(len(list_of_ops_realized))])
op_to_wolfram_string(null)
```
