# Fixed-Weight Operator Spaces, Realizations, and Descendants

## Main Modules

| Module | Use | Main items |
| --- | --- | --- |
| `operator_spaces.py` | fixed-weight bases and sparse linear algebra | `LocalOperatorBasis`, `LocalOperatorCanonicalizer`, `SparseLinearContext`, `RealizedGenerator`, `make_realized`, `realize`, `realized_coordinates`, `list_independent_ops`, `list_independent_op_indices`, `list_zero_relations` |
| `descendants.py` | descendant generation | `DescendantSpace` |
| `realizations.py` | optional realization backends | `RealizationBackend`, `IdentityRealizationBackend`, `DerivativeKillingRealizationBackend` |
| `operators.py` | custom display metadata on symbolic generators | `BasicOperator(..., latex=...)`, `.set_latex(...)` |

## Fixed-Weight Basis and Coordinates

`LocalOperatorBasis` now takes generators and optional metadata. The target weight is passed per call.

```python
from pyope import BasicOperator, Bosonic, LocalOperatorBasis, NO, d

T = BasicOperator("T", conformal_weight=2)
J = BasicOperator("J", conformal_weight=1)
Bosonic(T, J)

basis = LocalOperatorBasis([T, J])

expr = 5 * NO(T, J) + d(T)
print(basis.list(3))
print(basis.coordinates(expr, weight=3))
```

Use `basis.list(weight)` and `basis.coordinates(expr, weight=...)`.

## Nonpositive-Weight Generators

If any generator has nonpositive conformal weight, provide `max_occurence` when the basis is created.

```python
from pyope import BasicOperator, LocalOperatorBasis

b = BasicOperator("b", fermionic=True, conformal_weight=2)
c = BasicOperator("c", fermionic=True, conformal_weight=-1)

basis = LocalOperatorBasis([b, c], max_occurence=2)
```

## Independent Expressions and Zero Relations

```python
from pyope import BasicOperator, Bosonic, LocalOperatorBasis, NO, d

J = BasicOperator("J", conformal_weight=1)
Bosonic(J)

basis = LocalOperatorBasis([J])
expressions = [NO(J, J), 2 * NO(J, J), d(d(J))]

print(basis.list_independent_ops(expressions, weight=2))
print(basis.list_independent_op_indices(expressions, weight=2))
print(basis.list_zero_relations(expressions, weight=2))
```

Use `list_independent_op_indices(...)` when original input positions matter. `list_independent_ops(...)` returns the independent expressions themselves.

## Realized Generators

```python
from pyope import BasicOperator, Bosonic, NO, RealizedGenerator, d, realize

J = BasicOperator("J", conformal_weight=1)
Bosonic(J)

W = RealizedGenerator("W", realization=NO(J, J))
print(realize(NO(W, d(W))))
```

`make_realized(...)` is the convenient form when the Python variable name should become the generator name.

It **preserves the input order** of the expressions you pass in, and name inference prefers the latest binding name in the caller namespace.

```python
from pyope import NO, make_realized

J0 = NO(J, J)
J0, = make_realized([J0])
print(J0.name)
```

For multi-generator promotion, unpack in the same order you passed to `make_realized(...)`.

```python
Jplus = NO(J, J)
dJ = d(J)
Jplus, dJ = make_realized([Jplus, dJ])
```

`BasicOperator` and `RealizedGenerator` 支持自定义 LaTeX 显示名。

```python
from sympy import latex
from pyope import BasicOperator, RealizedGenerator, NO

T = BasicOperator("T", conformal_weight=2, latex=r"\mathcal{T}")
W = RealizedGenerator("W", realization=NO(T, T), latex=r"\mathcal{W}")

print(latex(T))
print(latex(W))
W.set_latex(r"\mathbf{W}")
print(latex(W))
```

## Descendants

```python
from pyope import DescendantSpace

descendants = DescendantSpace(basis)
print(descendants.generate(T, 4))
print(descendants.basis(T, 4))
```

Use `generate(...)` for all canonical candidates and `basis(...)` for an independent spanning set.

## Performance Notes

- Reuse one `LocalOperatorBasis` object across many weight queries.
- Pass a whole list to `list_independent_ops(...)`, `list_independent_op_indices(...)`, or `list_zero_relations(...)` instead of calling `coordinates(...)` in a Python loop.
- If your environment enables Wolfram-side canonicalization, these batch helpers share one single-pass pre-canonicalization path.
- `realize(...)` uses memoization for repeated `RealizedGenerator` expansion, and nested normal products are combined incrementally to keep intermediate expressions smaller.
