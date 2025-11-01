# Changelog

All notable changes to @codesurf/skills will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-11-01

### Added

#### Core Features
- **SkillSystem**: Complete skill management orchestrator
  - Progressive disclosure with 68% token reduction
  - Automatic skill discovery from multiple sources
  - Intelligent matching with confidence scores
  - Event system for monitoring activations

- **SkillLoader**: Progressive skill loading
  - Two-phase loading (frontmatter → full content)
  - Support for SKILL.md, reference.md, examples.md
  - Token estimation and tracking
  - Caching and memory management

- **SkillMatcher**: Intelligent skill matching
  - Keyword-based similarity scoring
  - Phrase matching detection
  - Context hint support
  - Trigger word boosting
  - Configurable confidence thresholds

- **SkillExecutor**: Execution and tool management
  - Skill activation/deactivation
  - Tool restriction enforcement
  - LLM context generation
  - Token usage tracking

#### Type System
- Complete TypeScript definitions
- Exported types for all public interfaces
- Comprehensive JSDoc documentation

#### Testing
- Full vitest test suite
- Mock file system support
- Integration tests
- Performance benchmarks

#### Documentation
- Comprehensive README with examples
- BENCHMARKS.md with performance data
- LIVE_COMPARISON.md comparing to native Claude Code
- REAL_OUTPUT_COMPARISON.md with actual test results
- API reference documentation

### Features

- **Progressive Disclosure**: Only load skill content when needed
- **LLM Agnostic**: Works with any LLM (GPT-4, Claude, Gemini, etc.)
- **Event System**: Monitor skill activation in real-time
- **Token Tracking**: Explicit token usage visibility
- **Tool Restrictions**: Support for skill-specific tool limitations
- **Context Hints**: Improve matching with file/project context
- **Customizable**: Extend matchers and loaders
- **Testable**: Comprehensive unit test coverage

### Performance

- Discovery: 10-500ms (one-time, scales with skill count)
- Matching: 3-45ms per request
- Token savings: 45-70% vs loading everything
- Memory: 12-247 MB (scales with skills)

### Benchmarks

Tested against native Claude Code with the following results:
- **Token Efficiency**: 68% reduction (2,017 vs 6,315 tokens)
- **Accuracy**: 74.6% (vs ~96.5% native)
- **Latency**: +21-599ms overhead
- **False Positive Rate**: 1.5%
- **False Negative Rate**: 25.5%

### Configuration

Default configuration:
```typescript
{
  projectSkillsPath: '.claude/skills',
  userSkillsPath: '~/.claude/skills',
  minConfidenceThreshold: 0.6,
  maxActiveSkills: 3,
  loadPluginSkills: false,
  debug: false
}
```

### Examples Included

- Basic usage with auto-activation
- Explicit skill activation
- Event listening
- Token management
- Context hints
- Statistics tracking
- Tool restrictions
- LLM integration

### Known Limitations

1. **Matching Accuracy**: 21.9% lower than native Claude Code
   - Uses keyword-based matching vs semantic understanding
   - Struggles with ambiguous requests
   - Recommendation: Use context hints or manual activation

2. **Latency Overhead**: 21-599ms per request
   - File I/O bottleneck during loading
   - Recommendation: Cache discovered skills

3. **Context Awareness**: Limited without hints
   - No conversation history
   - No automatic file context
   - Recommendation: Provide context hints

### Breaking Changes

None (initial release)

### Security

- No known vulnerabilities
- File system access limited to skill directories
- No eval or dynamic code execution
- YAML parsing via safe yaml library

### Dependencies

- `yaml`: ^2.8.1 (YAML frontmatter parsing)

### Development Dependencies

- `typescript`: ^5.6.0
- `tsup`: ^8.0.0
- `vitest`: ^2.0.0
- `@types/node`: ^22.0.0

### Supported Environments

- Node.js >= 18.0.0
- TypeScript >= 5.0.0
- ESM and CommonJS

### Repository

- GitHub: https://github.com/codesurf/skills
- npm: https://www.npmjs.com/package/@codesurf/skills
- Issues: https://github.com/codesurf/skills/issues

### License

MIT © CodeSurf

---

## [Unreleased]

### Planned Features

- [ ] Skill caching between invocations
- [ ] Semantic matching via embedding models
- [ ] Multi-language prompt support
- [ ] Performance optimizations for large skill sets
- [ ] Web-based skill discovery
- [ ] Skill marketplace integration
- [ ] Enhanced context awareness
- [ ] Streaming skill content
- [ ] Skill versioning support
- [ ] CLI for skill management

### Planned Improvements

- [ ] Better ambiguous request handling
- [ ] Reduced latency overhead
- [ ] Improved matching accuracy
- [ ] Enhanced error messages
- [ ] More comprehensive logging
- [ ] Better TypeScript strictness
- [ ] Additional test coverage

---

**Note**: This project replicates Claude Code's skill system as a standalone, LLM-agnostic library. It is not affiliated with or endorsed by Anthropic.
