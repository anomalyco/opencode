# Tree-sitter Differential Corpus

This corpus compares the current dependency-free scanner with retained outputs from the former Core tree-sitter implementation. The JSON baseline was captured with `tree-sitter-bash@0.25.0`, `tree-sitter-powershell@0.25.10`, and `web-tree-sitter@0.25.10`; running the comparison does not load or depend on tree-sitter.

Run from this package:

```sh
bun run research:parity
```

The command prints one JSON document. Per-shell and combined `metrics` report scanned/opaque totals, exact output parity, kind differences, and command extraction differences. `differences` includes the complete expected and actual values so scanner changes can be investigated without regenerating the historical fixture.

The old parser did not have an opaque classification. Its outputs are therefore all `scanned`; intentional fail-closed behavior appears as a kind difference and remains measurable over time.

`tree-sitter.json` is a historical artifact, not a golden file for the desired scanner behavior. Only replace it after deliberately capturing another named historical implementation, and record the parser versions in both the fixture and this document.
