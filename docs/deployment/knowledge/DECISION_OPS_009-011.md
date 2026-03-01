# DECISION_OPS_009-011: VM Deployment Path Forward

## DECISION_OPS_009: Fix Extension-Free Jackpot Reading

**Status**: Approved  
**Priority**: Critical  
**Dependencies**: OPS_005  
**Assigned To**: @windfixer

### Problem Statement
H4ND's `ReadExtensionGrandAsync()` reads `window.parent.Grand` which was injected by the RUL3S extension. Chrome runs on host in incognito mode without the extension, causing all reads to return 0. After 42 retries, H4ND throws "Extension Failure" exception and restarts.

### Current Code (Broken)
```csharp
// H4ND/Infrastructure/CdpGameActions.cs line 315-319
public static async Task<double> ReadExtensionGrandAsync(ICdpClient cdp, CancellationToken ct = default)
{
    double? raw = await cdp.EvaluateAsync<double>("Number(window.parent.Grand) || 0", ct);
    return (raw ?? 0) / 100;
}
```

### Solution
Replace with direct page JavaScript evaluation that reads jackpot values from the game's own variables or DOM elements.

### Implementation Tasks
1. **Research**: Identify where FireKirin/OrionStars expose jackpot values in their JavaScript or DOM
2. **Modify**: Update `ReadExtensionGrandAsync` to read directly from page
3. **Test**: Verify jackpot values are read correctly without extension
4. **Fallback**: Handle cases where values aren't immediately available

### Files to Modify
- `H4ND/Infrastructure/CdpGameActions.cs` - Update ReadExtensionGrandAsync

### Success Criteria
- [ ] H4ND reads Grand jackpot value > 0 on first attempt
- [ ] No "Extension Failure" exceptions thrown
- [ ] Values match actual game jackpot displays
- [ ] Works for both FireKirin and OrionStars platforms

---

## DECISION_OPS_010: Document VM Deployment Architecture

**Status**: Approved  
**Priority**: High  
**Dependencies**: OPS_009  
**Assigned To**: @windfixer

### Objective
Create comprehensive documentation in `/docs/vm-deployment/` covering the complete H4ND VM deployment architecture.

### Deliverables

#### 1. architecture.md
- System overview diagram
- Component interactions (H4ND VM, Host Chrome, MongoDB)
- Network topology (H4ND-Switch 192.168.56.0/24)
- Data flow for jackpot operations

#### 2. network-setup.md
- Hyper-V switch configuration
- Static IP assignment (VM: 192.168.56.10)
- Port proxy configuration for CDP
- Firewall rules

#### 3. chrome-cdp-config.md
- Chrome startup flags for remote debugging
- Port proxy setup (192.168.56.1:9222 → 127.0.0.1:9222)
- Incognito mode considerations
- Extension-free operation

#### 4. troubleshooting.md
- Common issues and solutions
- MongoDB directConnection requirement
- CDP connection debugging
- Extension failure resolution

### Documentation Structure
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

## DECISION_OPS_011: Ingest VM Deployment to RAG

**Status**: Approved  
**Priority**: Medium  
**Dependencies**: OPS_010  
**Assigned To**: @windfixer

### Objective
Ingest all VM deployment knowledge into RAG system for future searchability.

### Documents to Ingest
1. `OP3NF1XER/deployments/H4NDv2-VM-DEPLOYMENT.md`
2. `OP3NF1XER/deployments/JOURNAL_2026-02-19_THE_LONG_NIGHT.md`
3. `OP3NF1XER/deployments/SYNTHESIS_2026-02-19.txt`
4. `OP3NF1XER/knowledge/DECISION_OPS_005-008.md`
5. `docs/vm-deployment/*.md` (from OPS_010)

### RAG Tags
- vm-deployment
- h4nd
- chrome-cdp
- mongodb
- hyper-v
- troubleshooting
- extension-free

### Success Criteria
- [ ] All documents ingested successfully
- [ ] Searchable by relevant keywords
- [ ] Cross-references between decisions and docs

---

## Execution Order

1. **OPS_009** → Fix jackpot reading (Critical blocker)
2. **OPS_010** → Create documentation
3. **OPS_011** → Ingest to RAG

## Notes for WindFixer

- Chrome on host runs at `192.168.56.1:9222` via port proxy
- MongoDB on host requires `?directConnection=true`
- H4ND VM at `192.168.56.10` connects to both
- No extension loaded - must read jackpots from page directly
- FireKirin page: `http://play.firekirin.in/web_mobile/firekirin/`
- OrionStars page: `http://web.orionstars.org/hot_play/orionstars/`

