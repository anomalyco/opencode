# pyope Index

## Documentation Index

1. `pyope-01-core-runtime.md`: operators, registry state, `OPEData`, and coefficient collection.
2. `pyope-02-ope-algebra-workflow.md`: OPE evaluation, normal ordering, simplification, Jacobi, and quasiprimary helpers.
3. `pyope-03-operator-spaces-and-realizations.md`: fixed-weight bases, coordinates, independence filters, realized generators, and descendants.
4. `pyope-04-c2-and-null-search.md`: sparse `C_2` reduction, quotient witnesses, null search, and singularity constraints.
5. `pyope-05-zhu-and-finite-algebra.md`: Zhu products, reduction modulo `O(V)`, and finite-dimensional associative algebra helpers.
6. `pyope-06-wolfram-backend-and-performance.md`: explicit Wolfram bridge protocol, container payload support, chunking, and performance guidance.

## Core Public API

### Core algebra

- `BasicOperator`, `Operator`, `DerivativeOperator`, `NormalOrderedOperator`
- `Bosonic`, `Fermionic`, `clear_registry`
- `OPE`, `MakeOPE`, `NO`, `NO_product`, `bracket`
- `d`, `dn`
- `One`, `Zero`, `Delta`
- `simplify`
- `check_jacobi_identity`, `verify_jacobi_identity`
- `collect_operators_coefficients`, `extract_scalar_operator`

### Fixed-weight and realization workflow

- `LocalOperatorBasis`, `LocalOperatorCanonicalizer`, `SparseLinearContext`
- `RealizedGenerator`, `make_realized`, `realize`, `realized_coordinates`
- `make_realized(...)` preserves input order and infers names from the latest caller-side binding
- `list_independent_ops`, `list_independent_op_indices`, `list_zero_relations`
- `DescendantSpace`
- `compact_family_poles`, `qp`, `quasiprimary_product`
- `BasicOperator(..., latex=...)`, `RealizedGenerator(..., latex=...)`, `.set_latex(...)`

### Quotients and algebra extraction

- `GenericC2Reducer`, `C2ReductionWitness`
- `NullSearchResult`, `QuotientC2NullSearcher`, `SingularVectorAnalyzer`
- `zhu_star_product`, `zhu_circle_product`, `GenericZhuReducer`, `ZhuSpace`, `ZhuReductionWitness`
- `build_finite_dimensional_algebra`, `FiniteDimensionalAlgebra`, `AlgebraElement`

### Explicit Wolfram bridge

- `simplify_with_wolfram`, `op_to_wolfram_string`, `chunk_exprs_for_wolfram`

## Backend and Performance

- Public workflows should stay on `sympy`.
- `set_compute_backend("wolfram", max_worker_number=...)` performs a process-wide backend switch
- `compute_backend("wolfram", max_worker_number=...)` performs a scoped backend switch
- `simplify_with_wolfram(...)` remains the direct entry point for explicit one-shot or batched Wolfram simplification
- `simplify_with_wolfram(expr)` 接受单个表达式、列表、元组或字典载荷
- `LocalOperatorBasis` 无构造器级别 `max_weight`；使用 `basis.list(weight)` 和 `basis.coordinates(expr, weight=...)`
- 若生成元含有**非正** conformal weight，构造 `LocalOperatorBasis` 时必须提供 `max_occurence`
- `BasicOperator(..., latex=...)` 和 `RealizedGenerator(..., latex=...)` 自定义 LaTeX 显示；`.set_latex(...)` 修改显示
- 批量操作优先使用 `list_independent_ops(...)`、`list_independent_op_indices(...)`、`list_zero_relations(...)`、`simplify_with_wolfram([...])`
- Wolfram 传输按项数和载荷大小分块，大批量任务性能更好
- Wolfram 桥接持久化请求载荷到临时文件，支持嵌套容器往返

## Module Map

| File | Role | Main items |
| --- | --- | --- |
| `src/pyope/__init__.py` | Public export surface | package-level API |
| `src/pyope/backend.py` | Backend state | `get_compute_backend`, `set_compute_backend`, `compute_backend` |
| `src/pyope/wolfram_backend.py` | Explicit Wolfram bridge and transport layer | `simplify_with_wolfram`, `op_to_wolfram_string`, `chunk_exprs_for_wolfram` |
| `src/pyope/operators.py` | Symbolic operators | `Operator`, `BasicOperator`, `DerivativeOperator`, `NormalOrderedOperator`, `d`, `dn` |
| `src/pyope/constants.py` | Distinguished constants | `One`, `Zero`, `Delta` |
| `src/pyope/local_operator.py` | Local-operator decomposition | `is_local_operator`, `extract_scalar_operator`, `collect_operators_coefficients` |
| `src/pyope/registry.py` | Stateful OPE registry | `Bosonic`, `Fermionic`, `clear_registry`, `ope_registry` |
| `src/pyope/ope_data.py` | Pole container | `OPEData`, `from_list`, `.pole(n)`, `.max_pole` |
| `src/pyope/api.py` | Main OPE and normal-order workflow | `OPE`, `MakeOPE`, `NO`, `normal_product`, `bracket` |
| `src/pyope/simplify.py` | Canonicalization | `simplify` |
| `src/pyope/jacobi.py` | Jacobi checks | `check_jacobi_identity`, `verify_jacobi_identity` |
| `src/pyope/quasiprimary.py` | Quasiprimary completion | `qp`, `quasiprimary_product` |
| `src/pyope/operator_spaces.py` | Fixed-weight and realization-aware linear algebra | `LocalOperatorBasis`, `SparseLinearContext`, `RealizedGenerator`, independence helpers |
| `src/pyope/descendants.py` | Descendant generation | `DescendantSpace` |
| `src/pyope/c2.py` | Sparse `C_2` quotient reduction | `GenericC2Reducer`, `C2ReductionWitness` |
| `src/pyope/null_search.py` | Null-state search | `NullSearchResult`, `QuotientC2NullSearcher` |
| `src/pyope/singularity.py` | Positive-mode and singularity constraints | `SingularVectorAnalyzer` |
| `src/pyope/zhu.py` | Zhu algebra workflow | `zhu_star_product`, `zhu_circle_product`, `GenericZhuReducer`, `ZhuSpace` |
| `src/pyope/finite_algebra.py` | Finite-dimensional associative algebras | `FiniteDimensionalAlgebra`, `build_finite_dimensional_algebra` |
