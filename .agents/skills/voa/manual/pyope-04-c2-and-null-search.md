# Sparse `C_2` Reduction and Null-State Search

## Main Modules

| Module | Use | Main items |
| --- | --- | --- |
| `c2.py` | reduction modulo `C_2` | `GenericC2Reducer`, `C2ReductionWitness` |
| `null_search.py` | quotient precheck and descendant lift | `NullSearchResult`, `QuotientC2NullSearcher` |
| `singularity.py` | positive-mode constraints | `SingularVectorAnalyzer` |
| `free_field_c2.py` | realization-specific `C_2` reducers | `FreeFieldC2Reducer`, `DerivativeKillingFreeFieldC2Reducer` |

## `C_2` Reduction

```python
from pyope import BasicOperator, Bosonic, GenericC2Reducer, LocalOperatorBasis, NO, d

T = BasicOperator("T", conformal_weight=2)
Bosonic(T)

basis = LocalOperatorBasis([T])
reducer = GenericC2Reducer(basis)

print(reducer.is_zero_mod_c2(NO(d(T), T)))

witness = reducer.solve_c2_witness(NO(T, T))
print(witness.remainder)
print(witness.c2_part)
print(witness.generators)
```

Use `solve_c2_witness(...)` when you need the actual quotient decomposition, not only a Boolean.

## Quotient Precheck and Null Search

```python
from pyope import (
    BasicOperator,
    Bosonic,
    DescendantSpace,
    GenericC2Reducer,
    LocalOperatorCanonicalizer,
    NO,
    QuotientC2NullSearcher,
)

T = BasicOperator("T", conformal_weight=2)
Bosonic(T)

canonicalizer = LocalOperatorCanonicalizer([T], stress_tensor=T)
reducer = GenericC2Reducer(canonicalizer)
searcher = QuotientC2NullSearcher(
    canonicalizer=canonicalizer,
    c2_reducer=reducer,
    descendants=DescendantSpace(canonicalizer),
)

precheck = searcher.quotient_precheck(NO(T, T))
print(precheck.status)

result = searcher.search_from_sources(4, [T], NO(T, T))
print(result.status if result is not None else None)
```

`quotient_precheck(...)` returns `needs_lift` or `obstructed`. `search_from_sources(...)` returns a `NullSearchResult` or `None` if the quotient obstruction vanishes but no descendant lift is found.

## Singularity Constraints

```python
from pyope import MakeOPE, OPE, SingularVectorAnalyzer

J = BasicOperator("J", conformal_weight=1)
Bosonic(J)
OPE[T, J] = MakeOPE([J, d(J)])

analyzer = SingularVectorAnalyzer(canonicalizer, generators=[T], stress_tensor=T)
print(analyzer.positive_mode_constraints(J))
print(analyzer.is_singular(J))
```

Use `positive_mode_constraints(...)` when you need the actual violating poles. Use `is_singular(...)` for a Boolean answer.

## Practical Notes

- Prefer `QuotientC2NullSearcher` over the older compatibility names `C2NullSearcher` and `C2Space`.
- `NullSearchResult` carries the quotient remainder, the lifted null candidate, descendant coefficients, and optional singularity data.
- Keep the target weight explicit when you build descendant spans.

## Performance Notes

- Reuse one `LocalOperatorCanonicalizer`, one `GenericC2Reducer`, and one `DescendantSpace` across many searches.
- Run `quotient_precheck(...)` before a full descendant lift.
- Descendant spaces grow quickly with weight, so keep the source set small.
