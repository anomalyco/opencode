---
name: literature-search
description: Iterative literature search strategy using OpenCode's search tools. Use this when you need to find specific theorems, equations, algorithms, or concepts in the uploaded literature.
---

## Literature Search Strategy

Like searching code, searching literature requires iterative refinement.

### Search Hierarchy

1. **Keyword Search** (grep)
   ```
   grep "theorem" .opencode/literature/math/
   grep "equation of motion" .opencode/literature/physics/
   grep "complexity O(n" .opencode/literature/cs/
   ```

2. **File Discovery** (glob)
   ```
   glob "**/*quantum*.md" .opencode/literature/
   glob "**/*algorithm*.md" .opencode/literature/cs/
   ```

3. **Deep Read** (read)
   - Read promising files completely
   - Note line numbers for citations

### Iterative Refinement

If initial search fails:

1. **Broaden terms**: "Lagrangian" -> "Lagrange" -> "variational"
2. **Try synonyms**: "eigenvalue" -> "characteristic value" -> "spectrum"
3. **Search related concepts**: Can't find theorem? Search its prerequisites
4. **Check different categories**: A math result might be in physics folder

### Cross-Reference Pattern

For complex topics:

1. Find the primary source
2. Search for related terms mentioned in that source
3. Build a citation chain
4. Verify consistency across sources

### Document Categories

```
.opencode/literature/
├── math/           # Pure math: proofs, theorems, lemmas
├── physics/        # Physics: derivations, principles, laws
├── cs/             # CS: algorithms, complexity, data structures
├── engineering/    # Applied: methods, standards, practices
└── textbooks/      # Reference: comprehensive coverage
```

### Search Tips

- Math symbols: search by name ("integral", "derivative", "sum")
- Greek letters: search by name ("alpha", "beta", "lambda")
- Equations: search by key terms ("F = ma", "Schrodinger")
- Numbered items: "Theorem 3", "Lemma 2.1", "Algorithm 5"
