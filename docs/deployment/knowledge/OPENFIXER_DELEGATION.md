# FIXER DELEGATION: OpenFixer
## Infrastructure & External Tools
### Generated: 2026-02-19

---

## ASSIGNMENT OVERVIEW

**Agent**: @openfixer  
**Domain**: External infrastructure, tool modification, automation pipelines  
**Total Effort**: 29 hours  
**Decisions Assigned**: 3  

---

## DECISION 1: OPS_018 - Enable Remote CDP Execution for MCP Server

**Priority**: CRITICAL  
**Effort**: 5 hours  
**Status**: Pending Implementation  
**Oracle Approval**: 98%  

### Problem
The `chrome-devtools-mcp` server is hardcoded to connect only to local Chrome instances. It cannot connect to the remote CDP endpoint at `192.168.56.1:9222`, which is blocking all remote browser automation.

### Solution
Modify the `chrome-devtools-mcp` server to accept optional `host` and `port` parameters in the `evaluate_script` tool. When provided, connect directly to the remote CDP endpoint instead of attempting to launch/find local Chrome.

### Implementation Steps

#### Step 1: Update Tool Schema
**File**: `chrome-devtools-mcp/tools.json` (or equivalent schema definition)

Add optional `host` and `port` properties to the `evaluate_script` input schema:

```json
{
  "name": "evaluate_script",
  "inputSchema": {
    "type": "object",
    "properties": {
      "function": {
        "type": "string",
        "description": "JavaScript function to execute"
      },
      "args": {
        "type": "array",
        "description": "Optional arguments to pass to the function"
      },
      "host": {
        "type": "string",
        "description": "Optional hostname or IP address of the remote CDP instance"
      },
      "port": {
        "type": "integer",
        "description": "Optional port of the remote CDP instance"
      }
    },
    "required": ["function"]
  }
}
```

#### Step 2: Modify Connection Logic
**File**: `chrome-devtools-mcp/src/connection_manager.js` (or equivalent)

Refactor the primary connection function to handle remote endpoints:

```javascript
async function getConnection(params) {
  const { host, port } = params;

  if (host && port) {
    // Remote CDP connection
    const cdpUrl = `http://${host}:${port}`;
    console.log(`[CDP] Connecting to remote instance at ${cdpUrl}`);
    
    // Fetch WebSocket debugger URL from /json/version
    const response = await fetch(`${cdpUrl}/json/version`);
    const versionInfo = await response.json();
    
    // Get WebSocket URL from /json/list
    const listResponse = await fetch(`${cdpUrl}/json/list`);
    const targets = await listResponse.json();
    const pageTarget = targets.find(t => t.type === 'page');
    
    if (!pageTarget) {
      throw new Error('No page target found on remote CDP');
    }
    
    // Connect to WebSocket
    const wsUrl = pageTarget.webSocketDebuggerUrl;
    return await connectToWebSocket(wsUrl);
  } else {
    // Existing local Chrome logic
    console.log('[CDP] Connecting to local Chrome instance');
    return await connectToLocalChrome();
  }
}
```

#### Step 3: Update Tool Implementation
**File**: `chrome-devtools-mcp/src/tools/evaluate_script.js` (or equivalent)

Ensure the full parameters object is passed to the connection manager:

```javascript
async function evaluate_script(params) {
  // Pass full params including host/port
  const client = await getConnection(params);
  
  try {
    const result = await client.Runtime.evaluate({
      expression: params.function,
      returnByValue: true
    });
    
    return {
      result: result.result.value,
      type: result.result.type
    };
  } finally {
    // Don't close connection for remote - may be reused
    if (!params.host) {
      await client.close();
    }
  }
}
```

#### Step 4: Validation

Test the implementation:

```bash
# Test remote connection
curl -X POST http://localhost:22368/tools/evaluate_script \
  -H "Content-Type: application/json" \
  -d '{
    "function": "() => document.title",
    "host": "192.168.56.1",
    "port": 9222
  }'
```

### Success Criteria
- [ ] Can execute JavaScript on remote Chrome at `192.168.56.1:9222`
- [ ] Returns correct results from remote browser context
- [ ] Maintains backward compatibility (local Chrome still works)
- [ ] Connection timeout after 5000ms
- [ ] Clear error messages on connection failure

### Validation
- [ ] Test with simple expression: `() => 1 + 1` returns `2`
- [ ] Test with DOM access: `() => document.title` returns page title
- [ ] Test error handling: Invalid host returns clear error
- [ ] Test timeout: Unreachable host times out after 5s

---

## DECISION 2: OPS_014 - Automated VM Deployment Pipeline

**Priority**: Medium (Conditionally Approved)  
**Effort**: 16 hours  
**Status**: Pending (Blocked by OPS_010)  
**Oracle Approval**: 75%  
**Condition**: Complete OPS_010 documentation first  

### Problem
VM deployment required 43+ manual PowerShell scripts and extensive troubleshooting. Future deployments or disaster recovery would be time-consuming and error-prone.

### Solution
Create automated deployment pipeline using PowerShell DSC (Desired State Configuration).

### Implementation Steps

#### Step 1: Create DSC Configuration
**File**: `scripts/vm/H4ND-VM-Configuration.ps1`

```powershell
Configuration H4NDVMConfiguration {
    param(
        [string]$HostIP = "192.168.56.1",
        [string]$VMName = "H4NDv2-Production",
        [string]$VMIP = "192.168.56.10"
    )

    Import-DscResource -ModuleName PSDesiredStateConfiguration
    Import-DscResource -ModuleName HyperVDsc
    Import-DscResource -ModuleName NetworkingDsc

    Node 'localhost' {
        # VM Provisioning
        HyperVVM H4NDVM {
            Ensure = 'Present'
            Name = $VMName
            VHDPath = "C:\VMs\$VMName\$VMName.vhdx"
            Generation = 2
            MemoryStartupBytes = 4GB
            ProcessorCount = 2
            SwitchName = 'H4ND-Switch'
        }

        # Network Configuration
        NetIPAddress VMStaticIP {
            InterfaceAlias = "Ethernet"
            IPAddress = $VMIP
            PrefixLength = 24
            AddressFamily = "IPv4"
            DependsOn = '[HyperVVM]H4NDVM'
        }

        # Port Proxy on Host
        Script PortProxyCDP {
            GetScript = {
                $proxy = netsh interface portproxy show v4tov4 | 
                    Select-String "192.168.56.1 9222"
                return @{ Result = $proxy }
            }
            TestScript = {
                $proxy = netsh interface portproxy show v4tov4 | 
                    Select-String "192.168.56.1 9222"
                return $proxy -ne $null
            }
            SetScript = {
                netsh interface portproxy add v4tov4 `
                    listenaddress=192.168.56.1 listenport=9222 `
                    connectaddress=127.0.0.1 connectport=9222
            }
        }

        # Software Installation
        Script InstallDotNet {
            GetScript = { @{ Result = (dotnet --version) } }
            TestScript = { 
                $version = dotnet --version 2>$null
                return $version -like "10.*"
            }
            SetScript = {
                # Download and install .NET 10 Preview 1
                $url = "https://download.visualstudio.microsoft.com/..."
                Invoke-WebRequest -Uri $url -OutFile "C:\temp\dotnet10.exe"
                Start-Process -FilePath "C:\temp\dotnet10.exe" -ArgumentList "/quiet" -Wait
            }
        }

        # H4ND Deployment
        File H4NDDeployment {
            Ensure = 'Present'
            Type = 'Directory'
            Recurse = $true
            SourcePath = "\\fileserver\H4ND\publish\h4nd-vm-full"
            DestinationPath = "C:\H4ND"
            DependsOn = '[Script]InstallDotNet'
        }

        # Windows Service
        Service H4NDService {
            Name = "H4ND"
            Ensure = 'Present'
            State = 'Running'
            StartupType = 'Automatic'
            Path = "C:\H4ND\H4ND.exe"
            DependsOn = '[File]H4NDDeployment'
        }
    }
}
```

#### Step 2: Create Deployment Script
**File**: `scripts/vm/Deploy-H4NDVM.ps1`

```powershell
<#
.SYNOPSIS
    Deploys H4ND VM with full automation
.DESCRIPTION
    Creates Hyper-V VM, configures network, installs software, deploys H4ND
.PARAMETER HostIP
    IP address of the host machine (default: 192.168.56.1)
.PARAMETER VMIP
    Static IP for the VM (default: 192.168.56.10)
.PARAMETER VMName
    Name of the VM (default: H4NDv2-Production)
.EXAMPLE
    .\Deploy-H4NDVM.ps1 -HostIP "192.168.56.1" -VMIP "192.168.56.10"
#>
[CmdletBinding()]
param(
    [string]$HostIP = "192.168.56.1",
    [string]$VMIP = "192.168.56.10",
    [string]$VMName = "H4NDv2-Production"
)

# Error action preference
$ErrorActionPreference = "Stop"

# Start logging
$logFile = "C:\logs\H4ND-Deployment-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
Start-Transcript -Path $logFile

try {
    Write-Host "=== H4ND VM Deployment Started ===" -ForegroundColor Green
    Write-Host "Host IP: $HostIP"
    Write-Host "VM IP: $VMIP"
    Write-Host "VM Name: $VMName"

    # Phase 1: VM Provisioning
    Write-Host "`n[1/7] Provisioning VM..." -ForegroundColor Yellow
    & "C:\scripts\vm\01-Provision-VM.ps1" -VMName $VMName -VMIP $VMIP

    # Phase 2: OS Configuration
    Write-Host "`n[2/7] Configuring OS..." -ForegroundColor Yellow
    & "C:\scripts\vm\02-Configure-OS.ps1" -VMName $VMName

    # Phase 3: Network Setup
    Write-Host "`n[3/7] Setting up network..." -ForegroundColor Yellow
    & "C:\scripts\vm\03-Setup-Network.ps1" -HostIP $HostIP -VMIP $VMIP

    # Phase 4: Software Install
    Write-Host "`n[4/7] Installing software..." -ForegroundColor Yellow
    & "C:\scripts\vm\04-Install-Software.ps1" -VMName $VMName

    # Phase 5: H4ND Deploy
    Write-Host "`n[5/7] Deploying H4ND..." -ForegroundColor Yellow
    & "C:\scripts\vm\05-Deploy-H4ND.ps1" -VMName $VMName -HostIP $HostIP

    # Phase 6: Service Setup
    Write-Host "`n[6/7] Setting up service..." -ForegroundColor Yellow
    & "C:\scripts\vm\06-Setup-Service.ps1" -VMName $VMName

    # Phase 7: Health Verify
    Write-Host "`n[7/7] Verifying health..." -ForegroundColor Yellow
    $health = & "C:\scripts\vm\07-Verify-Health.ps1" -VMName $VMName -HostIP $HostIP

    if ($health.Status -eq "Healthy") {
        Write-Host "`n=== Deployment Successful ===" -ForegroundColor Green
        Write-Host "VM $VMName is running and healthy"
        Write-Host "CDP Endpoint: http://$HostIP`:9222"
        Write-Host "MongoDB: mongodb://$HostIP`:27017"
    } else {
        throw "Health check failed: $($health.Errors -join ', ')"
    }

} catch {
    Write-Host "`n=== Deployment Failed ===" -ForegroundColor Red
    Write-Host $_.Exception.Message
    
    # Automatic rollback
    Write-Host "`nInitiating rollback..." -ForegroundColor Yellow
    & "C:\scripts\vm\Rollback-Deployment.ps1" -VMName $VMName
    
    exit 1
} finally {
    Stop-Transcript
}
```

#### Step 3: Create Individual Phase Scripts

Create 7 phase scripts:
1. `01-Provision-VM.ps1` - Create Hyper-V VM
2. `02-Configure-OS.ps1` - Windows 11 setup
3. `03-Setup-Network.ps1` - H4ND-Switch, NAT, port proxy
4. `04-Install-Software.ps1` - .NET 10, Chrome
5. `05-Deploy-H4ND.ps1` - Copy H4ND files
6. `06-Setup-Service.ps1` - Windows Service
7. `07-Verify-Health.ps1` - Health checks

#### Step 4: Create Rollback Script
**File**: `scripts/vm/Rollback-Deployment.ps1`

```powershell
param([string]$VMName = "H4NDv2-Production")

Write-Host "Rolling back deployment of $VMName..." -ForegroundColor Yellow

# Stop VM if running
Stop-VM -Name $VMName -TurnOff -Force -ErrorAction SilentlyContinue

# Remove VM
Remove-VM -Name $VMName -Force -ErrorAction SilentlyContinue

# Remove port proxy
netsh interface portproxy delete v4tov4 listenaddress=192.168.56.1 listenport=9222

# Remove files
Remove-Item -Path "C:\H4ND" -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Rollback complete" -ForegroundColor Green
```

### Success Criteria
- [ ] Single command deployment: `Deploy-H4NDVM -HostIP 192.168.56.1`
- [ ] Idempotent: can re-run without breaking existing setup
- [ ] Rollback: automatic rollback on failure
- [ ] Tested: full deployment in < 30 minutes
- [ ] Health verification before marking complete

---

## DECISION 3: OPS_016 - Disaster Recovery Runbook

**Priority**: HIGH (Approved - PRIORITY)  
**Effort**: 8 hours  
**Status**: Pending  
**Oracle Approval**: 91%  

### Problem
No documented procedure for recovering from VM failure, host failure, or data corruption. Recovery would require reverse-engineering the deployment from scattered notes.

### Solution
Create comprehensive DR runbook with failure scenarios, recovery procedures, backup strategy, and emergency contacts.

### Implementation Steps

#### Step 1: Create Runbook Structure
**File**: `docs/runbooks/DISASTER-RECOVERY.md`

```markdown
# Disaster Recovery Runbook
## H4ND VM Deployment

### RTO: 1 hour
### RPO: 15 minutes

---

## 1. Failure Scenarios

### 1.1 VM Crash or Corruption
**Symptoms**: 
- H4ND service not responding
- VM cannot start
- Blue screen on VM boot

**Impact**: Complete H4ND automation outage

**Detection**: Health endpoint timeout, ERR0R collection alerts

### 1.2 Host Machine Failure
**Symptoms**:
- Physical host hardware failure
- Host OS corruption
- Network adapter failure

**Impact**: Complete system outage including MongoDB and Chrome

**Detection**: VM unreachable, host ping failure

### 1.3 MongoDB Data Corruption
**Symptoms**:
- MongoDB service won't start
- Data integrity errors
- Collection corruption warnings

**Impact**: Loss of credential, jackpot, and signal data

**Detection**: MongoDB logs, application errors

### 1.4 Network Connectivity Loss
**Symptoms**:
- VM cannot reach host
- CDP connection failures
- MongoDB connection timeouts

**Impact**: H4ND cannot communicate with Chrome or database

**Detection**: Connection error logs

### 1.5 Chrome/CDP Failure
**Symptoms**:
- Chrome process crashed
- CDP port not responding
- WebSocket connection failures

**Impact**: Cannot execute browser automation

**Detection**: CDP health check failures

---

## 2. Recovery Procedures

### 2.1 VM Restore from Checkpoint

**Prerequisites**:
- VM checkpoint exists
- Hyper-V host operational

**Steps**:
1. Stop H4ND service on VM (if running)
   ```powershell
   Invoke-Command -VMName "H4NDv2-Production" -ScriptBlock { 
       Stop-Service H4ND -Force 
   }
   ```

2. Restore VM from checkpoint
   ```powershell
   Restore-VMCheckpoint -Name "H4ND-Daily-Checkpoint" `
       -VMName "H4NDv2-Production" -Confirm:$false
   ```

3. Start VM
   ```powershell
   Start-VM -Name "H4NDv2-Production"
   ```

4. Verify health
   ```powershell
   Test-H4NDHealth -VMName "H4NDv2-Production"
   ```

**Time Estimate**: 10 minutes

### 2.2 Full Redeployment

**When to use**: VM checkpoint unavailable or corrupted

**Steps**:
1. Execute automated deployment pipeline
   ```powershell
   .\scripts\vm\Deploy-H4NDVM.ps1 -HostIP "192.168.56.1"
   ```

2. Restore MongoDB from backup (if needed)
   ```powershell
   mongorestore --host 192.168.56.1 --db P4NTHE0N `
       .\backups\mongodb\latest\
   ```

3. Verify all components
   ```powershell
   .\scripts\vm\07-Verify-Health.ps1
   ```

**Time Estimate**: 30 minutes

### 2.3 MongoDB Restore from Backup

**Prerequisites**:
- Backup files available
- MongoDB service running

**Steps**:
1. Stop H4ND service
2. Drop corrupted database (if partial corruption)
3. Restore from backup
   ```powershell
   mongorestore --drop --db P4NTHE0N `
       .\backups\mongodb\$(Get-Date -Format 'yyyyMMdd-HH')
   ```
4. Start H4ND service
5. Verify data integrity

**Time Estimate**: 15 minutes

### 2.4 Manual Failover to Backup Host

**Prerequisites**:
- Backup host prepared
- Network connectivity between hosts

**Steps**:
1. Update VM network configuration to point to backup host
2. Update MongoDB connection strings
3. Update CDP endpoint configuration
4. Restart H4ND service
5. Verify connectivity

**Time Estimate**: 20 minutes

---

## 3. Backup Strategy

### 3.1 VM Checkpoints
- **Frequency**: Daily at 02:00
- **Retention**: 7 days
- **Location**: Local Hyper-V storage
- **Script**: `scripts/backup/New-VMCheckpoint.ps1`

### 3.2 MongoDB Dumps
- **Frequency**: Hourly
- **Retention**: 48 hours
- **Location**: `\\backup-server\mongodb\`
- **Script**: `scripts/backup/Backup-MongoDB.ps1`

### 3.3 H4ND Configuration
- **Frequency**: On change
- **Retention**: Git history
- **Location**: Git repository
- **Backup**: Automatic via CI/CD

### 3.4 Host Configuration
- **Frequency**: Weekly
- **Retention**: 4 weeks
- **Location**: `\\backup-server\host-config\`
- **Script**: `scripts/backup/Backup-HostConfig.ps1`

---

## 4. Emergency Contacts

| Role | Name | Contact | Escalation |
|------|------|---------|------------|
| Infrastructure Owner | TBD | TBD | +1 hour |
| Database Administrator | TBD | TBD | +2 hours |
| Network Administrator | TBD | TBD | +2 hours |
| Business Stakeholder | TBD | TBD | +4 hours |

---

## 5. Validation Checklist

Post-recovery validation:

- [ ] VM is running and accessible
- [ ] H4ND service is running
- [ ] CDP connection to Chrome successful
- [ ] MongoDB connection successful
- [ ] Can read jackpot values from game platforms
- [ ] Can execute test spin
- [ ] Health endpoint returns 200 OK
- [ ] No errors in ERR0R collection

---

## 6. Testing Schedule

**DR Drill Frequency**: Quarterly

**Next Drill**: TBD

**Drill Procedure**:
1. Schedule maintenance window
2. Simulate failure scenario
3. Execute recovery procedure
4. Measure actual RTO/RPO
5. Document lessons learned
6. Update runbook as needed
```

#### Step 2: Create Backup Scripts

**File**: `scripts/backup/New-VMCheckpoint.ps1`
```powershell
param(
    [string]$VMName = "H4NDv2-Production",
    [string]$CheckpointName = "H4ND-Daily-$(Get-Date -Format 'yyyyMMdd')"
)

# Create checkpoint
Checkpoint-VM -Name $VMName -SnapshotName $CheckpointName

# Remove old checkpoints (keep 7 days)
Get-VMCheckpoint -VMName $VMName | 
    Where-Object { $_.CreationTime -lt (Get-Date).AddDays(-7) } |
    Remove-VMCheckpoint -Confirm:$false
```

**File**: `scripts/backup/Backup-MongoDB.ps1`
```powershell
param(
    [string]$Host = "192.168.56.1",
    [string]$BackupPath = "\\backup-server\mongodb"
)

$timestamp = Get-Date -Format 'yyyyMMdd-HH'
$backupDir = Join-Path $BackupPath $timestamp

# Create backup
mongodump --host $Host --db P4NTHE0N --out $backupDir

# Compress
Compress-Archive -Path $backupDir -DestinationPath "$backupDir.zip"
Remove-Item -Path $backupDir -Recurse

# Remove old backups (keep 48 hours)
Get-ChildItem $BackupPath -Filter "*.zip" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddHours(-48) } |
    Remove-Item -Force
```

#### Step 3: Create Validation Script

**File**: `scripts/dr/Test-DRProcedure.ps1`
```powershell
<#
.SYNOPSIS
    Tests disaster recovery procedures
.DESCRIPTION
    Simulates failure scenarios and validates recovery procedures
#>
param(
    [Parameter(Mandatory)]
    [ValidateSet("VM", "MongoDB", "Network", "Chrome")]
    [string]$Scenario
)

$startTime = Get-Date
Write-Host "Starting DR test for scenario: $Scenario" -ForegroundColor Green

try {
    switch ($Scenario) {
        "VM" {
            # Simulate VM failure
            Stop-VM -Name "H4NDv2-Production" -TurnOff -Force
            
            # Execute recovery
            .\docs\runbooks\DISASTER-RECOVERY.md -Procedure "VM Restore"
        }
        "MongoDB" {
            # Simulate MongoDB failure
            Stop-Service MongoDB
            
            # Execute recovery
            .\docs\runbooks\DISASTER-RECOVERY.md -Procedure "MongoDB Restore"
        }
        # ... other scenarios
    }
    
    $endTime = Get-Date
    $rto = ($endTime - $startTime).TotalMinutes
    
    Write-Host "DR Test Complete" -ForegroundColor Green
    Write-Host "RTO: $rto minutes"
    Write-Host "Target RTO: 60 minutes"
    Write-Host "Result: $(if ($rto -le 60) { 'PASS' } else { 'FAIL' })"
    
} catch {
    Write-Host "DR Test Failed: $_" -ForegroundColor Red
    exit 1
}
```

### Success Criteria
- [ ] Runbook tested: full DR drill completed
- [ ] RTO (Recovery Time Objective): < 1 hour
- [ ] RPO (Recovery Point Objective): < 15 minutes data loss
- [ ] Automated backup verification
- [ ] Quarterly DR drills scheduled

---

## SUMMARY

| Decision | Priority | Effort | Status | Key Deliverable |
|----------|----------|--------|--------|-----------------|
| OPS_018 | CRITICAL | 5h | Pending | Remote CDP support in MCP server |
| OPS_014 | Medium | 16h | Blocked | PowerShell DSC deployment pipeline |
| OPS_016 | HIGH | 8h | Pending | DR runbook with tested procedures |

**Total Effort**: 29 hours  
**Critical Path**: OPS_018 blocks all other work  
**Next Action**: Implement OPS_018 to unblock @windfixer

---

**END OF OPENFIXER DELEGATION**
