# GitLab Integration Setup

## Configuration

Set environment variables:

```bash
export OPENSACIA_VCS_PROVIDER=gitlab
export OPENSACIA_GITLAB_BASE_URL=https://hera.tics.inta/api/v4
export OPENSACIA_GITLAB_TOKEN=glpat-xxxxxxxxxxxx
export OPENSACIA_GITLAB_PROJECT_ID=61
```

Or add to `~/.config/opensacia/config.json`:

```json
{
  "vcs": {
    "provider": "gitlab",
    "gitlab": {
      "baseUrl": "https://hera.tics.inta/api/v4",
      "token": "glpat-xxxxxxxxxxxx",
      "defaultProjectId": 61
    }
  }
}
```

## CLI Commands

- `opensacia gitlab status` - Check GitLab connection
- `opensacia gitlab test` - Test API connection
- `opensacia gitlab config` - Show configuration
- `opensacia pr --project 61 --id 1` - Checkout MR

## Webhooks

Configure webhooks in GitLab project settings:

URL: `https://your-server/hooks/gitlab/61`
Secret: Set webhook token in GitLab
Events: Merge Request events, Comments

## Testing

```bash
# Unit tests
bun test --cwd packages/opencode test/vcs/

# Integration tests (requires GitLab access)
OPENSACIA_GITLAB_TOKEN=your-token bun test --cwd packages/opencode test/vcs/integration.test.ts
```
