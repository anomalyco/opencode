/**
 * Removes entities identified by the exact IDs recorded in the state ledger.
 *
 * @param {{
 *   nodeIds?: string[],
 *   variableIds?: string[],
 *   collectionIds?: string[]
 * }} ids
 * @returns {Promise<{
 *   removedCount: number,
 *   removedIds: string[],
 *   skippedIds: string[]
 * }>}
 */
async function cleanupOrphans({ nodeIds = [], variableIds = [], collectionIds = [] } = {}) {
  const requestedIds = [...nodeIds, ...variableIds, ...collectionIds]
  if (requestedIds.length === 0) {
    throw new Error('cleanupOrphans: pass IDs from the state ledger.')
  }

  const removedIds = []
  const skippedIds = []
  const nodes = []
  for (const id of new Set(nodeIds)) {
    const node = await figma.getNodeByIdAsync(id)
    if (!node) {
      skippedIds.push(id)
      continue
    }
    nodes.push(node)
  }

  for (const node of nodes.sort((a, b) => getDepth(b) - getDepth(a))) {
    if (node.type === 'DOCUMENT') {
      skippedIds.push(node.id)
      continue
    }

    if (node.type === 'PAGE') {
      if (figma.root.children.length <= 1) {
        skippedIds.push(node.id)
        continue
      }
      if (figma.currentPage.id === node.id) {
        const fallbackPage = figma.root.children.find((page) => page.id !== node.id)
        if (!fallbackPage) {
          skippedIds.push(node.id)
          continue
        }
        await figma.setCurrentPageAsync(fallbackPage)
      }
    }

    removedIds.push(node.id)
    node.remove()
  }

  for (const id of new Set(variableIds)) {
    const variable = await figma.variables.getVariableByIdAsync(id)
    if (!variable) {
      skippedIds.push(id)
      continue
    }
    removedIds.push(variable.id)
    variable.remove()
  }

  for (const id of new Set(collectionIds)) {
    const collection = await figma.variables.getVariableCollectionByIdAsync(id)
    if (!collection) {
      skippedIds.push(id)
      continue
    }
    removedIds.push(collection.id)
    collection.remove()
  }

  return {
    removedCount: removedIds.length,
    removedIds,
    skippedIds,
  }
}

function getDepth(node) {
  let depth = 0
  let current = node
  while (current.parent) {
    depth++
    current = current.parent
  }
  return depth
}
