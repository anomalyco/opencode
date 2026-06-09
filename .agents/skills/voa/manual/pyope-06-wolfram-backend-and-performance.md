# Explicit Wolfram Bridge and Performance Guidance

## Main Modules

| Module | Use | Main items |
| --- | --- | --- |
| `backend.py` | public backend state | `get_compute_backend`, `set_compute_backend`, `compute_backend` |
| `wolfram_backend.py` | explicit Wolfram canonicalization and transport | `simplify_with_wolfram`, `op_to_wolfram_string`, `chunk_exprs_for_wolfram`, `WolframBackendError` |
| `operator_spaces.py` | batch fixed-weight workflows that can reuse Wolfram-side precanonicalization | `list_independent_ops`, `list_independent_op_indices`, `list_zero_relations` |

## Public Positioning

- 默认使用 `sympy` 后端
- `set_compute_backend("wolfram", max_worker_number=...)` 支持进程级后端切换
- `compute_backend("wolfram", max_worker_number=...)` 支持局部上下文切换
- `simplify_with_wolfram(...)` 仍然是显式单次或批量化简的直接入口
- 如果没有安装 `wolframscript`，切换或显式调用会抛出带安装提示的错误

## What `simplify_with_wolfram(...)` Accepts

`simplify_with_wolfram(...)` is no longer just a single-expression helper.

- one operator expression
- a list of expressions
- nested lists and tuples
- dict payloads with string keys

可以传递结构化载荷，保留嵌套形状，避免多次小批量 Wolfram 调用。

```python
from pyope import BasicOperator, NO, dn, simplify_with_wolfram

beta = BasicOperator("β")
gamma = BasicOperator("γ")

payload = {
    "ops": [NO(gamma, dn(2, beta)), (dn(1, beta), "tag")],
    "meta": {"label": "trial"},
}

print(simplify_with_wolfram(payload))
```

## Transport Notes

- The bridge serializes requests through temp payload files instead of stuffing large strings directly into environment variables.
- Operator names with Greek letters are encoded to Mathematica-style escapes and decoded back on return.
- `op_to_wolfram_string(...)` is the public encoder when you need to inspect the exact transport form.

## Chunking Guidance

Use `chunk_exprs_for_wolfram(exprs, max_items=..., max_chars=...)` when you want manual control, but most users can let `simplify_with_wolfram([...])` auto-chunk for large lists.

- chunking is constrained by both expression count and encoded payload size
- very large single expressions can still exceed the transport limit
- many tiny calls are slower than one moderate batch because `wolframscript` startup dominates

## Where Performance Improved

- operator-space helpers now share a single-pass Wolfram precanonicalization path when that backend is available internally
- batched simplification avoids repeated encode/invoke/decode overhead
- persisted payload files make large jobs more robust than earlier inline transport styles

## Practical Performance Suggestions

- 批量操作优先使用 `simplify_with_wolfram([...])` 而非循环调用 `simplify_with_wolfram(expr)`
- 独立性检查或零关系扫描优先使用 `list_independent_ops(...)`、`list_independent_op_indices(...)`、`list_zero_relations(...)`
- 复用 `LocalOperatorBasis` 对象以利用缓存的规范化和基枚举
- 小任务保持 `sympy` 后端，Wolfram 启动成本可能抵消简化收益

## Retrieval Targets

- `src/pyope/wolfram_backend.py`
- `src/pyope/operator_spaces.py`
- `tests/foundation/test_backend.py`
- `tests/research/test_operator_spaces.py`
