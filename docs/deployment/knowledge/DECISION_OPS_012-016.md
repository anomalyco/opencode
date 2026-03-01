# DECISION_OPS_012-016: Strategic Path Forward

## DECISION_OPS_012: Implement Configuration-Driven Jackpot Selectors

**Status**: Proposed  
**Priority**: High  
**Dependencies**: OPS_009  
**Assigned To**: TBD

### Problem Statement
Hardcoded JavaScript selectors and DOM queries in `CdpGameActions.ReadExtensionGrandAsync()` will become brittle when game platforms update their UI or obfuscate their code.

### Solution
Move jackpot reading configuration to external configuration (appsettings.json or CRED3N7IAL.Settings) so selectors can be updated without code deployment.

### Implementation
```json
// appsettings.json
{
  "P4NTHE0N:H4ND:JackpotSelectors": {
    "FireKirin": {
      "Grand": ["window.jackpot?.grand", "document.querySelector('.grand-value')?.textContent"],
      "Major": ["window.jackpot?.major", "document.querySelector('.major-value')?.textContent"]
    },
    "OrionStars": {
      "Grand": ["window.gameState?.jackpots?.grand", "document.querySelector('[data-jackpot=grand]')?.innerText"]
    }
  }
}
```

### Success Criteria
- [ ] Selectors loaded from configuration at runtime
- [ ] Fallback chain: try config selectors → hardcoded defaults
- [ ] Hot-reload capability (restart H4ND not required)
- [ ] Validation: log error if no selector works

---

## DECISION_OPS_013: Create VM Health Monitoring Dashboard

**Status**: Proposed  
**Priority**: Medium  
**Dependencies**: OPS_010  
**Assigned To**: TBD

### Problem Statement
No centralized visibility into VM deployment health. Failures in CDP connection, MongoDB, or Chrome require manual log inspection.

### Solution
Extend existing SpinHealthEndpoint (port 9280) with VM-specific health checks:

### Health Check Endpoints
```
GET /health/vm          → VM status, CPU, memory
GET /health/cdp         → CDP connection, Chrome process
GET /health/mongodb     → MongoDB connectivity, latency
GET /health/network     → Port proxy status, VM→Host connectivity
GET /health/full        → All checks combined
```

### Implementation
- PowerShell script for VM metrics (CPU, memory, disk)
- CdpHealthCheck integration for CDP status
- MongoDB ping for database health
- netsh query for port proxy validation

### Success Criteria
- [ ] All endpoints return JSON with status, latency, details
- [ ] Failed checks include troubleshooting hints
- [ ] Dashboard UI (Spectre.Console) shows real-time status
- [ ] Alerts on critical failure (ERR0R collection logging)

---

## DECISION_OPS_014: Establish Automated VM Deployment Pipeline

**Status**: Proposed  
**Priority**: Medium  
**Dependencies**: OPS_010  
**Assigned To**: TBD

### Problem Statement
VM deployment required 43+ manual PowerShell scripts and extensive troubleshooting. Future deployments or disaster recovery would be time-consuming and error-prone.

### Solution
Create automated deployment pipeline using PowerShell DSC (Desired State Configuration) or Ansible:

### Pipeline Stages
1. **VM Provisioning**: Create Hyper-V VM from template
2. **OS Configuration**: Windows 11 setup, static IP (192.168.56.10)
3. **Network Setup**: H4ND-Switch, NAT, firewall rules
4. **Software Install**: .NET 10 Preview 1, Chrome (on host)
5. **H4ND Deploy**: Copy publish output, configure appsettings.json
6. **Service Setup**: Create Windows Service for H4ND auto-start
7. **Health Verify**: Run validation tests before marking complete

### Success Criteria
- [ ] Single command deployment: `Deploy-H4NDVM -HostIP 192.168.56.1`
- [ ] Idempotent: can re-run without breaking existing setup
- [ ] Rollback: automatic rollback on failure
- [ ] Tested: full deployment in < 30 minutes

---

## DECISION_OPS_015: Implement Chrome Session Persistence

**Status**: Proposed  
**Priority**: Low  
**Dependencies**: OPS_009  
**Assigned To**: TBD

### Problem Statement
Chrome running in incognito mode loses all state on restart. Login sessions, cached data, and cookies must be re-established on every H4ND restart, increasing latency and failure rate.

### Solution
Option A: Run Chrome in normal mode with user data directory  
Option B: Use Chrome's session restore APIs via CDP  
Option C: Implement credential caching in H4ND to reduce login frequency

### Recommended: Option A
```bash
chrome.exe --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir="C:\ChromeH4ND"
```

### Success Criteria
- [ ] Chrome persists cookies and localStorage across restarts
- [ ] Login sessions survive Chrome/H4ND restart
- [ ] Security: user data directory isolated from main Chrome profile
- [ ] Fallback: can still run incognito if needed

---

## DECISION_OPS_016: Create Disaster Recovery Runbook

**Status**: Proposed  
**Priority**: High  
**Dependencies**: OPS_010, OPS_014  
**Assigned To**: TBD

### Problem Statement
No documented procedure for recovering from VM failure, host failure, or data corruption. Recovery would require reverse-engineering the deployment from scattered notes.

### Solution
Create comprehensive DR runbook with:

### Runbook Sections
1. **Failure Scenarios**
   - VM crash or corruption
   - Host machine failure
   - MongoDB data corruption
   - Network connectivity loss
   - Chrome/CDP failure

2. **Recovery Procedures**
   - VM restore from checkpoint
   - Full redeployment (link to OPS_014)
   - MongoDB restore from backup
   - Manual failover to backup host

3. **Backup Strategy**
   - VM checkpoints: daily
   - MongoDB dumps: hourly
   - H4ND config: version controlled
   - Host configuration: documented

4. **Emergency Contacts**
   - Infrastructure owner
   - Database administrator
   - Network administrator

### Success Criteria
- [ ] Runbook tested: full DR drill completed
- [ ] RTO (Recovery Time Objective): < 1 hour
- [ ] RPO (Recovery Point Objective): < 15 minutes data loss
- [ ] Automated backup verification

---

## Decision Dependency Graph

```
OPS_009 (Fix Jackpot Reading)
    ↓
    ├── OPS_012 (Config-Driven Selectors) - Enhancement
    └── OPS_015 (Chrome Persistence) - Optimization

OPS_010 (Documentation)
    ↓
    ├── OPS_013 (Health Dashboard) - Monitoring
    ├── OPS_014 (Auto Deployment) - Automation
    └── OPS_016 (DR Runbook) - Reliability
        ↓
        OPS_011 (RAG Ingestion)
```

## Execution Priority

**Wave 1 (Critical)**:
1. OPS_009 - Unblocks all H4ND operations

**Wave 2 (High)**:
2. OPS_012 - Makes OPS_009 maintainable
3. OPS_016 - Business continuity requirement

**Wave 3 (Medium)**:
4. OPS_013 - Operational visibility
5. OPS_014 - Deployment efficiency

**Wave 4 (Low)**:
6. OPS_015 - Performance optimization

## Resource Estimates

| Decision | Effort | Risk | Business Value |
|----------|--------|------|----------------|
| OPS_009 | 4h | High | Critical |
| OPS_012 | 6h | Medium | High |
| OPS_013 | 8h | Low | Medium |
| OPS_014 | 16h | Medium | Medium |
| OPS_015 | 4h | Low | Low |
| OPS_016 | 8h | Low | High |

**Total Estimated Effort**: 46 hours

