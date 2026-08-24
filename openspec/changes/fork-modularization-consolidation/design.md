# Design

## Architecture target
upstream code -> thin integration point -> fork adapter -> fork-owned implementation

## Consolidation approach
Group capabilities:
- ForkCommands registration via single patch
- ForkDistribution via single patch
- Provider discovery via mergeDiscoveredModel patch
- TUI extensions via narrow patches

Avoid scattering Skein code throughout upstream files.

## Verification enhancement
Extend manifest entries with capability and tests fields.

## Hygiene
Remove graphify-out from tracking, add to .gitignore.
