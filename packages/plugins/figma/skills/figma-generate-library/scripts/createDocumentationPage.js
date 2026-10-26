/**
 * createDocumentationPage
 *
 * Creates a new Figma page with a standardized documentation layout: a page
 * title, optional description, and an ordered list of sections each built by
 * a caller-supplied `contentFn`. The content function receives the section
 * frame and may append any nodes to it.
 *
 * This function is used for standalone documentation pages (e.g. a Foundations
 * page, a Getting Started page, or a component page with documentation).
 * It does not handle component sets — those live on separate pages created by
 * createComponentWithVariants.
 *
 * @param {string} pageName - The Figma page name (e.g. "Foundations", "Getting Started").
 * @param {{
 *   title: string,
 *   description?: string,
 *   sections: Array<{
 *     name: string,
 *     contentFn: (sectionFrame: FrameNode) => Promise<void>
 *   }>
 * }} config
 *   - `title`: Large heading displayed at the top of the page.
 *   - `description`: Optional subtitle displayed below the heading.
 *   - `sections`: Ordered list of sections. Each section gets its own frame
 *     with a heading and is passed to `contentFn` for population.
 * @returns {Promise<{
 *   page: PageNode,
 *   titleNode: TextNode,
 *   frameIds: string[]
 * }>}
 *   `frameIds` is an ordered list of IDs for the root frame and each section frame.
 */
async function createDocumentationPage(pageName, config) {
  // Verify required fonts are available before loading
  const allFonts = await figma.listAvailableFontsAsync()
  const requiredStyles = ['Bold', 'Regular', 'Medium']
  for (const style of requiredStyles) {
    const found = allFonts.some((f) => f.fontName.family === 'Inter' && f.fontName.style === style)
    if (!found) {
      const interFonts = allFonts.filter((f) => f.fontName.family === 'Inter')
      throw new Error(
        `Font "Inter ${style}" not available. Available Inter styles: ${interFonts.map((f) => f.fontName.style).join(', ') || 'none'}`,
      )
    }
  }
  await Promise.all([
    figma.loadFontAsync({ family: 'Inter', style: 'Bold' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Regular' }),
    figma.loadFontAsync({ family: 'Inter', style: 'Medium' }),
  ])

  // Create and activate the page
  const page = figma.createPage()
  page.name = pageName
  await figma.setCurrentPageAsync(page)

  const frameIds = []

  // Root scroll container — 1440px wide, auto-height
  const root = figma.createAutoLayout('VERTICAL')
  root.name = pageName
  root.primaryAxisAlignItems = 'MIN'
  root.counterAxisAlignItems = 'MIN'
  root.itemSpacing = 80
  root.paddingTop = 80
  root.paddingBottom = 120
  root.paddingLeft = 80
  root.paddingRight = 80
  root.resize(1440, 1)
  root.layoutSizingHorizontal = 'FIXED'
  root.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
  root.x = 0
  root.y = 0
  page.appendChild(root)

  frameIds.push(root.id)

  // Page header: title + optional description
  const header = figma.createAutoLayout('VERTICAL')
  header.name = 'Header'
  header.itemSpacing = 12
  header.fills = []
  root.appendChild(header)
  header.layoutSizingHorizontal = 'FILL'

  const titleNode = figma.createText()
  titleNode.fontName = { family: 'Inter', style: 'Bold' }
  titleNode.characters = config.title
  titleNode.fontSize = 40
  titleNode.fills = [{ type: 'SOLID', color: { r: 0.07, g: 0.07, b: 0.07 } }]
  header.appendChild(titleNode)
  titleNode.layoutSizingHorizontal = 'FILL'

  if (config.description) {
    const descNode = figma.createText()
    descNode.fontName = { family: 'Inter', style: 'Regular' }
    descNode.characters = config.description
    descNode.fontSize = 16
    descNode.lineHeight = { value: 24, unit: 'PIXELS' }
    descNode.fills = [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4 } }]
    header.appendChild(descNode)
    descNode.layoutSizingHorizontal = 'FILL'
  }

  // Sections
  for (const section of config.sections) {
    const sectionFrame = figma.createAutoLayout('VERTICAL')
    sectionFrame.name = `Section/${section.name}`
    sectionFrame.itemSpacing = 20
    sectionFrame.fills = []
    root.appendChild(sectionFrame)
    sectionFrame.layoutSizingHorizontal = 'FILL'

    // Section heading
    const sectionHeading = figma.createText()
    sectionHeading.fontName = { family: 'Inter', style: 'Bold' }
    sectionHeading.characters = section.name
    sectionHeading.fontSize = 24
    sectionHeading.fills = [{ type: 'SOLID', color: { r: 0.07, g: 0.07, b: 0.07 } }]
    sectionFrame.appendChild(sectionHeading)
    sectionHeading.layoutSizingHorizontal = 'FILL'

    // Invoke the caller's content function to populate the section
    await section.contentFn(sectionFrame)

    frameIds.push(sectionFrame.id)
  }

  return { page, titleNode, frameIds }
}
