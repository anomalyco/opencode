<!-- Context: workflows/external-libraries-faq | Priority: medium | Version: 1.0 | Updated: 2026-02-05 -->
# External Libraries: FAQ

**Purpose**: Troubleshooting and common questions about ExternalScout

---

## When exactly should I use ExternalScout?

**ALWAYS when working with external packages.**

**Triggers:**
- User mentions library
- `import`/`require` statements
- package.json deps
- Build errors
- First-time setup
- Version upgrades

**Rule**: If it's not in `/Users/apple/.config/opencode/context/`, use ExternalScout.

---

## What if I already know the library?

**DON'T rely on training data - it's outdated.**

Example: You think "I know Next.js, I'll use pages/"  
Reality: Next.js 15 uses app/  
Result: Broken code ❌

**Always fetch current docs, even if you "know" the library.**

---

## How do I know if something is external?

**External:** npm/pip/gem/cargo packages | Third-party frameworks | ORMs | Auth libraries | UI libraries

**NOT external:** Your project's code | Project utilities | Internal modules

**Check:** Is it in `package.json` dependencies? → External → Use ExternalScout

---

## Can I use both ContextScout and ExternalScout?

**YES! Use both for most features.**

```javascript
// 1. ContextScout: Project standards
task(subagent_type="ContextScout", ...)

// 2. ExternalScout: Library docs  
task(subagent_type="ExternalScout", ...)

// 3. Combine: Implement using both
```

---

## What if ExternalScout doesn't have the library?

ExternalScout has two sources:
1. **Context7 API** (primary): 50+ popular libraries
2. **Official docs** (fallback): Any library with public docs

If library not in Context7: Auto-fallback to official docs via webfetch.

---

## How do I write a good ExternalScout prompt?

**Template:**
```javascript
task(
  subagent_type="ExternalScout",
  description="Fetch [Library] docs for [specific topic]",
  prompt="Fetch current documentation for [Library]: [specific question]
  
  Focus on:
  - [What you need - be specific]
  - [Related features/APIs]
  
  Context: [What you're building]"
)
```

**Good:** ✅ Specific | ✅ Focused (3-5 things) | ✅ Contextual
**Bad:** ❌ Vague | ❌ Too broad | ❌ No context

---

## What if I get an error after using ExternalScout?

**Process:**
1. Read error message carefully
2. ExternalScout again with specific error:
```javascript
task(
  subagent_type="ExternalScout",
  description="Fetch docs for error resolution",
  prompt="Fetch [Library] docs: [error message]
  Error: [paste actual error]
  Focus on: Common causes | Solutions"
)
```
3. Check install scripts (maybe setup incomplete)
4. Verify versions (package.json vs docs)

---

## Do I need approval to use ExternalScout?

**NO - ExternalScout is read-only, no approval required.**

**Approval required:** ❌ Write code | ❌ Run commands | ❌ Install packages
**No approval:** ✅ ContextScout | ✅ ExternalScout | ✅ Read files

---

## ContextScout vs ExternalScout?

| Aspect | ContextScout | ExternalScout |
|--------|--------------|---------------|
| **Searches** | Internal project files | External documentation |
| **Location** | `/Users/apple/.config/opencode/context/` | Internet (Context7, docs) |
| **Returns** | Project standards | Library APIs |
| **Use for** | "How we do things here" | "How this library works" |
| **Speed** | Fast (local) | Slower (network) |

**Use both together for best results.**

---

## Quick Checklist

Before implementing with external libraries:

- [ ] Used ContextScout for project standards?
- [ ] Checked for install scripts first?
- [ ] Used ExternalScout for EACH external library?
- [ ] Asked for installation steps?
- [ ] Asked for current API patterns?
- [ ] Read returned docs before coding?

**All checked? → You're doing it right! ✅**

---

## Supported Libraries

**See**: `.opencode/skills/context7/library-registry.md`

**Categories:** Database/ORM | Auth | Frontend | Infrastructure | UI | State | Validation | Testing

Not listed? ExternalScout can still fetch from official docs.

---

## Related

- `external-libraries-workflow.md` - Core workflow
- `external-libraries-scenarios.md` - Common scenarios
- `.opencode/agent/subagents/core/externalscout.md` - ExternalScout agent
