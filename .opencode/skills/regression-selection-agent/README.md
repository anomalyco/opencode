# regression-selection-agent

Part of the **Agile V + Understand Anything** integration.

This skill runs after `impact-analysis-agent` and produces a prioritized list of regression
tests to run after the build. It identifies gaps in existing test coverage and flags them
for the Test Designer.

## Key outputs

| File | Purpose |
|---|---|
| `required_regression_tests.md` | Prioritized list of tests to run |
| `selected_tests.json` | Machine-readable test selection |
| `regression_coverage_rationale.md` | Why each test was selected |
| `missing_regression_tests.md` | Coverage gaps and suggested tests |

## See also

- `SKILL.md` — full skill specification
- `metadata.json` — machine-readable skill metadata
- `../../integrations/understand-anything/examples/regression_selection_example.md` — full example
