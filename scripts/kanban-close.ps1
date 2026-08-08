# kanban-close.ps1 — Cierra un item del kanban Interno (Jarvis)
# Setea Status=Changelog y Completado=fecha en un solo paso.
#
# Uso:
#   .\kanban-close.ps1 -ItemId <ID_del_item> [-Date 2026-08-07]
#
# Requiere `gh` autenticado con scope `project`.

param(
  [Parameter(Mandatory = $true)]
  [string]$ItemId,
  [string]$Date = (Get-Date -Format "yyyy-MM-dd")
)

$ProjectId = "PVT_kwHOBM87Yc4Bfn48"          # Jarvis · Interno
$StatusFieldId = "PVTSSF_lAHOBM87Yc4Bfn48zhZ5fDo"
$StatusChangelog = "7874500c"
$CompletadoFieldId = "PVTF_lAHOBM87Yc4Bfn48zhZ5mT8"

$setStatus = @'
mutation($pid: ID!, $item: ID!, $fid: ID!, $opt: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $pid, itemId: $item, fieldId: $fid,
    value: { singleSelectOptionId: $opt }
  }) { clientMutationId }
}
'@

$setDate = @'
mutation($pid: ID!, $item: ID!, $fid: ID!, $date: Date!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $pid, itemId: $item, fieldId: $fid,
    value: { date: $date }
  }) { clientMutationId }
}
'@

$ok = 0
$r1 = gh api graphql -F pid=$ProjectId -F item=$ItemId -F fid=$StatusFieldId -F opt=$StatusChangelog -f query=$setStatus 2>&1
if ($r1 -match 'clientMutationId') { $ok++ } else { "FALLO status: $r1" }

$r2 = gh api graphql -F pid=$ProjectId -F item=$ItemId -F fid=$CompletadoFieldId -F date=$Date -f query=$setDate 2>&1
if ($r2 -match 'clientMutationId') { $ok++ } else { "FALLO fecha: $r2" }

"Listo: Status=Changelog + Completado=$Date ($ok/2)"
