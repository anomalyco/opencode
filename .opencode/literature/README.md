# Literature Library

Upload your parsed documents here. The agent will search and cite from these files.

## Directory Structure

```
literature/
├── math/        # Pure mathematics (proofs, theorems)
├── physics/     # Physics (derivations, principles)
├── cs/          # Computer science (algorithms, complexity)
├── engineering/ # Engineering (methods, applications)
└── textbooks/   # Reference textbooks
```

## File Format

- Plain text (.txt) or Markdown (.md)
- Pre-parsed content (no PDF/LaTeX processing needed)
- Include page/section numbers in content for accurate citations

## Example Format

```markdown
# Linear Algebra - Chapter 3

## Theorem 3.1 (Eigenvalue Decomposition)
If A is a symmetric matrix, then A = QΛQ^T where Q is orthogonal...

## Proof
Consider the characteristic polynomial det(A - λI) = 0...
```

## Usage

The agent will automatically:
1. Search files using grep/glob
2. Read relevant sections
3. Cite with `file_path:line_number` format
