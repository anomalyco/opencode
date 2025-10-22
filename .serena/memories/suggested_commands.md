# OpenCode Development Commands

## Core Development Commands
```bash
# Install dependencies
bun install

# Type checking across all packages (WORKS)
bun run typecheck
bun turbo typecheck

# Build all packages
bun turbo build

# Run tests
bun test                    # From packages/opencode
bun turbo test             # From root (runs all tests)
```

## Current Status
- `bun run dev` currently fails with SIGABRT - needs investigation
- Type checking works correctly
- Build process may require Go dependencies to be properly set up

## Package-Specific Commands
```bash
# opencode package
cd packages/opencode
bun typecheck              # Type checking only
bun build                  # Build the package (currently failing)
bun test                   # Run tests

# Other packages typically have:
bun typecheck              # Type checking
bun build                  # Build if applicable
```

## Debugging Current Issues
```bash
# The dev command is currently failing:
bun run dev                # Currently results in SIGABRT

# Alternative approaches to investigate:
cd packages/opencode
bun run src/index.ts --help   # Also failing with SIGABRT
```

## Git & Repository Commands
```bash
git status                 # Check repository status
git add .                  # Stage all changes
git commit -m "message"    # Commit changes
git push                   # Push to remote
git pull                   # Pull latest changes
```

## File System Utilities
```bash
ls -la                     # List files with details
find . -name "*.ts"        # Find TypeScript files
grep -r "pattern" .        # Search recursively
rg "pattern"               # Ripgrep search (preferred)
```

## Testing & Quality
```bash
# Type checking works
bun turbo typecheck

# Check if these exist and run them
bun run lint    # Check for linting script
bun run format   # Check for format script
prettier --write .         # Manual formatting
```

## Next Steps for Development
1. Investigate the SIGABRT issue with `bun dev`
2. Check if Go TUI component needs to be built first
3. Verify all dependencies are properly installed
4. Consider running opencode from compiled binary instead of source