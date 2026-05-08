<!-- Context: standards/patterns | Priority: high | Version: 2.0 | Updated: 2025-01-21 -->

# Essential Patterns - Core Knowledge Base

## Quick Reference

**Critical Patterns**: Error Handling, Validation, Security, Logging

**ALWAYS**: Handle errors gracefully, validate input, use env vars for secrets

**NEVER**: Expose sensitive info, hardcode credentials, skip input validation

**Language-agnostic**: Apply to all programming languages

---

These are language-agnostic patterns that apply to all programming languages. Language-specific implementations are loaded from context files based on project detection.

## Error Handling Pattern

**ALWAYS** handle errors gracefully:

- Catch specific errors, not generic ones
- Log errors with context
- Return meaningful error messages
- Don't expose internal implementation details
- Use language-specific error handling mechanisms (try/catch, Result, error returns)

## Validation Pattern

**ALWAYS** validate input data:

- Check for null/nil/None values
- Validate data types
- Validate data ranges and constraints
- Sanitize user input
- Return clear validation error messages

## Logging Pattern

**USE** consistent logging levels:

- **Debug**: Detailed information for debugging (development only)
- **Info**: Important events and milestones
- **Warning**: Potential issues that don't stop execution
- **Error**: Failures and exceptions

## Security Pattern

**NEVER** expose sensitive information:

- Don't log passwords, tokens, or API keys
- Don't expose internal error details to users
- Validate and sanitize all user input
- Use environment variables for secrets
- Follow principle of least privilege

## File System Safety Pattern

**ALWAYS** validate file paths:

- Prevent path traversal attacks
- Check file permissions before operations
- Use absolute paths when possible
- Handle file not found errors gracefully
- Close file handles properly

## Configuration Pattern

**ALWAYS** use environment variables for configuration:

- Never hardcode secrets or credentials
- Provide sensible defaults
- Validate required configuration on startup
- Document all configuration options
- Use different configs for dev/staging/production

## Testing Pattern

**ALWAYS** write testable code:

- Use dependency injection
- Keep functions pure when possible
- Write unit tests for business logic
- Write integration tests for external dependencies
- Use test fixtures and mocks appropriately

## Documentation Pattern

**DOCUMENT** complex logic and public APIs:

- Explain the "why", not just the "what"
- Document function parameters and return values
- Include usage examples
- Keep documentation up to date with code
- Use language-specific documentation tools

## Performance Pattern

**AVOID** unnecessary operations:

- Don't repeat expensive calculations
- Cache results when appropriate
- Use efficient data structures
- Profile before optimizing
- Consider time and space complexity

## Code Organization Pattern

**KEEP** code modular and focused:

- Single Responsibility Principle - one function, one purpose
- Don't Repeat Yourself (DRY)
- Separate concerns (business logic, data access, presentation)
- Use meaningful names for functions and variables
- Keep functions small and focused (< 50 lines ideally)

## Dependency Management

**MANAGE** dependencies carefully:

- Pin dependency versions for reproducibility
- Regularly update dependencies for security
- Minimize number of dependencies
- Audit dependencies for security vulnerabilities
- Document why each dependency is needed

## Version Control

**FOLLOW** git best practices:

- Write clear, descriptive commit messages
- Make atomic commits (one logical change per commit)
- Use feature branches for development
- Review code before merging
- Keep main/master branch stable

## Code Review Checklist

**REVIEW** for these common issues:

- Error handling is comprehensive
- Input validation is present
- No hardcoded secrets or credentials
- Tests cover new functionality
- Documentation is updated
- Code follows project conventions
- No obvious security vulnerabilities
- Performance considerations addressed
