# WINDFIXER DELEGATION: ALL OPERATIONS
## Complete H4ND VM Deployment & Operations
### Generated: 2026-02-19
### Total Decisions: 18
### Total Effort: 57 hours

---

## EXECUTIVE SUMMARY

**Agent**: @windfixer  
**Scope**: All decisions from infrastructure to code implementation  
**Critical Path**: OPS_018 → OPS_017 → OPS_009 → OPS_005  
**Status**: Ready for execution  

**Note**: This is a comprehensive delegation. All decisions previously split between OpenFixer and WindFixer are now consolidated under WindFixer.

---

## CRITICAL PATH (Execute First)

### OPS_018: Enable Remote CDP Execution for MCP Server
**Priority**: CRITICAL  
**Effort**: 5 hours  
**Type**: Infrastructure/Tool Modification  

**Problem**: chrome-devtools-mcp server cannot connect to remote CDP at 192.168.56.1:9222

**Solution**: Modify MCP server to accept optional `host` and `port` parameters

**Implementation**:
```javascript
// Update tool schema
evaluate_script: {
  inputSchema: {
    properties: {
      function: { type: "string" },
      args: { type: "array" },
      host: { type: "string" },  // NEW
      port: { type: "integer" }  // NEW
    }
  }
}

// Modify connection logic
async function getConnection(params) {
  if (params.host && params.port) {
    // Connect to remote CDP
    const cdpUrl = `http://${params.host}:${params.port}`;
    return await connectToRemoteCDP(cdpUrl);
  } else {
    // Existing local logic
    return await connectToLocalChrome();
  }
}
```

**Success Criteria**: Can execute `() => document.title` on remote Chrome and get correct result

---

### OPS_017: Discover Jackpot DOM/JS Selectors
**Priority**: CRITICAL  
**Effort**: 4 hours  
**Type**: Investigation  
**Blocked By**: OPS_018  

**Objective**: Find where FireKirin and OrionStars expose jackpot values

**Investigation Steps**:
1. Use remote CDP to probe `window` object
2. Test candidate variables: `window.game`, `window.jackpot`, `window.Hall`, etc.
3. If JS fails, inspect DOM for jackpot display elements
4. Document reliable selectors for all 4 tiers

**Deliverable**: `jackpot_selectors.md` with validated selectors

---

### OPS_009: Fix Extension-Free Jackpot Reading
**Priority**: CRITICAL  
**Effort**: 4 hours  
**Type**: C# Code  
**Blocked By**: OPS_017  

**Current Code**:
```csharp
public static async Task<double> ReadExtensionGrandAsync(ICdpClient cdp, ...)
{
    double? raw = await cdp.EvaluateAsync<double>(
        "Number(window.parent.Grand) || 0", ct);
    return (raw ?? 0) / 100;
}
```

**New Implementation**:
```csharp
public static async Task<double> ReadJackpotValueAsync(
    ICdpClient cdp, List<string> selectors, ...)
{
    foreach (var selector in selectors)
    {
        try {
            var value = await cdp.EvaluateAsync<double>(selector, ct);
            if (value > 0) return value;
        } catch { /* try next */ }
    }
    return 0;
}
```

**Files**: `H4ND/Infrastructure/CdpGameActions.cs`, `H4ND/H4ND.cs`

---

### OPS_005: End-to-End Spin Verification
**Priority**: CRITICAL  
**Effort**: 2 hours  
**Type**: Testing  
**Blocked By**: OPS_009  

**Test Flow**:
1. Signal received from SIGN4L
2. CDP connection established
3. Login successful
4. Spin executed
5. Jackpot values read
6. Results written to MongoDB

**Success**: Complete spin cycle without "Extension Failure"

---

## HIGH PRIORITY (Wave 2)

### OPS_016: Disaster Recovery Runbook
**Priority**: HIGH (PRIORITY)  
**Effort**: 8 hours  
**Type**: Documentation/Automation  

**Deliverables**:
- `docs/runbooks/DISASTER-RECOVERY.md`
- Backup scripts (VM checkpoints, MongoDB dumps)
- DR validation scripts
- Quarterly drill schedule

**Targets**:
- RTO: < 1 hour
- RPO: < 15 minutes

---

### OPS_012: Configuration-Driven Jackpot Selectors
**Priority**: HIGH  
**Effort**: 6 hours  
**Type**: C# Code/Configuration  
**Blocked By**: OPS_009  

**Implementation**:
```json
// appsettings.json
{
  "P4NTHE0N:H4ND:JackpotSelectors": {
    "FireKirin": {
      "Grand": ["window.jackpot?.grand", "document.querySelector('.grand')?.textContent"],
      "Major": ["window.jackpot?.major", "document.querySelector('.major')?.textContent"]
    }
  }
}
```

**Benefit**: Selectors can be updated without code deployment

---

### OPS_010: Document VM Deployment Architecture
**Priority**: HIGH  
**Effort**: 6 hours  
**Type**: Documentation  

**Deliverables**:
- `/docs/vm-deployment/architecture.md`
- `/docs/vm-deployment/network-setup.md`
- `/docs/vm-deployment/chrome-cdp-config.md`
- `/docs/vm-deployment/troubleshooting.md`

---

## MEDIUM PRIORITY (Wave 3)

### OPS_013: VM Health Monitoring Dashboard
**Priority**: MEDIUM  
**Effort**: 8 hours  
**Type**: C# Code  
**Blocked By**: OPS_010  

**Endpoints**:
- `GET /health/vm` - VM status, CPU, memory
- `GET /health/cdp` - CDP connection status
- `GET /health/mongodb` - Database connectivity
- `GET /health/network` - Port proxy status
- `GET /health/full` - All checks combined

---

### OPS_014: Automated VM Deployment Pipeline
**Priority**: MEDIUM (Conditional)  
**Effort**: 16 hours  
**Type**: PowerShell Automation  
**Condition**: Complete OPS_010 first  

**Pipeline**: `Deploy-H4NDVM.ps1 -HostIP 192.168.56.1`

**Stages**:
1. VM Provisioning
2. OS Configuration
3. Network Setup
4. Software Install
5. H4ND Deploy
6. Service Setup
7. Health Verify

**Success**: Full deployment in < 30 minutes

---

### OPS_006: Failure Recovery Verification
**Priority**: HIGH  
**Effort**: 4 hours  
**Type**: Testing  
**Blocked By**: OPS_005  

**Test Scenarios**:
- CDP connection drop
- MongoDB disconnection
- Invalid credentials
- Platform timeout
- Chrome crash

---

### OPS_007: Temp Script Cleanup
**Priority**: MEDIUM  
**Effort**: 2 hours  
**Type**: Maintenance  
**Blocked By**: OPS_005  

**Tasks**:
- Review 43 temp scripts in `c:\P4NTHE0N\temp_*.ps1`
- Archive useful patterns
- Delete obsolete scripts
- Verify H4ND auto-start

---

## LOW PRIORITY (Wave 4)

### OPS_015: Chrome Session Persistence
**Priority**: LOW  
**Effort**: 4 hours  
**Type**: Configuration  
**Blocked By**: OPS_009  

**Change**: Run Chrome with `--user-data-dir="C:\ChromeH4ND"` instead of `--incognito`

**Benefit**: Persist login sessions across restarts

---

### OPS_011: Ingest VM Deployment to RAG
**Priority**: MEDIUM  
**Effort**: 3 hours  
**Type**: Knowledge Management  
**Blocked By**: OPS_010  

**Documents to Ingest**:
- All deployment documentation
- Decision records
- Troubleshooting guides

---

### OPS_008: Production Readiness Assessment
**Priority**: MEDIUM  
**Effort**: 4 hours  
**Type**: Documentation  
**Blocked By**: OPS_006, OPS_007  

**Deliverables**:
- Production readiness report
- Operations runbook
- Monitoring specification
- DR procedures

---

## EXECUTION ORDER

```
Wave 1 (Critical - 15 hours):
  OPS_018 (5h) → OPS_017 (4h) → OPS_009 (4h) → OPS_005 (2h)

Wave 2 (High - 20 hours):
  OPS_016 (8h), OPS_012 (6h), OPS_010 (6h)

Wave 3 (Medium - 18 hours):
  OPS_013 (8h), OPS_014 (16h) [parallel], OPS_006 (4h), OPS_007 (2h)

Wave 4 (Low - 4 hours):
  OPS_015 (4h), OPS_011 (3h), OPS_008 (4h)
```

**Total Sequential Time**: ~57 hours  
**Parallel Execution**: ~30 hours  

---

## KEY TECHNICAL DETAILS

### Network Configuration
- **VM**: 192.168.56.10 (H4NDv2-Production)
- **Host**: 192.168.56.1 (Chrome CDP + MongoDB)
- **Switch**: H4ND-Switch (192.168.56.0/24)
- **Port Proxy**: 192.168.56.1:9222 → 127.0.0.1:9222

### MongoDB Connection
```
mongodb://192.168.56.1:27017/?directConnection=true
```

### Chrome Startup
```bash
chrome.exe --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --incognito
```

### Game URLs
- FireKirin: `http://play.firekirin.in/web_mobile/firekirin/`
- OrionStars: `http://web.orionstars.org/hot_play/orionstars/`

---

## SUCCESS METRICS

### Technical
- [ ] Can execute JavaScript on remote Chrome (OPS_018)
- [ ] Jackpot selectors discovered and validated (OPS_017)
- [ ] H4ND reads jackpots without extension (OPS_009)
- [ ] End-to-end spin test passes (OPS_005)

### Operational
- [ ] DR runbook tested (OPS_016)
- [ ] Deployment automated (OPS_014)
- [ ] Health monitoring operational (OPS_013)
- [ ] Documentation complete (OPS_010)

### Business
- [ ] RTO < 1 hour
- [ ] RPO < 15 minutes
- [ ] Deployment time < 30 minutes

---

## REPORTING

**Daily Updates Required**:
1. Decisions completed
2. Decisions in progress
3. Blockers encountered
4. Time spent vs. estimated

**Escalation Triggers**:
- Any decision exceeds 150% of estimated effort
- New blockers discovered
- Technical approach proves infeasible

---

**END OF WINDFIXER DELEGATION**
