# Bug Report Agent Skill

## Purpose
Automatically detects, categorizes, and drafts bug reports for submission to project maintainers. Analyzes error logs, stack traces, and reproduction steps to produce structured, actionable bug reports.

## Capabilities
- Parse stack traces and error messages
- Categorize bugs by severity and component
- Generate reproduction steps from session history
- Draft GitHub/Bugcrowd-compatible bug report templates
- Suggest potential root causes and fixes

## Configuration
```json
{
  "name": "bug-report",
  "category": "utility",
  "priority": "high",
  "enabled": true,
  "triggers": ["error", "exception", "bug", "crash", "fail", "stack trace"],
  "output_formats": ["github-issue", "bugcrowd-report", "markdown", "json"]
}
```

## Usage
```
/oc report-bug --source error.log --platform github --severity high
```

## Contribution Target
- **OpenCode**: Submit as a built-in agent skill
- **Bugcrowd**: Use to draft security bug reports
- **GitHub**: Use to file repository issues
