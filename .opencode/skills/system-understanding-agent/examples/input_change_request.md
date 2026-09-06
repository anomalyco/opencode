# Example Input: Change Request

See `integrations/understand-anything/examples/existing_repo_change_request.md` for a full
example of the change request that feeds into this skill.

## Minimal example

```text
Change request: Add rate limiting to the login endpoint.
Repository: my-org/auth-service
Risk level: L3
```

## What the agent uses from this

1. The description of the change — to identify which parts of the system graph are relevant.
2. The risk level — to determine confidence requirements and gate behavior.
3. Any constraints mentioned — to flag in the system overview.
