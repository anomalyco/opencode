# Zhu Algebra and Finite-Dimensional Associative Algebras

## Main Modules

| Module | Use | Main items |
| --- | --- | --- |
| `zhu.py` | Zhu products and reduction modulo `O(V)` | `zhu_star_product`, `zhu_circle_product`, `GenericZhuReducer`, `ZhuReductionWitness`, `ZhuSpace` |
| `finite_algebra.py` | finite-dimensional associative algebras from structure constants | `FiniteDimensionalAlgebra`, `AlgebraElement`, `build_finite_dimensional_algebra` |

## Zhu Products

`zhu_star_product(left, right)` and `zhu_circle_product(left, right)` require the conformal weight of `left` to be well defined.

```python
from pyope import BasicOperator, Bosonic, zhu_circle_product, zhu_star_product

T = BasicOperator("T", conformal_weight=2)
Bosonic(T)

print(zhu_star_product(T, T))
print(zhu_circle_product(T, T))
```

Use the star product for multiplication in `A(V)`. Use the circle product for generators of `O(V)`.

## Zhu Reduction

```python
from pyope import GenericZhuReducer, LocalOperatorBasis, ZhuSpace

basis = LocalOperatorBasis([T])
reducer = GenericZhuReducer(basis)

witness = reducer.solve_zhu_witness(zhu_star_product(T, T))
print(witness.remainder)
print(witness.ov_part)

space = ZhuSpace(basis)
print(space.multiply(T, T, weight=4))
```

Use `solve_zhu_witness(...)` when you need both the quotient remainder and the explicit `O(V)` part. `ZhuSpace` is the convenience wrapper for fixed-weight work.

## Inhomogeneous Input

`GenericZhuReducer.solve_zhu_witness(expr)` can accept an inhomogeneous expression. It decomposes the input by conformal weight and reduces each weight sector separately.

## Candidate Generators and Weight Sectors

`GenericZhuReducer.candidate_generators_for_weight(weight)` exposes the current generating set used for the fixed-weight `O(V)` span. `candidate_generators_for_expr(expr)` first canonicalizes the input and infers the homogeneous target weight.

This is useful when you want to inspect why a Zhu reduction succeeds or fails before building a finite-dimensional quotient model.

## Finite-Dimensional Associative Algebra

```python
from pyope import build_finite_dimensional_algebra

A = build_finite_dimensional_algebra(
    basis_names=["1", "x"],
    structure_constants={
        ("1", "1"): {"1": 1},
        ("1", "x"): {"x": 1},
        ("x", "1"): {"x": 1},
        ("x", "x"): {},
    },
    identity="1",
)

print(A.dimension)
print(A.multiply("x", "x"))
print(A.validate_associativity().is_associative)
```

`build_finite_dimensional_algebra(...)` expects `structure_constants`, not `products`.

## Useful Methods on `FiniteDimensionalAlgebra`

- `basis_element(name)`
- `basis()`
- `multiply(left, right)`
- `left_regular_matrix(element)` and `right_regular_matrix(element)`
- `validate_associativity()`
- `validate_identity()`
- `solve_one_dimensional_representations()`

## Performance Notes

- Reuse one `LocalOperatorBasis` and one `GenericZhuReducer` for many reductions.
- Zhu candidate generation scans fixed-weight bases up to the target weight, so lower target weights are much cheaper.
- If you need many explicit Wolfram simplifications before Zhu reduction, batch them with `simplify_with_wolfram([...])`.
- For inhomogeneous expressions, `solve_zhu_witness(...)` reduces one weight sector at a time; if you already know the target sector, pass `weight=...` through `ZhuSpace.solve_zhu_witness(...)` or `ZhuSpace.quotient_normal_form(...)` to avoid extra decomposition work.
