# Proposed Decisions for Oracle Review

**Created**: 2026-02-19
**Agent**: Vigil (OpenFixer)
**Context**: H4NDv2 VM Deployment — MongoDB connectivity blocker identified

---

## DECISION_OPS_004: Fix MongoDB Environment Variable for VM Connection

| Field | Value |
|-------|-------|
| **ID** | DECISION_OPS_004 |
| **Title** | Fix MongoDB Environment Variable for VM Connection |
| **Category** | Infrastructure |
| **Priority** | **Critical** |
| **Status** | Proposed |
| **Source** | H4NDv2 VM Deployment Journal |

### Problem Statement

The H4ND agent in the H4NDv2-Production VM is failing to connect to MongoDB because the Machine-level environment variable `P4NTHE0N_MONGODB_URI` is set to `mongodb://192.168.56.1:27017/` **WITHOUT** the `?directConnection=true` query parameter.

This causes the MongoDB driver to perform replica set discovery, which fails because:
1. MongoDB is configured with `replSetName: rs0`
2. The member advertises itself as `localhost:27017`
3. The VM has no MongoDB instance running locally
4. Driver tries to connect to VM's localhost:27017 → connection refused

The `mongodb.uri` file in `C:\H4ND\` contains the correct URI with `?directConnection=true`, but `MongoConnectionOptions.FromEnvironment()` checks the env var **first**, so the file override never executes.

### Proposed Implementation

1. Update Machine-level env var `P4NTHE0N_MONGODB_URI` to `mongodb://192.168.56.1:27017/?directConnection=true`
2. Restart H4ND process in VM
3. Verify MongoDB connection in H4ND logs
4. Confirm signal processing loop starts successfully

### Verification Criteria

- [ ] H4ND log shows `[MongoConnectionOptions] Using: mongodb://192.168.56.1:27017/?directConnection=true`
- [ ] No more `localhost:27017` connection errors
- [ ] H4ND enters main signal processing loop
- [ ] Signals are fetched from SIGN4L collection

---

## DECISION_OPS_005: Execute OPS-JP-002: End-to-End Spin Verification

| Field | Value |
|-------|-------|
| **ID** | DECISION_OPS_005 |
| **Title** | Execute OPS-JP-002: End-to-End Spin Verification |
| **Category** | Verification |
| **Priority** | **High** |
| **Status** | Proposed |
| **Dependencies** | DECISION_OPS_004 |

### Description

Once MongoDB connectivity is restored (DECISION_OPS_004), execute the end-to-end spin verification test (OPS-JP-002). This validates the full pipeline from signal generation to spin execution.

Test signal already injected into SIGN4L collection. H4ND should pick up the signal, execute the CDP-based spin, and update the signal status.

### Implementation Steps

1. Verify H4ND is processing signals from SIGN4L collection
2. Monitor H4ND logs for signal pickup and CDP execution
3. Verify spin execution metrics are recorded
4. Confirm signal is marked as acknowledged/processed

### Verification Criteria

- [ ] H4ND log shows signal pickup from SIGN4L
- [ ] CDP navigation and spin execution logged
- [ ] Signal status updated in MongoDB
- [ ] Spin metrics recorded (success/failure, latency)

---

## DECISION_OPS_006: Execute OPS-JP-003: Failure Recovery Verification

| Field | Value |
|-------|-------|
| **ID** | DECISION_OPS_006 |
| **Title** | Execute OPS-JP-003: Failure Recovery Verification |
| **Category** | Verification |
| **Priority** | **High** |
| **Status** | Proposed |
| **Dependencies** | DECISION_OPS_004 |

### Description

Execute the failure recovery verification test (OPS-JP-003) to validate Circuit Breaker and Dead Letter Queue functionality.

**Circuit Breaker**: Threshold=5 failures, recovery=2 minutes. All 4 unit tests pass.

**DLQ Discrepancy**: Task references `V1S10N_DLQ` collection but H4ND pipeline logs rejections to console only; H0UND uses `D34DL3TT3R` collection. Need to verify actual DLQ behavior and document any gaps.

### Implementation Steps

1. Test Circuit Breaker trip after 5 consecutive failures
2. Verify 2-minute recovery window
3. Test DLQ write on signal processing failure
4. Verify DLQ collection contains rejected signals

### Verification Criteria

- [ ] Circuit Breaker enters Open state after threshold
- [ ] Recovery timer starts and transitions to HalfOpen
- [ ] DLQ collection has entries for failed signals
- [ ] H4ND resumes processing after recovery

---

## DECISION_OPS_007: Cleanup: Remove Temp Scripts and Review Config

| Field | Value |
|-------|-------|
| **ID** | DECISION_OPS_007 |
| **Title** | Cleanup: Remove Temp Scripts and Review Config |
| **Category** | Maintenance |
| **Priority** | **Low** |
| **Status** | Proposed |
| **Dependencies** | DECISION_OPS_004, DECISION_OPS_005, DECISION_OPS_006 |

### Description

Clean up the 43 temporary PowerShell scripts created during iterative debugging of the H4NDv2 VM deployment. Also review whether `MongoConnectionOptions.cs` file-based override should be reverted if the environment variable approach becomes permanent.

### Implementation Steps

1. List all `temp_*.ps1` files in `c:\P4NTHE0N\`
2. Review each for valuable diagnostic patterns worth preserving
3. Delete non-essential temp scripts
4. Review `MongoConnectionOptions.cs` — consider if file-based override is still needed
5. Document final configuration approach (env var vs file)

### Verification Criteria

- [ ] All 43 temp scripts reviewed
- [ ] Non-essential scripts deleted
- [ ] Valuable patterns documented in knowledge base
- [ ] Configuration approach documented

---

## DECISION_OPS_008: Resolve DLQ Collection Discrepancy and Implement Writes

| Field | Value |
|-------|-------|
| **ID** | DECISION_OPS_008 |
| **Title** | Resolve DLQ Collection Discrepancy and Implement Writes |
| **Category** | Bug Fix |
| **Priority** | **Medium** |
| **Status** | Proposed |

### Problem Statement

There is a discrepancy between the task specification and actual implementation regarding the Dead Letter Queue (DLQ):

| Source | Collection Name |
|--------|-----------------|
| Task specification | `V1S10N_DLQ` |
| H0UND implementation | `D34DL3TT3R` |
| H4ND current behavior | Logs rejections to console only, no DLQ writes |

### Proposed Resolution

1. Determine canonical DLQ collection name with stakeholders
2. Add DLQ write logic to H4ND signal processing pipeline
3. Create DLQ entity/schema if not exists
4. Update unit tests to verify DLQ writes

### Verification Criteria

- [ ] DLQ collection name documented and consistent
- [ ] H4ND writes failed signals to DLQ
- [ ] DLQ entries contain signal ID, failure reason, timestamp
- [ ] Unit tests pass for DLQ functionality

---

## Summary

| Decision | Priority | Status | Blocked By |
|----------|----------|--------|------------|
| DECISION_OPS_004 | **Critical** | Proposed | — |
| DECISION_OPS_005 | **High** | Proposed | DECISION_OPS_004 |
| DECISION_OPS_006 | **High** | Proposed | DECISION_OPS_004 |
| DECISION_OPS_007 | **Low** | Proposed | DECISION_OPS_004, 005, 006 |
| DECISION_OPS_008 | **Medium** | Proposed | — |

**Immediate Action Required**: Execute DECISION_OPS_004 to unblock the deployment.
