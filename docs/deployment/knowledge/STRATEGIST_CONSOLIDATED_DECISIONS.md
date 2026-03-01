# STRATEGIST CONSOLIDATED DECISIONS
## H4ND VM Deployment & Operations
### Generated: 2026-02-19
### Total Decisions: 18
### Status: Ready for Delegation

---

## EXECUTIVE SUMMARY

This document consolidates all strategic decisions from filesystem and MongoDB into a single source of truth for delegation to OpenFixer and WindFixer.

**Critical Path Blocker**: OPS_018 (Enable Remote CDP Execution) blocks OPS_017, which blocks OPS_009, which blocks all H4ND operations.

**Immediate Action Required**: Execute OPS_018 or find workaround for remote CDP access.

---

## DECISION REGISTRY

### WAVE 1: CRITICAL - BLOCKING ALL OPERATIONS

| ID | Title | Status | Priority | Assigned | Oracle | Effort | Blocker |
|----|-------|--------|----------|----------|--------|--------|---------|
| OPS_018 | Enable Remote CDP Execution for MCP Server | Pending Implementation | **Critical** | TBD | 98% | 5h | None |
| OPS_017 | Discover Jackpot DOM/JS Selectors | Pending Implementation | **Critical** | TBD | 94% | 4h | OPS_018 |
| OPS_009 | Fix Extension-Free Jackpot Reading | Pending Implementation | **Critical** | WindFixer | 88% | 4h | OPS_017 |
| OPS_005 | End-to-End Spin Verification | Blocked | **Critical** | TBD | 85% | 2h | OPS_009 |

### WAVE 2: HIGH PRIORITY

| ID | Title | Status | Priority | Assigned | Oracle | Effort | Dependencies |
|----|-------|--------|----------|----------|--------|--------|--------------|
| OPS_016 | Disaster Recovery Runbook | Approved - PRIORITY | High | TBD | 91% | 8h | OPS_010 |
| OPS_012 | Configuration-Driven Jackpot Selectors | Approved | High | TBD | 90% | 6h | OPS_009 |
| OPS_010 | Document VM Deployment Architecture | Approved | High | TBD | 95% | 6h | OPS_009 |

### WAVE 3: MEDIUM PRIORITY

| ID | Title | Status | Priority | Assigned | Oracle | Effort | Dependencies |
|----|-------|--------|----------|----------|--------|--------|--------------|
| OPS_013 | VM Health Monitoring Dashboard | Approved | Medium | TBD | 82% | 8h | OPS_010 |
| OPS_014 | Automated VM Deployment Pipeline | Conditionally Approved | Medium | TBD | 75% | 16h | OPS_010 |
| OPS_006 | Failure Recovery Verification | Pending | High | TBD | 90% | 4h | OPS_005 |
| OPS_007 | Temp Script Cleanup and Finalization | Pending | Medium | TBD | 95% | 2h | OPS_005 |

### WAVE 4: LOW PRIORITY

| ID | Title | Status | Priority | Assigned | Oracle | Effort | Dependencies |
|----|-------|--------|----------|----------|--------|--------|--------------|
| OPS_015 | Chrome Session Persistence | Approved | Low | TBD | 78% | 4h | OPS_009 |
| OPS_011 | Ingest VM Deployment to RAG | Approved | Medium | TBD | 92% | 3h | OPS_010 |
| OPS_008 | Production Readiness Assessment | In Progress | Medium | TBD | 98% | 4h | OPS_006, OPS_007 |

---

## CRITICAL PATH DEPENDENCY CHAIN

```
OPS_018 (Enable Remote CDP)
    ↓ [BLOCKS]
OPS_017 (Discover Selectors)
    ↓ [BLOCKS]
OPS_009 (Fix Jackpot Reading)
    ↓ [BLOCKS]
OPS_005 (End-to-End Verification)
    ↓ [ENABLES]
OPS_006, OPS_007 (Testing & Cleanup)
    ↓ [ENABLES]
OPS_008 (Production Readiness)
```

**Total Critical Path Time**: 15 hours (OPS_018 + OPS_017 + OPS_009 + OPS_005)

---

## DELEGATION ASSIGNMENTS

### @openfixer (External Infrastructure & Tools)

**Primary Responsibility**: Infrastructure-level fixes and external tool modifications

**Assigned Decisions**:
1. **OPS_018** - Enable Remote CDP Execution for MCP Server
   - **Scope**: Modify chrome-devtools-mcp server to accept remote host/port
   - **Files**: chrome-devtools-mcp configuration and connection logic
   - **Success Criteria**: Can execute JavaScript on remote Chrome at 192.168.56.1:9222
   - **Estimated Effort**: 5 hours

2. **OPS_014** - Automated VM Deployment Pipeline (Conditional)
   - **Scope**: Create PowerShell DSC or Ansible automation
   - **Condition**: Complete after OPS_010 documentation
   - **Success Criteria**: Single-command deployment in <30 minutes
   - **Estimated Effort**: 16 hours

3. **OPS_016** - Disaster Recovery Runbook
   - **Scope**: Document failure scenarios and recovery procedures
   - **Deliverables**: DR runbook with RTO <1h, RPO <15min
   - **Estimated Effort**: 8 hours

### @windfixer (C# Code Implementation)

**Primary Responsibility**: C# code changes within the P4NTHE0N solution

**Assigned Decisions**:
1. **OPS_017** - Discover Jackpot DOM/JS Selectors
   - **Scope**: Use remote CDP to probe FireKirin and OrionStars pages
   - **Deliverable**: jackpot_selectors.md with validated selectors
   - **Blocked By**: OPS_018 (needs remote CDP working)
   - **Estimated Effort**: 4 hours

2. **OPS_009** - Fix Extension-Free Jackpot Reading
   - **Scope**: Refactor ReadExtensionGrandAsync to use discovered selectors
   - **Files**: H4ND/Infrastructure/CdpGameActions.cs, H4ND/H4ND.cs
   - **Blocked By**: OPS_017 (needs selectors)
   - **Estimated Effort**: 4 hours

3. **OPS_012** - Configuration-Driven Jackpot Selectors
   - **Scope**: Move selectors to appsettings.json with fallback chain
   - **Files**: H4ND/Infrastructure/CdpGameActions.cs, appsettings.json
   - **Blocked By**: OPS_009
   - **Estimated Effort**: 6 hours

4. **OPS_010** - Document VM Deployment Architecture
   - **Scope**: Create /docs/vm-deployment/ documentation
   - **Deliverables**: architecture.md, network-setup.md, chrome-cdp-config.md, troubleshooting.md
   - **Estimated Effort**: 6 hours

5. **OPS_013** - VM Health Monitoring Dashboard
   - **Scope**: Extend SpinHealthEndpoint with VM-specific checks
   - **Files**: H4ND/Infrastructure/SpinHealthEndpoint.cs
   - **Blocked By**: OPS_010
   - **Estimated Effort**: 8 hours

---

## DETAILED DECISION SPECIFICATIONS

### OPS_018: Enable Remote CDP Execution for MCP Server

**Oracle Assessment**: 98% Approved
**Risk**: Medium (modifying core infrastructure)
**Complexity**: Medium-High

**Problem**: chrome-devtools-mcp is hardcoded to local Chrome instance. Cannot connect to remote CDP at 192.168.56.1:9222.

**Solution**: Add optional `host` and `port` parameters to evaluate_script tool.

**Implementation Design**:
```json
// Schema Update
evaluate_script: {
  "inputSchema": {
    "properties": {
      "function": { "type": "string" },
      "args": { "type": "array" },
      "host": { "type": "string", "description": "Remote CDP host" },
      "port": { "type": "integer", "description": "Remote CDP port" }
    },
    "required": ["function"]
  }
}
```

**Connection Logic**:
```javascript
async function getConnection(params) {
  const { host, port } = params;
  if (host && port) {
    // Connect to remote CDP
    const cdpUrl = `http://${host}:${port}`;
    return await connectToRemoteCDP(cdpUrl);
  } else {
    // Existing local Chrome logic
    return await connectToLocalChrome();
  }
}
```

**Validation**:
- Must validate both host and port provided together
- Connection timeout: 5000ms
- Clear error message on connection failure

---

### OPS_017: Discover Jackpot DOM/JS Selectors

**Oracle Assessment**: 94% Approved
**Risk**: Medium (values may be obfuscated or in Canvas)
**Complexity**: Medium

**Problem**: Need to find where FireKirin and OrionStars expose jackpot values without extension.

**Investigation Strategy**:
1. **JavaScript Probing**:
   - `Object.keys(window)` to find global objects
   - Inspect promising candidates: `game`, `j`, `jp`, `g_main`, `Hall`, etc.
   - Serialize objects to find jackpot data paths

2. **DOM Probing** (if JS fails):
   - `document.querySelectorAll('[id*="jackpot"], [class*="jackpot"]')`
   - Look for stable IDs, data attributes, or class names
   - Test textContent extraction

**Deliverable**:
```markdown
### FireKirin
- **Method**: JavaScript Variable
- **Grand**: `window.game.room.jackpot[0]`
- **Major**: `window.game.room.jackpot[1]`
- **Minor**: `window.game.room.jackpot[2]`
- **Mini**: `window.game.room.jackpot[3]`

### OrionStars
- **Method**: DOM Selector
- **Grand**: `document.querySelector('.jackpot-grand .value').textContent`
...
```

**Validation**: Each method tested 5+ times for consistency.

---

### OPS_009: Fix Extension-Free Jackpot Reading

**Oracle Assessment**: 88% Approved
**Risk**: High (core functionality change)
**Complexity**: Medium

**Problem**: `ReadExtensionGrandAsync()` reads `window.parent.Grand` which was injected by RUL3S extension. Without extension, returns 0, causing failure after 42 retries.

**Current Code**:
```csharp
public static async Task<double> ReadExtensionGrandAsync(ICdpClient cdp, CancellationToken ct = default)
{
    double? raw = await cdp.EvaluateAsync<double>("Number(window.parent.Grand) || 0", ct);
    return (raw ?? 0) / 100;
}
```

**Solution**: Create generic `ReadJackpotValueAsync` method.

**New Implementation**:
```csharp
public static async Task<double> ReadJackpotValueAsync(
    ICdpClient cdp, 
    List<string> selectors, 
    CancellationToken ct = default)
{
    if (selectors == null || !selectors.Any())
        return 0;

    foreach (var selectorScript in selectors)
    {
        try
        {
            var rawValue = await cdp.EvaluateAsync<object>(selectorScript, ct);
            if (double.TryParse(rawValue?.ToString(), out double value) && value > 0)
                return value;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[CDP] Selector failed: {selectorScript}. Error: {ex.Message}");
        }
    }
    return 0;
}
```

**Files to Modify**:
- `H4ND/Infrastructure/CdpGameActions.cs` - New method
- `H4ND/H4ND.cs` - Update caller to use new method
- `appsettings.json` - Add selector configuration

**Success Criteria**:
- [ ] H4ND reads Grand jackpot value > 0 on first attempt
- [ ] No "Extension Failure" exceptions thrown
- [ ] Values match actual game jackpot displays
- [ ] Works for both FireKirin and OrionStars platforms

---

### OPS_016: Disaster Recovery Runbook

**Oracle Assessment**: 91% Approved - PRIORITY
**Risk**: Low
**Complexity**: Low-Medium

**Problem**: No documented procedure for recovering from VM failure, host failure, or data corruption.

**Runbook Sections**:
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

**Success Criteria**:
- [ ] Runbook tested: full DR drill completed
- [ ] RTO (Recovery Time Objective): < 1 hour
- [ ] RPO (Recovery Point Objective): < 15 minutes data loss
- [ ] Automated backup verification

---

### OPS_010: Document VM Deployment Architecture

**Oracle Assessment**: 95% Approved
**Risk**: Low
**Complexity**: Low

**Deliverables**:
1. **architecture.md** - System overview, component interactions, network topology
2. **network-setup.md** - Hyper-V switch, static IP, port proxy, firewall rules
3. **chrome-cdp-config.md** - Chrome flags, port proxy, incognito mode
4. **troubleshooting.md** - Common issues, MongoDB directConnection, CDP debugging

**Documentation Structure**:
```
/docs/vm-deployment/
├── README.md
├── architecture.md
├── network-setup.md
├── chrome-cdp-config.md
├── troubleshooting.md
└── diagrams/
    ├── network-topology.png
    └── data-flow.png
```

---

## RESOURCE ESTIMATES

### By Agent

| Agent | Total Hours | Decisions |
|-------|-------------|-----------|
| @openfixer | 29h | OPS_018 (5h), OPS_014 (16h), OPS_016 (8h) |
| @windfixer | 28h | OPS_017 (4h), OPS_009 (4h), OPS_012 (6h), OPS_010 (6h), OPS_013 (8h) |
| **Total** | **57h** | 8 decisions |

### By Priority Wave

| Wave | Hours | Decisions |
|------|-------|-----------|
| Wave 1 (Critical) | 15h | OPS_018, OPS_017, OPS_009, OPS_005 |
| Wave 2 (High) | 20h | OPS_016, OPS_012, OPS_010 |
| Wave 3 (Medium) | 18h | OPS_013, OPS_014, OPS_006, OPS_007 |
| Wave 4 (Low) | 4h | OPS_015 |

---

## SUCCESS METRICS

### Technical Success
- [ ] H4ND successfully reads jackpots without extension (OPS_009)
- [ ] End-to-end spin test passes (OPS_005)
- [ ] DR runbook tested and validated (OPS_016)
- [ ] Documentation complete and ingested to RAG (OPS_010, OPS_011)

### Operational Success
- [ ] VM deployment automated (OPS_014)
- [ ] Health monitoring dashboard operational (OPS_013)
- [ ] Configuration-driven selectors working (OPS_012)
- [ ] Chrome session persistence enabled (OPS_015)

### Business Success
- [ ] RTO < 1 hour for disaster recovery
- [ ] RPO < 15 minutes data loss
- [ ] Full deployment time < 30 minutes
- [ ] Zero manual intervention for standard operations

---

## APPENDIX: SOURCE FILES

### Filesystem Sources
- `OP3NF1XER/knowledge/DECISION_OPS_005-008.md`
- `OP3NF1XER/knowledge/DECISION_OPS_009-011.md`
- `OP3NF1XER/knowledge/DECISION_OPS_012-016.md`
- `OP3NF1XER/knowledge/DECISION_REPORTS_OPS_009-011.md`
- `OP3NF1XER/knowledge/DECISION_REPORTS_OPS_012-016.md`

### MongoDB Sources
- Collection: `P4NTHE0N.DECISIONS`
- Count: 14 documents
- Last Updated: 2026-02-19

### Consolidated By
- **Strategist**: Atlas
- **Oracle**: Orion (assimilated)
- **Designer**: Aegis (assimilated)
- **Date**: 2026-02-19

---

**END OF CONSOLIDATED DECISIONS**
