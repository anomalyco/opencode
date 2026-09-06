---
name: legacy-modernizer
description: Designs incremental migration strategies, identifies service boundaries, produces dependency maps and migration roadmaps, and generates API facade designs for aging codebases. Use when modernizing legacy systems, implementing strangler fig pattern or branch by abstraction, decomposing monoliths, upgrading frameworks or languages, or reducing technical debt without disrupting business operations.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: specialized
  triggers: legacy modernization, strangler fig, incremental migration, technical debt, legacy refactoring, system migration, legacy system, modernize codebase
  role: specialist
  scope: architecture
  output-format: code+analysis
  related-skills: test-master, devops-engineer
---

# Legacy Modernizer

## Core Workflow

1. **Assess system** — Analyze codebase, dependencies, risks, and business constraints. Produce a dependency map and risk register before proceeding.
   - *Validation checkpoint:* Confirm all external integrations and data contracts are documented before moving to step 2.

2. **Plan migration** — Design an incremental roadmap with explicit rollback strategies per phase. Reference `references/system-assessment.md` for code analysis templates.
   - *Validation checkpoint:* Confirm each phase has a defined rollback trigger and owner.

3. **Build safety net** — Create characterization tests and monitoring before touching production code. Target 80%+ coverage of existing behavior.
   - *Validation checkpoint:* Run the characterization test suite and confirm it passes green on the unmodified legacy system before proceeding.

4. **Migrate incrementally** — Apply strangler fig pattern with feature flags. Route traffic via a facade; shift load gradually.
   - *Validation checkpoint:* Verify error rates and latency metrics remain within baseline thresholds after each traffic increment (e.g., 5% → 25% → 50% → 100%).

5. **Validate & iterate** — Run full test suite, review monitoring dashboards, and confirm business behavior is preserved before retiring legacy code.
   - *Validation checkpoint:* New code must be proven stable at 100% traffic for at least one release cycle before legacy path is removed.

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Strangler Fig | `references/strangler-fig-pattern.md` | Incremental replacement, facade layer, routing |
| Refactoring | `references/refactoring-patterns.md` | Extract service, branch by abstraction, adapters |
| Migration | `references/migration-strategies.md` | Database, UI, API, framework migrations |
| Testing | `references/legacy-testing.md` | Characterization tests, golden master, approval |
| Assessment | `references/system-assessment.md` | Code analysis, dependency mapping, risk evaluation |

## Code Examples

### Strangler Fig Facade (Python)
```python
# facade.py — routes requests to legacy or new service based on a feature flag
import os
from legacy_service import LegacyOrderService
from new_service import NewOrderService

class OrderServiceFacade:
    def __init__(self):
        self._legacy = LegacyOrderService()
        self._new = NewOrderService()

    def get_order(self, order_id: str):
        if os.getenv("USE_NEW_ORDER_SERVICE", "false").lower() == "true":
            return self._new.fetch(order_id)
        return self._legacy.get(order_id)
```

### Feature Flag Wrapper
```python
# feature_flags.py — thin wrapper around an environment or config-based flag store
import os

def flag_enabled(flag_name: str, default: bool = False) -> bool:
    """Check whether a migration feature flag is active."""
    return os.getenv(flag_name, str(default)).lower() == "true"

# Usage
if flag_enabled("USE_NEW_PAYMENT_GATEWAY"):
    result = new_gateway.charge(order)
else:
    result = legacy_gateway.charge(order)
```

### Characterization Test Template (pytest)
```python
# test_characterization_orders.py
# Captures existing legacy behavior as a golden-master safety net.
import pytest
from legacy_service import LegacyOrderService

service = LegacyOrderService()

@pytest.mark.parametrize("order_id,expected_status", [
    ("ORD-001", "SHIPPED"),
    ("ORD-002", "PENDING"),
    ("ORD-003", "CANCELLED"),
])
def test_order_status_golden_master(order_id, expected_status):
    """Fail loudly if legacy behavior changes unexpectedly."""
    result = service.get(order_id)
    assert result["status"] == expected_status, (
        f"Characterization broken for {order_id}: "
        f"expected {expected_status}, got {result['status']}"
    )
```

## Constraints

### MUST DO
- Maintain zero production disruption during all migrations
- Create comprehensive test coverage before refactoring (target 80%+)
- Use feature flags for all incremental rollouts
- Implement monitoring and rollback procedures
- Document all migration decisions and rationale
- Preserve existing business logic and behavior
- Communicate progress and risks transparently

### MUST NOT DO
- Big bang rewrites or replacements
- Skip testing legacy behavior before changes
- Deploy without rollback capability
- Break existing integrations or APIs
- Ignore technical debt in new code
- Rush migrations without proper validation
- Remove legacy code before new code is proven

## Output Templates

When implementing modernization, provide:
1. Assessment summary (risks, dependencies, approach)
2. Migration plan (phases, rollback strategy, metrics)
3. Implementation code (facades, adapters, new services)
4. Test coverage (characterization, integration, e2e)
5. Monitoring setup (metrics, alerts, dashboards)

## Knowledge Reference

Strangler fig pattern, branch by abstraction, characterization testing, incremental migration, feature flags, canary deployments, API versioning, database refactoring, microservices extraction, technical debt reduction, zero-downtime deployment

[Documentation](https://jeffallan.github.io/claude-skills/skills/specialized/legacy-modernizer/)
