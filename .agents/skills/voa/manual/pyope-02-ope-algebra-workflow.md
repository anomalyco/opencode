# OPE Workflow, Simplification, and Algebra Checks

## Main Modules

| Module | Use | Main items |
| --- | --- | --- |
| `api.py` | day-to-day OPE work | `OPE`, `MakeOPE`, `NO`, `NO_product`, `bracket` |
| `simplify.py` | canonical form | `simplify` |
| `jacobi.py` | consistency checks | `check_jacobi_identity`, `verify_jacobi_identity` |
| `compact_ope.py` | compact OPE-family helpers | `compact_family_poles` |
| `quasiprimary.py` | quasiprimary completion | `qp`, `quasiprimary_product` |

## Standard Workflow

1. Define generators with `BasicOperator`.
2. Declare parity with `Bosonic(...)` or `Fermionic(...)`.
3. Register basic OPEs with `OPE[A, B] = MakeOPE([...])`.
4. Compute derived OPEs with `OPE(expr1, expr2)`.
5. Extract a pole with `bracket(A, B, n)`.
6. Build composites with `NO(...)` or `NO_product(...)`.
7. Canonicalize with `simplify(...)`.

## OPE, Brackets, and Normal Ordering

```python
import sympy as sp

from pyope import BasicOperator, Bosonic, MakeOPE, OPE
from pyope import NO, bracket, simplify, One, Zero, d

T = BasicOperator("T", conformal_weight=2)
Bosonic(T)

c = sp.Symbol("c")
OPE[T, T] = MakeOPE([c / 2 * One, Zero, 2 * T, d(T)])

print(OPE(T, T).pole(4))
print(bracket(T, T, 2))
print(bracket(T, T, 0))
print(simplify(NO(T, T) + NO(T, T)))
```

Use `bracket(A, B, 0)` for the normal product and `bracket(A, B, n)` with `n \geq 1` for the `n`-th singular pole.

## `NO(...)` and `NO_product(...)`

- `NO(A, B)` is the explicit binary constructor.
- `NO_product(A, B, C, ...)` builds nested normal ordering: `NO(A, NO(B, NO(C, ...)))`
- `simplify(...)` is the algebraic canonicalizer; plain `sympy.simplify(...)` is not enough for normal-order structure.

## Jacobi and Quasiprimary Helpers

```python
from pyope import verify_jacobi_identity, qp

print(verify_jacobi_identity(T, T, T))

J = BasicOperator("J", conformal_weight=1)
Bosonic(J)
OPE[T, J] = MakeOPE([J, d(J)])

print(qp(T, J, 0))
```

Use `verify_jacobi_identity(...)` when you want a quick Boolean answer. Use `check_jacobi_identity(...)` when you want the explicit residual expression.

## Explicit Wolfram Simplification

```python
from pyope import simplify_with_wolfram

batch = [NO(T, T) + NO(T, T), d(NO(T, T))]
print(simplify_with_wolfram(batch))
```

`simplify_with_wolfram(...)` 接受单个表达式、列表、元组或字典载荷。批量操作优先使用列表输入。

如果你希望 `OPE(...)` 或 `LocalOperatorBasis` 相关规范化流程整体走 Wolfram 路线，可以显式切换后端：

```python
from pyope import compute_backend, set_compute_backend

set_compute_backend("wolfram", max_worker_number=4)

with compute_backend("wolfram"):
	print(OPE(T, T))
```
