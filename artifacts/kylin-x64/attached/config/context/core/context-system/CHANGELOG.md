<!-- Context: core/CHANGELOG | Priority: low | Version: 1.0 | Updated: 2026-02-15 -->

# Context System Changelog

**Purpose**: Track major changes to the context system

---

## 2026-01-08: Navigation System Redesign

### Major Changes

1. **Renamed README.md → navigation.md**
   - More descriptive filename
   - Better discoverability
   - Self-describing purpose

2. **Added Concern-Based Organization Pattern**
   - Pattern A: Function-Based (repository-specific)
   - Pattern B: Concern-Based (multi-technology)
   - Hybrid approach supported

3. **Token-Efficient Navigation**
   - Target: 200-300 tokens per navigation file
   - ASCII trees for structure
   - Tables for quick routes
   - Concise descriptions (3-5 words)

4. **Specialized Navigation Files**
   - Cross-cutting concerns (e.g., `ui-navigation.md`)
   - Task-focused routes
   - Workflow-oriented

5. **Self-Describing Filenames**
   - `code.md` → `code-quality.md`
   - `tests.md` → `test-coverage.md`
   - `review.md` → `code-review.md`

### New Documentation

**Created**:
- `guides/navigation-design.md` - How to create navigation files
- `guides/organizing-context.md` - How to choose organizational pattern
- `examples/navigation-examples.md` - Real-world examples

**Updated**:
- `context-system.md` - Added concern-based pattern, navigation principles
- `standards/templates.md` - Added navigation templates

### Organizational Decisions

1. **Core Standards (Universal)**
   - Location: `core/standards/`
   - Scope: All projects, all languages
   - Users can edit to affect global context flow

2. **Development Principles (Domain-Specific)**
   - Location: `development/principles/`
   - Scope: Software engineering
   - Both core standards and dev principles exist

3. **Data Context**
   - Location: `development/data/` (not top-level)
   - Rationale: Data layer is part of development workflow

4. **Specialized Navigation**
   - Includes quick routes + common patterns
   - Example: `fullstack-navigation.md` shows MERN, T3 stacks

### Migration Path

**Phase 0**: ✅ Update context system documentation (DONE)
**Phase 1**: Rename navigation files, update core/
**Phase 2**: Restructure development/ category
**Phase 3**: Organize New-context-to-sort/
**Phase 4**: Update all references

---

## Previous Changes

### 2026-01-06: Initial Context System

- Established MVI principle
- Created function-based structure
- Added file templates
- Defined operations (harvest, extract, organize, update)
