<!-- Context: core/organizing-context | Priority: high | Version: 1.1 | Updated: 2026-02-15 -->

# Guide: Organizing Context by Concern

**Purpose**: How to choose and apply the right organizational pattern

**Last Updated**: 2026-02-15

---

## Two Organizational Patterns

### Pattern A: Function-Based
**Use for**: Repository-specific context

**Structure**: Organize by what the information does
```
{repo}/
├── concepts/     # What it is
├── examples/     # Working code
├── guides/       # How to do it
├── lookup/       # Quick reference
└── errors/       # Troubleshooting
```

**Example**: `openagents-repo/`

---

### Pattern B: Concern-Based
**Use for**: Multi-technology development context

**Structure**: Organize by what you're doing (concern), then how (approach/tech)
```
{concern}/
├── {approach}/   # How you're doing it
└── {tech}/       # What you're using
```

**Example**: `development/frontend/react/`, `ui/web/design/`

---

## Decision Tree

| Question | Answer | Use Pattern |
|----------|--------|-------------|
| Is this repository-specific? | YES | **Pattern A** (Function-Based) |
| Does content span multiple technologies? | YES | **Pattern B** (Concern-Based) |
| Single domain/technology? | YES | **Pattern A** (Function-Based) |

---

## Quick Steps to Organize

### 1. Audit Existing Content
- List all files
- Identify natural groupings
- Note overlaps/duplicates

### 2. Choose Pattern
- Use decision tree above
- Consider future growth
- Check existing patterns in `/Users/apple/.config/opencode/context/`

### 3. Create Directory Structure
```bash
mkdir -p {category}/{subcategory}
```

### 4. Move Files
- Move files to new structure
- Keep filenames descriptive
- Follow naming conventions

### 5. Create Navigation Files
- Add `navigation.md` to each directory
- Follow navigation template (see navigation-templates.md)
- Keep to 200-300 tokens

### 6. Update References
- Update links in moved files
- Update parent navigation.md
- Test navigation paths

---

## Pattern Examples

### Function-Based (openagents-repo/)
```
openagents-repo/
├── concepts/agents.md
├── examples/subagent-example.md
├── guides/creating-agents.md
├── lookup/commands.md
└── errors/tool-errors.md
```

### Concern-Based (development/)
```
development/
├── frontend/
│   ├── react/
│   └── vue/
├── backend/
│   ├── node/
│   └── python/
└── data/
    └── postgres/
```

### Hybrid (ui/)
```
ui/
├── web/
│   ├── design/
│   ├── animation/
│   └── react-patterns.md
└── terminal/
    └── cli-design.md
```

---

## Verification Checklist

- [ ] Every directory has navigation.md?
- [ ] Navigation files follow template?
- [ ] All files have frontmatter?
- [ ] Links updated and working?
- [ ] Pattern is consistent?
- [ ] Files under line limits?

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| File fits multiple categories | Choose primary purpose, reference from others |
| Too many files in one directory | Create subcategories |
| Unclear hierarchy | Use concern-based pattern |
| Navigation too complex | Simplify structure, use specialized navigation |

---

## Related

- structure.md - Directory structure standards
- navigation-templates.md - Navigation file templates
- creation.md - Creating new context files
