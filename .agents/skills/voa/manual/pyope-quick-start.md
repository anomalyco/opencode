# 主要类
- `BasicOperator`: 登记一个基本算符
- `OPE`: 管理算符的 OPE 数据
- `LocalOperatorBasis`: 根据 `BasicOperator` 列表管理不同 weight 的算符基底
  ```
  LocalOperatorBasis
  ├── list(weight) -> list of BasisOperator
  ├── list_independent_ops(list_of_ops) -> list of independent ops from the given list of ops
  ├── list_independent_op_indices(list_of_ops) -> list of indices of the independent ops from the given list of ops
  ├── list_zero_relations(list_of_ops) -> list of linear relations between the ops in the given list of ops
  ```
- `RealizedGenerator`: 登记一个带 realization 的抽象算符


# 性能要点

- 较小规模的算符化简直接用 `simplify(op_expr)`，更快
- 对于较大较复杂的表达式，或者大量表达式，显式调用 `simplify_with_wolfram(op_expr)`, `simplify_with_wolfram([...])` 可以调用 `wolfram` 批量化简表达式
- 使用 `set_compute_backend("wolfram", max_worker_number=X)` 让以下函数自动调用 `X` 个 `wolfram` 后端进行并行计算

  ```
  simplify_with_wolfram(op_expr)

  LocalOperatorBasis
  ├─ canonicalize(), coordinates()
  ├─ realized_coordinates(), 
  ├─ list_independent_ops(), 
  ├─ list_independent_op_indices()
  ├─ list_zero_relations()

  ```

  > 根据经验，`max_worker_number` 取 2-4 就可以提升性能



# 示例

```python

# 声明自由场算符
# bc 系统（费米鬼场）：b 权重 2, c 权重 -1
clear_registry()
b = BasicOperator('b', fermionic=True, conformal_weight=Fraction(2))
c = BasicOperator('c', fermionic=True, conformal_weight=Fraction(-1))

# βγ 系统 (玻色鬼场)：β 权重 3/2, γ 权重 -1/2
β = BasicOperator('β',  conformal_weight=Fraction(3, 2))
γ = BasicOperator('γ',  conformal_weight=Fraction(-1, 2))

# 定义 OPE: 算符声明顺序 b -> c -> β -> γ，声明 OPE 时也按照这个顺序
OPE[b, c] = MakeOPE([One])
OPE[β, γ] = MakeOPE([-One])
```

构造 composite operator：

```python

# 定义 composite generators
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

# 将刚才的 composite generators 声明为 realized generators
(T, J, W, Wbar, G, Gbar, GW, GbarWbar) = make_realized(generators)
generators = [T, J, W, Wbar, G, Gbar, GW, GbarWbar]

```

验证 null state
```python
null_1 = (
  -Fraction(8, 9) * NO(T,NO(T,NO(T,NO(J,J))))
+ Fraction(4, 3) * NO(T,NO(T,NO(T,T)))
+ Fraction(4, 9) * NO(T,NO(T,NO(T,d(J))))
+ -Fraction(8, 9) * NO(T,NO(T,NO(J,NO(G,Gbar))))
+ Fraction(2, 3) * NO(T,NO(T,NO(G,d(Gbar))))
+ -3 * NO(T,NO(T,NO(W,d(Wbar))))
+ -Fraction(1, 9) * NO(T,NO(T,NO(d(J),NO(J,J))))
+ -Fraction(4, 9) * NO(T,NO(T,NO(d(J),d(J))))
+ -Fraction(2, 9) * NO(T,NO(T,NO(d(G), Gbar)))
+ 5 * NO(T,NO(T,NO(d(W),Wbar)))
+ 1 * NO(T,NO(T,NO(d(J,2),J)))).realize()

simplify_with_wolfram(null_1) # 用 wolfram 化简，适用于复杂算符
simplify(null_1)              # 用 `sympy` 直接化简，适用于简单的算符
```

研究给定 weight 的算符基底，并利用 free field realization 列出 independent operators

```python
# 用 [T, J, W, Wbar, G, Gbar, GW, GbarWbar] 构造 weight=4 的算符基底
weight=4
basis = LocalOperatorBasis(generators)
list_of_ops = basis.list(weight)
list_of_ops_realized = [op.realize() for op in list_of_ops] # 代入 realization 但不化简

# 用 wolfram 化简
list_of_ops_realized = simplify_with_wolfram(list_of_ops_realized)

bc_basis.list_independent_ops(list_of_ops_realized)
bc_basis.list_independent_op_indices(list_of_ops_realized)
bc_basis.list_zero_relations(list_of_ops_realized)

```
