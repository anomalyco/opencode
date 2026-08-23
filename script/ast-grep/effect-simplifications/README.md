# Effect simplification rules

The dedicated config scans both TypeScript and TSX with equivalent rules. The
generic ast-grep config intentionally does not load these rules.

Ignored callback parameters are supported only when they are simple ASCII
underscore-prefixed identifiers such as `_`, `_error`, or `_value`, optionally
with a type annotation. A rule reports the callback only when the exact target
subtree contains no underscore-prefixed identifier-like node, proving the
binding is unused without relying on unavailable TypeScript scope resolution.

This proof is intentionally conservative. Destructured, defaulted, rest,
optional, non-underscore, and Unicode parameters are excluded. A nested binding
or property whose name starts with `_` also suppresses the diagnostic, even when
it does not reference the callback parameter. Regular-function callbacks are
excluded when their target captures `this`, `arguments`, or a meta-property such
as `new.target` or `import.meta`.
