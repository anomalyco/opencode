# MicroPython fixtures

These two test programs are unmodified from MicroPython v1.24.1, commit `ecfdd5d6f9be971852003c2049600dc7b3e2a838`:

- [`list_slice_3arg.py`](https://github.com/micropython/micropython/blob/ecfdd5d6f9be971852003c2049600dc7b3e2a838/tests/basics/list_slice_3arg.py): stepped slices, including negative and out-of-bounds indices.
- [`ifcond.py`](https://github.com/micropython/micropython/blob/ecfdd5d6f9be971852003c2049600dc7b3e2a838/tests/basics/ifcond.py): conditional expressions and evaluation order in tuple literals.

The upstream [test suite](https://github.com/micropython/micropython/blob/ecfdd5d6f9be971852003c2049600dc7b3e2a838/tests/README.md) compares printed output against CPython. `bun run test:cpython micropython` does the same with Code Mode. These are fixtures for the supported subset, not a claim of full MicroPython or CPython compatibility. The upstream license is included in [`LICENSE`](./LICENSE).
