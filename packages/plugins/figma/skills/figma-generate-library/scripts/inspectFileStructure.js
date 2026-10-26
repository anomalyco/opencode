/**
 * inspectFileStructure
 *
 * Reads the current Figma file and returns a structural inventory:
 * all pages (with child counts), all local variable collections (with mode
 * names and variable counts), all component sets, all local text styles,
 * and all local effect styles.
 *
 * This is a read-only discovery function — it never creates or mutates nodes.
 * Run it at the start of Phase 0 to understand what already exists before
 * planning any creation work.
 *
 * @returns {Promise<{
 *   pages: Array<{id: string, name: string, childCount: number}>,
 *   variableCollections: Array<{
 *     id: string,
 *     name: string,
 *     modes: Array<{modeId: string, name: string}>,
 *     variableCount: number,
 *     variableNames: string[]
 *   }>,
 *   componentSets: Array<{id: string, name: string, variantCount: number, pageId: string, pageName: string}>,
 *   textStyles: Array<{id: string, name: string, fontFamily: string, fontStyle: string, fontSize: number}>,
 *   effectStyles: Array<{id: string, name: string, effectCount: number}>
 * }>}
 */
async function inspectFileStructure() {
  const result = {
    pages: [],
    variableCollections: [],
    componentSets: [],
    textStyles: [],
    effectStyles: [],
  }

  // --- Pages ---
  for (const page of figma.root.children) {
    result.pages.push({
      id: page.id,
      name: page.name,
      childCount: page.children.length,
    })
  }

  // --- Variable collections ---
  const collections = await figma.variables.getLocalVariableCollectionsAsync()
  for (const coll of collections) {
    const variables = await Promise.all(
      coll.variableIds.map((id) => figma.variables.getVariableByIdAsync(id)),
    )
    const variableNames = variables.filter(Boolean).map((v) => v.name)

    result.variableCollections.push({
      id: coll.id,
      name: coll.name,
      modes: coll.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
      variableCount: coll.variableIds.length,
      variableNames,
    })
  }

  // --- Component sets (and standalone components) ---
  // We need to load all pages to inspect components across the whole file.
  const originalPage = figma.currentPage

  for (const page of figma.root.children) {
    await figma.setCurrentPageAsync(page)

    // findAllWithCriteria.types accepts an array — one indexed scan returns
    // both COMPONENT_SET and standalone COMPONENT nodes.
    const found = page.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] })
    for (const node of found) {
      if (node.type === 'COMPONENT_SET') {
        result.componentSets.push({
          id: node.id,
          name: node.name,
          variantCount: node.children.length,
          pageId: page.id,
          pageName: page.name,
        })
      } else if (node.parent && node.parent.type !== 'COMPONENT_SET') {
        // Standalone component (not a variant inside a COMPONENT_SET)
        result.componentSets.push({
          id: node.id,
          name: node.name,
          variantCount: 1,
          pageId: page.id,
          pageName: page.name,
        })
      }
    }
  }

  // Restore original page
  await figma.setCurrentPageAsync(originalPage)

  // --- Text styles ---
  const textStyles = figma.getLocalTextStyles()
  for (const ts of textStyles) {
    result.textStyles.push({
      id: ts.id,
      name: ts.name,
      fontFamily: ts.fontName.family,
      fontStyle: ts.fontName.style,
      fontSize: ts.fontSize,
    })
  }

  // --- Effect styles ---
  const effectStyles = figma.getLocalEffectStyles()
  for (const es of effectStyles) {
    result.effectStyles.push({
      id: es.id,
      name: es.name,
      effectCount: es.effects.length,
    })
  }

  return result
}
