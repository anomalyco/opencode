# H0UND Empty-Credential Runtime Behavior

Decision link: `DECISION_130`

## Operational Symptom

When no credentials are enabled and non-banned, H0UND can enter a poll loop that previously emitted repeated red error logs every cycle.

## Expected Behavior (Post-Fix)

- H0UND remains running in idle mode.
- Operator sees a yellow status notice:
  - `MongoDB connected. No enabled credentials available; starting credential-state investigation path.`
- Operator receives a credential-state snapshot to guide immediate investigation:
  - `total`, `enabled`, `banned`, `enabled+banned`, `actionable`
- Repeated red error spam for this condition is suppressed.

## Verification Anchors

- Build:
  - `dotnet build "H0UND/H0UND.csproj" -c Release`
- Runtime artifact:
  - `C:/Users/paulc/OneDrive/Desktop/build/H0UND/bin/Release/net10.0-windows7.0/P4NTHE0N.exe`
- Runtime log cues:
  - `Loaded 0 credentials`
  - yellow idle guidance above

## Operator Action

Enable at least one non-banned credential in `CR3D3N7IAL` to resume normal polling.

Investigation query anchors:

- `CR3D3N7IAL` records where `Enabled=true` and `Banned=false`
- records that are `Enabled=true` but `Banned=true` (contradictory state)
