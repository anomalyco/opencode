---
title: "bun why"
description: "Explain why a package is installed"
---

The `bun why` command explains why a package is installed in your project by showing the dependency chain that led to its installation.

## Usage

```bash terminal icon="terminal"
bun why <package>
```

## Arguments

- `<package>`: The name of the package to explain. Supports glob patterns like `@org/*` or `*-lodash`.

## Options

- `--top`: Show only the top-level dependencies instead of the complete dependency tree.
- `--depth <number>`: Maximum depth of the dependency tree to display.

## Examples

Check why a specific package is installed:

```bash terminal icon="terminal"
bun why react
```

```txt
react@18.2.0
  └─ my-app@1.0.0 (requires ^18.0.0)
```

Check why all packages with a specific pattern are installed:

```bash terminal icon="terminal"
bun why "@types/*"
```

```txt
@types/react@18.2.15
  └─ dev my-app@1.0.0 (requires ^18.0.0)

@types/react-dom@18.2.7
  └─ dev my-app@1.0.0 (requires ^18.0.0)
```

Show only top-level dependencies:

```bash terminal icon="terminal"
bun why express --top
```

```txt
express@4.18.2
  └─ my-app@1.0.0 (requires ^4.18.2)
```

Limit the dependency tree depth:

```bash terminal icon="terminal"
bun why express --depth 2
```

```txt
express@4.18.2
  └─ express-pollyfill@1.20.1 (requires ^4.18.2)
     └─ body-parser@1.20.1 (requires ^1.20.1)
     └─ accepts@1.3.8 (requires ^1.3.8)
        └─ (deeper dependencies hidden)
```

## Understanding the Output

The output shows:

- The package name and version being queried
- The dependency chain that led to its installation
- The type of dependency (dev, peer, optional, or production)
- The version requirement specified in each package's dependencies

For nested dependencies, the command shows the complete dependency tree by default, with indentation indicating the relationship hierarchy.
