# @opencode/codemode

- `interpreter-support.md` is a checklist, not a changelog: check off newly added support and add unchecked items for significant gaps. Leave it alone for fixes and refactors.
- Program values are `Value` (`src/runtime/objects.ts`). Host values are `unknown` and enter only through `fromHost` and `fromJson`; do not widen program-facing signatures to `unknown`.
- Each built-in object kind is one `Obj` subclass (`Wrapper` or `Opaque`) that overrides the hooks it needs. Ask the object instead of adding `instanceof` ladders.
- The core VM, compiler, prelude, snapshot, and stdlib modules must not import `effect`; Effect lives only in the host boundary and driver (`src/runtime/`, `src/openapi/`, and the top-level tool/runtime entrypoints).
