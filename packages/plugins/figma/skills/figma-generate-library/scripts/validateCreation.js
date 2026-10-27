/**
 * validateCreation
 *
 * Verifies that a set of nodes exist and match expected structural properties.
 * Designed to run immediately after a creation script to catch partial failures
 * before proceeding to the next build phase.
 *
 * Each check specifies a node ID and any combination of expected properties.
 * A check passes when all specified expectations are met; it fails (with a
 * reason string) as soon as any expectation is violated.
 *
 * @param {Array<{
 *   nodeId: string,
 *   expectedChildCount?: number,
 *   expectedName?: string,
 *   expectedType?: NodeType
 * }>} checks
 *   - `nodeId`: The Figma node ID to look up via figma.getNodeById.
 *   - `expectedChildCount`: If set, the node must have exactly this many direct children.
 *     Applies to any node with a `children` property (frames, component sets, etc.).
 *   - `expectedName`: If set, the node's `.name` must exactly match this string.
 *   - `expectedType`: If set, the node's `.type` must exactly match this string.
 * @returns {{
 *   passed: string[],
 *   failed: Array<{nodeId: string, reason: string}>
 * }}
 *   `passed`: Array of nodeIds that passed all checks.
 *   `failed`: Array of objects with the nodeId and a human-readable reason string.
 */
function validateCreation(checks) {
  const passed = []
  const failed = []

  for (const check of checks) {
    const node = figma.getNodeById(check.nodeId)

    // Node must exist
    if (!node) {
      failed.push({
        nodeId: check.nodeId,
        reason: `Node not found. It may not have been created, or was deleted.`,
      })
      continue
    }

    const reasons = []

    // Type check
    if (check.expectedType !== undefined && node.type !== check.expectedType) {
      reasons.push(`type is "${node.type}", expected "${check.expectedType}"`)
    }

    // Name check
    if (check.expectedName !== undefined && node.name !== check.expectedName) {
      reasons.push(`name is "${node.name}", expected "${check.expectedName}"`)
    }

    // Child count check
    if (check.expectedChildCount !== undefined) {
      if (!('children' in node)) {
        reasons.push(
          `node type "${node.type}" does not have children, but expectedChildCount=${check.expectedChildCount} was specified`,
        )
      } else {
        const actualCount = node.children.length
        if (actualCount !== check.expectedChildCount) {
          reasons.push(`has ${actualCount} children, expected ${check.expectedChildCount}`)
        }
      }
    }

    if (reasons.length > 0) {
      failed.push({
        nodeId: check.nodeId,
        reason: reasons.join('; '),
      })
    } else {
      passed.push(check.nodeId)
    }
  }

  return { passed, failed }
}
