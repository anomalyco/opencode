<!-- Context: openagents-repo/guides | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Guide: Creating a Release

**Purpose**: Step-by-step workflow for creating a new release

---

## Quick Steps

```bash
# 1. Update version
echo "0.X.Y" > VERSION
jq '.version = "0.X.Y"' package.json > tmp && mv tmp package.json

# 2. Update CHANGELOG
# (Edit CHANGELOG.md manually)

# 3. Commit and tag
git add VERSION package.json CHANGELOG.md
git commit -m "chore: bump version to 0.X.Y"
git tag -a v0.X.Y -m "Release v0.X.Y"

# 4. Push
git push origin main
git push origin v0.X.Y
```

---

## Step 1: Determine Version

### Semantic Versioning

```
MAJOR.MINOR.PATCH

- MAJOR: Breaking changes
- MINOR: New features (backward compatible)
- PATCH: Bug fixes
```

### Examples

- `0.5.0` → `0.5.1` (bug fix)
- `0.5.0` → `0.6.0` (new feature)
- `0.5.0` → `1.0.0` (breaking change)

---

## Step 2: Update Version Files

### VERSION File

```bash
echo "0.X.Y" > VERSION
```

### package.json

```bash
jq '.version = "0.X.Y"' package.json > tmp && mv tmp package.json
```

### Verify Consistency

```bash
cat VERSION
cat package.json | jq '.version'
# Both should show same version
```

---

## Step 3: Update CHANGELOG

### Format

```markdown
# Changelog

## [0.X.Y] - 2025-12-10

### Added
- New feature 1
- New feature 2

### Changed
- Updated feature 1
- Improved feature 2

### Fixed
- Bug fix 1
- Bug fix 2

### Removed
- Deprecated feature 1

## [Previous Version] - Date
...
```

### Tips

✅ **Group by type** - Added, Changed, Fixed, Removed  
✅ **User-focused** - Describe impact, not implementation  
✅ **Link PRs** - Reference PR numbers  
✅ **Breaking changes** - Clearly mark breaking changes  

---

## Step 4: Commit Changes

```bash
# Stage files
git add VERSION package.json CHANGELOG.md

# Commit
git commit -m "chore: bump version to 0.X.Y"
```

---

## Step 5: Create Git Tag

```bash
# Create annotated tag
git tag -a v0.X.Y -m "Release v0.X.Y"

# Verify tag
git tag -l "v0.X.Y"
git show v0.X.Y
```

---

## Step 6: Push to GitHub

```bash
# Push commit
git push origin main

# Push tag
git push origin v0.X.Y
```

---

## Step 7: Create GitHub Release

### Via GitHub UI

1. Go to repository on GitHub
2. Click "Releases"
3. Click "Create a new release"
4. Select tag: `v0.X.Y`
5. Title: `v0.X.Y`
6. Description: Copy from CHANGELOG
7. Click "Publish release"

### Via GitHub CLI

```bash
gh release create v0.X.Y \
  --title "v0.X.Y" \
  --notes "$(cat CHANGELOG.md | sed -n '/## \[0.X.Y\]/,/## \[/p' | head -n -1)"
```

---

## Step 8: Verify Release

### Check GitHub

- ✅ Release appears on GitHub
- ✅ Tag is correct
- ✅ CHANGELOG is included
- ✅ Assets are attached (if any)

### Test Installation

```bash
# Test install from GitHub
./install.sh --list

# Verify version
cat VERSION
```

---

## Complete Example

```bash
# Releasing v0.6.0

# 1. Update version
echo "0.6.0" > VERSION
jq '.version = "0.6.0"' package.json > tmp && mv tmp package.json

# 2. Update CHANGELOG
cat >> CHANGELOG.md << 'EOF'
## [0.6.0] - 2025-12-10

### Added
- New API specialist agent
- GraphQL support in backend specialist

### Changed
- Improved eval framework performance
- Updated registry schema to 2.0.0

### Fixed
- Fixed path resolution for subagents
- Fixed registry validation edge cases
EOF

# 3. Commit
git add VERSION package.json CHANGELOG.md
git commit -m "chore: bump version to 0.6.0"

# 4. Tag
git tag -a v0.6.0 -m "Release v0.6.0"

# 5. Push
git push origin main
git push origin v0.6.0

# 6. Create GitHub release
gh release create v0.6.0 \
  --title "v0.6.0" \
  --notes "See CHANGELOG.md for details"
```

---

## Checklist

Before releasing:

- [ ] All tests pass
- [ ] Registry validates
- [ ] VERSION updated
- [ ] package.json updated
- [ ] CHANGELOG updated
- [ ] Changes committed
- [ ] Tag created
- [ ] Pushed to GitHub
- [ ] GitHub release created
- [ ] Installation tested

---

## Common Issues

### Version Mismatch

**Problem**: VERSION and package.json don't match  
**Solution**: Update both to same version

### Tag Already Exists

**Problem**: Tag already exists  
**Solution**: Delete tag and recreate
```bash
git tag -d v0.X.Y
git push origin :refs/tags/v0.X.Y
```

### Push Rejected

**Problem**: Push rejected (not up to date)  
**Solution**: Pull latest changes first
```bash
git pull origin main
git push origin main
git push origin v0.X.Y
```

---

## Related Files

- **Version management**: `scripts/versioning/bump-version.sh`
- **CHANGELOG**: `CHANGELOG.md`
- **VERSION**: `VERSION`

---

**Last Updated**: 2025-12-10  
**Version**: 0.5.0
