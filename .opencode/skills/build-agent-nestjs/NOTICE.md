# Attribution Notice

This skill integrates content from the upstream repository:

**Upstream Repository:** [Kadajett/agent-nestjs-skills](https://github.com/Kadajett/agent-nestjs-skills)  
**Upstream Skill:** NestJS Best Practices  
**Author:** Kadajett  
**License:** MIT  
**Upstream Version Integrated:** 1.1.0  

The upstream content is mirrored in the `upstream/` directory and adapted into this Agile V domain skill. The upstream materials provide detailed NestJS best practices, rule sets, and examples.

## Adaptation for Agile V

This skill adapts the upstream NestJS best practices into the Agile V framework by:
- Integrating with Agile V traceability requirements (REQ-XXXX → ART-XXXX)
- Mapping to SCOPE-V task execution framework (Specify → Constrain → Orchestrate → Prove → Evolve → Verify)
- Adding risk-based evidence requirements (R0/R1/R2/R3)
- Enforcing Red Team Protocol (independent verification)
- Supporting multi-cycle workflows with change requests

Agile V-specific adaptations (SKILL.md structure, SCOPE-V participation section, evidence requirements, traceability integration, multi-cycle versioning) are additions by the Agile V project and are licensed under CC-BY-SA-4.0.

---

## MIT License (Upstream Content)

The following license applies to the upstream content in the `upstream/` directory:

```
MIT License

Copyright (c) 2024 Kadajett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Synchronization

To sync with upstream updates:

```bash
cd domains/build-agent-nestjs/upstream
git pull origin main
# Review changes and update SKILL.md if new patterns emerge
```

Document sync events in CHANGELOG.md:
```
## [1.1.0] - 2026-MM-DD
### Changed
- Synced upstream Kadajett/agent-nestjs-skills to v1.2.0
- Added GraphQL-specific patterns to SKILL.md
- Updated dependency injection guidance based on upstream rule changes
```
