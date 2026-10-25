/**
 * @see https://developers.figma.com/docs/plugins/api/figma
 */
interface PluginAPI {
  /**
   * The version of the Figma API this plugin is running on, as defined in your `manifest.json` in the `"api"` field.
   */
  readonly apiVersion: '1.0.0'
  /**
   * The currently executing command from the `manifest.json` file. It is the command string in the `ManifestMenuItem` (more details in the [manifest guide](https://developers.figma.com/docs/plugins/manifest)). If the plugin does not have any menu item, this property is undefined.
   */
  readonly command: string
  /**
   * The current editor type this plugin is running in. See also [Setting editor type](https://developers.figma.com/docs/plugins/setting-editor-type).
   */
  readonly editorType: 'figma' | 'figjam' | 'dev' | 'slides' | 'buzz'
  /**
   * The value specified in the `manifest.json` "id" field. This only exists for Plugins.
   */
  readonly pluginId?: string
  /**
   * Similar to `figma.pluginId` but for widgets. The value specified in the `manifest.json` "id" field. This only exists for Widgets.
   */
  readonly widgetId?: string
  /**
   * The file key of the current file this plugin is running on.
   * **Only [private plugins](https://help.figma.com/hc/en-us/articles/4404228629655-Create-private-organization-plugins) and Figma-owned resources (such as the Jira and Asana widgets) have access to this.**
   * To enable this behavior, you need to specify `enablePrivatePluginApi` in your `manifest.json`.
   */
  readonly fileKey: string | undefined
  /**
   * When enabled, causes all node properties and methods to skip over invisible nodes (and their descendants) inside {@link InstanceNode | instances}.
   * This makes operations like document traversal much faster.
   *
   * Note: Defaults to true in Figma Dev Mode and false in Figma and FigJam
   *
   * @remarks
   *
   * Accessing and modifying invisible nodes and their descendants inside instances can be slow with the plugin API.
   * This is especially true in large documents with tens of thousands of nodes where a call to {@link ChildrenMixin.findAll} might come across many of these invisible instance children.
   *
   * If your plugin does not need access to these nodes, we recommend setting `figma.skipInvisibleInstanceChildren = true` as that often makes document traversal significantly faster.
   *
   * When this flag is enabled, it will not be possible to access invisible nodes (and their descendants) inside instances. This has the following effects:
   *
   * - {@link ChildrenMixin.children} and methods such as {@link ChildrenMixin.findAll} will exclude these nodes.
   * - {@link PluginAPI.getNodeByIdAsync} will return a promise containing null.
   * - {@link PluginAPI.getNodeById} will return null.
   * - Accessing a property on an existing node object for an invisible node will throw an error.
   *
   * For example, suppose that a portion of the document tree looks like this:
   *
   * Frame (visible) → Instance (visible) → Frame (invisible) → Text (visible)
   *
   * The last two frame and text nodes cannot be accessed after setting `figma.skipInvisibleInstanceChildren = true`.
   *
   * The benefit of enabling this flag is that document traversal methods, {@link ChildrenMixin.findAll} and {@link ChildrenMixin.findOne}, can be up to several times faster in large documents that have invisible instance children.
   * {@link ChildrenMixin.findAllWithCriteria} can be up to hundreds of times faster in large documents.
   */
  skipInvisibleInstanceChildren: boolean
  /**
   * This property contains methods used to read and set the viewport, the user-visible area of the current page.
   *
   * Read more in the [viewport section](https://developers.figma.com/docs/plugins/api/figma-viewport).
   */
  readonly viewport: ViewportAPI
  /**
   * Closes the plugin. You should always call this function once your plugin is done running. When called, any UI that's open will be closed and any `setTimeout` or `setInterval` timers will be cancelled.
   *
   * @param message - Optional -- display a visual bell toast with the message after the plugin closes.
   *
   * @remarks
   *
   * Calling `figma.closePlugin()` disables callbacks and Figma APIs. It does not, however, abort the plugin. Any lines of Javascript after this call will also run. For example, consider the following plugin that expects the user to have one layer selected:
   *
   * ```ts title="Simple closePlugin"
   * if (figma.currentPage.selection.length !== 1) {
   *   figma.closePlugin()
   * }
   * figma.currentPage.selection[0].opacity = 0.5
   * ```
   *
   * This will not work. The last line will still run, but will throw an exception because access to `figma.currentPage` has been disabled. As such, it is not recommended to run any code after calling `figma.closePlugin()`.
   *
   * A simple way to easily exit your plugin is to wrap your plugin in a function, instead of running code at the top-level, and always follow `figma.closePlugin()` with a `return` statement:
   *
   * ```ts title="Early return"
   * function main() {
   *   if (figma.currentPage.selection.length !== 1) {
   *     figma.closePlugin()
   *     return
   *   }
   *   figma.currentPage.selection[0].opacity = 0.5
   * }
   * main()
   * ```
   *
   * It's good practice to have all input validation done at the start of the plugin. However, there may be cases where the plugin may need to close after a chain of multiple function calls. If you expect to have to close the plugin deep within your code, but don't want to necessarily want the user to see an error, the example above will not be sufficient.
   *
   * One alternative is to use a top-level try-catch statement. However, you will need to be responsible for making sure that there are no usages of try-catch between the top-level try-catch and the call to `figma.closePlugin()`, or to pass along the close command if necessary. Example:
   *
   * ```ts title="Top-level try-catch"
   * const CLOSE_PLUGIN_MSG = "_CLOSE_PLUGIN_"
   * function someNestedFunctionCallThatClosesThePlugin() {
   *   throw CLOSE_PLUGIN_MSG
   * }
   *
   * function main() {
   *   someNestedFunctionCallThatClosesThePlugin()
   * }
   *
   * try {
   *   main()
   * } catch (e) {
   *   if (e === CLOSE_PLUGIN_MSG) {
   *     figma.closePlugin()
   *   } else {
   *     // >> DO NOT LEAVE THIS OUT <<
   *     // If we caught any other kind of exception,
   *     // it's a real error and should be passed along.
   *     throw e
   *   }
   * }
   * ```
   */
  closePlugin(message?: string): void
  /**
   * This property contains convenience functions for common operations.
   *
   * Read more in the [util section](https://developers.figma.com/docs/plugins/api/figma-util).
   */
  readonly util: UtilAPI
  /**
   * This property contains methods to handle user inputs when a plugin is launched in query mode. See [Accepting Parameters as Input](https://developers.figma.com/docs/plugins/plugin-parameters) for more details.
   */
  readonly parameters: ParametersAPI
  /**
   * This property contains methods for reading Motion animation styles available in the current document.
   *
   * Read more in the [Motion section](https://developers.figma.com/docs/plugins/api/figma-motion).
   */
  readonly motion: MotionAPI
  /**
   * Finds a node by its id in the current document. Every node has an `id` property, which is unique within the document. If the id is invalid, or the node cannot be found (e.g. removed), returns a promise containing null.
   */
  getNodeByIdAsync(id: string): Promise<BaseNode | null>
  /**
   * Finds a style by its id in the current document. If not found, returns a promise containing null.
   */
  getStyleByIdAsync(id: string): Promise<BaseStyle | null>
  /**
   * This property contains methods to work with Variables and Variable Collections within Figma.
   *
   * */
  readonly variables: VariablesAPI
  /** This property contains methods to work with assets residing in a team library. */
  readonly teamLibrary: TeamLibraryAPI
  /**
   * This property contains methods to work with annotations.
   */
  readonly annotations: AnnotationsAPI
  /**
   * The root of the entire Figma document. This node is used to access other pages. Each child is a {@link PageNode}.
   */
  readonly root: DocumentNode
  /**
   * The page that the user currently viewing. You can set this value to a {@link PageNode} to switch pages.
   *
   * * If the manifest contains`"documentAccess": "dynamic-page"`, this property is read-only. Use {@link PluginAPI.setCurrentPageAsync} to update the value.
   */
  currentPage: PageNode
  /**
   * Switch the active page to the specified {@link PageNode}.
   */
  setCurrentPageAsync(page: PageNode): Promise<void>
  /**
   * This a constant value that some node properties return when they are a mix of multiple values. An example might be font size: a single text node can use multiple different font sizes for different character ranges. For those properties, you should always compare against `figma.mixed`.
   *
   * @remarks
   *
   * Example:
   *
   * ```ts title="Check if property is a mix of multiple values"
   * if (node.type === 'RECTANGLE') {
   *   if (node.cornerRadius !== figma.mixed) {
   *     console.log(`Single corner radius: ${node.cornerRadius}`)
   *   } else {
   *     console.log(`Mixed corner radius: ${node.topLeftRadius}, ${node.topRightRadius}, ${node.bottomLeftRadius}, ${node.bottomRightRadius}`)
   *   }
   * }
   * ```
   *
   * Note: Your plugin never needs to know what the actual value of `figma.mixed` is, only that it is a unique, constant value that can be compared against. That being said, this value returns an object of type `symbol` which is a more advanced feature of Javascript. [Read more about symbols](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol). It works in TypeScript via the `unique symbol` [subtype](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-7.html#unique-symbol).
   */
  readonly mixed: unique symbol
  /**
   * Creates a new rectangle. The behavior is similar to using the `R` shortcut followed by a click.
   *
   * @remarks
   *
   * By default, the new node has a default fill, width and height both at 100, and is parented under `figma.currentPage`.
   *
   * ```ts title="Create a rectangle and set basic styles"
   * const rect = figma.createRectangle()
   *
   * // Move to (50, 50)
   * rect.x = 50
   * rect.y = 50
   *
   * // Set size to 200 x 100
   * rect.resize(200, 100)
   *
   * // Set solid red fill
   * rect.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
   * ```
   */
  createRectangle(): RectangleNode
  /**
   * Creates a new line.
   *
   * @remarks
   *
   * By default, the new node is 100 in width, has a black stroke, with weight 1, and is parented under `figma.currentPage`.
   *
   * ```ts title="Create a line and set basic styles"
   * const line = figma.createLine()
   *
   * // Move to (50, 50)
   * line.x = 50
   * line.y = 50
   *
   * // Make line 200px long
   * line.resize(200, 0)
   *
   * // 4px thick red line with arrows at each end
   * line.strokeWeight = 4
   * line.strokes = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
   * line.strokeCap = 'ARROW_LINES'
   * ```
   */
  createLine(): LineNode
  /**
   * Creates a new ellipse. The behavior is similar to using the `O` shortcut followed by a click.
   *
   * @remarks
   *
   * By default, the new node has a default fill, width and height both at 100, and is parented under `figma.currentPage`.
   *
   * ```ts title="Create a red, U-shaped half donut"
   * const ellipse = figma.createEllipse()
   *
   * // Move to (50, 50)
   * ellipse.x = 50
   * ellipse.y = 50
   *
   * // Set size to 200 x 100
   * ellipse.resize(200, 100)
   *
   * // Set solid red fill
   * ellipse.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
   *
   * // Arc from 0° to 180° clockwise
   * ellipse.arcData = {startingAngle: 0, endingAngle: Math.PI, innerRadius: 0.5}
   * ```
   */
  createEllipse(): EllipseNode
  /**
   * Creates a new polygon (defaults to a triangle).
   *
   * @remarks
   *
   * By default, the new node has three edges (i.e. a triangle), a default fill, width and height both at 100, and is parented under `figma.currentPage`.
   *
   * ```ts title="Create a red octagon"
   * const polygon = figma.createPolygon()
   *
   * // Move to (50, 50)
   * polygon.x = 50
   * polygon.y = 50
   *
   * // Set size to 200 x 200
   * polygon.resize(200, 200)
   *
   * // Make the polygon 8-sided
   * polygon.pointCount = 8
   *
   * // Set solid red fill
   * polygon.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
   * ```
   */
  createPolygon(): PolygonNode
  /**
   * Creates a new star.
   *
   * @remarks
   *
   * By default, the new node has five points edges (i.e. a canonical star), a default fill, width and height both at 100, and is parented under `figma.currentPage`.
   *
   * ```ts title="Create a red, 7-pointed star"
   * const star = figma.createStar()
   *
   * // Move to (50, 50)
   * star.x = 50
   * star.y = 50
   *
   * // Set size to 200 x 200
   * star.resize(200, 200)
   *
   * // Make the star 7-pointed
   * star.pointCount = 7
   *
   * // Set solid red fill
   * star.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
   *
   * // Make the angles of each point less acute
   * star.innerRadius = 0.6
   * ```
   */
  createStar(): StarNode
  /**
   * Creates a new, empty vector network with no vertices.
   *
   * @remarks
   *
   * By default, parented under `figma.currentPage`. Without setting additional properties, the vector has a bounding box but doesn't have any vertices. There are two ways to assign vertices to a vector node - [`vectorPaths`](https://developers.figma.com/docs/plugins/api/VectorNode#vectorpaths) and [`setVectorNetworkAsync`](https://developers.figma.com/docs/plugins/api/VectorNode#setvectornetworkasync). Please refer to the documentation of those properties for more details.
   */
  createVector(): VectorNode
  /**
   * Creates a new, empty text node.
   *
   * @remarks
   *
   * By default, parented under `figma.currentPage`. Without setting additional properties, the text has no characters. You can assign a string, to the [`characters`](https://developers.figma.com/docs/plugins/api/properties/TextNode-characters) property of the returned node to provide it with text.
   *
   * ```ts title="Create a styled 'Hello world!' text node"
   * (async () => {
   *   const text = figma.createText()
   *
   *   // Move to (50, 50)
   *   text.x = 50
   *   text.y = 50
   *
   *   // Load the font in the text node before setting the characters
   *   await figma.loadFontAsync(text.fontName)
   *   text.characters = 'Hello world!'
   *
   *   // Set bigger font size and red color
   *   text.fontSize = 18
   *   text.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
   * })()
   * ```
   */
  createText(): TextNode
  /**
   * Creates a new frame. The behavior is similar to using the `F` shortcut followed by a click.
   *
   * @remarks
   *
   * By default, the new node has a white background, width and height both at 100, and is parented under `figma.currentPage`.
   *
   * ```ts title="Create a frame"
   * const frame = figma.createFrame()
   *
   * // Move to (50, 50)
   * frame.x = 50
   * frame.y = 50
   *
   * // Set size to 1280 x 720
   * frame.resize(1280, 720)
   * ```
   */
  createFrame(): FrameNode
  /**
   * Note: This API is only available via `use_figma` in the MCP server
   *
   * Creates a new frame with auto layout already enabled. Both axes default to hug content
   * (`primaryAxisSizingMode = "AUTO"`, `counterAxisSizingMode = "AUTO"`), so children can
   * immediately use `layoutSizingHorizontal/Vertical = "FILL"` after being appended.
   *
   * @remarks
   *
   * Prefer this over `createFrame()` whenever you need an auto-layout parent. Since `layoutMode` is
   * already set, children can use `FILL` sizing immediately after being appended.
   *
   * The default direction is `"HORIZONTAL"`. Pass `"VERTICAL"` for a column layout.
   *
   * ```ts title="Create an auto-layout frame"
   * const row = figma.createAutoLayout()
   * const column = figma.createAutoLayout("VERTICAL")
   *
   * row.itemSpacing = 16
   * row.paddingTop = 24
   * row.paddingBottom = 24
   * row.paddingLeft = 24
   * row.paddingRight = 24
   * ```
   */
  createAutoLayout(direction?: 'HORIZONTAL' | 'VERTICAL'): FrameNode
  /**
   * Note: This API is only available in Figma Design
   *
   * Creates a new, empty component.
   *
   * @remarks
   *
   * By default, the new node has width and height both at 100, and is parented under `figma.currentPage`.
   *
   * This function creates a brand new component. To create a component from an existing node, use {@link PluginAPI.createComponentFromNode}.
   *
   * ```ts title="Create a component"
   * const component = figma.createComponent()
   * ```
   */
  createComponent(): ComponentNode
  /**
   * Note: This API is only available in Figma Design
   *
   * Creates a component from an existing node, preserving all of its properties and children. The behavior is similar to using the **Create component** button in the toolbar.
   *
   * @remarks
   *
   * To create a brand new component instead, use {@link PluginAPI.createComponent}.
   *
   * There are many restrictions on what nodes can be turned into components. For example, the node cannot be a component or component set and cannot be inside a component, component set, or instance.
   *
   * If you try to create a component from a node that cannot be turned into a component, then the function will throw a `Cannot create component from node` error.
   *
   * ```ts title="Create a component from a node"
   * const frame = figma.createFrame()
   * const component = figma.createComponentFromNode(frame)
   */
  createComponentFromNode(node: SceneNode): ComponentNode
  /**
   * Creates a new page, appended to the document's list of children.
   *
   * @remarks
   *
   * A page node can be the parent of all types of nodes except for the document node and other page nodes.
   *
   * Files in a Starter team are limited to three pages in Figma Design files and one page in FigJam files. When a plugin tries to exceed this limit, it triggers the following error:
   *
   * ```text title="Page limit error"
   * The Starter plan only comes with 3 pages. Upgrade to
   * Professional for unlimited pages.
   * ```
   */
  createPage(): PageNode
  /**
   * Creates a new page divider, appended to the document's list of children. A page divider is a {@link PageNode} with `isPageDivider` true.
   *
   * @remarks
   *
   * A page divider is always the child of the document node and cannot have any children.
   *
   * @param dividerName - An optional argument to specify the name of the page divider node. It won't change how the page divider appears in the UI, but it specifies the name of the underlying node. The dividerName must be a page divider name (all asterisks, all en dashes, all em dashes, or all spaces). If no dividerName is specified, the default name for the created page divider node is "---".
   */
  createPageDivider(dividerName?: string): PageNode
  /**
     * Creates a new slice object.
     *
     * @remarks
     *
     * By default, the new node is parented under `figma.currentPage`.
     *
     * ```ts title="Create a slice and export as PNG"
     * (async () => {
     *   const slice = figma.createSlice()
     *
     *   // Move to (50, 50)
     *   slice.x = 50
     *   slice.y = 50
     *
     *   // Set size to 500 x 500
     *   slice.resize(500, 500)
     *
     *   // Export a PNG of this region of the canvas
     *   const bytes = await slice.exportAsync()
     *
     *   // Add the image onto the canvas as an image fill in a frame
     *   const image = figma.createImage(bytes)
     *   const frame = figma.createFrame()
     *   frame.resize(500, 500)
     *   frame.fills = [{
     *     imageHash: image.hash,
     *     scaleMode: "FILL",
     *     scalingFactor: 1,
     *     type: "IMAGE",
     *   }]
  })()
     * ```
     */
  createSlice(): SliceNode
  /**
   * Note: This API is only available in Figma Slides
   *
   * @remarks
   *
   * By default, the slide gets appended to the end of the presentation (the last child in the last Slide Row).
   *
   * ```ts title="Create a slide"
   * const slide = figma.createSlide()
   * ```
   *
   * To specify a position in the Slide Grid, pass a row and column index to the function.
   *
   * ```ts title="Create a slide at index 0, 0"
   * const slide = figma.createSlide(0, 0)
   * ```
   */
  createSlide(row?: number, col?: number): SlideNode
  /**
   * Note: This API is only available in Figma Slides
   *
   * Creates a new Slide Row, which automatically gets appended to the Slide Grid.
   *
   * @remarks
   *
   * By default, the row gets appended to the end of the Slide Grid.
   *
   * ```ts title="Create a slide row"
   * const slideRow = figma.createSlideRow()
   * ```
   *
   * To specify a position in the Slide Grid, pass a row index to the function.
   *
   * ```ts title="Create a slide row at index 0"
   * const slideRow = figma.createSlideRow(0)
   * ```
   */
  createSlideRow(row?: number): SlideRowNode
  /**
   * Note: This API is only available in FigJam
   *
   * Creates a new sticky. The behavior is similar to using the `S` shortcut followed by a click.
   *
   * @remarks
   *
   * By default, the new node has constant width and height both at 240, and is parented under `figma.currentPage`.
   *
   * ```ts title="Create a sticky with text"
   * (async () => {
   *   const sticky = figma.createSticky()
   *
   *   // Load the font before setting characters
   *   await figma.loadFontAsync(sticky.text.fontName)
   *   sticky.text.characters = 'Hello world!'
   * })()
   * ```
   */
  createSticky(): StickyNode
  /**
   * Note: This API is only available in FigJam
   *
   * Creates a new connector. The behavior is similar to using the `Shift-C` shortcut followed by a click.
   *
   * @remarks
   *
   * By default, the new node has a width of 200, and is parented under `figma.currentPage`.
   *
   * ```ts title="Add a connector between two stickies"
   * // Create two stickies
   * const stickyLeft = figma.createSticky()
   * stickyLeft.x = -200
   *
   * const stickyRight = figma.createSticky()
   * stickyRight.x = 200
   *
   * // Connect the two stickies
   * const connector = figma.createConnector()
   * connector.connectorStart = {
   *   endpointNodeId: stickyLeft.id,
   *   magnet: 'AUTO'
   * }
   *
   * connector.connectorEnd = {
   *   endpointNodeId: stickyRight.id,
   *   magnet: 'AUTO'
   * }
   * ```
   */
  createConnector(): ConnectorNode
  /**
   * Note: This API is only available in FigJam
   *
   * Creates a new shape with text.
   *
   * @remarks
   *
   * By default, the new node has a width and height of 208, and is parented under `figma.currentPage`.
   *
   * ```ts title="Create a rounded rectangle shape with text"
   * (async () => {
   *   const shape = figma.createShapeWithText()
   *   shape.shapeType = 'ROUNDED_RECTANGLE'
   *
   *   // Load the font before setting characters
   *   await figma.loadFontAsync(shape.text.fontName)
   *   shape.text.characters = 'Hello world!'
   * })()
   * ```
   */
  createShapeWithText(): ShapeWithTextNode
  /**
   * Note: This API is only available in FigJam
   *
   * Creates a new code block.
   */
  createCodeBlock(): CodeBlockNode
  /**
   *
   * Creates a new section
   */
  createSection(): SectionNode
  /**
   * Note: This API is only available in FigJam
   *
   * Creates a new table.
   *
   * @remarks
   *
   * By default, a table has two rows and two columns, and is parented under `figma.currentPage`.
   *
   * ```ts title="Create a table and add text to cells inside"
   * (async () => {
   *   // Create a table with 2 rows and 3 columns
   *   const table = figma.createTable(2, 3)
   *
   *   // Load the font before setting characters
   *   await figma.loadFontAsync(table.cellAt(0, 0).text.fontName)
   *
   *   // Sets characters for the table cells:
   *   // A B C
   *   // 1 2 3
   *   table.cellAt(0, 0).text.characters = 'A'
   *   table.cellAt(0, 1).text.characters = 'B'
   *   table.cellAt(0, 2).text.characters = 'C'
   *   table.cellAt(1, 0).text.characters = '1'
   *   table.cellAt(1, 1).text.characters = '2'
   *   table.cellAt(1, 2).text.characters = '3'
   * })()
   * ```
   */
  createTable(numRows?: number, numColumns?: number): TableNode
  /**
   * Creates a new text on a path node from an existing vector node.
   *
   * @remarks
   * Once you create a TextPathNode, you can then modify properties such as `characters`, `fontSize`, `fill`, etc just like a regular TextNode.
   *
   * Example:
   * ```ts
   * const circle = figma.createEllipse()
   * circle.resize(200, 200)
   * await figma.loadFontAsync({ family: "Inter", style: "Regular" })
   * const textPath = figma.createTextPath(circle, 2, 0.5)
   * textPath.characters = "This is text on a path!"
   * ```
   * The base vector network cannot currently be modified after creating the TextPathNode.
   *
   * Note: Creating a `TextPathNode` modifies the `type` of the underlying node. Make sure that you use the node object returned from this function rather than the original node object.
   *
   *
   * @param node - The vector-like node to convert to a text on a path node. These can be VectorNodes, shape nodes (Rectangle, Ellipse, Polygon, Star), or Line nodes.
   * @param startSegment - The index of the segment in the vector network to start the text path from.
   * @param startPosition - A number between 0 and 1 representing the position along the start segment to start the text path from.
   */
  createTextPath(node: VectorNode, startSegment: number, startPosition: number): TextPathNode
  /**
   * Note: This API is only available in Figma Design
   *
   * Creates a new Paint style. This might be referred to as a Color style, or Fill style more colloquially. However, since this type of style may contain images, and may be used for backgrounds, strokes, and fills, it is called a Paint.
   */
  createPaintStyle(): PaintStyle
  /**
   * Note: This API is only available in Figma Design
   *
   * Creates a new Text style. By default, the text style has the Figma default text properties (font family Inter Regular, font size 12).
   */
  createTextStyle(): TextStyle
  /**
   * Note: This API is only available in Figma Design
   *
   * Creates a new Effect style.
   */
  createEffectStyle(): EffectStyle
  /**
   * Note: This API is only available in Figma Design
   *
   * Creates a new Grid style.
   */
  createGridStyle(): GridStyle
  /**
   * Returns the list of local paint styles.
   */
  getLocalPaintStylesAsync(): Promise<PaintStyle[]>
  /**
   * Returns the list of local text styles.
   */
  getLocalTextStylesAsync(): Promise<TextStyle[]>
  /**
   * Returns the list of local effect styles.
   */
  getLocalEffectStylesAsync(): Promise<EffectStyle[]>
  /**
   * Returns the list of local grid styles.
   */
  getLocalGridStylesAsync(): Promise<GridStyle[]>
  /**
   * Note: This API is only available in Figma Design
   *
   * Reorders a target node after the specified reference node (if provided) or to be first if reference is null. The target and reference nodes must live in the same folder. The target and reference nodes must be local paint styles.
   */
  moveLocalPaintStyleAfter(targetNode: PaintStyle, reference: PaintStyle | null): void
  /**
   * Note: This API is only available in Figma Design
   *
   * Reorders a target node after the specified reference node (if provided) or to be first if reference is null. The target and reference nodes must live in the same folder. The target and reference nodes must be local text styles.
   */
  moveLocalTextStyleAfter(targetNode: TextStyle, reference: TextStyle | null): void
  /**
   * Note: This API is only available in Figma Design
   *
   * Reorders a target node after the specified reference node (if provided) or to be first if reference is null. The target and reference nodes must live in the same folder. The target and reference nodes must be local effect styles.
   */
  moveLocalEffectStyleAfter(targetNode: EffectStyle, reference: EffectStyle | null): void
  /**
   * Note: This API is only available in Figma Design
   *
   * Reorders a target node after the specified reference node (if provided) or to be first if reference is null. The target and reference nodes must live in the same folder. The target and reference nodes must be local grid styles.
   */
  moveLocalGridStyleAfter(targetNode: GridStyle, reference: GridStyle | null): void
  /**
   * Note: This API is only available in Figma Design
   *
   * Reorders a target folder after the specified reference folder (if provided) or to be first in the parent folder if reference is null. The target and reference folders must have the same parent folder. The target and reference folders must contain paint styles. When referring to nested folders, the full delimited folder name must be used. See the {@link BaseStyle } section for more info.
   */
  moveLocalPaintFolderAfter(targetFolder: string, reference: string | null): void
  /**
   * Note: This API is only available in Figma Design
   *
   * Reorders a target folder after the specified reference folder (if provided) or to be first in the parent folder if reference is null. The target and reference folders must have the same parent folder. The target and reference folders must contain text styles. When referring to nested folders, the full delimited folder name must be used. See the {@link BaseStyle } section for more info.
   */
  moveLocalTextFolderAfter(targetFolder: string, reference: string | null): void
  /**
   * Note: This API is only available in Figma Design
   *
   * Reorders a target folder after the specified reference folder (if provided) or to be first in the parent folder if reference is null. The target and reference folders must have the same parent folder. The target and reference folders must contain effect styles. When referring to nested folders, the full delimited folder name must be used. See the {@link BaseStyle } section for more info.
   */
  moveLocalEffectFolderAfter(targetFolder: string, reference: string | null): void
  /**
   * Note: This API is only available in Figma Design
   *
   * Reorders a target folder after the specified reference folder (if provided) or to be first in the parent folder if reference is null. The target and reference folders must have the same parent folder. The target and reference folders must contain grid styles. When referring to nested folders, the full delimited folder name must be used. See the {@link BaseStyle } section for more info.
   */
  moveLocalGridFolderAfter(targetFolder: string, reference: string | null): void
  /**
   * Loads a component node from the team library. Promise is rejected if there is no published component with that key or if the request fails.
   */
  importComponentByKeyAsync(key: string): Promise<ComponentNode>
  /**
   * Loads a component set node from the team library. Promise is rejected if there is no published component set with that key or if the request fails.
   */
  importComponentSetByKeyAsync(key: string): Promise<ComponentSetNode>
  /**
   * Loads a style from the team library. Promise is rejected if there is no style with that key or if the request fails.
   */
  importStyleByKeyAsync(key: string): Promise<BaseStyle>
  /**
   * Lists every shader available to the current file: shaders already in the file, shaders from subscribed libraries, and the user's owned shaders.
   *
   * @remarks
   *
   * A shader applies either as an effect (`node.effects`) or as a fill (`node.fills` / `node.strokes`), depending on its `type`. Owned or subscribed shaders that aren't materialized in the file yet are returned with `imported: false` — call {@link PluginAPI.importShaderById} on the shader's `id` before applying it (this mirrors `loadFontAsync` for fonts).
   *
   * ```ts
   * const shaders = await figma.listAvailableShaders()
   * for (const shader of shaders) {
   *   console.log(shader.name, shader.type, shader.imported)
   * }
   * ```
   */
  listAvailableShaders(): Promise<Shader[]>
  /**
   * Materializes a shader into the current file by `id` and returns it with `imported: true` and its `propertyDefinitions` populated. The `id` is one returned by {@link PluginAPI.listAvailableShaders}. This is idempotent for a shader that is already imported, and mirrors {@link PluginAPI.importComponentByKeyAsync}.
   *
   * @remarks
   *
   * A shader must be imported before it can be applied. Applying an unloaded shader id throws `Shader not imported. Call figma.importShaderById(id) first.`
   *
   * ```ts
   * const [shader] = await figma.listAvailableShaders()
   * if (shader && !shader.imported) {
   *   const imported = await figma.importShaderById(shader.id)
   *   console.log(imported.propertyDefinitions)
   * }
   * ```
   */
  importShaderById(id: string): Promise<Shader>
  /**
   * Returns the lists of currently available fonts. This should be the same list as the one you'd see if you manually used the font picker.
   */
  listAvailableFontsAsync(): Promise<Font[]>
  /**
   * Makes a font available _in the plugin_ for use when creating and modifying text. Calling this function is **necessary** to modify any property of a text node that may cause the rendered text to change, including `.characters`, `.fontSize`, `.fontName`, etc.
   *
   * You can either pass in a hardcoded font, a font loaded via `listAvailableFontsAsync`, or the font stored on an existing text node.
   *
   * Read more about how to work with fonts, when to load them, and how to load them in the [Working with Text](https://developers.figma.com/docs/plugins/working-with-text) page.
   *
   * @remarks
   *
   * This function only works to load fonts _already accessible in the Figma editor_ available to _plugins_. It does not load fonts from the internet.
   *
   * Tip: to load multiple fonts at the same time, you may find [Promise.all](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all) helpful.
   *
   * A common question is whether a plugin needs to be careful about calling `loadFontAsync(font)` for the same font multiple times. The answer is somewhat nuanced. The result of loading a font is cached, so calling `loadFontAsync` won't re-fetch the same font from disk. Therefore, calling `loadFontAsync` on every frame would be perfectly ok.
   *
   * However, note that `loadFontAsync` returns a Promise. Even a Promise resolves immediately, it still needs to round-trip to the JavaScript event loop. So you probably shouldn't call `loadFontAsync` on the same font repeatedly inside a loop.
   *
   * **Variable fonts**
   *
   * You can pass a {@link FontNameInput} and omit `style` to load every style of the family in one call. This works for both variable and static families, and is convenient when you plan to drive the font with {@link FontName.variationSettings} rather than enumerating named instances. {@link FontName.variationSettings} on the argument is ignored — variation values affect what gets rendered, not what gets loaded — so you can pass the same object you later assign to `node.fontName`.
   *
   * ```ts title="Loading and applying a variable font"
   * (async () => {
   *   await figma.loadFontAsync({ family: 'Inter' })
   *
   *   const text = figma.createText()
   *   text.fontName = {
   *     family: 'Inter',
   *     style: 'Regular',
   *     variationSettings: { wght: 550 },
   *   }
   *   text.characters = 'Hello, world'
   * })()
   * ```
   */
  loadFontAsync(fontName: FontNameInput): Promise<void>
  /**
   * Returns the [OpenType variation axis](https://fonts.google.com/knowledge/glossary/axis_in_variable_fonts) tags a variable font family exposes, or `null` for a static family. These are the tags accepted by {@link FontName.variationSettings}.
   *
   * @remarks
   *
   * The family has to be available in the editor but does not have to be loaded, so this can be called before {@link PluginAPI.loadFontAsync} to decide what to load. Throws for an unknown family, so `null` always means the family is static.
   *
   * Each tag is a 4-character OpenType axis tag such as `"wght"` (weight), `"wdth"` (width), `"slnt"` (slant), `"opsz"` (optical size), or a custom tag defined by the font designer.
   *
   * ```ts title="Discovering variation axes, then applying one"
   * (async () => {
   *   const family = 'Inter'
   *   const axes = figma.getFontFamilyVariationAxes(family)
   *   if (axes === null) {
   *     console.log(`${family} is a static font`)
   *     return
   *   }
   *
   *   await figma.loadFontAsync({ family })
   *   const text = figma.createText()
   *   if (axes.includes('wght')) {
   *     text.fontName = { family, style: 'Regular', variationSettings: { wght: 550 } }
   *   }
   *   text.characters = 'Variable!'
   * })()
   * ```
   */
  getFontFamilyVariationAxes(family: string): string[] | null
  /**
   * Returns true if the document contains text with missing fonts.
   */
  readonly hasMissingFont: boolean
  /**
   * Creates a new node from an SVG string. This is equivalent to the SVG import feature in the editor. See the [official documentation on SVG paths](https://www.w3.org/TR/SVG/paths.html) for more details.
   */
  createNodeFromSvg(svg: string): FrameNode
  /**
   * Creates an `Image` object from the raw bytes of a file content. Note that `Image` objects **are not nodes**. They are handles to images stored by Figma. Frame backgrounds, or fills of shapes (e.g. a rectangle) may contain images.
   * [Example: how to work with images](https://developers.figma.com/docs/plugins/working-with-images).
   * @remarks
   *
   * The `data` passed in must be encoded as a PNG, JPEG, or GIF. Images have a maximum size of 4096 pixels (4K) in width and height. Invalid images will throw an error.
   */
  createImage(data: Uint8Array): Image
  /**
   * This gets the corresponding `Image` object for a given image hash, which can then be used to obtain the bytes of the image. This hash is found in a node's fill property as part of the ImagePaint object. If there is no image with this hash, returns null.
   */
  getImageByHash(hash: string): Image | null
  /**
   * Note: This API is only available in Figma Design
   *
   * Creates a new {@link ComponentSetNode} by combining all the nodes in `nodes`, which should all have type {@link ComponentNode}.
   *
   * @param nodes - The list of nodes in the new component set. This list must be non-empty, and must consist of only component nodes.
   * @param parent - The node under which the new component set will be created. This is similar to `parent.appendChild(componentSet)`, but must be specified at the time that the group is created rather than later.
   * @param index - An optional index argument that specifies where inside `parent` the new component set will be created. When this argument is not provided, it will default to appending the component set as the last (topmost) child. This is similar to the index argument in `parent.insertChild(index, componentSet)`.
   *
   * @remarks
   *
   * This API is roughly the equivalent of pressing the "Combine as Variants" button in the editor, but combines the specified list of nodes rather than the current selection. You may still, of course, combine the current selection as variants by passing it as an argument:
   *
   * ```ts title="Combining variants"
   * figma.combineAsVariants(figma.currentPage.selection, parent)
   * ```
   *
   * Note: Why is there no `figma.createComponentSet()` function? It would create an empty component set, and empty component sets are not supported in Figma.
   *
   * Since combining as variants involves moving nodes to a different parent, this operation is subject to many reparenting restrictions:
   */
  combineAsVariants(
    nodes: ReadonlyArray<ComponentNode>,
    parent: BaseNode & ChildrenMixin,
    index?: number,
  ): ComponentSetNode
  /**
   * Creates new group containing all the nodes in `nodes`. There is no `createGroup` function -- use this instead. Group nodes have many quirks, like auto-resizing, that you can read about in the {@link FrameNode} section.
   *
   * @param nodes - The list of nodes in the new group. This list must be non-empty as Figma does not support empty groups. This list cannot include any node that cannot be reparented, such as children of instances.
   * @param parent - The node under which the new group will be created. This is similar to `parent.appendChild(group)`, but must be specified at the time that the group is created rather than later.
   * @param index - An optional index argument that specifies where inside `parent` the new group will be created. When this argument is not provided, it will default to appending the group as the last (topmost) child. This is similar to the index argument in `parent.insertChild(index, group)`.
   *
   * @remarks
   *
   * This API is roughly the equivalent of pressing Ctrl-G/⌘G in the editor, but groups the specified list of nodes rather than the current selection. You may still, of course, group the current selection by passing it as an argument:
   *
   * ```ts title="Group nodes"
   * figma.group(figma.currentPage.selection, parent)
   * ```
   *
   * Note: Why is there no `figma.createGroup()` function? It would create an empty group, and empty groups are not supported in Figma.
   *
   * Note: Why do we require `figma.group(...)` to specify the parent, rather let you call `parent.appendChild(group)` separately? It allows you to create the new group while keeping all the grouped layers in the same absolute x/y locations. The method `.appendChild` preserves the *relative* position of a node, so if you use `.appendChild` to populate a group, you would need to do additional work to put them back in their original location if that was the desired behavior.
   *
   * Since grouping involves moving nodes to a different parent, this operation is subject to many reparenting restrictions:
   */
  group(nodes: ReadonlyArray<BaseNode>, parent: BaseNode & ChildrenMixin, index?: number): GroupNode
  /**
   * Creates a new {@link TransformGroupNode} containing all the nodes in `nodes`, applying the transformations specified in `modifiers` to each child node.
   *
   * @param nodes - The list of nodes in the new group. This list must be non-empty as Figma does not support empty groups. This list cannot include any node that cannot be reparented, such as children of instances.
   * @param parent - The node under which the new group will be created. This is similar to `parent.appendChild(group)`, but must be specified at the time that the group is created rather than later.
   * @param index - An index argument that specifies where inside `parent` the new group will be created.
   * @param modifiers - The list of transform modifiers to apply to each corresponding node in `nodes`.
   */
  transformGroup(
    nodes: ReadonlyArray<SceneNode>,
    parent: BaseNode & ChildrenMixin,
    index: number,
    modifiers: TransformModifier[],
  ): TransformGroupNode
  /**
   * Flattens every node in nodes into a new vector network.
   *
   * @param nodes - The list of nodes in the new group. This list must be non-empty and cannot include any node that cannot be reparented, such as children of instances. Make a copy of those nodes first if necessary.
   * @param parent - The node under which the new vector will be created. This is similar to `parent.appendChild(group)` and defaults to `figma.currentPage` if left unspecified.
   * @param index - An optional index argument that specifies where inside `parent` the new vector will be created. When this argument is not provided, it will default to appending the vector as the last (topmost) child. This is similar to the index argument in `parent.insertChild(index, group)`.
   *
   * @remarks
   *
   * This API is roughly the equivalent of pressing Ctrl-E/⌘E in the editor, but flattens the specified list of nodes rather than the current selection. You may still, of course, flatten the current selection by passing it as an argument:
   *
   * ```ts title="Flatten nodes"
   * figma.flatten(figma.currentPage.selection, parent)
   * ```
   *
   * Since flattening involves moving nodes to a different parent, this operation is subject to many reparenting restrictions:
   */
  flatten(
    nodes: ReadonlyArray<BaseNode>,
    parent?: BaseNode & ChildrenMixin,
    index?: number,
  ): VectorNode
  /**
   * Creates a new {@link BooleanOperationNode} using the UNION operation using the contents of `nodes`. The arguments to `union` are the same as in {@link PluginAPI.group}.
   */
  union(
    nodes: ReadonlyArray<BaseNode>,
    parent: BaseNode & ChildrenMixin,
    index?: number,
  ): BooleanOperationNode
  /**
   * Creates a new {@link BooleanOperationNode} using the SUBTRACT operation using the contents of `nodes`. The arguments to `union` are the same as in {@link PluginAPI.subtract}.
   */
  subtract(
    nodes: ReadonlyArray<BaseNode>,
    parent: BaseNode & ChildrenMixin,
    index?: number,
  ): BooleanOperationNode
  /**
   * Creates a new {@link BooleanOperationNode} using the INTERSECT operation using the contents of `nodes`. The arguments to `union` are the same as in {@link PluginAPI.intersect}.
   */
  intersect(
    nodes: ReadonlyArray<BaseNode>,
    parent: BaseNode & ChildrenMixin,
    index?: number,
  ): BooleanOperationNode
  /**
   * Creates a new {@link BooleanOperationNode} using the EXCLUDE operation using the contents of `nodes`. The arguments to `union` are the same as in {@link PluginAPI.exclude}.
   */
  exclude(
    nodes: ReadonlyArray<BaseNode>,
    parent: BaseNode & ChildrenMixin,
    index?: number,
  ): BooleanOperationNode
  /**
   * Ungroups the given `node`, moving all of `node`'s children into `node`'s parent and removing `node`. Returns an array of nodes that were children of `node`.
   *
   * @remarks
   *
   * This API is roughly the equivalent of pressing Ctrl-Shift-G/⌘⇧G in the editor, but ungroups the given node rather than all nodes in the current selection.
   *
   * If the ungrouped node is part of the current selection, the ungrouped node's children will become part of the selection. Otherwise the selection is unchanged.
   *
   * @param node - The node to ungroup.
   */
  ungroup(node: SceneNode & ChildrenMixin): Array<SceneNode>
  /**
   * Returns a base64-encoded string from the Uint8Array `data`.
   */
  base64Encode(data: Uint8Array): string
  /**
   * Decodes and returns a Uint8Array from the base64-encoded string `data`.
   */
  base64Decode(data: string): Uint8Array
  /**
   * Gets the current canvas grid layout as a 2D array of nodes.
   *
   * Note: This API is only available in Figma Slides and Figma Buzz
   *
   * @remarks
   *
   * The canvas grid represents the organizational structure of assets in Slides and Buzz,
   * where each position can contain a node (slide or asset).
   *
   * To visualize the nodes in the canvas grid in a 2D array, you can call this function.
   *
   * ```ts
   * const grid = figma.getCanvasGrid()
   * ```
   */
  getCanvasGrid(): Array<Array<SceneNode>>
  /**
   * Sets the canvas grid layout, reorganizing nodes in the canvas.
   *
   * Note: This API is only available in Figma Slides and Figma Buzz
   *
   * @remarks
   *
   * This allows you to programmatically rearrange the layout of slides or assets in the canvas grid.
   * All nodes in the current grid must be included in the new layout.
   *
   * For example:
   *
   * ```ts
   * const grid = figma.getCanvasGrid()
   * const [firstRow, ...rest] = grid
   *
   * // move the first row to the end
   * figma.setCanvasGrid([...rest, firstRow])
   * ```
   *
   * @param canvasGrid - A 2D array representing the new canvas grid layout
   */
  setCanvasGrid(canvasGrid: Array<Array<SceneNode>>): void
  /**
   * Creates a new row in the canvas grid at the specified index.
   *
   * Note: This API is only available in Figma Slides and Figma Buzz
   *
   *
   * @param rowIndex - The index where to insert the new row (optional)
   *
   * @remarks
   *
   * If no row index is provided, the row will be added at the end of the grid.
   */
  createCanvasRow(rowIndex?: number): SceneNode
  /**
   * Makes all built-in brushes of the specified type available for use in the plugin. This function must be called before
   * setting the stroke of a node to a brush of the specified type.
   *
   * There are two types of brushes: 'STRETCH' brushes, which stretch along the length of the stroke, and 'SCATTER' brushes, which scatter instances of the brush shape along the stroke.
   *
   * @param brushType - The type of brush to load. Can be either 'STRETCH' or 'SCATTER'.
   *
   * @remarks
   *
   * This function only needs to be called once per plugin run for each brush type that will be used. Once loaded, brushes of the specified type can be used freely.
   */
  loadBrushesAsync(brushType: 'STRETCH' | 'SCATTER'): Promise<void>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/figma-variables
 */
interface VariablesAPI {
  /**
   * Finds a variable by ID. If not found or the provided ID is invalid, returns a promise containing `null`.
   *
   * @param id - The variable ID to search for, which represents a unique identifier for the variable.
   */
  getVariableByIdAsync(id: string): Promise<Variable | null>
  /**
   * Finds a variable collection by ID. If not found or the provided ID is invalid, returns a promise containing `null`.
   *
   * @param id - The variable collection ID to search for, which represents a unique identifier for the variable collection.
   */
  getVariableCollectionByIdAsync(id: string): Promise<VariableCollection | null>
  /**
   * Returns all local variables in the current file, optionally filtering by resolved type.
   *
   * @param type - Filters the returned variables to only be of the given resolved type.
   */
  getLocalVariablesAsync(type?: VariableResolvedDataType): Promise<Variable[]>
  /**
   * Returns all local variable collections in the current file.
   */
  getLocalVariableCollectionsAsync(): Promise<VariableCollection[]>
  /**
   * Creates a variable with a given name and resolved type inside a collection.
   *
   * @param name - The name of the newly created variable
   * @param collection - A variable collection. Make sure to pass a collection object here; passing a collection ID is deprecated.
   * @param resolvedType - The resolved type of this variable
   */
  createVariable(
    name: string,
    collection: VariableCollection,
    resolvedType: VariableResolvedDataType,
  ): Variable
  /**
   * Creates a new variable collection with the given name.
   * @param name - The name of the newly created variable collection.
   */
  createVariableCollection(name: string): VariableCollection
  /**
   * Creates a new extended variable collection from a library or local variable collection with the given name.
   * @param collectionKey - The key of the library or local variable collection to extend.
   * @param name - The name of the newly created variable collection.
   *
   * Note: This API is limited to the Enterprise plan.
   * If limited by the current pricing tier, this method will throw an error with the message
   * `in extend: Cannot create extended collections outside of enterprise plan.`
   */
  extendLibraryCollectionByKeyAsync(
    collectionKey: string,
    name: string,
  ): Promise<ExtendedVariableCollection>
  /**
   * Helper function to create a variable alias.
   *
   * This should be used with functions such as `node.setProperties()` to
   * assign component properties to variables.
   */
  createVariableAlias(variable: Variable): VariableAlias
  /**
   * Helper function to create a variable alias.
   *
   * This should be used with functions such as `node.setProperties()` to
   * assign component properties to variables.
   */
  createVariableAliasByIdAsync(variableId: string): Promise<VariableAlias>
  /**
   * Helper function to bind a variable to a {@link SolidPaint}.
   *
   * If `null` is provided as the `variable`, the given `field` will be unbound from any variables.
   *
   * @returns a copy of the paint which is now bound to the provided variable.
   */
  setBoundVariableForPaint(
    paint: SolidPaint,
    field: VariableBindablePaintField,
    variable: Variable | null,
  ): SolidPaint
  /**
   * Helper function to bind a variable to an {@link Effect}.
   *
   * If `null` is provided as the `variable`, the given `field` will be unbound from any variables.
   *
   * @returns a copy of the effect which is now bound to the provided variable.
   */
  setBoundVariableForEffect(
    effect: Effect,
    field: VariableBindableEffectField,
    variable: Variable | null,
  ): Effect
  /**
   * Helper function to bind a variable to a {@link LayoutGrid}.
   *
   * If `null` is provided as the `variable`, the given `field` will be unbound from any variables.
   *
   * @returns a copy of the layout grid which is now bound to the provided variable.
   */
  setBoundVariableForLayoutGrid(
    layoutGrid: LayoutGrid,
    field: VariableBindableLayoutGridField,
    variable: Variable | null,
  ): LayoutGrid
  /**
   * Loads a variable from the team library. Promise is rejected if there is
   * no published variable with that key or if the request fails.
   *
   * @param key the key of the variable to import.
   */
  importVariableByKeyAsync(key: string): Promise<Variable>
}
interface LibraryVariableCollection {
  /** The name of the variable collection. */
  name: string
  /** The key of the variable collection. */
  key: string
  /** The name of the library that contains this variable collection. */
  libraryName: string
}
interface LibraryVariable {
  /** The name of the variable. */
  name: string
  /** The key of the variable. */
  key: string
  /** The resolved type of this variable. */
  resolvedType: VariableResolvedDataType
}
/**
 * @see https://developers.figma.com/docs/plugins/api/figma-annotations
 */
interface AnnotationsAPI {
  /**
   * Returns a list of all {@link AnnotationCategory}s that exist in the current file.
   */
  getAnnotationCategoriesAsync(): Promise<AnnotationCategory[]>
  /**
   * Returns an {@link AnnotationCategory} by its ID. If not found, returns a promise containing null.
   *
   * @param id - The annotation category ID to search for.
   */
  getAnnotationCategoryByIdAsync(id: string): Promise<AnnotationCategory | null>
  /**
   * Adds a new {@link AnnotationCategory}.
   *
   * @param categoryInput - The label and color of the annotation category.
   */
  addAnnotationCategoryAsync(categoryInput: {
    label: string
    color: AnnotationCategoryColor
  }): Promise<AnnotationCategory>
}
/**
 * Represents a text field within a Buzz media asset that can be dynamically updated.
 * BuzzTextField objects are returned by {@link BuzzAPI.getTextContent} and provide access
 * to both the current text content and the underlying text node.
 */
interface BuzzTextField {
  /**
   * The current text content of the field, or null if the field is empty.
   */
  readonly value: string | null
  /**
   * The underlying TextNode that contains this text content, or null if not found.
   */
  readonly node: TextNode | null
  /**
   * Updates the text content asynchronously
   */
  setValueAsync(value: string): Promise<void>
}
/**
 * Represents a media field within a Buzz media asset that can contain images or videos.
 * BuzzMediaField objects are returned by {@link BuzzAPI.getMediaContent} and provide access
 * to the current media content and the ability to update it dynamically.
 */
interface BuzzMediaField {
  /**
   * The type of media content: 'IMAGE' for images, 'VIDEO' for videos, or null if no media is present.
   */
  readonly type: 'IMAGE' | 'VIDEO' | null
  /**
   * A unique identifier for the current media content, or null if no media is set.
   */
  readonly hash: string | null
  /**
   * The underlying SceneNode that contains this media content, or null if not found.
   */
  readonly node: SceneNode | null
  /**
   * Updates the media content with a new ImagePaint or VideoPaint
   */
  setMediaAsync(paint: ImagePaint | VideoPaint): Promise<void>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/figma-teamlibrary
 */
interface TeamLibraryAPI {
  /**
   * Returns a descriptor of all {@link VariableCollection}s that exist in the enabled libraries of the current file. Rejects if the request fails.
   *
   * Note: This requires that users enable libraries that contain variables via the UI. Currently it is not possible to enable libraries via the Plugin API.
   *
   * @returns A list of {@link LibraryVariableCollection}s that are available for this file
   *
   * @remarks
   *
   * This is intended to be used in conjunction with {@link TeamLibraryAPI.getVariablesInLibraryCollectionAsync}
   */
  getAvailableLibraryVariableCollectionsAsync(): Promise<LibraryVariableCollection[]>
  /**
   * Returns a descriptor of all {@link Variable}s that exist in a given {@link LibraryVariableCollection}.
   * Rejects if the given variable collection does not exist, or if the current user
   * does not have access to that variable collection's library, or if the request fails.
   *
   * @param libraryCollectionKey the key of the library variable collection that contains the returned library variables.
   *
   * ## Example usage
   *
   * ```ts title="Example usage of getVariablesInLibraryCollectionAsync"
   * // Query all published collections from libraries enabled for this file
   * const libraryCollections =
   *     await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()
   * // Select a library variable collection to import into this file
   * const variablesInFirstLibrary =
   *     await figma.teamLibrary.getVariablesInLibraryCollectionAsync(libraryCollections[0].key)
   * // Import the first number variable we find in that collection
   * const variableToImport =
   *     variablesInFirstLibrary.find((libVar) => libVar.resolvedType === 'FLOAT')
   * const importedVariable =
   *     await figma.variables.importVariableByKeyAsync(variableToImport.key)
   * ```
   *
   */
  getVariablesInLibraryCollectionAsync(libraryCollectionKey: string): Promise<LibraryVariable[]>
}
/**
 * The Motion API is available in Beta. This API is subject to change.
 *
 * @see https://developers.figma.com/docs/plugins/api/figma-motion
 */
interface MotionAPI {
  /**
   * Returns the Motion animation styles available in the current document.
   *
   * @remarks
   *
   * The returned styles describe animation templates that can be applied to nodes with {@link MotionNodeMixin.applyAnimationStyle}.
   * Their `props` values are type/default descriptions for each configurable property.
   *
   * ```ts
   * const styles = figma.motion.figmaAnimationStyles()
   * for (const style of styles) {
   *   console.log(style.name, style.styleId, style.props)
   * }
   * ```
   */
  figmaAnimationStyles(): AvailableAnimationStyle[]
  /**
   * Converts physical spring parameters to Motion's normalized `bounce` value from 0 to 1.
   *
   * @param spring - Positive finite physical spring values.
   *
   * @remarks
   * The returned value is the normalized `bounce` scalar used by {@link NormalizedSpring}.
   *
   * ```ts
   * const bounce = figma.motion.physicalSpringToNormalized({
   *   mass: 1,
   *   stiffness: 100,
   *   damping: 10,
   * })
   * ```
   */
  physicalSpringToNormalized(spring: PhysicalSpring): number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/figma-util
 */
interface UtilAPI {
  /**
   * Creates an `RGB` color object from a variety of common color encodings.
   *
   * **Note**: since `RGB` colors are primarily used for creating `SolidPaint` objects, you might want to use {@link UtilAPI.solidPaint} instead.
   *
   * Accepted color formats include CSS color strings with hex, `rgb()`, `hsl()`, or `lab()` encodings, as well as `RGB` and `RGBA` objects. Alpha values in the input will be ignored. If a string encoding cannot be parsed, an error will be thrown.
   *
   * Examples:
   *
   * ```ts
   * const color1 = figma.util.rgb('#FF00FF')
   * const color2 = figma.util.rgb('hsl(25% 50% 75%)')
   * ```
   *
   * You can alias this function for more concise code:
   *
   * ```ts
   * const rgb = figma.util.rgb
   * const color = rgb('#FF00FF')
   * ```
   *
   * @param color - A CSS color string, `RGB` object, or `RGBA` object. The input color's alpha value, if any, will be ignored.
   */
  rgb(color: string | RGB | RGBA): RGB
  /**
   * Creates an `RGBA` color object from a variety of common color encodings.
   *
   * Accepted color formats include CSS color strings with hex, `rgb()`, `hsl()`, or `lab()` encodings, as well as `RGB` and `RGBA` objects. Alpha defaults to 1 (opaque) if not provided in the input. If a string encoding cannot be parsed, an error will be thrown.
   *
   * Examples:
   *
   * ```ts
   * const layoutGrid = {
   *   pattern: 'GRID',
   *   sectionSize: 1,
   *   color: figma.util.rgba('rgb(25% 25% 25% / 0.5)')
   * }
   * ```
   *
   * You can alias this function for more concise code:
   *
   * ```ts
   * const rgba = figma.util.rgba
   * const color = rgba('rgb(25% 25% 25% / 0.5)')
   * ```
   *
   * @param color - A CSS color string, `RGB` object, or `RGBA` object.
   */
  rgba(color: string | RGB | RGBA): RGBA
  /**
   * Creates a `SolidPaint` object, assigning color and opacity from a variety of common color encodings.
   *
   * Accepted color formats include CSS color strings with hex, `rgb()`, `hsl()`, or `lab()` encodings, as well as `RGB` and `RGBA` objects. The resulting alpha value will be applied to the `SolidPaint`'s `opacity` property, which defaults to 1 (opaque) if not specified. If a string encoding cannot be parsed, an error will be thrown.
   *
   * Optionally, you can provide a set of overrides for any of the non-color properties of the `SolidPaint` object. This is useful for modifying the color of an existing `SolidPaint` while preserving its other properties.
   *
   * Examples:
   *
   * ```ts
   * // Set the current page background to red
   * figma.currentPage.backgrounds = [figma.util.solidPaint("#FF0000")]
   *
   * // Modify an existing SolidPaint with new color and opacity
   * if (node.fills[0].type === 'SOLID') {
   *   const updated = figma.util.solidPaint('#FF00FF88', node.fills[0])
   * }
   * ```
   *
   * You can alias this function for more concise code:
   *
   * ```ts
   * const solidPaint = figma.util.solidPaint
   *
   * // Set the current page background to red
   * figma.currentPage.backgrounds = [solidPaint("#FF0000")]
   *
   * // Modify an existing SolidPaint with new color and opacity
   * if (node.fills[0].type === 'SOLID') {
   *   const updated = solidPaint('#FF00FF88', node.fills[0])
   * }
   * ```
   *
   * @param color - A CSS color string, `RGB` object, or `RGBA` object.
   * @param overrides - An optional object that allows you to specify additional `SolidPaint` properties, aside from color. This is useful for modifying the color of a pre-existing `SolidPaint` object.
   */
  solidPaint(color: string | RGB | RGBA, overrides?: Partial<SolidPaint>): SolidPaint
  /**
   *
   * Normalizes the markdown string to verify what markdown will render with Figma's rich-text editors.
   *
   * Examples:
   *
   * ```ts
   * const md = "# Hello, world!\n\nThis is a **bold** text."
   * const normalizedMd = figma.util.normalizeMarkdown(md);
   *
   * // Set an component description with descriptionMarkdown
   * component.descriptionMarkdown = normalizedMd;
   * ```
   *
   * @param markdown - A markdown string to normalize.
   */
  normalizeMarkdown(markdown: string): string
  /**
   * Returns the single-character Private Use Area string for an Apple SF Symbol, given the symbol's canonical name (e.g. `'square.and.arrow.up'`). Assigning the returned character to a text node's `characters` — after loading the SF Pro font — causes the symbol to render in the text layer.
   *
   * Throws if `name` is not a string or does not match a known SF Symbol.
   *
   * Example:
   *
   * ```ts
   * const text = figma.createText()
   * await figma.loadFontAsync({ family: 'SF Pro', style: 'Regular' })
   * text.characters = 'Share ' + figma.util.getSfSymbolCharacter('square.and.arrow.up')
   * ```
   *
   * @param name - The canonical SF Symbol name.
   */
  getSfSymbolCharacter(name: string): string
}
/**
 * @see https://developers.figma.com/docs/plugins/api/figma-viewport
 */
interface ViewportAPI {
  /**
   * Center of the the current page that is currently visible on screen.
   */
  center: Vector
  /**
   * Zoom level. A value of 1.0 means 100% zoom, 0.5 means 50% zoom.
   *
   * @remarks
   * - zoom &lt; 1: design is zoomed out
   * - zoom = 1: design is shown at exact size
   * - zoom &gt; 1: design is zoomed in
   *
   */
  zoom: number
  /**
   * Automatically sets the viewport coordinates such that the nodes are visible on screen. It is the equivalent of pressing Shift-1.
   *
   */
  scrollAndZoomIntoView(nodes: ReadonlyArray<BaseNode>): void
  /**
   * The bounds of the viewport of the page that is currently visible on screen. The (x, y) corresponds to the top-left of the screen. User actions such as resizing the window or showing/hiding the rulers/UI will change the bounds of the viewport.
   *
   */
  readonly bounds: Rect
}
/**
 * @see https://developers.figma.com/docs/plugins/api/figma-parameters
 */
interface SuggestionResults {
  /**
   * Sets the list of autocomplete suggestions to be displayed in the quick action UI.
   *
   * If you only want to provide a string suggestion, and don't need metadata or icons, you can use
   * an array of simple string values. For example
   *
   * ```ts title="Simple string suggestions"
   * figma.parameters.on('input', ({ query, result }) => {
   *   result.setSuggestions(
   *     ["Armadillo", "Baboon", "Cacatua", "Dolphin"]
   *     .filter(s => s.includes(query)))
   * })
   * ```
   *
   * However the API also allows providing more information with each suggestion:
   * * The text to display to the user
   * * An icon (optional)
   * * Hidden metadata which is passed back to the plugin if the user chooses this suggestion (optional)
   *
   * Example
   * ```ts title="Suggestions with icons and data"
   * result.setSuggestions([
   *   { name: node1.name, data: node1.id, icon: node1Preview },
   *   { name: node2.name, data: node2.id, icon: node2Preview },
   *   ...
   * ])
   * ```
   *
   * The `name` property contains the text to display to the user in the autocomplete suggestions. This
   * property is required.
   *
   * The `data` property allows associating hidden metadata with a given autocomplete suggestion.
   * This data is passed back to the plugin as the parameter's value if the user chooses this option.
   * If no `data` property is provided, it defaults to the value of the `name` property. I.e. the value
   * of the parameter will be the string that was displayed to the user.
   *
   * An icon can be provided through a `icon` or `iconUrl` property. The `icon` property can contain
   * either a raster image in the form of a `Uint8Array`, or an SVG image in the form of a string. You
   * can alternatively use the `iconUrl` property to provide a URL to the image. Note that for this to
   * work the target server has to support CORS.
   */
  setSuggestions(
    suggestions: Array<
      | string
      | {
          name: string
          data?: any
          icon?: string | Uint8Array
          iconUrl?: string
        }
    >,
  ): void
  /**
   * Displays an error message to the user instead of a list of autocomplete suggestions. When this function
   * is called, the user is prevented from moving on to the next parameter without first changing the input
   * for the current parameter.
   *
   * This is useful to signal to the user that they have entered an invalid value and provide them
   * instruction for how to correct the input.
   *
   * You can also use this as a way to validate pre-conditions, like current selection, or some state of the
   * current document. To do this, in the 'input' event handler for the first parameter key, check the that
   * all pre-conditions are fulfilled and call `setError` with an appropriate error message if they are not,
   * unconditionally of what the current `query` value is.
   *
   * This function is *not* available on parameters with `allowFreeform` set. The purpose of `allowFreeform`
   * is to allow users to enter arbitrary values and so Figma doesn't guarantee that the plugin gets an
   * opportunity to handle an input event and call `setError` before the user moves on to the next parameter.
   *
   * If you want to generally allow freeform input, but still retain the ability to call `setError`, you can
   * remove `allowFreeform` and manually add a autocomplete entry containing the current `query` string. I.e.
   * make the first item in the array passed to `setSuggestions` simply be the string in `query`.
   *
   * For a full example of what this can look like, see the [Resizer sample plugin](https://github.com/figma/plugin-samples/blob/master/resizer/code.ts)
   */
  setError(message: string): void
  /**
   * Modify the default "Loading Suggestions..." message displayed until the plugin calls `setSuggestions`.
   * This can be useful if your plugin needs to load autocomplete messages from the network, or if you need
   * to perform lengthy calculations.
   *
   * You can call `setLoadingMessage` multiple times in order to provide an updated message.
   */
  setLoadingMessage(message: string): void
}
/**
 * @see https://developers.figma.com/docs/plugins/api/figma-parameters
 */
interface ParametersAPI {}
/**
 * @see https://developers.figma.com/docs/plugins/api/NodeChangeProperty
 */
type NodeChangeProperty =
  | 'pointCount'
  | 'name'
  | 'width'
  | 'height'
  | 'minWidth'
  | 'maxWidth'
  | 'minHeight'
  | 'maxHeight'
  | 'parent'
  | 'pluginData'
  | 'constraints'
  | 'locked'
  | 'visible'
  | 'opacity'
  | 'blendMode'
  | 'layoutGrids'
  | 'guides'
  | 'characters'
  | 'openTypeFeatures'
  | 'styledTextSegments'
  | 'vectorNetwork'
  | 'effects'
  | 'exportSettings'
  | 'arcData'
  | 'autoRename'
  | 'fontName'
  | 'innerRadius'
  | 'fontSize'
  | 'lineHeight'
  | 'leadingTrim'
  | 'paragraphIndent'
  | 'paragraphSpacing'
  | 'textWrapStyle'
  | 'listSpacing'
  | 'hangingPunctuation'
  | 'hangingList'
  | 'letterSpacing'
  | 'textAlignHorizontal'
  | 'textAlignVertical'
  | 'textCase'
  | 'textDecoration'
  | 'textAutoResize'
  | 'textTruncation'
  | 'maxLines'
  | 'fills'
  | 'topLeftRadius'
  | 'topRightRadius'
  | 'bottomLeftRadius'
  | 'bottomRightRadius'
  | 'constrainProportions'
  | 'strokes'
  | 'strokeWeight'
  | 'strokeAlign'
  | 'strokeCap'
  | 'strokeJoin'
  | 'strokeMiterLimit'
  | 'booleanOperation'
  | 'overflowDirection'
  | 'dashPattern'
  | 'backgrounds'
  | 'handleMirroring'
  | 'cornerRadius'
  | 'cornerSmoothing'
  | 'relativeTransform'
  | 'x'
  | 'y'
  | 'rotation'
  | 'isMask'
  | 'maskType'
  | 'clipsContent'
  | 'type'
  | 'overlayPositionType'
  | 'overlayBackgroundInteraction'
  | 'overlayBackground'
  | 'prototypeStartNode'
  | 'prototypeBackgrounds'
  | 'expanded'
  | 'fillStyleId'
  | 'strokeStyleId'
  | 'backgroundStyleId'
  | 'textStyleId'
  | 'effectStyleId'
  | 'gridStyleId'
  | 'description'
  | 'layoutMode'
  | 'layoutWrap'
  | 'paddingLeft'
  | 'paddingTop'
  | 'paddingRight'
  | 'paddingBottom'
  | 'itemSpacing'
  | 'counterAxisSpacing'
  | 'layoutAlign'
  | 'counterAxisSizingMode'
  | 'primaryAxisSizingMode'
  | 'primaryAxisAlignItems'
  | 'counterAxisAlignItems'
  | 'counterAxisAlignContent'
  | 'layoutGrow'
  | 'layoutPositioning'
  | 'itemReverseZIndex'
  | 'hyperlink'
  | 'mediaData'
  | 'stokeTopWeight'
  | 'strokeBottomWeight'
  | 'strokeLeftWeight'
  | 'strokeRightWeight'
  | 'reactions'
  | 'flowStartingPoints'
  | 'shapeType'
  | 'connectorStart'
  | 'connectorEnd'
  | 'connectorLineType'
  | 'connectorStartStrokeCap'
  | 'connectorEndStrokeCap'
  | 'codeLanguage'
  | 'widgetSyncedState'
  | 'componentPropertyDefinitions'
  | 'componentPropertyReferences'
  | 'componentProperties'
  | 'embedData'
  | 'linkUnfurlData'
  | 'text'
  | 'authorVisible'
  | 'authorName'
  | 'code'
  | 'textBackground'
  | 'gridAutoTracks'
  | 'gridItemsPositioning'
  | 'animationStyles'
  | 'animations'
  | 'manualKeyframeTracks'
type Transform = [[number, number, number], [number, number, number]]
interface Vector {
  readonly x: number
  readonly y: number
}
interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/RGB
 */
interface RGB {
  readonly r: number
  readonly g: number
  readonly b: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/RGB
 */
interface RGBA {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/FontName
 *
 * Describes a font used by a text node. For example, the default font is `{ family: "Inter", style: "Regular" }`.
 *
 * @remarks
 *
 * Reads always include `family` and `style`. For [variable fonts](https://fonts.google.com/knowledge/glossary/variable_fonts), they also include {@link FontName.variationSettings} with every axis the family defines. Static fonts omit `variationSettings`.
 *
 * To apply a font without naming a style, pass a {@link FontNameInput} to {@link PluginAPI.loadFontAsync}, {@link BaseNonResizableTextMixin.setRangeFontName}, or `fontName`. Use {@link PluginAPI.getFontFamilyVariationAxes} to discover the axis tags a family accepts.
 *
 * ```ts title="Setting a font with custom variation settings"
 * (async () => {
 *   const text = figma.createText()
 *   await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })
 *   text.fontName = {
 *     family: 'Inter',
 *     style: 'Regular',
 *     variationSettings: { wght: 600, slnt: -5 },
 *   }
 *   text.characters = 'Hello, variable fonts!'
 * })()
 * ```
 */
interface FontName {
  readonly family: string
  readonly style: string
  /**
   * The variable font axis values applied to the text, for example `{ wght: 600, slnt: -10 }`. Absent for a static font.
   *
   * Reading reports every axis the family defines. When setting, an omitted axis keeps the value of the named instance `style` refers to, so `{ wght: 900 }` on Inter Regular changes only the weight and leaves slant at Regular's default. Setting an axis the family does not define throws; use {@link PluginAPI.getFontFamilyVariationAxes} to discover the valid tags.
   */
  readonly variationSettings?: FontVariationSettings
}
/**
 * @see https://developers.figma.com/docs/plugins/api/FontName
 *
 * Variable font axis values keyed by [OpenType variation axis](https://fonts.google.com/knowledge/glossary/axis_in_variable_fonts) tag, mirroring the CSS `font-variation-settings` property. A tag is always four ASCII characters.
 */
interface FontVariationSettings {
  readonly [axis: string]: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/FontName
 *
 * A font to apply where `style` can be inferred rather than named. Unlike {@link FontName}, `style` may be omitted, in which case Figma resolves the named instance that most closely matches {@link FontName.variationSettings}. Reads always return a fully populated {@link FontName}.
 *
 * @remarks
 *
 * Accepted by {@link PluginAPI.loadFontAsync}, {@link BaseNonResizableTextMixin.setRangeFontName}, and when assigning {@link BaseNonResizableTextMixin.fontName}.
 *
 * Omitting `style` in {@link PluginAPI.loadFontAsync} loads every style of the family. Omitting `style` when setting a font lets Figma pick the named instance closest to `variationSettings` (for example `{ family: 'Inter', variationSettings: { wght: 900 } }` resolves to Inter Black).
 *
 * ```ts title="Inferring a named instance from variation settings"
 * (async () => {
 *   await figma.loadFontAsync({ family: 'Inter' })
 *   const text = figma.createText()
 *   text.characters = 'Hello'
 *   text.setRangeFontName(0, text.characters.length, {
 *     family: 'Inter',
 *     variationSettings: { wght: 900 },
 *   })
 *   // Read back: { family: 'Inter', style: 'Black', variationSettings: { wght: 900, slnt: 0 } }
 *   console.log(text.fontName)
 * })()
 * ```
 */
interface FontNameInput {
  readonly family: string
  readonly style?: string
  readonly variationSettings?: FontVariationSettings
}
type TextCase = 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE' | 'SMALL_CAPS' | 'SMALL_CAPS_FORCED'
type TextDecoration = 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH'
type TextDecorationStyle = 'SOLID' | 'WAVY' | 'DOTTED'
type FontStyle = 'REGULAR' | 'ITALIC'
type TextDecorationOffset =
  | {
      readonly value: number
      readonly unit: 'PIXELS' | 'PERCENT'
    }
  | {
      readonly unit: 'AUTO'
    }
type TextDecorationThickness =
  | {
      readonly value: number
      readonly unit: 'PIXELS' | 'PERCENT'
    }
  | {
      readonly unit: 'AUTO'
    }
type TextDecorationColor =
  | {
      readonly value: SolidPaint
    }
  | {
      readonly value: 'AUTO'
    }
type OpenTypeFeature =
  | 'PCAP'
  | 'C2PC'
  | 'CASE'
  | 'CPSP'
  | 'TITL'
  | 'UNIC'
  | 'ZERO'
  | 'SINF'
  | 'ORDN'
  | 'AFRC'
  | 'DNOM'
  | 'NUMR'
  | 'LIGA'
  | 'CLIG'
  | 'DLIG'
  | 'HLIG'
  | 'RLIG'
  | 'AALT'
  | 'CALT'
  | 'RCLT'
  | 'SALT'
  | 'RVRN'
  | 'VERT'
  | 'SWSH'
  | 'CSWH'
  | 'NALT'
  | 'CCMP'
  | 'STCH'
  | 'HIST'
  | 'SIZE'
  | 'ORNM'
  | 'ITAL'
  | 'RAND'
  | 'DTLS'
  | 'FLAC'
  | 'MGRK'
  | 'SSTY'
  | 'KERN'
  | 'FWID'
  | 'HWID'
  | 'HALT'
  | 'TWID'
  | 'QWID'
  | 'PWID'
  | 'JUST'
  | 'LFBD'
  | 'OPBD'
  | 'RTBD'
  | 'PALT'
  | 'PKNA'
  | 'LTRA'
  | 'LTRM'
  | 'RTLA'
  | 'RTLM'
  | 'ABRV'
  | 'ABVM'
  | 'ABVS'
  | 'VALT'
  | 'VHAL'
  | 'BLWF'
  | 'BLWM'
  | 'BLWS'
  | 'AKHN'
  | 'CJCT'
  | 'CFAR'
  | 'CPCT'
  | 'CURS'
  | 'DIST'
  | 'EXPT'
  | 'FALT'
  | 'FINA'
  | 'FIN2'
  | 'FIN3'
  | 'HALF'
  | 'HALN'
  | 'HKNA'
  | 'HNGL'
  | 'HOJO'
  | 'INIT'
  | 'ISOL'
  | 'JP78'
  | 'JP83'
  | 'JP90'
  | 'JP04'
  | 'LJMO'
  | 'LOCL'
  | 'MARK'
  | 'MEDI'
  | 'MED2'
  | 'MKMK'
  | 'NLCK'
  | 'NUKT'
  | 'PREF'
  | 'PRES'
  | 'VPAL'
  | 'PSTF'
  | 'PSTS'
  | 'RKRF'
  | 'RPHF'
  | 'RUBY'
  | 'SMPL'
  | 'TJMO'
  | 'TNAM'
  | 'TRAD'
  | 'VATU'
  | 'VJMO'
  | 'VKNA'
  | 'VKRN'
  | 'VRTR'
  | 'VRT2'
  | 'SS01'
  | 'SS02'
  | 'SS03'
  | 'SS04'
  | 'SS05'
  | 'SS06'
  | 'SS07'
  | 'SS08'
  | 'SS09'
  | 'SS10'
  | 'SS11'
  | 'SS12'
  | 'SS13'
  | 'SS14'
  | 'SS15'
  | 'SS16'
  | 'SS17'
  | 'SS18'
  | 'SS19'
  | 'SS20'
  | 'CV01'
  | 'CV02'
  | 'CV03'
  | 'CV04'
  | 'CV05'
  | 'CV06'
  | 'CV07'
  | 'CV08'
  | 'CV09'
  | 'CV10'
  | 'CV11'
  | 'CV12'
  | 'CV13'
  | 'CV14'
  | 'CV15'
  | 'CV16'
  | 'CV17'
  | 'CV18'
  | 'CV19'
  | 'CV20'
  | 'CV21'
  | 'CV22'
  | 'CV23'
  | 'CV24'
  | 'CV25'
  | 'CV26'
  | 'CV27'
  | 'CV28'
  | 'CV29'
  | 'CV30'
  | 'CV31'
  | 'CV32'
  | 'CV33'
  | 'CV34'
  | 'CV35'
  | 'CV36'
  | 'CV37'
  | 'CV38'
  | 'CV39'
  | 'CV40'
  | 'CV41'
  | 'CV42'
  | 'CV43'
  | 'CV44'
  | 'CV45'
  | 'CV46'
  | 'CV47'
  | 'CV48'
  | 'CV49'
  | 'CV50'
  | 'CV51'
  | 'CV52'
  | 'CV53'
  | 'CV54'
  | 'CV55'
  | 'CV56'
  | 'CV57'
  | 'CV58'
  | 'CV59'
  | 'CV60'
  | 'CV61'
  | 'CV62'
  | 'CV63'
  | 'CV64'
  | 'CV65'
  | 'CV66'
  | 'CV67'
  | 'CV68'
  | 'CV69'
  | 'CV70'
  | 'CV71'
  | 'CV72'
  | 'CV73'
  | 'CV74'
  | 'CV75'
  | 'CV76'
  | 'CV77'
  | 'CV78'
  | 'CV79'
  | 'CV80'
  | 'CV81'
  | 'CV82'
  | 'CV83'
  | 'CV84'
  | 'CV85'
  | 'CV86'
  | 'CV87'
  | 'CV88'
  | 'CV89'
  | 'CV90'
  | 'CV91'
  | 'CV92'
  | 'CV93'
  | 'CV94'
  | 'CV95'
  | 'CV96'
  | 'CV97'
  | 'CV98'
  | 'CV99'
interface ArcData {
  readonly startingAngle: number
  readonly endingAngle: number
  readonly innerRadius: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Effect
 */
interface DropShadowEffect {
  /**
   * The string literal representing the type of effect this is. Always check the `type` before reading other properties.
   */
  readonly type: 'DROP_SHADOW'
  /**
   * The color of the shadow, including its opacity.
   */
  readonly color: RGBA
  /**
   * The offset of the shadow relative to its object. Use this property to simulate the direction of the light.
   */
  readonly offset: Vector
  /**
   * The blur radius of the shadow. Must be >= 0. A lower radius creates a sharper shadow.
   */
  readonly radius: number
  /**
   * The distance by which to expand (or contract) the shadow. For drop shadows, a positive spread value creates a shadow larger than the node, whereas a negative value creates a shadow smaller than the node. For inner shadows, a positive `spread` value contracts the shadow. `spread` values are only accepted on rectangles and ellipses, or on frames, components, and instances with visible fill paints and `clipsContent` enabled. When left unspecified, the default value is 0.
   */
  readonly spread?: number
  /**
   * Whether this shadow is visible.
   */
  readonly visible: boolean
  /**
   * Determines how the color of this shadow blends with the colors underneath it. The typical default value is "NORMAL".
   */
  readonly blendMode: BlendMode
  /**
   * Whether the drop shadow should show behind translucent or transparent pixels within the node's geometry. Defaults to `false`.
   */
  readonly showShadowBehindNode?: boolean
  /**
   * The variables bound to a particular field on this shadow effect
   */
  readonly boundVariables?: {
    [field in VariableBindableEffectField]?: VariableAlias
  }
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Effect
 */
interface InnerShadowEffect {
  /**
   * The string literal representing the type of effect this is. Always check the `type` before reading other properties.
   */
  readonly type: 'INNER_SHADOW'
  /**
   * The color of the shadow, including its opacity.
   */
  readonly color: RGBA
  /**
   * The offset of the shadow relative to its object. Use this property to simulate the direction of the light.
   */
  readonly offset: Vector
  /**
   * The blur radius of the shadow. Must be >= 0. A lower radius creates a sharper shadow.
   */
  readonly radius: number
  /**
   * The distance by which to expand (or contract) the shadow. For drop shadows, a positive spread value creates a shadow larger than the node, whereas a negative value creates a shadow smaller than the node. For inner shadows, a positive `spread` value contracts the shadow. `spread` values are only accepted on rectangles and ellipses, or on frames, components, and instances with visible fill paints and `clipsContent` enabled. When left unspecified, the default value is 0.
   */
  readonly spread?: number
  /**
   * Whether this shadow is visible.
   */
  readonly visible: boolean
  /**
   * Determines how the color of this shadow blends with the colors underneath it. The typical default value is "NORMAL".
   */
  readonly blendMode: BlendMode
  /**
   * The variables bound to a particular field on this shadow effect
   */
  readonly boundVariables?: {
    [field in VariableBindableEffectField]?: VariableAlias
  }
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Effect
 */
interface BlurEffectBase {
  /**
   * The string literal representing the type of effect this is. Always check the `type` before reading other properties.
   */
  readonly type: 'LAYER_BLUR' | 'BACKGROUND_BLUR'
  /**
   * The radius of the blur. Must be >= 0. A lower radius creates a sharper blur. For progressive blurs, this is the end radius of the blur.
   */
  readonly radius: number
  /**
   * Whether this blur is visible.
   */
  readonly visible: boolean
  /**
   * The variable bound to the radius field on this blur effect
   * */
  readonly boundVariables?: {
    ['radius']?: VariableAlias
  }
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Effect
 */
interface BlurEffectNormal extends BlurEffectBase {
  /**
   * The string literal representing the blur type. Always check the `blurType` before reading other properties.
   */
  readonly blurType: 'NORMAL'
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Effect
 */
interface BlurEffectProgressive extends BlurEffectBase {
  /**
   * The string literal representing the blur type. Always check the `blurType` before reading other properties.
   */
  readonly blurType: 'PROGRESSIVE'
  /**
   * Radius of the starting point of the progressive blur.
   */
  readonly startRadius: number
  /**
   * Position of the starting point of the progressive blur. The position is in normalized object space (top left corner of the bounding box of the object is (0, 0) and the bottom right is (1,1)).
   */
  readonly startOffset: Vector
  /**
   * Position of the ending point of the progressive blur. The position is in normalized object space (top left corner of the bounding box of the object is (0, 0) and the bottom right is (1,1)).
   */
  readonly endOffset: Vector
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Effect
 */
type BlurEffect = BlurEffectNormal | BlurEffectProgressive
/**
 * @see https://developers.figma.com/docs/plugins/api/Effect
 */
interface NoiseEffectBase {
  /**
   * The string literal representing the type of effect this is. Always check the `type` before reading other properties.
   */
  readonly type: 'NOISE'
  /**
   * The color of the noise effect.
   */
  readonly color: RGBA
  /**
   * Whether the noise effect is visible.
   */
  readonly visible: boolean
  /**
   * The blend mode of the noise.
   */
  readonly blendMode: BlendMode
  /**
   * The size of the noise effect. Applies to both axes. When `noiseSizeVector` is set, this value
   * is always equal to `noiseSizeVector.x`.
   */
  readonly noiseSize: number
  /**
   * The size of the noise effect along the x and y axes. When omitted, `noiseSize` applies to both
   * axes. When provided, its `x` component must equal `noiseSize` or an error is thrown on write.
   */
  readonly noiseSizeVector?: Vector
  /**
   * The density of the noise effect.
   */
  readonly density: number
  /**
   * Noise effects currently do not support binding variables.
   */
  readonly boundVariables?: {}
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Effect
 */
interface NoiseEffectMonotone extends NoiseEffectBase {
  /**
   * The string literal representing the type of noise this is. Always check the `noiseType` before reading
   * other properties.
   */
  readonly noiseType: 'MONOTONE'
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Effect
 */
interface NoiseEffectDuotone extends NoiseEffectBase {
  /**
   * The string literal representing the type of noise this is. Always check the `noiseType` before reading
   * other properties.
   */
  readonly noiseType: 'DUOTONE'
  /**
   * The secondary color of the noise effect.
   */
  readonly secondaryColor: RGBA
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Effect
 */
interface NoiseEffectMultitone extends NoiseEffectBase {
  /**
   * The string literal representing the type of noise this is. Always check the `noiseType` before reading
   * other properties.
   */
  readonly noiseType: 'MULTITONE'
  /**
   * The opacity of the noise effect.
   */
  readonly opacity: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Effect
 */
type NoiseEffect = NoiseEffectMonotone | NoiseEffectDuotone | NoiseEffectMultitone
/**
 * @see https://developers.figma.com/docs/plugins/api/Effect
 */
interface TextureEffect {
  /**
   * The string literal representing the type of effect this is. Always check the `type` before reading other properties.
   */
  readonly type: 'TEXTURE'
  /**
   * Whether the texture effect is visible.
   */
  readonly visible: boolean
  /**
   * The size of the texture effect. Applies to both axes. When `noiseSizeVector` is set, this value
   * is always equal to `noiseSizeVector.x`.
   */
  readonly noiseSize: number
  /**
   * The size of the texture effect along the x and y axes. When omitted, `noiseSize` applies to
   * both axes. When provided, its `x` component must equal `noiseSize` or an error is thrown on
   * write.
   */
  readonly noiseSizeVector?: Vector
  /**
   * The radius of the texture effect.
   */
  readonly radius: number
  /**
   * Whether the texture is clipped to the shape.
   */
  readonly clipToShape: boolean
  /**
   * Texture effects currently do not support binding variables.
   */
  readonly boundVariables?: {}
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Effect
 */
interface GlassEffect {
  /**
   * The string literal representing the type of effect this is. Always check the `type` before reading other properties.
   */
  readonly type: 'GLASS'
  /**
   * Whether this glass effect is visible.
   */
  readonly visible: boolean
  /**
   * The intensity of specular highlights. Must be between 0 and 1. Higher values create brighter highlights.
   */
  readonly lightIntensity: number
  /**
   * The angle of the specular light in degrees. Controls the direction of highlights on the glass surface.
   */
  readonly lightAngle: number
  /**
   * The intensity of the refraction distortion. Must be between 0 and 1. Higher values create more distortion.
   */
  readonly refraction: number
  /**
   * The depth of the refraction effect. Must be >= 1. Higher values create deeper glass appearance.
   */
  readonly depth: number
  /**
   * The amount of chromatic aberration (color separation). Must be between 0 and 1. Higher values create more rainbow-like distortion at edges.
   */
  readonly dispersion: number
  /**
   * The radius of frost on the glass effect.
   */
  readonly radius: number
  /**
   * Glass effects currently do not support binding variables.
   */
  readonly boundVariables?: {}
}
/**
 * A shader applied to a node's `effects`.
 *
 * @see https://developers.figma.com/docs/plugins/api/Effect
 */
interface ShaderEffect {
  /**
   * The string literal "SHADER" representing the type of effect this is. Always check the `type` before reading other properties.
   */
  readonly type: 'SHADER'
  /**
   * Whether this shader effect is visible.
   */
  readonly visible: boolean
  /**
   * The id of the shader, as returned by {@link PluginAPI.listAvailableShaders} and {@link PluginAPI.importShaderById}. The shader must be imported with {@link PluginAPI.importShaderById} before it can be applied.
   */
  readonly id: string
  /**
   * The read/write map of property assignments, keyed by property-definition id (the keys of {@link Shader.propertyDefinitions}, not property names). On reads, this is populated with the effect's current assignments, including author-defined defaults, so a plugin can discover the available ids after the shader is applied.
   */
  readonly properties?: {
    [defId: string]: ShaderPropertyValue
  }
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Effect
 */
type Effect =
  | DropShadowEffect
  | InnerShadowEffect
  | BlurEffect
  | NoiseEffect
  | TextureEffect
  | GlassEffect
  | ShaderEffect
/**
 * @see https://developers.figma.com/docs/plugins/api/Constraints
 */
type ConstraintType = 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE'
/**
 * @see https://developers.figma.com/docs/plugins/api/Constraints
 */
interface Constraints {
  readonly horizontal: ConstraintType
  readonly vertical: ConstraintType
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Paint
 */
interface ColorStop {
  /**
   * The position of the stop along the gradient between 0 and 1
   */
  readonly position: number
  /**
   * The color value of the gradient stop
   */
  readonly color: RGBA
  /**
   * The variable bound to a gradient stop
   */
  readonly boundVariables?: {
    [field in VariableBindableColorStopField]?: VariableAlias
  }
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Paint
 */
interface ImageFilters {
  readonly exposure?: number
  readonly contrast?: number
  readonly saturation?: number
  readonly temperature?: number
  readonly tint?: number
  readonly highlights?: number
  readonly shadows?: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Paint
 */
interface SolidPaint {
  /**
   * The string literal "SOLID" representing the type of paint this is. Always check the `type` before reading other properties.
   */
  readonly type: 'SOLID'
  /**
   * The color of the paint. This does not have a alpha property, use `opacity` instead.
   *
   * You can use the {@link UtilAPI.solidPaint} utility function to set both `color` and `opacity` using CSS color strings:
   *
   * ```
   * // Create a new SolidPaint
   * const paint = figma.util.solidPaint('#FF00FF88')
   *
   * // Modify an existing SolidPaint
   * if (node.fills[0].type === 'SOLID') {
   *   const updated = figma.util.solidPaint('#FF00FF88', node.fills[0])
   * }
   * ```
   */
  readonly color: RGB
  /**
   * Whether the paint is visible. Defaults to true.
   */
  readonly visible?: boolean
  /**
   * The opacity of the paint. Must be a value between 0 and 1. Defaults to 1.
   *
   * You can use the {@link UtilAPI.solidPaint} utility function to set both `color` and `opacity` using CSS color strings:
   *
   * ```
   * // Create a new SolidPaint
   * const paint = figma.util.solidPaint('#FF00FF88')
   *
   * // Modify an existing SolidPaint
   * if (node.fills[0].type === 'SOLID') {
   *   const updated = figma.util.solidPaint('#FF00FF88', node.fills[0])
   * }
   * ```
   */
  readonly opacity?: number
  /**
   * Determines how the color of this paint blends with the colors underneath it. Defaults to "NORMAL".
   */
  readonly blendMode?: BlendMode
  /**
   * The variables bound to a particular field on this paint
   */
  readonly boundVariables?: {
    [field in VariableBindablePaintField]?: VariableAlias
  }
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Paint
 */
interface GradientPaint {
  /**
   * The string literal representing the type of paint this is. Always check the `type` before reading other properties.
   */
  readonly type: 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND'
  /**
   * The positioning of the gradient within the layer.
   */
  readonly gradientTransform: Transform
  /**
   * Array of colors and their position within the gradient.
   */
  readonly gradientStops: ReadonlyArray<ColorStop>
  readonly visible?: boolean
  readonly opacity?: number
  readonly blendMode?: BlendMode
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Paint
 */
interface ImagePaint {
  /**
   * The string literal "IMAGE" representing the type of paint this is. Always check the `type` before reading other properties.
   */
  readonly type: 'IMAGE'
  /**
   * How the image is positioned and scaled within the layer. Same as in the properties panel.
   */
  readonly scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE'
  /**
   * The hash (id) of the image used for this paint, if any. Use {@link PluginAPI.getImageByHash} to get the corresponding image object.
   */
  readonly imageHash: string | null
  /**
   * Applicable only for `scaleMode == "CROP"`. Determines how the image is positioned (thus, cropped) within the layer.
   */
  readonly imageTransform?: Transform
  /**
   * Applicable only for `scaleMode == "TILE"` (automatic for other modes). Determines the scaling (thus, repetition) of the image within the layer.
   */
  readonly scalingFactor?: number
  /**
   * Applicable only for `scaleMode == "TILE" | "FILL" | "FIT"` (automatic for `scaleMode == "CROP"`). Determines the rotation of the image within the layer. Must be in increments of +90.
   */
  readonly rotation?: number
  /**
   * The values for the image filter slides, equivalent to those in the paint picker. All values default to 0.0 and have range -1.0 to +1.0.
   */
  readonly filters?: ImageFilters
  readonly visible?: boolean
  readonly opacity?: number
  readonly blendMode?: BlendMode
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Paint
 */
interface VideoPaint {
  /**
   * The string literal "VIDEO" representing the type of paint this is. Always check the `type` before reading other properties.
   */
  readonly type: 'VIDEO'
  /**
   * How the image is positioned and scaled within the layer. Same as in the properties panel.
   */
  readonly scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE'
  /**
   * The hash (id) of the video used for this paint, if any.
   */
  readonly videoHash: string | null
  /**
   * Applicable only for `scaleMode == "CROP"`. Determines how the video is positioned (thus, cropped) within the layer.
   */
  readonly videoTransform?: Transform
  /**
   * Applicable only for `scaleMode == "TILE"` (automatic for other modes). Determines the scaling (thus, repetition) of the video within the layer.
   */
  readonly scalingFactor?: number
  /**
   * Applicable only for `scaleMode == "TILE" | "FILL" | "FIT"` (automatic for `scaleMode == "CROP"`). Determines the rotation of the video within the layer. Must be in increments of +90.
   */
  readonly rotation?: number
  /**
   * The values for the video filter slides, equivalent to those in the paint picker. All values default to 0.0 and have range -1.0 to +1.0.
   */
  readonly filters?: ImageFilters
  readonly visible?: boolean
  readonly opacity?: number
  readonly blendMode?: BlendMode
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Paint
 */
interface PatternPaint {
  /**
   * The string literal representing the type of paint this is. Always check the `type` before reading other properties.
   */
  readonly type: 'PATTERN'
  /**
   * The node id of the source node for the pattern
   */
  readonly sourceNodeId: string
  /**
   * The way the pattern is tiled
   */
  readonly tileType: 'RECTANGULAR' | 'HORIZONTAL_HEXAGONAL' | 'VERTICAL_HEXAGONAL'
  /**
   * The scaling factor of the pattern
   */
  readonly scalingFactor: number
  /**
   * The spacing of the pattern
   */
  readonly spacing: Vector
  /**
   * The horizontal alignment of the pattern
   */
  readonly horizontalAlignment: 'START' | 'CENTER' | 'END'
  readonly visible?: boolean
  readonly opacity?: number
  readonly blendMode?: BlendMode
}
/**
 * A shader applied to a node's `fills` or `strokes`.
 *
 * @see https://developers.figma.com/docs/plugins/api/Paint
 */
interface ShaderPaint {
  /**
   * The string literal "SHADER" representing the type of paint this is. Always check the `type` before reading other properties.
   */
  readonly type: 'SHADER'
  /**
   * The id of the shader, as returned by {@link PluginAPI.listAvailableShaders} and {@link PluginAPI.importShaderById}. The shader must be imported with {@link PluginAPI.importShaderById} before it can be applied.
   */
  readonly id: string
  /**
   * The read/write map of property assignments, keyed by property-definition id (the keys of {@link Shader.propertyDefinitions}, not property names). On reads, this is populated with the paint's current assignments, including author-defined defaults, so a plugin can discover the available ids after the shader is applied.
   */
  readonly properties?: {
    [defId: string]: ShaderPropertyValue
  }
  readonly visible?: boolean
  readonly opacity?: number
  readonly blendMode?: BlendMode
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Paint
 */
type Paint = SolidPaint | GradientPaint | ImagePaint | VideoPaint | PatternPaint | ShaderPaint
/**
 * A single value assignable to a shader property, read from or written to the `properties` map of a {@link ShaderEffect} or {@link ShaderPaint}. The shape that's valid for a given property depends on that property's declared `type` in its {@link ShaderPropertyDefinition}. A value can always be a variable binding via the standard `VariableAlias` form.
 *
 * @see https://developers.figma.com/docs/plugins/api/Shader
 */
type ShaderPropertyValue =
  | boolean
  | string
  | number
  | RGB
  | RGBA
  | {
      x: number
      y: number
    }
  | {
      x: number
      y: number
      x2: number
      y2: number
    }
  | {
      x: number
      y: number
      radius: number
    }
  | {
      x: number
      y: number
      radius: number
      angle: number
    }
  | {
      x: number
      y: number
      color: RGB | RGBA | VariableAlias
    }
  | {
      stops: {
        position: number
        color: RGB | RGBA | VariableAlias
      }[]
    }
  | VariableAlias
/**
 * A read-only description of one property declared by a shader. Surfaced via the `propertyDefinitions` field of a {@link Shader}, keyed by property-definition id.
 *
 * @see https://developers.figma.com/docs/plugins/api/Shader
 */
interface ShaderPropertyDefinition {
  /**
   * The author-defined name of the property.
   */
  readonly name: string
  /**
   * The declared type of the property. This determines which shape of {@link ShaderPropertyValue} is valid for it. `POINT` corresponds to the editor's "point" property type.
   */
  readonly type:
    | 'BOOLEAN'
    | 'TEXT'
    | 'NUMBER'
    | 'IMAGE'
    | 'INSTANCE_SWAP'
    | 'SLOT'
    | 'COLOR'
    | 'POINT'
    | 'LINE'
    | 'CIRCLE'
    | 'CIRCLE_POINT'
    | 'COLOR_POINT'
    | 'GRADIENT'
  /**
   * The author-defined default value for the property, if any.
   */
  readonly defaultValue?: ShaderPropertyValue
  /**
   * The author-defined description of the property, if any.
   */
  readonly description?: string
}
/**
 * A shader available to the current file, as returned by {@link PluginAPI.listAvailableShaders} and {@link PluginAPI.importShaderById}.
 *
 * @see https://developers.figma.com/docs/plugins/api/Shader
 */
interface Shader {
  /**
   * A stable identifier for the shader. The same value round-trips through {@link PluginAPI.importShaderById} and the `id` field of a {@link ShaderEffect} / {@link ShaderPaint} when applying the shader.
   */
  readonly id: string
  /**
   * The name of the shader.
   */
  readonly name: string
  /**
   * Whether the shader applies as an effect (`node.effects`) or as a fill (`node.fills` / `node.strokes`).
   */
  readonly type: 'effect' | 'fill'
  /**
   * Whether the shader has been imported into the file yet. When `false`, call {@link PluginAPI.importShaderById} with this shader's `id` before applying it.
   */
  readonly imported: boolean
  /**
   * The shader's declared properties, keyed by property-definition id. Populated for imported shaders; may be absent until the shader is imported.
   */
  readonly propertyDefinitions?: {
    [defId: string]: ShaderPropertyDefinition
  }
}
interface Guide {
  readonly axis: 'X' | 'Y'
  readonly offset: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/LayoutGrid
 */
interface RowsColsLayoutGrid {
  /**
   * The string literal representing the layout grid this is. Always check the `pattern` before reading other properties.
   */
  readonly pattern: 'ROWS' | 'COLUMNS'
  /**
   * How the layout grid is aligned. "MIN" corresponds to "Left" or "Top" in the UI depending on the orientation of the layout grid. "MAX" corresponds to "Right" or "Bottom".
   */
  readonly alignment: 'MIN' | 'MAX' | 'STRETCH' | 'CENTER'
  /**
   * The distance between the sections of the grid.
   */
  readonly gutterSize: number
  /**
   * The number of sections. This can be set to the value `Infinity`, which corresponds to "Auto" in the UI.
   */
  readonly count: number
  /**
   * The size of a section. This is ignored when `alignment == "STRETCH"` since the size is set automatically.
   */
  readonly sectionSize?: number
  /**
   * The distance between the layout grid sections and the edges of the frame. This is ignored when `alignment == "CENTER"` since the size is set automatically.
   */
  readonly offset?: number
  /**
   * Whether the layout grid is visible. Defaults to true.
   */
  readonly visible?: boolean
  /**
   * The color of the layout grid.
   */
  readonly color?: RGBA
  /**
   * The variables bound to a particular field on this shadow effect
   */
  readonly boundVariables?: {
    [field in VariableBindableLayoutGridField]?: VariableAlias
  }
}
/**
 * @see https://developers.figma.com/docs/plugins/api/LayoutGrid
 */
interface GridLayoutGrid {
  /**
   * The string literal "GRID" representing the layout grid this is. Always check the `pattern` before reading other properties.
   */
  readonly pattern: 'GRID'
  /**
   * The size of individual grid cells.
   */
  readonly sectionSize: number
  readonly visible?: boolean
  readonly color?: RGBA
  readonly boundVariables?: {
    ['sectionSize']?: VariableAlias
  }
}
/**
 * @see https://developers.figma.com/docs/plugins/api/LayoutGrid
 */
type LayoutGrid = RowsColsLayoutGrid | GridLayoutGrid
/**
 * @see https://developers.figma.com/docs/plugins/api/ExportSettings
 */
interface ExportSettingsConstraints {
  readonly type: 'SCALE' | 'WIDTH' | 'HEIGHT'
  readonly value: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/ExportSettings
 */
interface ExportSettingsImage {
  /**
   * The string literal representing the export format.
   * When reading {@link ExportMixin.exportSettings }, always check the `format` before reading other properties.
   */
  readonly format: 'JPG' | 'PNG'
  /**
   * Whether only the contents of the node are exported, or any overlapping layer in the same area. Defaults to `true`.
   */
  readonly contentsOnly?: boolean
  /**
   * Use the full dimensions of the node regardless of whether or not it is cropped or the space around it is empty. Use this to export text nodes without cropping. Defaults to `false`.
   */
  readonly useAbsoluteBounds?: boolean
  /**
   * Suffix appended to the file name when exporting. Defaults to empty string.
   */
  readonly suffix?: string
  /**
   * Constraint on the image size when exporting.
   *
   * ```ts
   * interface ExportSettingsConstraints {
   *   type: "SCALE" | "WIDTH" | "HEIGHT"
   *   value: number
   * }
   * ```
   *
   * Defaults to 100% of image size `{ type: "SCALE", value: 1 }`.
   *
   *
   * - `"SCALE"`: The size of the exported image is proportional to the size of the exported layer in Figma. A `value` of 1 means the export is 100% of the layer size.
   * - `"WIDTH"`: The exported image is scaled to have a fixed width of `value`.
   * - `"HEIGHT"`: The exported image is scaled to have a fixed height of `value`.
   */
  readonly constraint?: ExportSettingsConstraints
  /**
   * Color profile of the export.
   *
   * Defaults to `'DOCUMENT'`
   *
   *
   * - `"DOCUMENT"`: Use the color profile of {@link DocumentNode.documentColorProfile}.
   * - `"SRGB"`: Use sRGB colors. This was the previous behavior of Figma before [color management](https://help.figma.com/hc/en-us/articles/360039825114).
   * - `"DISPLAY_P3_V4"`: Use Display P3 colors.
   */
  readonly colorProfile?: 'DOCUMENT' | 'SRGB' | 'DISPLAY_P3_V4'
}
interface ExportSettingsSVGBase {
  readonly contentsOnly?: boolean
  readonly useAbsoluteBounds?: boolean
  readonly suffix?: string
  /**
   * Whether text elements are rendered as outlines (vector paths) or as `<text>` elements in SVGs. Defaults to `true`.
   *
   * Rendering text elements as outlines guarantees that the text looks exactly the same in the SVG as it does in the browser/inside Figma.
   *
   * Exporting as `<text>` allows text to be selectable inside SVGs and generally makes the SVG easier to read. However, this relies on the browser’s rendering engine which can vary between browsers and/or operating systems. As such, visual accuracy is not guaranteed as the result could look different than in Figma.
   */
  readonly svgOutlineText?: boolean
  /**
   * Whether to include layer names as ID attributes in the SVG. This can be useful as a way to reference particular elements, but increases the size of the SVG. SVG features that require IDs to function, such as masks and gradients, will always have IDs. Defaults to `false`.
   */
  readonly svgIdAttribute?: boolean
  /**
   * Whether to export inside and outside strokes as an approximation of the original to simplify the output. Otherwise, it uses a more precise but more bloated masking technique. This is needed because SVGs only support center strokes. Defaults to `true`.
   */
  readonly svgSimplifyStroke?: boolean
  readonly colorProfile?: 'DOCUMENT' | 'SRGB' | 'DISPLAY_P3_V4'
}
/**
 * @see https://developers.figma.com/docs/plugins/api/ExportSettings
 */
interface ExportSettingsSVG extends ExportSettingsSVGBase {
  /**
   * The string literal "SVG" representing the export format.
   * When reading {@link ExportMixin.exportSettings }, always check the `format` before reading other properties.
   */
  readonly format: 'SVG'
}
/**
 * @see https://developers.figma.com/docs/plugins/api/ExportSettings
 */
interface ExportSettingsSVGString extends ExportSettingsSVGBase {
  /**
   * The string literal "SVG_STRING" representing the export format.
   */
  readonly format: 'SVG_STRING'
}
/**
 * @see https://developers.figma.com/docs/plugins/api/ExportSettings
 */
interface ExportSettingsPDF {
  /**
   * The string literal "PDF" representing the export format.
   *  When reading {@link ExportMixin.exportSettings }, always check the `format` before reading other properties.
   */
  readonly format: 'PDF'
  readonly contentsOnly?: boolean
  readonly useAbsoluteBounds?: boolean
  readonly suffix?: string
  readonly colorProfile?: 'DOCUMENT' | 'SRGB' | 'DISPLAY_P3_V4'
}
/**
 * @see https://developers.figma.com/docs/plugins/api/ExportSettings
 */
interface ExportSettingsREST {
  /**
   * Returns the equivalent REST API response of hitting the endpoint `https://api.figma.com/v1/files/:file_key/nodes?ids=:id`.
   *
   * This is useful if you have existing code that uses the REST API that you would like to have work inside a plugin as well. It can also be significantly more perfomant if you need to serialize large groups of nodes and their children.
   * Here is an example that logs the name of every child in a node using the REST API response:
   *
   * ```ts title="Using the JSON_REST_V1 format"
   * function visitChildren(child: Object) {
   *   console.log(child.name);
   *   if (child.children) {
   *     child.children.forEach(visitChildren);
   *   }
   * }
   *
   * const response = await figma.currentPage.selection[0].exportAsync({
   *   format: "JSON_REST_V1",
   * });
   *
   * visitChildren(response.document);
   * ```
   *
   * For more information on the shape of the output of the 'JSON_REST_V1' format, see the [files](https://developers.figma.com/docs/rest-api/files) documentation.
   */
  readonly format: 'JSON_REST_V1'
}
/**
 * @see https://developers.figma.com/docs/plugins/api/ExportSettings
 */
type ExportSettings = ExportSettingsImage | ExportSettingsSVG | ExportSettingsPDF
/**
 * @see https://developers.figma.com/docs/plugins/api/properties/VectorPath-windingrule
 */
type WindingRule = 'NONZERO' | 'EVENODD'
/**
 * @see https://developers.figma.com/docs/plugins/api/VectorNetwork
 */
interface VectorVertex {
  /**
   * x position of the vertex relative to the position of the node.
   */
  readonly x: number
  /**
   * y position of the vertex relative to the position of the node.
   */
  readonly y: number
  /**
   * Appearance of the end of a stroke. Defaults to the node's property if left unspecified.
   */
  readonly strokeCap?: StrokeCap
  /**
   * Appearance of the join between two segments. Defaults to the node's property if left unspecified.
   */
  readonly strokeJoin?: StrokeJoin
  /**
   * Corner radius at this vertex. Defaults to the node's property if left unspecified.
   */
  readonly cornerRadius?: number
  /**
   * How two curve handles behave relative to one another. Defaults to the node's property if left unspecified.
   */
  readonly handleMirroring?: HandleMirroring
}
/**
 * @see https://developers.figma.com/docs/plugins/api/VectorNetwork
 */
interface VectorSegment {
  /**
   * The index of the vertex that starts this segment.
   */
  readonly start: number
  /**
   * The index of the vertex that ends this segment.
   */
  readonly end: number
  /**
   * The tangent on the start side of this segment. Defaults to `{ x: 0, y: 0 }`
   */
  readonly tangentStart?: Vector
  /**
   * The tangent on the end side of this segment. Defaults to `{ x: 0, y: 0 }`
   */
  readonly tangentEnd?: Vector
}
/**
 * @see https://developers.figma.com/docs/plugins/api/VectorNetwork
 */
interface VectorRegion {
  /**
   * Winding rule for this region.
   */
  readonly windingRule: WindingRule
  /**
   * List of loops, each of which is a list of indices of `VectorSegment`(s)
   */
  readonly loops: ReadonlyArray<ReadonlyArray<number>>
  /**
   * Array of fill paints used on this region.
   */
  readonly fills?: ReadonlyArray<Paint>
  /**
   * Style key of fill style applied to this region, if any.
   */
  readonly fillStyleId?: string
}
/**
 * @see https://developers.figma.com/docs/plugins/api/VectorNetwork
 */
interface VectorNetwork {
  /**
   * Vertices are points in the graph.
   */
  readonly vertices: ReadonlyArray<VectorVertex>
  /**
   * Segments connect vertices.
   */
  readonly segments: ReadonlyArray<VectorSegment>
  /**
   * Regions are defined by segments and specify that an area is to be filled. Defaults to [].
   */
  readonly regions?: ReadonlyArray<VectorRegion>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/VectorPath
 */
interface VectorPath {
  /**
   * The winding rule for the path (same as in SVGs). This determines whether a given point in space is inside or outside the path.
   *
   * @remarks
   *
   * ```ts
   * type WindingRule = "NONZERO" | "EVENODD"
   * ```
   *
   * Winding rules work off a concept called the winding number, which tells you for a given point how many times the path winds around that point. This is described in much more detail [here](https://oreillymedia.github.io/Using_SVG/extras/ch06-fill-rule.html). This field can have three possible values:
   * - `"NONZERO"`: The point is considered inside the path if the winding number is NONZERO.
   * - `"EVENODD"`: The point is considered inside the path if the winding number is odd.
   * - `"NONE"`: An open path won’t have a fill.
   */
  readonly windingRule: WindingRule | 'NONE'
  /**
   * A series of path commands that encodes how to draw the path.
   *
   * @remarks
   *
   * Figma supports a subset of the SVG path format. Path commands must be joined into a single string in order separated by a single space. Here are the path commands we support:
   * - `M x y`: The absolute "move to" command.
   * - `L x y`: The absolute "line to" command.
   * - `Q x0 y0 x y`: The absolute "quadratic spline to" command. _Note_ that while Figma supports this as input, we will never generate this ourselves. All quadratic splines are converted to cubic splines internally.
   * - `C x0 y0 x1 y1 x y`: The absolute "cubic spline to" command.
   * - `Z`: The "close path" command.
   */
  readonly data: string
}
/**
 * @see https://developers.figma.com/docs/plugins/api/VectorPath
 */
type VectorPaths = ReadonlyArray<VectorPath>
interface LetterSpacing {
  readonly value: number
  readonly unit: 'PIXELS' | 'PERCENT'
}
type LineHeight =
  | {
      readonly value: number
      readonly unit: 'PIXELS' | 'PERCENT'
    }
  | {
      readonly unit: 'AUTO'
    }
type LeadingTrim = 'CAP_HEIGHT' | 'NONE'
/**
 * @see https://developers.figma.com/docs/plugins/api/TextWrapStyle
 */
type TextWrapStyle = 'AUTO' | 'BALANCE' | 'PRETTY'
type HyperlinkTarget = {
  type: 'URL' | 'NODE'
  value: string
}
/**
 * @see https://developers.figma.com/docs/plugins/api/TextListOptions
 */
type TextListOptions = {
  type: 'ORDERED' | 'UNORDERED' | 'NONE'
}
type BlendMode =
  | 'PASS_THROUGH'
  | 'NORMAL'
  | 'DARKEN'
  | 'MULTIPLY'
  | 'LINEAR_BURN'
  | 'COLOR_BURN'
  | 'LIGHTEN'
  | 'SCREEN'
  | 'LINEAR_DODGE'
  | 'COLOR_DODGE'
  | 'OVERLAY'
  | 'SOFT_LIGHT'
  | 'HARD_LIGHT'
  | 'DIFFERENCE'
  | 'EXCLUSION'
  | 'HUE'
  | 'SATURATION'
  | 'COLOR'
  | 'LUMINOSITY'
type MaskType = 'ALPHA' | 'VECTOR' | 'LUMINANCE'
/**
 * @see https://developers.figma.com/docs/plugins/api/FontName
 */
interface Font {
  fontName: FontName
}
/**
 * @see https://developers.figma.com/docs/plugins/api/TextStyleOverrides
 */
type TextStyleOverrideType = {
  type: 'SEMANTIC_ITALIC' | 'SEMANTIC_WEIGHT' | 'HYPERLINK' | 'TEXT_DECORATION'
}
interface StyledTextSegment {
  /**
   * The characters in the range of text with the same styles.
   */
  characters: string
  /**
   * Start index (inclusive) of the range of characters.
   */
  start: number
  /**
   * End index (exclusive) of the range of characters.
   */
  end: number
  /**
   * The size of the font. Has minimum value of 1.
   */
  fontSize: number
  /**
   * The font family (e.g. `"Inter"`), font style (e.g. `"Regular"`). For [variable fonts](https://developers.figma.com/docs/plugins/api/FontName), also {@link FontName.variationSettings}.
   */
  fontName: FontName
  /**
   * The weight of the font (e.g. 400 for "Regular", 700 for "Bold").
   */
  fontWeight: number
  /**
   * The style of the font (i.e. "REGULAR", "ITALIC").
   */
  fontStyle: FontStyle
  /**
   * Whether the text is underlined or has a strikethrough.
   */
  textDecoration: TextDecoration
  /**
   * The text decoration style (e.g. "SOLID"). If the text is not underlined, this value will be null.
   */
  textDecorationStyle: TextDecorationStyle | null
  /**
   * The text decoration offset. If the text is not underlined, this value will be null.
   */
  textDecorationOffset: TextDecorationOffset | null
  /**
   * The text decoration thickness. If the text is not underlined, this value will be null.
   */
  textDecorationThickness: TextDecorationThickness | null
  /**
   * The text decoration color. If the text is not underlined, this value will be null.
   */
  textDecorationColor: TextDecorationColor | null
  /**
   * Whether the text decoration skips descenders. If the text is not underlined, this value will be null.
   */
  textDecorationSkipInk: boolean | null
  /**
   * Overrides the case of the raw characters in the text node.
   */
  textCase: TextCase
  /**
   * The spacing between the lines in a paragraph of text.
   */
  lineHeight: LineHeight
  /**
   * The spacing between the individual characters.
   */
  letterSpacing: LetterSpacing
  /**
   * The paints used to fill the area of the shape.
   */
  fills: Paint[]
  /**
   * The id of the TextStyle object that the text properties of this node are linked to
   */
  textStyleId: string
  /**
   * The id of the PaintStyle object that the fills property of this node is linked to.
   */
  fillStyleId: string
  /**
   * The list settings.
   */
  listOptions: TextListOptions
  /**
   * The spacing between list items.
   */
  listSpacing: number
  /**
   * The indentation.
   */
  indentation: number
  /**
   * The paragraph indent.
   */
  paragraphIndent: number
  /**
   * The paragraph spacing.
   */
  paragraphSpacing: number
  /**
   * The text wrap style applied to the paragraph.
   */
  textWrapStyle: TextWrapStyle
  /**
   * A HyperlinkTarget if the text node has exactly one hyperlink, or null if the node has none.
   */
  hyperlink: HyperlinkTarget | null
  /**
   * OpenType features that have been explicitly enabled or disabled.
   */
  openTypeFeatures: {
    readonly [feature in OpenTypeFeature]: boolean
  }
  /**
   * The variables bound to a particular field.
   */
  boundVariables?: {
    [field in VariableBindableTextField]?: VariableAlias
  }
  /**
   * Overrides applied over a text style.
   */
  textStyleOverrides: TextStyleOverrideType[]
}
/**
 * @see https://developers.figma.com/docs/plugins/api/TextPathStartData
 *
 * Interface representing the starting point of a text path.
 */
interface TextPathStartData {
  /**
   * The segment index where the text path starts.
   */
  segment: number
  /**
   * The position (0 to 1) along the segment where the text path starts.
   */
  position: number
}
type Reaction = {
  actions?: Action[]
  trigger: Trigger | null
}
type VariableDataType =
  'BOOLEAN' | 'COLOR' | 'EASING' | 'EXPRESSION' | 'FLOAT' | 'STRING' | 'TIMING' | 'VARIABLE_ALIAS'
type ExpressionFunction =
  | 'ADDITION'
  | 'SUBTRACTION'
  | 'MULTIPLICATION'
  | 'DIVISION'
  | 'EQUALS'
  | 'NOT_EQUAL'
  | 'LESS_THAN'
  | 'LESS_THAN_OR_EQUAL'
  | 'GREATER_THAN'
  | 'GREATER_THAN_OR_EQUAL'
  | 'AND'
  | 'OR'
  | 'VAR_MODE_LOOKUP'
  | 'NEGATE'
  | 'NOT'
interface Expression {
  expressionFunction: ExpressionFunction
  expressionArguments: VariableData[]
}
type VariableValueWithExpression = VariableValue | Expression
interface VariableData {
  type?: VariableDataType
  resolvedType?: VariableResolvedDataType
  value?: VariableValueWithExpression
}
type ConditionalBlock = {
  condition?: VariableData
  actions: Action[]
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Action
 */
type Action =
  | {
      readonly type: 'BACK' | 'CLOSE'
    }
  | {
      readonly type: 'URL'
      url: string
      openInNewTab?: boolean
    }
  | {
      readonly type: 'UPDATE_MEDIA_RUNTIME'
      readonly destinationId: string | null
      readonly mediaAction:
        'PLAY' | 'PAUSE' | 'TOGGLE_PLAY_PAUSE' | 'MUTE' | 'UNMUTE' | 'TOGGLE_MUTE_UNMUTE'
    }
  | {
      readonly type: 'UPDATE_MEDIA_RUNTIME'
      readonly destinationId?: string | null
      readonly mediaAction: 'SKIP_FORWARD' | 'SKIP_BACKWARD'
      readonly amountToSkip: number
    }
  | {
      readonly type: 'UPDATE_MEDIA_RUNTIME'
      readonly destinationId?: string | null
      readonly mediaAction: 'SKIP_TO'
      readonly newTimestamp: number
    }
  | {
      readonly type: 'SET_VARIABLE'
      readonly variableId: string | null
      readonly variableValue?: VariableData
    }
  | {
      readonly type: 'SET_VARIABLE_MODE'
      readonly variableCollectionId: string | null
      readonly variableModeId: string | null
    }
  | {
      readonly type: 'CONDITIONAL'
      readonly conditionalBlocks: ConditionalBlock[]
    }
  | {
      readonly type: 'NODE'
      readonly destinationId: string | null
      readonly navigation: Navigation
      readonly transition: Transition | null
      readonly overlayRelativePosition?: Vector
      readonly resetVideoPosition?: boolean
      readonly resetScrollPosition?: boolean
      readonly resetInteractiveComponents?: boolean
    }
/**
 * @see https://developers.figma.com/docs/plugins/api/Transition
 */
interface SimpleTransition {
  readonly type: 'DISSOLVE' | 'SMART_ANIMATE' | 'SCROLL_ANIMATE'
  readonly easing: Easing
  readonly duration: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Transition
 */
interface DirectionalTransition {
  readonly type: 'MOVE_IN' | 'MOVE_OUT' | 'PUSH' | 'SLIDE_IN' | 'SLIDE_OUT'
  readonly direction: 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM'
  readonly matchLayers: boolean
  readonly easing: Easing
  readonly duration: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Transition
 */
type Transition = SimpleTransition | DirectionalTransition
type Trigger =
  | {
      readonly type: 'ON_CLICK' | 'ON_HOVER' | 'ON_PRESS' | 'ON_DRAG'
    }
  | {
      readonly type: 'AFTER_TIMEOUT'
      readonly timeout: number
    }
  | {
      readonly type: 'MOUSE_UP' | 'MOUSE_DOWN'
      readonly delay: number
    }
  | {
      readonly type: 'MOUSE_ENTER' | 'MOUSE_LEAVE'
      readonly delay: number
      readonly deprecatedVersion: boolean
    }
  | {
      readonly type: 'ON_KEY_DOWN'
      readonly device: 'KEYBOARD' | 'XBOX_ONE' | 'PS4' | 'SWITCH_PRO' | 'UNKNOWN_CONTROLLER'
      readonly keyCodes: ReadonlyArray<number>
    }
  | {
      readonly type: 'ON_MEDIA_HIT'
      readonly mediaHitTime: number
    }
  | {
      readonly type: 'ON_MEDIA_END'
    }
/**
 * @see https://developers.figma.com/docs/plugins/api/Action
 */
type Navigation = 'NAVIGATE' | 'SWAP' | 'OVERLAY' | 'SCROLL_TO' | 'CHANGE_TO'
/**
 * @see https://developers.figma.com/docs/plugins/api/Transition
 */
interface Easing {
  readonly type:
    | 'EASE_IN'
    | 'EASE_OUT'
    | 'EASE_IN_AND_OUT'
    | 'LINEAR'
    | 'EASE_IN_BACK'
    | 'EASE_OUT_BACK'
    | 'EASE_IN_AND_OUT_BACK'
    | 'CUSTOM_CUBIC_BEZIER'
    | 'GENTLE'
    | 'QUICK'
    | 'BOUNCY'
    | 'SLOW'
    | 'CUSTOM_SPRING'
  readonly easingFunctionCubicBezier?: EasingFunctionBezier
  readonly easingFunctionSpring?: EasingFunctionSpring
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Transition
 */
interface EasingFunctionBezier {
  x1: number
  y1: number
  x2: number
  y2: number
}
interface EasingFunctionSpring {
  mass: number
  stiffness: number
  damping: number
  initialVelocity: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
interface MotionEasing {
  readonly type:
    | 'EASE_IN'
    | 'EASE_OUT'
    | 'EASE_IN_AND_OUT'
    | 'LINEAR'
    | 'EASE_IN_BACK'
    | 'EASE_OUT_BACK'
    | 'EASE_IN_AND_OUT_BACK'
    | 'CUSTOM_CUBIC_BEZIER'
    | 'GENTLE'
    | 'QUICK'
    | 'BOUNCY'
    | 'SLOW'
    | 'CUSTOM_SPRING'
    | 'HOLD'
  readonly easingFunctionCubicBezier?: EasingFunctionBezier
  readonly easingFunctionSpring?: NormalizedSpring
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
interface PhysicalSpring {
  readonly mass: number
  readonly stiffness: number
  readonly damping: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
interface NormalizedSpring {
  /**
   * A normalized bounce value from 0 to 1.
   */
  readonly bounce: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
type AnimationStylePropValue = string | number | boolean | MotionEasing | VariableAlias
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
type AvailableAnimationStylePropValue = string
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
interface BaseAnimationStyle {
  readonly styleId: string
  readonly name: string
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
interface AvailableAnimationStyle extends BaseAnimationStyle {
  readonly description?: string
  readonly props?: {
    readonly [key: string]: AvailableAnimationStylePropValue
  }
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
interface AnimationStyleConfiguration {
  /**
   * The duration of the applied animation style in seconds.
   */
  readonly duration?: number
  /**
   * The timeline offset of the applied animation style in seconds.
   */
  readonly timelineOffset?: number
  readonly props?: {
    readonly [key: string]: AnimationStylePropValue
  }
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
interface AppliedAnimationStyle extends BaseAnimationStyle, AnimationStyleConfiguration {
  readonly id: string
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
type KeyframeValue =
  | {
      readonly type: 'FLOAT'
      readonly value: number
    }
  | {
      readonly type: 'COLOR'
      readonly value: RGBA
    }
  | {
      readonly type: 'TEXT_DATA'
      readonly value: string
    }
  | {
      readonly type: 'VECTOR'
      readonly value: Vector
    }
  | {
      readonly type: 'BOOL'
      readonly value: boolean
    }
  | {
      readonly type: 'CIRCLE'
      readonly value: {
        readonly x: number
        readonly y: number
        readonly radius: number
      }
    }
  | {
      readonly type: 'LINE'
      readonly value: {
        readonly x: number
        readonly y: number
        readonly x2: number
        readonly y2: number
      }
    }
  | {
      readonly type: 'CIRCLE_POINT'
      readonly value: {
        readonly x: number
        readonly y: number
        readonly radius: number
        readonly angle: number
      }
    }
  | {
      readonly type: 'COLOR_POINT'
      readonly value: {
        readonly x: number
        readonly y: number
        readonly color: RGBA
      }
    }
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
interface ManualKeyframeInput {
  readonly id?: string
  /**
   * The keyframe position on the timeline in seconds.
   */
  readonly timelinePosition: number
  readonly easing?: MotionEasing | VariableAlias
  readonly value: KeyframeValue
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
interface ManualKeyframeTrackInput {
  readonly id?: string
  readonly baseValue?: KeyframeValue
  readonly keyframes: ReadonlyArray<ManualKeyframeInput>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
interface ManualKeyframe extends ManualKeyframeInput {
  readonly id: string
  readonly easing: MotionEasing | VariableAlias
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
interface ManualKeyframeBinding {
  readonly id: string
  readonly baseValue: KeyframeValue
  readonly keyframes: ReadonlyArray<ManualKeyframe>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
interface ManualKeyframeTrack {
  readonly id: string
  readonly keyframeOperation: 'SET' | 'OFFSET' | 'SCALE'
  readonly keyframes: ReadonlyArray<ManualKeyframe>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
interface KeyframeBinding {
  readonly baseValue: KeyframeValue
  readonly timelineDuration: number
  readonly tracks: ReadonlyArray<ManualKeyframeTrack>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
type KeyframePropertyFieldName =
  | 'CORNER_RADIUS'
  | 'STROKE_WEIGHT'
  | 'STACK_SPACING'
  | 'STACK_PADDING_LEFT'
  | 'STACK_PADDING_TOP'
  | 'STACK_PADDING_RIGHT'
  | 'STACK_PADDING_BOTTOM'
  | 'WIDTH'
  | 'HEIGHT'
  | 'RECTANGLE_TOP_LEFT_CORNER_RADIUS'
  | 'RECTANGLE_TOP_RIGHT_CORNER_RADIUS'
  | 'RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS'
  | 'RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS'
  | 'BORDER_TOP_WEIGHT'
  | 'BORDER_BOTTOM_WEIGHT'
  | 'BORDER_LEFT_WEIGHT'
  | 'BORDER_RIGHT_WEIGHT'
  | 'STACK_COUNTER_SPACING'
  | 'OPACITY'
  | 'GRID_ROW_GAP'
  | 'GRID_COLUMN_GAP'
  | 'TRANSLATION_X'
  | 'TRANSLATION_Y'
  | 'TRANSLATION_XY'
  | 'ROTATION'
  | 'SCALE_X'
  | 'SCALE_Y'
  | 'SCALE_XY'
  | 'PATH_TRIM_START'
  | 'PATH_TRIM_END'
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
type EffectKeyframeFieldName =
  | 'OFFSET_X'
  | 'OFFSET_Y'
  | 'RADIUS'
  | 'SPREAD'
  | 'COLOR'
  | 'REFRACTION_RADIUS'
  | 'SPECULAR_ANGLE'
  | 'SPECULAR_INTENSITY'
  | 'CHROMATIC_ABERRATION'
  | 'SPLAY'
  | 'REFRACTION_INTENSITY'
  | 'START_RADIUS'
  | 'NOISE_SIZE_X'
  | 'NOISE_SIZE_Y'
  | 'DENSITY'
  | 'EFFECT_OPACITY'
  | 'SECONDARY_COLOR'
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
type KeyframeField =
  | {
      readonly type: 'PROPERTY'
      readonly name: KeyframePropertyFieldName
    }
  | {
      readonly type: 'INDEXED_ITEM'
      readonly collection: 'fills' | 'strokes'
      readonly index: number
    }
  | {
      readonly type: 'INDEXED_ITEM'
      readonly collection: 'fills' | 'strokes'
      readonly index: number
      readonly propertyId: string
    }
  | {
      readonly type: 'INDEXED_ITEM'
      readonly collection: 'effects'
      readonly index: number
      readonly field: EffectKeyframeFieldName
    }
  | {
      readonly type: 'INDEXED_ITEM'
      readonly collection: 'effects'
      readonly index: number
      readonly propertyId: string
    }
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
type ComponentPropKeyframeTracks = Partial<Record<string, ManualKeyframeBinding>>
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
type ComponentPropKeyframeBindings = Partial<Record<string, KeyframeBinding>>
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
type PaintManualKeyframeTrack =
  | ManualKeyframeBinding
  | {
      readonly properties: ComponentPropKeyframeTracks
    }
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
type PaintKeyframeBinding =
  | KeyframeBinding
  | {
      readonly properties: ComponentPropKeyframeBindings
    }
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
type EffectManualKeyframeTracks = Partial<
  Record<EffectKeyframeFieldName, ManualKeyframeBinding>
> & {
  readonly properties?: ComponentPropKeyframeTracks
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
type EffectKeyframeBindings = Partial<Record<EffectKeyframeFieldName, KeyframeBinding>> & {
  readonly properties?: ComponentPropKeyframeBindings
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
type ManualKeyframeTracks = Partial<Record<KeyframePropertyFieldName, ManualKeyframeBinding>> & {
  readonly fills?: Partial<Record<number, PaintManualKeyframeTrack>>
  readonly strokes?: Partial<Record<number, PaintManualKeyframeTrack>>
  readonly effects?: Partial<Record<number, EffectManualKeyframeTracks>>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
type Animations = Partial<Record<KeyframePropertyFieldName, KeyframeBinding>> & {
  readonly fills?: Partial<Record<number, PaintKeyframeBinding>>
  readonly strokes?: Partial<Record<number, PaintKeyframeBinding>>
  readonly effects?: Partial<Record<number, EffectKeyframeBindings>>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Motion
 */
interface Timeline {
  readonly id: string
  /**
   * The timeline duration in seconds.
   */
  readonly duration: number
}
type OverflowDirection = 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'BOTH'
/**
 * @see https://developers.figma.com/docs/plugins/api/Overlay
 */
type OverlayPositionType =
  | 'CENTER'
  | 'TOP_LEFT'
  | 'TOP_CENTER'
  | 'TOP_RIGHT'
  | 'BOTTOM_LEFT'
  | 'BOTTOM_CENTER'
  | 'BOTTOM_RIGHT'
  | 'MANUAL'
/**
 * @see https://developers.figma.com/docs/plugins/api/Overlay
 */
type OverlayBackground =
  | {
      readonly type: 'NONE'
    }
  | {
      readonly type: 'SOLID_COLOR'
      readonly color: RGBA
    }
/**
 * @see https://developers.figma.com/docs/plugins/api/Overlay
 */
type OverlayBackgroundInteraction = 'NONE' | 'CLOSE_ON_CLICK_OUTSIDE'
/**
 * @see https://developers.figma.com/docs/plugins/api/PublishStatus
 */
type PublishStatus = 'UNPUBLISHED' | 'CURRENT' | 'CHANGED'
interface ConnectorEndpointPosition {
  position: {
    x: number
    y: number
  }
}
interface ConnectorEndpointPositionAndEndpointNodeId {
  position: {
    x: number
    y: number
  }
  endpointNodeId: string
}
interface ConnectorEndpointEndpointNodeIdAndMagnet {
  endpointNodeId: string
  magnet: 'NONE' | 'AUTO' | 'TOP' | 'LEFT' | 'BOTTOM' | 'RIGHT' | 'CENTER'
}
/**
 * @see https://developers.figma.com/docs/plugins/api/ConnectorEndpoint
 */
type ConnectorEndpoint =
  | ConnectorEndpointPosition
  | ConnectorEndpointEndpointNodeIdAndMagnet
  | ConnectorEndpointPositionAndEndpointNodeId
/**
 * @see https://developers.figma.com/docs/plugins/api/ConnectorStrokeCap
 */
type ConnectorStrokeCap =
  | 'NONE'
  | 'ARROW_EQUILATERAL'
  | 'ARROW_LINES'
  | 'TRIANGLE_FILLED'
  | 'DIAMOND_FILLED'
  | 'CIRCLE_FILLED'
  | 'ERD_ZERO_OR_ONE'
  | 'ERD_EXACTLY_ONE'
  | 'ERD_ZERO_OR_MORE'
  | 'ERD_ONE_OR_MORE'
  | 'ERD_ONE'
  | 'ERD_MANY'
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface BaseNodeMixin extends PluginDataMixin {
  /**
   * The unique identifier of a node. For example, `1:3`. The node id can be used with methods such as {@link PluginAPI.getNodeByIdAsync}, but plugins typically don't need to use this since you can usually just access a node directly.
   *
   * @remarks
   *
   * One possible use case for using the `id` is to have a serializable representation of a Figma node. To "deserialize" an id back into a node, pass it to {@link PluginAPI.getNodeByIdAsync}. This will return null if the node is no longer present in the document.
   *
   * In the URLs for Figma files, node ids are hyphenated. However, for use with the API, node ids must use colons. For example, if a Figma file URL has the node id `1-3`, you must convert it to `1:3`.
   */
  readonly id: string
  /**
   * Returns the parent of this node, if any. This property is not meant to be directly edited. To reparent, see {@link ChildrenMixin.appendChild}.
   *
   * @remarks
   *
   * The root node (i.e. `figma.root`) doesn't have a parent.
   *
   * Components accessed via {@link InstanceNode.getMainComponentAsync | instance.getMainComponentAsync()} or {@link InstanceNode.mainComponent | instance.mainComponent} do not always have a parent. They could be remote components or soft-deleted components.
   */
  readonly parent: (BaseNode & ChildrenMixin) | null
  /**
   * The name of the layer that appears in the layers panel. Calling `figma.root.name` will return the name, read-only, of the current file.
   *
   * @remarks
   *
   * If the node is a {@link TextNode}, the name will update automatically by default based on the `characters` property (`autoRename` is true). If you manually override the text node's name, it will set `autoRename` to false. This matches the behavior in the editor.
   *
   * If the node is a {@link PageNode} with no children and the name is a page divider name, it will set `isPageDivider` to true. A page divider name consists of all asterisks, all en dashes, all em dashes, or all spaces.
   */
  name: string
  /**
   * Returns true if this node has been removed since it was first accessed. If your plugin stays open for a while and stores references to nodes, you should write your code defensively and check that the nodes haven't been removed by the user.
   *
   * @remarks
   *
   * A node can be removed for any number of reasons. Some examples:
   * - Your plugin called node.remove() on it
   * - Someone else deleted the node using multiplayer
   * - The user triggered an undo action and the node was removed
   * - The user simply deleted the node
   * - You removed all children out of a group, and the group auto-deleted itself
   */
  readonly removed: boolean
  /**
   * Returns a string representation of the node. For debugging purposes only, do not rely on the exact output of this string in production code.
   *
   * @remarks
   *
   * This currently returns a string of the form `[Node ID]` where `ID` is the id of the node. This is just for debugging convenience so the node displays something useful when converted to a string. We recommend not relying on this in production.
   *
   * Example:
   * ```ts
   * // e.g. [Node 0:5]
   * console.log(`Current selected node ${figma.currentPage.selection[0]}`)
   * ```
   */
  toString(): string
  /**
   * Removes this node and **all of its children** from the document.
   *
   * @remarks
   *
   * If you want to only remove this node but not its children, you will have to first move them to another node before calling `remove()`.
   */
  remove(): void
  /**
   * Returns true if Figma detects that a node is an asset, otherwise returns false. An asset is is either an icon or a raster image.
   *
   * This property is useful if you're building a [plugin for code generation](https://developers.figma.com/docs/plugins/codegen-plugins).
   *
   * Note: This property uses a set of heuristics to determine if a node is an asset. At a high level an icon is a small vector graphic and an image is a node with an image fill.
   */
  readonly isAsset: boolean
  /**
   * Resolves to a JSON object of CSS properties of the node. This is the same CSS that Figma shows in the inspect panel and is helpful if you are building a [plugin for code generation](https://developers.figma.com/docs/plugins/codegen-plugins).
   *
   */
  getCSSAsync(): Promise<{
    [key: string]: string
  }>
  /**
   * Returns the top-most frame that contains this node. If the node is not inside a frame, this will return undefined.
   *
   * Note: This function will only work in Figma Design and will throw an error if called in FigJam or Slides.
   */
  getTopLevelFrame(): FrameNode | undefined
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface PluginDataMixin {
  /**
   * Retrieves custom information that was stored on this node or style using {@link PluginDataMixin.setPluginData}. If there is no data stored for the provided key, an empty string is returned.
   */
  getPluginData(key: string): string
  /**
   * Lets you store custom information on any node or style, **private** to your plugin. The total size of your entry (`pluginId`, `key`, `value`) cannot exceed 100 kB.
   *
   * @param key - The key under which to store the data. This is similar to writing to a plain object via `obj[key] = value`.
   * @param value - The data you want to store. If you want to store a value type other than a string, encode it as a JSON string first via `JSON.stringify` and `JSON.parse`. If you set the value to the empty string (""), the key/value pair is removed.
   *
   * @remarks
   *
   * The data is specific to your plugin ID. Plugins with other IDs won't be able to read this data. You can retrieve it later by calling `getPluginData` with the same key. To find all data stored on a node or style by your plugin use `getPluginDataKeys`.
   *
   * Caution: ⚠ The data is stored privately for **stability**, not **security**. It prevents other plugins from accessing with your data. It does not, however, prevent users from seeing the data given sufficient effort. For example, they could export the document as a .fig file and try to decode it.
   *
   * Caution: ⚠ Data will become inaccessible if your plugin ID changes.
   *
   *
   * Caution: ⚠ Total entry size cannot exceed 100 kB.
   */
  setPluginData(key: string, value: string): void
  /**
   * Retrieves a list of all keys stored on this node or style using using {@link PluginDataMixin.setPluginData}. This enables iterating through all data stored privately on a node or style by your plugin.
   */
  getPluginDataKeys(): string[]
  /**
   * Retrieves custom information that was stored on this node or style using {@link PluginDataMixin.setSharedPluginData}. If there is no data stored for the provided namespace and key, an empty string is returned.
   */
  getSharedPluginData(namespace: string, key: string): string
  /**
   * Lets you store custom information on any node or style, **public** to all plugins. The total size of your entry (`namespace`, `key`, `value`) cannot exceed 100 kB.
   *
   * @param namespace - A unique string to identify your plugin and avoid key collisions with other plugins. The namespace must be at least 3 alphanumeric characters.
   * @param key - The key under which to store the data. This is similar to writing to a plain object via `obj[key] = value`.
   * @param value - The data you want to store. If you want to store a value type other than a string, encode it as a JSON string first via `JSON.stringify` and `JSON.parse`. If you set the value to the empty string (""), the key/value pair is removed.
   *
   * @remarks
   *
   * This lets you store custom information on any node or style. You can retrieve it later by calling {@link PluginDataMixin.getSharedPluginData} with the same namespace and key. To find all data stored on a node or style in a particular namespace, use {@link PluginDataMixin.getSharedPluginDataKeys}.
   *
   * Any data you write using this API will be readable by any plugin. The intent is to allow plugins to interoperate with each other. Use {@link PluginDataMixin.setPluginData} instead if you don't want other plugins to be able to read your data.
   *
   * You must also provide a `namespace` argument to avoid key collisions with other plugins. This argument is mandatory to prevent multiple plugins from using generic key names like `data` and overwriting one another. We recommend passing a value that identifies your plugin. This namespace can be given to authors of other plugins so that they can read data from your plugin.
   *
   * Caution: ⚠ Total entry size cannot exceed 100 kB.
   */
  setSharedPluginData(namespace: string, key: string, value: string): void
  /**
   * Retrieves a list of all keys stored on this node or style using {@link PluginDataMixin.setSharedPluginData}. This enables iterating through all data stored in a given namespace.
   */
  getSharedPluginDataKeys(namespace: string): string[]
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface SceneNodeMixin extends ExplicitVariableModesMixin, MotionNodeMixin {
  /**
   * Whether the node is visible or not. Does not affect a plugin's ability to access the node.
   *
   * @remarks
   *
   * The value that this property returns is independent from the node's parent. i.e.
   * - The node isn't necessarily visible if this is `.visible === true`.
   * - The node isn't necessarily invisible if this is `.visible === false`.
   * - An object is visible if `.visible == true` for itself and **all** its parents.
   */
  visible: boolean
  /**
   * Whether the node is locked or not, preventing certain user interactions on the canvas such as selecting and dragging. Does not affect a plugin's ability to write to those properties.
   *
   * @remarks
   *
   * The value that this property returns is independent from the node's parent. i.e.
   * - The node isn't necessarily locked if this is `.locked === true`.
   * - The node isn't necessarily unlocked if this is `.locked === false`.
   * - An object is locked if `.locked == true` for itself or **any** of its parents.
   */
  locked: boolean
  /**
   * An array of nodes that are "stuck" to this node. In FigJam, stamps, highlights, and some widgets can "stick"
   * to other nodes if they are dragged on top of another node.
   *
   * @remarks
   *
   * This property is only available in FigJam.
   *
   *
   * In FigJam a stickable host that means that stickables, like `'STAMP'` nodes, are allowed to attach themselves to the node. If the stickable host moves all nodes that are in `stuckNodes` move along with it.
   */
  readonly stuckNodes: SceneNode[]
  /**
   * An array of `ConnectorNode`s that are attached to a node.
   */
  readonly attachedConnectors: ConnectorNode[]
  /**
   * All component properties that are attached on this node. A node can only have `componentPropertyReferences` if it is a component sublayer or an instance sublayer. It will be `null` otherwise. The value in the key-value pair refers to the component property name as returned by `componentPropertyDefinitions` on the containing component, component set or main component (for instances).
   *
   * When setting, may throw the following errors: cannotApplySlotPropertyToNonFrameNode, cannotApplySlotPropertyToFrameWithGrid, or cannotApplySlotPropertyToFrame.
   */
  componentPropertyReferences:
    | {
        [nodeProperty in 'visible' | 'characters' | 'mainComponent']?: string
      }
    | null
  /**
   * The variables bound to a particular field on this node. Please see the [Working with Variables](https://developers.figma.com/docs/plugins/working-with-variables) guide for how to get and set variable bindings.
   *
   * @remarks
   *
   * On nodes with independent corner radii (e.g. rectangles, frames), a `cornerRadius` binding sets all four corners and appears in `boundVariables` as `topLeftRadius`/`topRightRadius`/`bottomLeftRadius`/`bottomRightRadius` rather than `cornerRadius`; elsewhere it appears as `cornerRadius`.
   *
   */
  readonly boundVariables?: {
    readonly [field in VariableBindableNodeField]?: VariableAlias
  } & {
    readonly [field in VariableBindableTextField]?: VariableAlias[]
  } & {
    readonly fills?: VariableAlias[]
    readonly strokes?: VariableAlias[]
    readonly effects?: VariableAlias[]
    readonly layoutGrids?: VariableAlias[]
    readonly componentProperties?: {
      readonly [propertyName: string]: VariableAlias
    }
    readonly textRangeFills?: VariableAlias[]
  }
  /**
   * Binds the provided `field` on this node to the given variable. Please see the [Working with Variables](https://developers.figma.com/docs/plugins/working-with-variables) guide for how to get and set variable bindings.
   *
   * If `null` is provided as the variable, the given `field` will be unbound from any variables.
   *
   * @param field - The field to bind the variable to.
   * @param variable - The variable to bind to the field. If `null` is provided, the field will be unbound from any variables. Make sure to pass a Variable object or null; passing a variable ID is deprecated.
   */
  setBoundVariable(
    field: VariableBindableNodeField | VariableBindableTextField,
    variable: Variable | null,
  ): void
  /**
   * An object, keyed by field, returning any variables that match the raw value of that field for the mode of the node (or the default variable value if no mode is set)
   *
   * @remarks
   *
   * Inferred variables are only returned for a field when it is not using a [bound variable](https://developers.figma.com/docs/plugins/api/node-properties#boundvariables).
   *
   * Variables can be inferred from:
   * - The collections of variables used in the file
   * - Variables from subscribed libraries, provided the variable is used in the file
   *
   * Variables can only be inferred when there is a single variable that matches the raw value used for the scope of the variable.
   * - i.e. For a property set to width: 100px, where there are two variables set to a value of 100 with the default scope, a value cannot be inferred as there are two matches.
   * - i.e. For a property set to width: 100px, where there is a variable set to 100 with a scope of "Width and height" and a variable set to 100 with a scope of "Corner radius", a value can be inferred as there is a single match for the given scope.
   *
   * Inferred variables for fills and strokes return a list of results where the index matches that of node.fills and node.strokes.
   * - i.e. node.inferredVariables.fills[0] holds the inferred variables for node.fills[0]
   */
  readonly inferredVariables?: {
    readonly [field in VariableBindableNodeField]?: VariableAlias[]
  } & {
    readonly fills?: VariableAlias[][]
    readonly strokes?: VariableAlias[][]
  }
  /**
   * The resolved mode for this node for each variable collection in this file.
   *
   * @remarks
   *
   * The set of resolved modes on a node includes the explicitly set modes on the node, as well as the explicitly set modes on ancestors of the node. By default, nodes [automatically inherit](https://help.figma.com/hc/en-us/articles/15343816063383-Modes-for-variables#Auto_mode) the modes of their parents.
   *
   * ```ts title="explicitVariableModes vs resolvedVariableModes"
   * // Create two collections with two modes each
   * const collection1 = figma.variables.createVariableCollection("Collection 1")
   * const collection1Mode1Id = collection1.modes[0].modeId
   * const collection1Mode2Id = collection1.addMode('Mode 2')
   * const collection2 = figma.variables.createVariableCollection("Collection 2")
   * const collection2Mode1Id = collection2.modes[0].modeId
   * const collection2Mode2Id = collection2.addMode('Mode 2')
   *
   * const parentFrame = figma.createFrame()
   * const childFrame = figma.createFrame()
   * parentFrame.appendChild(childFrame)
   *
   * parentFrame.setExplicitVariableModeForCollection(
   *   collection1,
   *   collection1Mode2Id
   * )
   * childFrame.setExplicitVariableModeForCollection(
   *   collection2,
   *   collection2Mode1Id
   * )
   *
   * // Example output (only collection2 is present):
   * // { 'VariableCollectionId:1:3': '1:2' }
   * console.log(childFrame.explicitVariableModes);
   *
   * // Example output (both collections are present):
   * // { 'VariableCollectionId:1:2': '1:1', 'VariableCollectionId:1:3': '1:2' }
   * console.log(childFrame.resolvedVariableModes);
   * ```
   */
  resolvedVariableModes: {
    [collectionId: string]: string
  }
}
/**
 * Motion node properties and methods are available in Beta. This API is subject to change.
 *
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface MotionNodeMixin {
  /**
   * The Motion animation style instances currently applied to this node.
   * Their `props` values are the configured property values for this node.
   *
   * @remarks
   * ```ts
   * const node = figma.currentPage.selection[0]
   * if (node) {
   *   for (const style of node.animationStyles) {
   *     console.log(style.name, style.id, style.props)
   *   }
   * }
   * ```
   */
  readonly animationStyles: AppliedAnimationStyle[]
  /**
   * All Motion animation keyframes on this node, including keyframes created by animation styles and manual keyframe tracks.
   *
   * @remarks
   * ```ts
   * const node = figma.currentPage.selection[0]
   * const translationX = node?.animations.TRANSLATION_X
   * if (translationX) {
   *   console.log(translationX.timelineDuration, translationX.tracks)
   * }
   * ```
   */
  readonly animations: Animations
  /**
   * The manual Motion keyframe tracks bound to this node.
   *
   * @remarks
   * ```ts
   * const node = figma.currentPage.selection[0]
   * const manualTranslationX = node?.manualKeyframeTracks.TRANSLATION_X
   * if (manualTranslationX) {
   *   console.log(manualTranslationX.keyframes)
   * }
   * ```
   */
  readonly manualKeyframeTracks: ManualKeyframeTracks
  /**
   * The Motion timelines that contain this node. Currently this returns the containing top-level frame's timeline.
   *
   * @remarks
   * ```ts
   * const node = figma.currentPage.selection[0]
   * if (node) {
   *   for (const timeline of node.timelines) {
   *     console.log(timeline.id, timeline.duration)
   *   }
   * }
   * ```
   */
  readonly timelines: ReadonlyArray<Timeline>
  /**
   * Applies a Motion animation style to this node and returns the applied animation style instance id.
   *
   * @param styleId - The `styleId` of the animation style to apply. Use {@link MotionAPI.figmaAnimationStyles} to get available styles.
   * @param animationStyleData - Optional values used to configure the applied animation style.
   *
   * @remarks
   * ```ts
   * const node = figma.currentPage.selection[0]
   * const [style] = figma.motion.figmaAnimationStyles()
   * if (node && style) {
   *   const appliedStyleId = node.applyAnimationStyle(style.styleId, {
   *     duration: 0.4,
   *     timelineOffset: 0,
   *     props: {
   *       direction: 'right',
   *       distance: 120,
   *     },
   *   })
   *   console.log(appliedStyleId)
   * }
   * ```
   */
  applyAnimationStyle(styleId: string, animationStyleData?: AnimationStyleConfiguration): string
  /**
   * Removes an applied Motion animation style from this node.
   *
   * @param id - The applied animation style instance id returned by {@link MotionNodeMixin.applyAnimationStyle} or read from {@link MotionNodeMixin.animationStyles}.
   *
   * @remarks
   * ```ts
   * const node = figma.currentPage.selection[0]
   * const [appliedStyle] = node?.animationStyles ?? []
   * if (node && appliedStyle) {
   *   node.removeAnimationStyle(appliedStyle.id)
   * }
   * ```
   */
  removeAnimationStyle(id: string): void
  /**
   * Applies or replaces the manual Motion keyframe track for a property, paint, or effect field on this node.
   *
   * @param field - The property, paint, or effect field to animate.
   * @param track - The manual keyframe track to write.
   *
   * @remarks
   * ```ts
   * const node = figma.currentPage.selection[0]
   * if (node) {
   *   node.applyManualKeyframeTrack(
   *     { type: 'PROPERTY', name: 'TRANSLATION_X' },
   *     {
   *       baseValue: { type: 'FLOAT', value: 0 },
   *       keyframes: [
   *         { timelinePosition: 0, value: { type: 'FLOAT', value: 0 } },
   *         { timelinePosition: 0.3, value: { type: 'FLOAT', value: 120 } },
   *       ],
   *     },
   *   )
   * }
   * ```
   */
  applyManualKeyframeTrack(field: KeyframeField, track: ManualKeyframeTrackInput): void
  /**
   * Removes the manual Motion keyframe track for a property, paint, or effect field on this node.
   *
   * @param field - The property, paint, or effect field to remove.
   *
   * @remarks
   * ```ts
   * const node = figma.currentPage.selection[0]
   * if (node) {
   *   node.removeManualKeyframeTrack({
   *     type: 'PROPERTY',
   *     name: 'TRANSLATION_X',
   *   })
   * }
   * ```
   */
  removeManualKeyframeTrack(field: KeyframeField): void
  /**
   * Sets the duration, in seconds, for the timeline with the given id.
   *
   * @param id - A timeline id read from {@link MotionNodeMixin.timelines}.
   * @param duration - The new timeline duration in seconds. Must be greater than zero.
   *
   * @remarks
   * ```ts
   * const node = figma.currentPage.selection[0]
   * const [timeline] = node?.timelines ?? []
   * if (node && timeline) {
   *   node.setTimelineDuration(timeline.id, 1.2)
   * }
   * ```
   */
  setTimelineDuration(id: string, duration: number): void
}
type VariableBindableNodeField =
  | 'height'
  | 'width'
  | 'characters'
  | 'itemSpacing'
  | 'paddingLeft'
  | 'paddingRight'
  | 'paddingTop'
  | 'paddingBottom'
  | 'visible'
  | 'cornerRadius'
  | 'topLeftRadius'
  | 'topRightRadius'
  | 'bottomLeftRadius'
  | 'bottomRightRadius'
  | 'minWidth'
  | 'maxWidth'
  | 'minHeight'
  | 'maxHeight'
  | 'counterAxisSpacing'
  | 'strokeWeight'
  | 'strokeTopWeight'
  | 'strokeRightWeight'
  | 'strokeBottomWeight'
  | 'strokeLeftWeight'
  | 'opacity'
  | 'gridRowGap'
  | 'gridColumnGap'
type VariableBindableTextField =
  | 'fontFamily'
  | 'fontSize'
  | 'fontStyle'
  | 'fontWeight'
  | 'letterSpacing'
  | 'lineHeight'
  | 'paragraphSpacing'
  | 'paragraphIndent'
type VariableBindablePaintField = 'color'
type VariableBindablePaintStyleField = 'paints'
type VariableBindableColorStopField = 'color'
type VariableBindableEffectField = 'color' | 'radius' | 'spread' | 'offsetX' | 'offsetY'
type VariableBindableEffectStyleField = 'effects'
type VariableBindableLayoutGridField = 'sectionSize' | 'count' | 'offset' | 'gutterSize'
type VariableBindableGridStyleField = 'layoutGrids'
type VariableBindableComponentPropertyField = 'value'
type VariableBindableComponentPropertyDefinitionField = 'defaultValue'
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface StickableMixin {
  /**
   * If this node is stuck to another node this property returns that node or null.
   *
   * @remarks
   *
   * This property is only available in FigJam.
   */
  stuckTo: SceneNode | null
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface ChildrenMixin {
  /**
   * The list of children, sorted back-to-front. That is, the first child in the array is the bottommost layer on the screen, and the last child in the array is the topmost layer.
   *
   * If the manifest contains `"documentAccess": "dynamic-page"`, **and** the node is a {@link PageNode}, you must first call {@link PageNode.loadAsync} to access this property.
   *
   * @remarks
   *
   * This array can be read like and iterated like a regular array. However, calling this property always returns a new array, and both the property and the new array are read-only.
   *
   * As such, this property cannot be assigned to, and the array cannot be modified directly (it wouldn't do anything). Instead, use {@link ChildrenMixin.appendChild}, {@link ChildrenMixin.insertChild} or {@link BaseNodeMixin.remove}.
   *
   * Do not recursively walk the entire document tree by repeatedly reading `children` (for example, a manual DFS/BFS over `node.children`). That pattern is often much slower in large files.
   * Prefer {@link ChildrenMixin.findAllWithCriteria} when you know the target node types, and use {@link ChildrenMixin.findAll} when you need callback-based logic.
   *
   * Note: If you are curious, the reason why inserting children has to be done via API calls is because our internal representation for the layer tree uses [fractional indexing](https://www.figma.com/blog/multiplayer-editing-in-figma/) and {@link ChildrenMixin.insertChild} performs that conversion.
   */
  readonly children: ReadonlyArray<SceneNode>
  /**
   * Adds a new child to the end of the {@link ChildrenMixin.children} array. That is, visually on top of all other children.
   *
   * If the manifest contains `"documentAccess": "dynamic-page"`, **and** the node is a {@link PageNode}, you must first call {@link PageNode.loadAsync} to access this function.
   *
   * @remarks
   *
   * Reparenting nodes is subject to many restrictions. For example, some nodes cannot be moved, others would break the document if moved. Below are possible exceptions that can be thrown if the operation is invalid.
   *
   * If this is called on an auto-layout frame, calling this function can cause this layer to be resized and children to be moved.
   */
  appendChild(child: SceneNode): void
  /**
   * Adds a new child at the specified index in the {@link ChildrenMixin.children} array.
   *
   * If the manifest contains `"documentAccess": "dynamic-page"`, **and** the node is a {@link PageNode}, you must first call {@link PageNode.loadAsync} to access this function.
   *
   * @param index - Determines where the new layer gets inserted. For example, suppose a group has layers A, B, C, where C is the top-most layer.
   * - `insertChild(0, D)` gives a group with layers **D**, A, B, C
   * - `insertChild(1, D)` gives a group with layers A, **D**, B, C
   * - `insertChild(2, D)` gives a group with layers A, B, **D**, C
   * - `insertChild(3, D)` gives a group with layers A, B, C, **D**
   * - `insertChild(4, D)` throws an error since the group originally only has 3 children
   *
   * @param child - The node to be inserted.
   *
   * @remarks
   *
   * Reparenting nodes is subject to many restrictions. For example, some nodes cannot be moved, others would break the document if moved. Below are possible exceptions that can be thrown if the operation is invalid.
   *
   * If this is called on an auto-layout frame, calling this function can cause this layer to be resized and children to be moved.
   */
  insertChild(index: number, child: SceneNode): void
  /**
   * Searches the immediate children of this node (i.e. not including the children's children). Returns all nodes for which `callback` returns true.
   *
   * If the manifest contains `"documentAccess": "dynamic-page"`, **and** the node is a {@link PageNode}, you must first call {@link PageNode.loadAsync} to access this function.
   *
   * @param callback - A function that evaluates whether to return the provided `node`. If this argument is omitted, `findChildren` returns `node.children`.
   *
   * @remarks
   *
   * Example: find all frames that are immediate child of the current page.
   * ```ts
   * const childFrames = figma.currentPage.findChildren(n => n.type === "FRAME")
   * ```
   */
  findChildren(callback?: (node: SceneNode) => boolean): SceneNode[]
  /**
   * Searches the immediate children of this node (i.e. not including the children's children). Returns the first node for which `callback` returns true.
   *
   * If the manifest contains `"documentAccess": "dynamic-page"`, **and** the node is a {@link PageNode}, you must first call {@link PageNode.loadAsync} to access this function.
   *
   * @param callback - A function that evaluates whether to return the provided `node`.
   *
   * @remarks
   *
   * This function returns `null` if no matching node is found.
   *
   * Example: find the first frame that is an immediate child of the current page.
   * ```ts
   * const firstChildFrame = figma.currentPage.findChild(n => n.type === "FRAME")
   * ```
   */
  findChild(callback: (node: SceneNode) => boolean): SceneNode | null
  /**
   * Searches this entire subtree (this node's children, its children's children, etc). Returns all nodes for which `callback` returns true.
   *
   * If the manifest contains `"documentAccess": "dynamic-page"`, **and** the node is a {@link PageNode}, you must first call {@link PageNode.loadAsync} to access this function.
   *
   * @param callback - A function that evaluates whether to return the provided `node`. If this argument is omitted, `findAll` returns all nodes in the subtree.
   *
   * @remarks
   *
   * Nodes are included in **back-to-front** order. Parents always appear before their children, and children appear in same relative order before their children, and children appear in same relative order as in the {@link ChildrenMixin.children} array.
   *
   * This traversal method is known as ["pre-order traversal"](https://en.wikipedia.org/wiki/Tree_traversal#Pre-order_(NLR)).
   *
   * Note that the node this method is called on is **not included**.
   *
   * Example: find all nodes whose name is "Color":
   * ```ts
   * const colors = figma.currentPage.findAll(n => n.name === "Color")
   * ```
   *
   * Caution: ⚠ Large documents in Figma can have tens of thousands of nodes. Be careful using this function as it could be very slow.
   * If you only need to search immediate children, it is much faster to call `node.children.filter(callback)` or `node.findChildren(callback)`.
   * Please refer to our [recommendations](https://developers.figma.com/docs/plugins/accessing-document#full-document-traversal) for how to optimize document traversals.
   */
  findAll(callback?: (node: SceneNode) => boolean): SceneNode[]
  /**
   * Searches this entire subtree (this node's children, its children's children, etc). Returns the first node for which `callback` returns true.
   *
   * If the manifest contains `"documentAccess": "dynamic-page"`, **and** the node is a {@link PageNode}, you must first call {@link PageNode.loadAsync} to access this function.
   *
   * @param callback - A function that evaluates whether to return the provided `node`.
   *
   * @remarks
   * This function returns `null` if no matching node is found. The traversal order is the same as in {@link ChildrenMixin.findAll}.
   *
   * Note that the node this method is called on is **not included**.
   *
   * Example: find one node whose name is "Template":
   * ```ts
   * const template = figma.currentPage.findOne(n => n.name === "Template")
   * ```
   *
   * Caution: ⚠ Large documents in Figma can have tens of thousands of nodes. Be careful using this function as it could be very slow.
   * If you only need to search immediate children, it is much faster to call `node.children.find(callback)` or `node.findChild(callback)`.
   * Please refer to our [recommendations](https://developers.figma.com/docs/plugins/accessing-document#full-document-traversal) for how to optimize document traversals.
   */
  findOne(callback: (node: SceneNode) => boolean): SceneNode | null
  /**
   * Searches this entire subtree (this node's children, its children's children, etc). Returns all nodes that satisfy all of specified criteria.
   *
   * If the manifest contains `"documentAccess": "dynamic-page"`, **and** the node is a {@link PageNode}, you must first call {@link PageNode.loadAsync} to access this function.
   *
   * @param criteria - An object of type {@link FindAllCriteria} that specifies the search criteria. The following criterias are currently supported:
   * - Nodes with specific {@link NodeType | types}
   * - Nodes with {@link PluginDataMixin.getSharedPluginData | SharedPluginData } by their namespace and keys.
   * - Nodes with {@link PluginDataMixin.getPluginData | PluginData } by their keys.
   * - A combination of any of the above.
   *
   * @remarks
   *
   * This is a faster but more limited search compared to {@link ChildrenMixin.findAll}, which lets you search nodes based on any logic you can include in a callback.
   *
   * When paired with [`figma.skipInvisibleInstanceChildren = true`](https://developers.figma.com/docs/plugins/api/properties/figma-skipinvisibleinstancechildren), this method can be hundreds of times faster in large documents with tens of thousands of nodes.
   *
   * The return value is narrowly typed to match the provided `types`, which makes it much easier to use node-type-specific properties. For example, `node.findAllWithCriteria({ types: ['TEXT'] })` will return `TextNode[]` instead of the more generic `SceneNode[]` from {@link ChildrenMixin.findAll}.
   *
   * Nodes are included in **back-to-front** order, which is the same order as in {@link ChildrenMixin.findAll}. Parents always appear before their children, and children appear in same relative order before their children, and children appear in same relative order as in the {@link ChildrenMixin.children} array.
   *
   * This traversal method is known as ["pre-order traversal"](https://en.wikipedia.org/wiki/Tree_traversal#Pre-order_(NLR)).
   *
   * Note: The node this method is called on is **not included**.
   *
   * ## Example Usages
   *
   * ### Find by node type
   * ```ts
   * // Find all component and component set nodes in the current
   * // page
   * const nodes = figma.currentPage.findAllWithCriteria({
   *   types: ['COMPONENT', 'COMPONENT_SET']
   * })
   *
   * // Find all text nodes in the current page
   * const nodes = figma.currentPage.findAllWithCriteria({
   *   types: ['TEXT']
   * })
   * ```
   *
   * ### Find by plugin data
   * ```ts
   * // Find all nodes in the current page with plugin data
   * // for the current plugin.
   * const nodes = figma.currentPage.findAllWithCriteria({
   *   pluginData: {}
   * })
   *
   * // Find all nodes in the current page with plugin data
   * // for the current plugin with keys "a" or "b"
   * const nodes = figma.currentPage.findAllWithCriteria({
   *   pluginData: {
   *     keys: ["a", "b"]
   *   }
   * })
   * ```
   *
   * ### Find by shared plugin data
   * ```ts
   * // Find all nodes in the current page with shared plugin data
   * // stored on the "bar" namespace
   * const nodes = figma.currentPage.findAllWithCriteria({
   *   sharedPluginData: {
   *     namespace: "bar"
   *   }
   * })
   *
   * // Find all nodes in the current page with shared plugin data
   * // stored on the "bar" namespace and keys "a" or "b"
   * const nodes = figma.currentPage.findAllWithCriteria({
   *   sharedPluginData: {
   *     namespace: "bar",
   *     keys: ["a", "b"]
   *   }
   * })
   * ```
   *
   * ### Combining criterias
   *
   * You can combine multiple criterias for further narrow your search.
   *
   * ```ts
   * // Find all text nodes in the current page with plugin data
   * // for the current plugin
   * const nodes = figma.currentPage.findAllWithCriteria({
   *   types: ["TEXT"],
   *   pluginData: {}
   * })
   *
   * // Find all text nodes in the current page with shared plugin data
   * // stored on the "bar" namespace
   * const nodes = figma.currentPage.findAllWithCriteria({
   *   types: ["TEXT"],
   *   sharedPluginData: {
   *     namespace: "bar"
   *   }
   * })
   * ```
   */
  findAllWithCriteria<T extends NodeType[]>(
    criteria: FindAllCriteria<T>,
  ): Array<
    {
      type: T[number]
    } & SceneNode
  >
  /**
   * Searches this entire subtree (this node's children, its children's children, etc). Returns all widget nodes that match the provided `widgetId`.
   *
   * If the manifest contains `"documentAccess": "dynamic-page"`, **and** the node is a {@link PageNode}, you must first call {@link PageNode.loadAsync} to access this function.
   *
   * @param widgetId - The widget ID to search for, which represents unique identifier for the widget.
   *
   * @remarks
   *
   * `node.widgetId` is not to be confused with `node.id`, which is the unique identifier for the node on the canvas. In other words, if you clone a widget, the cloned widget will have a matching `widgetId` but a different `id`.
   */
  findWidgetNodesByWidgetId(widgetId: string): Array<WidgetNode>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface ConstraintMixin {
  /**
   * Constraints of this node relative to its containing {@link FrameNode}, if any.
   *
   * @remarks
   *
   * Not all node types have a constraint property. In particular, Group and BooleanOperation nodes do not have a constraint property themselves. Instead, resizing a frame applies the constraints on the children of those nodes.
   */
  constraints: Constraints
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface DimensionAndPositionMixin {
  /**
   * The position of the node. Identical to `relativeTransform[0][2]`.
   *
   * @remarks
   *
   * This value is automatically computed in children of auto-layout frames. Setting this property for these auto-layout children will no-op.
   */
  x: number
  /**
   * The position of the node. Identical to `relativeTransform[1][2]`.
   *
   * @remarks
   *
   * This value is automatically computed in children of auto-layout frames. Setting this property for these auto-layout children will no-op.
   */
  y: number
  /**
   * The width of the node. Use a resizing method to change this value.
   */
  readonly width: number
  /**
   * The height of the node. Use a resizing method to change this value.
   */
  readonly height: number
  /**
   * Applicable only to auto-layout frames and their direct children. Value must be positive. Set to `null` to remove `minWidth`.
   */
  minWidth: number | null
  /**
   * Applicable only to auto-layout frames and their direct children. Value must be positive. Set to `null` to remove `maxWidth`.
   */
  maxWidth: number | null
  /**
   * Applicable only to auto-layout frames and their direct children. Value must be positive. Set to null to remove `minHeight`.
   */
  minHeight: number | null
  /**
   * Applicable only to auto-layout frames and their direct children. Value must be positive. Set to `null` to remove `maxHeight`.
   */
  maxHeight: number | null
  /**
   * The position of a node relative to its **containing parent** as a {@link Transform} matrix. Not used for scaling, see `width` and `height` instead. Read the details page to understand the nuances of this property.
   *
   * @remarks
   *
   * ### Scale
   *
   * The `relativeTransform` is **not** used for scaling a node. The transform always has unit axes. That is, `sqrt(m00^2 + m10^2) == sqrt(m01^2 + m11^2) == 1`. In order to set the size of a node, use {@link LayoutMixin.resize} or {@link LayoutMixin.resizeWithoutConstraints}.
   *
   * Note: If you have a background in computer graphics, you may find it odd that we use the transform matrix in such a manner. This is because in 2D UI design, it's rare that you would want to scale the children when resizing a frame. And even if you did, it would be through more nuanced constraint settings that aren't captured by a transformation matrix.
   *
   * Also, if nodes had both a `width` and a separate `m00` scale property, it would be confusing to the users which one they're changing, especially during interactions like dragging.
   *
   * ### Container parent
   *
   * The relative transform of a node is shown relative to its container parent, which includes canvas nodes, frame nodes, component nodes, and instance nodes. Just like in the properties panel, it is **not** relative to its direct parent if the parent is a group or a boolean operation.
   *
   * Example 1: In the following hierarchy, the relative transform of `rectangle` is relative to `page` (which is just its position on the canvas).
   * ```text
   * page
   *   group
   *     rectangle
   * ```
   *
   * Example 2: In the following hierarchy, the relative transform of `rectangle` is relative to `frame`.
   * ```text
   * page
   *   frame
   *     boolean operation
   *       rectangle
   * ```
   *
   * One implication is that to calculate the absolute position of a node, you have to either use the {@link DimensionAndPositionMixin.absoluteTransform} property or multiply relative transform matrices while traversing up the node hierarchy while ignoring groups and boolean operations.
   *
   * Note: Why this complication? We do it this way because groups and boolean operations automatically resize to fit their children. While you _can_ set the relative transform of a group to move it, it's a property derived from the position and size of its children.
   * If the relative transform was always relative to it’s immediate parent, you could get into confusing situations where moving a layer inside a group by setting the relative transform changes the position of the parent, which then requires changing the relative transform of the child in order to preserve its on-screen position!
   *
   * ### Skew
   *
   * While it is possible to skew a layer by setting `m00`, `m01`, `m10`, `m11` to the right values, be aware that the skew will not be surfaced in the properties panel and may be confusing to the user dealing with a skewed node.
   *
   * ### Auto-layout frames
   *
   * The translation components `m02` and `m12` of the transform matrix is automatically computed in children of auto-layout frames. Setting `relativeTransform` on those layers will ignore the translation components, but do keep the rotation components.
   */
  relativeTransform: Transform
  /**
   * The position of a node relative to its **containing page** as a {@link Transform} matrix.
   */
  readonly absoluteTransform: Transform
  /**
   * The bounds of the node that does not include rendered properties like drop shadows or strokes. The `x` and `y` inside this property represent the absolute position of the node on the page.
   */
  readonly absoluteBoundingBox: Rect | null
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface LayoutMixin
  extends DimensionAndPositionMixin, AutoLayoutChildrenMixin, GridChildrenMixin {
  /**
   * The actual bounds of a node accounting for drop shadows, thick strokes, and anything else that may fall outside the node's regular bounding box defined in `x`, `y`, `width`, and `height`. The `x` and `y` inside this property represent the absolute position of the node on the page. This value will be `null` if the node is invisible.
   */
  readonly absoluteRenderBounds: Rect | null
  /**
   * The rotation of the node in degrees. Returns values from -180 to 180. Identical to `Math.atan2(-m10, m00)` in the {@link DimensionAndPositionMixin.relativeTransform} matrix. When setting `rotation`, it will also set `m00`, `m01`, `m10`, `m11`.
   *
   * @remarks
   *
   * The rotation is with respect to the top-left of the object. Therefore, it is independent from the position of the object. If you want to rotate with respect to the center (or any arbitrary point), you can do so via matrix transformations and {@link DimensionAndPositionMixin.relativeTransform}.
   */
  rotation: number
  /**
   * Applicable only on auto-layout frames, their children, and text nodes. This is a shorthand for setting {@link AutoLayoutChildrenMixin.layoutGrow}, {@link AutoLayoutChildrenMixin.layoutAlign}, {@link AutoLayoutMixin.primaryAxisSizingMode}, and {@link AutoLayoutMixin.counterAxisSizingMode}. This field maps directly to the "Horizontal sizing" dropdown in the Figma UI.
   *
   * @remarks
   *
   * `"HUG"` is only valid on auto-layout frames and text nodes. `"FILL"` is only valid on auto-layout children. Setting these values when they don't apply will throw an error.
   *
   * ```ts title="Setting layoutSizingHorizontal on an auto-layout frame"
   * const parentFrame = figma.createFrame()
   * const child2 = figma.createFrame()
   * parentFrame.appendChild(figma.createFrame())
   * parentFrame.appendChild(child2)
   * parentFrame.layoutMode = 'VERTICAL'
   * // Make the second child twice as wide as the first
   * child2.resize(200, 100)
   *
   * // Parent frame (child 2 is clipped)
   * // +-------------+
   * // |+-----------+|
   * // ||           ||
   * // ||  Child 1  ||
   * // ||           ||
   * // |+-----------+|
   * // |+------------|
   * // ||            |
   * // ||  Child 2   |
   * // ||            |
   * // |+------------|
   * // +-------------+
   *
   * parentFrame.layoutSizingHorizontal = 'FIXED'
   *
   * // Parent frame (child 2 is not clipped)
   * // +------------------------+
   * // |+-----------+           |
   * // ||           |           |
   * // ||  Child 1  |           |
   * // ||           |           |
   * // |+-----------+           |
   * // |+----------------------+|
   * // ||                      ||
   * // ||       Child 2        ||
   * // ||                      ||
   * // |+----------------------+|
   * // +------------------------+
   * parentFrame.layoutSizingHorizontal = 'HUG'
   * ```
   *
   * ```ts title="Setting layoutSizingHorizontal on an auto-layout child"
   * const parentFrame = figma.createFrame()
   * const child2 = figma.createFrame()
   * parentFrame.appendChild(figma.createFrame())
   * parentFrame.appendChild(child2)
   * parentFrame.layoutMode = 'HORIZONTAL'
   * parentFrame.resize(300, 100)
   *
   * // Parent frame
   * // +-------------------------------------+
   * // |+-----------++-----------+           |
   * // ||           ||           |           |
   * // ||  Child 1  ||  Child 2  |           |
   * // ||           ||           |           |
   * // |+-----------++-----------+           |
   * // +-------------------------------------+
   * child2.layoutSizingHorizontal = 'FIXED'
   *
   * // Parent frame
   * // +-------------------------------------+
   * // |+-----------++----------------------+|
   * // ||           ||                      ||
   * // ||  Child 1  ||       Child 2        ||
   * // ||           ||                      ||
   * // |+-----------++----------------------+|
   * // +-------------------------------------+
   * child2.layoutSizingHorizontal = 'FILL'
   * ```
   */
  layoutSizingHorizontal: 'FIXED' | 'HUG' | 'FILL'
  /**
   * Applicable only on auto-layout frames, their children, and text nodes. This is a shorthand for setting {@link AutoLayoutChildrenMixin.layoutGrow}, {@link AutoLayoutChildrenMixin.layoutAlign}, {@link AutoLayoutMixin.primaryAxisSizingMode}, and {@link AutoLayoutMixin.counterAxisSizingMode}. This field maps directly to the "Vertical sizing" dropdown in the Figma UI.
   *
   * @remarks
   *
   * `"HUG"` is only valid on auto-layout frames and text nodes. `"FILL"` is only valid on auto-layout children. Setting these values when they don't apply will throw an error.
   */
  layoutSizingVertical: 'FIXED' | 'HUG' | 'FILL'
  /**
   * Resizes the node. If the node contains children with constraints, it applies those constraints during resizing. If the parent has auto-layout, causes the parent to be resized.
   *
   * @param width - New width of the node. Must be >= 0.01
   * @param height - New height of the node. Must be >= 0.01, except for {@link LineNode} which must always be given a height of exactly 0.
   *
   * @remarks
   *
   * Since this function applies constraints recursively (when there are multiple levels of nested frames with constraints), calls to this function could be expensive. Use {@link LayoutMixin.resizeWithoutConstraints} if you don't need to apply constraints.
   *
   * Caution: ⚠️ If this node is a text node with a missing font or contains a text node with a missing font, the text node will be resized but the text will not re-layout until the next time the text node is opened on a machine that _has_ the font. This can cause the text node to re-layout immediately and be surprising to your user. Consider checking if the document {@link PluginAPI.hasMissingFont} before using this function.
   *
   * Ignores `targetAspectRatio`. If `targetAspectRatio` has been set, it will be updated to correspond to the post-resize value.
   */
  resize(width: number, height: number): void
  /**
   * Resizes the node. Children of the node are never resized, even if those children have constraints. If the parent has auto-layout, causes the parent to be resized (this constraint cannot be ignored).
   *
   * @param width - New width of the node. Must be >= 0.01
   * @param height - New height of the node. Must be >= 0.01, except for {@link LineNode} which must always be given a height of exactly 0.
   *
   * @remarks
   *
   * This function will not cause its children to resize. Use {@link LayoutMixin.resize} if you need to apply constraints.
   *
   * Caution: ⚠️ If this node is a text node with a missing font, the text node will be resized but the text will not re-layout until the next time the text node is opened on a machine that _has_ the font. This can cause the text node to re-layout immediately and be surprising to your user. Consider checking the text node property [`hasMissingFont`](https://developers.figma.com/docs/plugins/api/TextNode#hasmissingfont) before using this function.
   *
   * Ignores `targetAspectRatio`. If `targetAspectRatio` has been set, it will be updated to correspond to the post-resize value.
   */
  resizeWithoutConstraints(width: number, height: number): void
  /**
   * Rescales the node. This API function is the equivalent of using the Scale Tool from the toolbar.
   *
   * @param scale - The scale by which to resize the node from the top-left corner.
   *
   * @remarks
   *
   * The scale factor must be >= 0.01
   */
  rescale(scale: number): void
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface AspectRatioLockMixin {
  /**
   * When toggled, causes the layer to keep its proportions when the user resizes it via auto layout, constraints, the properties panel, or on-canvas.
   * If not set, the node does NOT resize toward a specific targetAspectRatio.
   *
   * @remarks
   *
   * Use `lockAspectRatio` and `unlockAspectRatio` to set targetAspectRatio.
   *
   * ```ts
   * const parentFrame = figma.createFrame()
   * const image = await figma.createNodeFromJSXAsync(
   *   <figma.widget.Image
   *     src="https://picsum.photos/200/300"
   *     width={200}
   *     height={300}
   *   />
   * )
   * parentFrame.appendChild(image)
   *
   * image.lockAspectRatio() // set to 2:3 ratio, implicit from the size
   *
   * // Add autolayout to parent, which defaults to Hug x Hug
   * parentFrame.layoutMode = 'HORIZONTAL'
   *
   * // Set child to fill-width
   * image.layoutGrow = 1
   *
   * // Resize parent to be much larger
   * parentFrame.resize(500, 1000)
   *
   * // Since the child is fill-width, it will expand to the available space
   * image.width == 500
   * image.height == 750
   * // Image maintains the 2:3 ratio even as it grew with auto layout!
   * ```
   *
   * Caution: ⚠️ `targetAspectRatio` cannot be used with auto-resizing text (TextNodes where textAutoResize !== NONE).
   */
  readonly targetAspectRatio: Vector | null
  /**
   * Locks the node's `targetAspectRatio` to the current ratio of its width and height.
   */
  lockAspectRatio(): void
  /**
   * Unlocks the node's `targetAspectRatio`.
   */
  unlockAspectRatio(): void
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface BlendMixin extends MinimalBlendMixin {
  /**
   * Whether this node is a mask. A mask node masks its subsequent siblings.
   *
   * @remarks
   *
   * Since a mask node masks all of its subsequent siblings, enabling `isMask` on a node that is not in a group-like container designed to stop mask propagation can have unintented consequences — that is, it may "mask" (often in practice, hide) more siblings than you intend. When enabling `isMask`, ensure you have contained its propagation propertly. ("Subsequent siblings" are siblings listed _after_ this node in a `children` array in the plugin API; this corresponds to layers shown _above_ this node in the layers panel.)
   *
   * Example:
   * ```ts
   * const rect = figma.createRectangle()
   * const circleToMask = figma.createEllipse()
   * const otherCircle1 = figma.createEllipse()
   * const otherCircle2 = figma.createEllipse()
   *
   * // In the layers panel, this would look something like:
   * // - otherCircle2
   * // - otherCircle1
   * // - circleToMask
   * // - rect
   * //
   * // So if I enable `rect.isMask`, the rect will mask ALL other nodes,
   * // because they are all siblings.
   * //
   * // If I only want `rect` to mask `circleToMask`, I should group
   * // them first.
   * figma.group([rect, circleToMask], figma.currentPage,
   *             figma.currentPage.children.indexOf(circleToMask))
   * rect.isMask = true
   *
   * // Now `rect` only masks its siblings above it in its group
   * // (`circleToMask`) but not the circles outside of the group.
   * // In the layers panel this would look like:
   * // - otherCircle2
   * // - otherCircle1
   * // - Group
   * //   - circleToMask [this is the only node masked by rect]
   * //   - rect (isMask)
   *
   * ```
   */
  isMask: boolean
  /**
   * Type of masking to use if this node is a mask. Defaults to `"ALPHA"`. You must check `isMask` to verify that this is a mask; changing `maskType` does not automatically turn on `isMask`, and a node that is not a mask can still have a `maskType`.
   */
  maskType: MaskType
  /**
   * Array of effects. See {@link Effect} type. For help on how to change this value, see [Editing Properties](https://developers.figma.com/docs/plugins/editing-properties).
   */
  effects: ReadonlyArray<Effect>
  /**
   * The id of the {@link EffectStyle} object that the properties of this node are linked to.
   *
   * If the manifest contains`"documentAccess": "dynamic-page"`, this property is read-only. Use `setEffectStyleIdAsync` to update the style.
   */
  effectStyleId: string
  /**
   * Set the {@link EffectStyle} that the properties of this node are linked to.
   */
  setEffectStyleIdAsync(styleId: string): Promise<void>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface ContainerMixin {
  /**
   * Whether this container is shown as expanded in the layers panel.
   */
  expanded: boolean
}
declare type StrokeCap =
  | 'NONE'
  | 'ROUND'
  | 'SQUARE'
  | 'ARROW_LINES'
  | 'ARROW_EQUILATERAL'
  | 'DIAMOND_FILLED'
  | 'TRIANGLE_FILLED'
  | 'CIRCLE_FILLED'
declare type StrokeJoin = 'MITER' | 'BEVEL' | 'ROUND'
declare type HandleMirroring = 'NONE' | 'ANGLE' | 'ANGLE_AND_LENGTH'
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface AutoLayoutMixin {
  /**
   * Determines whether this layer uses auto-layout to position its children. Defaults to "NONE".
   *
   * @remarks
   *
   * Changing this property will cause the position of the children of this layer to change as a side-effect. It also causes the size of this layer to change, since at least one dimension of auto-layout frames is automatically calculated.
   *
   * As a consequence, note that if a frame has `layoutMode === "NONE"`, calling `layoutMode = "VERTICAL"; layoutMode = "NONE"` does not leave the document unchanged. Removing auto-layout from a frame does not restore the children to their original positions.
   *
   * This property must be set to `"HORIZONTAL"` or `"VERTICAL"` in order for the {@link AutoLayoutMixin.primaryAxisSizingMode}, {@link AutoLayoutMixin.counterAxisSizingMode}, {@link AutoLayoutMixin.layoutWrap}, {@link AutoLayoutMixin.primaryAxisAlignItems}, {@link AutoLayoutMixin.counterAxisAlignItems}, {@link AutoLayoutMixin.counterAxisAlignContent}, {@link AutoLayoutMixin.paddingTop}, {@link AutoLayoutMixin.paddingBottom}, {@link AutoLayoutMixin.paddingLeft}, {@link AutoLayoutMixin.paddingRight}, {@link AutoLayoutMixin.itemSpacing}, {@link AutoLayoutMixin.counterAxisSpacing}, {@link AutoLayoutMixin.itemReverseZIndex}, and {@link AutoLayoutMixin.strokesIncludedInLayout} properties to be applicable.
   *
   * Note: `GRID` is not supported for Slot frames, and setting `GRID` will throw a cannotApplyGridToSlot error.
   *
   * ```ts title="Auto-layout frame with horizontal layout"
   * const parentFrame = figma.createFrame()
   * parentFrame.appendChild(figma.createFrame())
   * parentFrame.appendChild(figma.createFrame())
   *
   * // Parent frame
   * // +--------------------------+
   * // |+-----------++-----------+|
   * // ||           ||           ||
   * // ||  Child 1  ||  Child 2  ||
   * // ||           ||           ||
   * // |+-----------++-----------+|
   * // +--------------------------+
   * parentFrame.layoutMode = 'HORIZONTAL'
   * ```
   *
   * ```ts title="Auto-layout frame with vertical layout"
   * const parentFrame = figma.createFrame()
   * parentFrame.appendChild(figma.createFrame())
   * parentFrame.appendChild(figma.createFrame())
   *
   * // Parent frame
   * // +-------------+
   * // |+-----------+|
   * // ||           ||
   * // ||  Child 1  ||
   * // ||           ||
   * // |+-----------+|
   * // |+-----------+|
   * // ||           ||
   * // ||  Child 2  ||
   * // ||           ||
   * // |+-----------+|
   * // +-------------+
   * parentFrame.layoutMode = 'VERTICAL'
   */
  layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID'
  /**
   * Applicable only on auto-layout frames. Determines the left padding between the border of the frame and its children.
   */
  paddingLeft: number
  /**
   * Applicable only on auto-layout frames. Determines the right padding between the border of the frame and its children.
   */
  paddingRight: number
  /**
   * Applicable only on auto-layout frames. Determines the top padding between the border of the frame and its children.
   */
  paddingTop: number
  /**
   * Applicable only on auto-layout frames. Determines the bottom padding between the border of the frame and its children.
   */
  paddingBottom: number
  /**
   * Applicable only on auto-layout frames. Determines whether the primary axis has a fixed length (determined by the user) or an automatic length (determined by the layout engine).
   *
   * @remarks
   *
   * Auto-layout frames have a **primary axis**, which is the axis that resizes when you add new items into the frame. For example, frames with "VERTICAL" {@link AutoLayoutMixin.layoutMode} resize in the y-axis.
   *
   * - `"FIXED"`: The primary axis length is determined by the user or plugins, unless the {@link AutoLayoutChildrenMixin.layoutAlign} is set to “STRETCH” or {@link AutoLayoutChildrenMixin.layoutGrow} is 1.
   * - `"AUTO"`: The primary axis length is determined by the size of the children. If set, the auto-layout frame will automatically resize along the counter axis to fit its children.
   *
   * Note: `“AUTO”` should not be used in any axes where {@link AutoLayoutChildrenMixin.layoutAlign} = “STRETCH” or {@link AutoLayoutChildrenMixin.layoutGrow} = 1. Either use `“FIXED”` or disable {@link AutoLayoutChildrenMixin.layoutAlign}/{@link AutoLayoutChildrenMixin.layoutGrow}.
   */
  primaryAxisSizingMode: 'FIXED' | 'AUTO'
  /**
   * Applicable only on auto-layout frames. Determines whether the counter axis has a fixed length (determined by the user) or an automatic length (determined by the layout engine).
   *
   * @remarks
   *
   * Auto-layout frames have a **primary axis**, which is the axis that resizes when you add new items into the frame. For example, frames with "VERTICAL" {@link AutoLayoutMixin.layoutMode} resize in the y-axis.
   *
   * The other axis is called the **counter axis**.
   * - `"FIXED"`: The counter axis length is determined by the user or plugins, unless the {@link AutoLayoutChildrenMixin.layoutAlign} is set to “STRETCH” or {@link AutoLayoutChildrenMixin.layoutGrow} is 1.
   * - `"AUTO"`: The counter axis length is determined by the size of the children. If set, the auto-layout frame will automatically resize along the counter axis to fit its children.
   *
   * Note: `“AUTO”` cannot be used in any axes where {@link AutoLayoutChildrenMixin.layoutAlign} = “STRETCH” or {@link AutoLayoutChildrenMixin.layoutGrow} = 1. Either use `“FIXED”` or disable {@link AutoLayoutChildrenMixin.layoutAlign}/{@link AutoLayoutChildrenMixin.layoutGrow}.
   *
   * ```ts title="Horizontal auto-layout frame with different counterAxisSizingMode values"
   * const parentFrame = figma.createFrame()
   * const child2 = figma.createFrame()
   * // Make the second child 200px high instead of the default 100px
   * child2.resize(100, 200)
   * parentFrame.appendChild(figma.createFrame())
   * parentFrame.appendChild(child2)
   * parentFrame.layoutMode = 'HORIZONTAL'
   *
   * // Parent frame
   * // +--------------------------+
   * // |+-----------++-----------+|
   * // ||           ||           ||
   * // ||  Child 1  ||  Child 2  ||
   * // ||           ||           ||
   * // |+-----------+|           ||
   * // +--------------------------+
   * parentFrame.counterAxisSizingMode = 'FIXED' // Child 2 is clipped
   *
   * // Parent frame
   * // +--------------------------+
   * // |+-----------++-----------+|
   * // ||           ||           ||
   * // ||  Child 1  ||  Child 2  ||
   * // ||           ||           ||
   * // |+-----------+|           ||
   * // |             |           ||
   * // |             |           ||
   * // |             +-----------+|
   * // +--------------------------+
   * parentFrame.counterAxisSizingMode = 'AUTO'
   * ```
   */
  counterAxisSizingMode: 'FIXED' | 'AUTO'
  /**
   * Applicable only on auto-layout frames. Determines whether strokes are included in [layout calculations](https://help.figma.com/hc/en-us/articles/31289464393751-Use-the-horizontal-and-vertical-flows-in-auto-layout#01JT9NA4HVT02ZPE7BA86SFCD6). When true, auto-layout frames behave like css `box-sizing: border-box`.
   *
   * @remarks
   *
   * ```ts title="Auto-layout frame with strokes included in layout"
   * const parentFrame = figma.createFrame()
   * parentFrame.appendChild(figma.createFrame())
   * parentFrame.appendChild(figma.createFrame())
   * parentFrame.layoutMode = 'HORIZONTAL'
   * // Let the height of the parent frame resize to fit the children
   * parentFrame.counterAxisSizingMode = 'AUTO'
   *
   * // Thick stroke around parent frame to illustrate layout differences
   * parentFrame.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }}]
   * parentFrame.strokeWeight = 10
   *
   * // Parent frame (strokes overlap with children)
   * // +--------------------------+
   * // |+-----------++-----------+|
   * // ||           ||           ||
   * // ||  Child 1  ||  Child 2  ||
   * // ||           ||           ||
   * // |+-----------++-----------+|
   * // +--------------------------+
   * parentFrame.strokesIncludedInLayout = false
   *
   * // Parent frame (strokes do not overlap with children)
   * // +--------------------------------+
   * // |                                |
   * // |   +-----------++-----------+   |
   * // |   |           ||           |   |
   * // |   |  Child 1  ||  Child 2  |   |
   * // |   |           ||           |   |
   * // |   +-----------++-----------+   |
   * // |                                |
   * // +--------------------------------+
   * parentFrame.strokesIncludedInLayout = true
   * ```
   */
  strokesIncludedInLayout: boolean
  /**
   * Determines whether this layer should use wrapping auto-layout. Defaults to `"NO_WRAP"`.
   *
   * @remarks
   *
   * This property can only be set on layers with `layoutMode === "HORIZONTAL"`. Setting it on layers without this property will throw an Error.
   *
   * This property must be set to `"WRAP"` in order for the {@link AutoLayoutMixin.counterAxisSpacing} and {@link AutoLayoutMixin.counterAxisAlignContent} properties to be applicable.
   */
  layoutWrap: 'NO_WRAP' | 'WRAP'
  /**
   * Applicable only on "HORIZONTAL" or "VERTICAL" auto-layout frames. Determines how the auto-layout frame’s children should be aligned in the primary axis direction.
   *
   * @remarks
   *
   * Changing this property will cause all the children to update their `x` and `y` values.
   *
   * - In horizontal auto-layout frames, `“MIN”` and `“MAX”` correspond to left and right respectively.
   * - In vertical auto-layout frames, `“MIN”` and `“MAX”` correspond to top and bottom respectively.
   * - `“SPACE_BETWEEN”` will space the children evenly along the primary axis, only putting the extra space between the children. The first and last child are flush with the edges of the frame.
   * - `“SPACE_EVENLY”` will space the children evenly along the primary axis, dividing the extra space equally in the spaces before the first child, between each pair of items, and after the last child.
   * - `“SPACE_AROUND”` will space the children evenly along the primary axis such that the spacing between each pair of items is equal, and the empty space before the first and after the last child is equal to half the space between items.
   *
   * The corresponding property for the counter axis direction is {@link AutoLayoutMixin.counterAxisAlignItems}.
   *
   * ```ts title="Horizontal auto-layout frame with different primaryAxisAlignItems values"
   * const parentFrame = figma.createFrame()
   * parentFrame.appendChild(figma.createFrame())
   * parentFrame.appendChild(figma.createFrame())
   * parentFrame.layoutMode = 'HORIZONTAL'
   *
   * // Make the parent frame wider so we can see the effects of
   * // the different primaryAxisAlignItems values
   * parentFrame.resize(300, 100)
   *
   * // Parent frame
   * // +--------------------------------------+
   * // |+-----------++-----------+            |
   * // ||           ||           |            |
   * // ||  Child 1  ||  Child 2  |            |
   * // ||           ||           |            |
   * // |+-----------++-----------+            |
   * // +--------------------------------------+
   * parentFrame.primaryAxisAlignItems = 'MIN'
   *
   * // Parent frame
   * // +--------------------------------------+
   * // |            +-----------++-----------+|
   * // |            |           ||           ||
   * // |            |  Child 1  ||  Child 2  ||
   * // |            |           ||           ||
   * // |            +-----------++-----------+|
   * // +--------------------------------------+
   * parentFrame.primaryAxisAlignItems = 'MAX'
   *
   * // Parent frame
   * // +--------------------------------------+
   * // |      +-----------++-----------+      |
   * // |      |           ||           |      |
   * // |      |  Child 1  ||  Child 2  |      |
   * // |      |           ||           |      |
   * // |      +-----------++-----------+      |
   * // +--------------------------------------+
   * parentFrame.primaryAxisAlignItems = 'CENTER'
   *
   * // Parent frame
   * // +--------------------------------------+
   * // |+-----------+            +-----------+|
   * // ||           |            |           ||
   * // ||  Child 1  |            |  Child 2  ||
   * // ||           |            |           ||
   * // |+-----------+            +-----------+|
   * // +--------------------------------------+
   * parentFrame.primaryAxisAlignItems = 'SPACE_BETWEEN'
   *
   * // Parent frame
   * // +--------------------------------------+
   * // |    +-----------+    +-----------+    |
   * // |    |           |    |           |    |
   * // |----|  Child 1  |----|  Child 2  |----|
   * // |    |           |    |           |    |
   * // |    +-----------+    +-----------+    |
   * // +--------------------------------------+
   * parentFrame.primaryAxisAlignItems = 'SPACE_EVENLY'
   *
   * // Parent frame
   * // +--------------------------------------+
   * // |   +-----------+      +-----------+   |
   * // |   |           |      |           |   |
   * // |---|  Child 1  |------|  Child 2  |---|
   * // |   |           |      |           |   |
   * // |   +-----------+      +-----------+   |
   * // +--------------------------------------+
   * parentFrame.primaryAxisAlignItems = 'SPACE_AROUND'
   * ```
   */
  primaryAxisAlignItems:
    'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN' | 'SPACE_EVENLY' | 'SPACE_AROUND'
  /**
   * Applicable only on "HORIZONTAL" or "VERTICAL" auto-layout frames. Determines how the auto-layout frame’s children should be aligned in the counter axis direction.
   *
   * @remarks
   *
   * Changing this property will cause all the children to update their `x` and `y` values.
   *
   * - In horizontal auto-layout frames, `“MIN”` and `“MAX”` correspond to top and bottom respectively.
   * - In vertical auto-layout frames, `“MIN”` and `“MAX”` correspond to left and right respectively.
   * - `"BASELINE"` can only be set on horizontal auto-layout frames, and aligns all children along the [text baseline](https://help.figma.com/hc/en-us/articles/360040451373-Explore-auto-layout-properties#Text_baseline_alignment).
   *
   * The corresponding property for the primary axis direction is {@link AutoLayoutMixin.primaryAxisAlignItems}.
   *
   * ```ts title="Horizontal auto-layout frame with different counterAxisAlignItems values"
   * (async () => {
   *   const parentFrame = figma.createFrame()
   *   const text = figma.createText()
   *   await figma.loadFontAsync(text.fontName)
   *   text.characters = 'asdf'
   *   // Make the text taller so we can see how text baseline alignment works
   *   text.lineHeight = {unit: 'PERCENT', value: 300}
   *
   *   // Auto-layout frame will have 2 children: a frame and a text node
   *   parentFrame.appendChild(figma.createFrame())
   *   parentFrame.appendChild(text)
   *   parentFrame.layoutMode = 'HORIZONTAL'
   *
   *   // Make the parent frame taller so we can see the effects of
   *   // the different counterAxisAlignItems values
   *   parentFrame.resize(200, 150)
   *
   *   // Parent frame
   *   // +--------------------------+
   *   // |+-----------++----+       |
   *   // ||           ||    |       |
   *   // ||  Child 1  ||asdf|       |
   *   // ||           ||    |       |
   *   // |+-----------++----+       |
   *   // |                          |
   *   // |                          |
   *   // +--------------------------+
   *   parentFrame.counterAxisAlignItems = 'MIN'
   *
   *   // Parent frame
   *   // +--------------------------+
   *   // |                          |
   *   // |                          |
   *   // |+-----------++----+       |
   *   // ||           ||    |       |
   *   // ||  Child 1  ||asdf|       |
   *   // ||           ||    |       |
   *   // |+-----------++----+       |
   *   // +--------------------------+
   *   parentFrame.counterAxisAlignItems = 'MAX'
   *
   *   // Parent frame
   *   // +--------------------------+
   *   // |                          |
   *   // |+-----------++----+       |
   *   // ||           ||    |       |
   *   // ||  Child 1  ||asdf|       |
   *   // ||           ||    |       |
   *   // |+-----------++----+       |
   *   // |                          |
   *   // +--------------------------+
   *   parentFrame.counterAxisAlignItems = 'CENTER'
   *
   *   // Parent frame
   *   // +--------------------------+
   *   // |+-----------+             |
   *   // ||           |+----+       |
   *   // ||  Child 1  ||    |       |
   *   // ||           ||asdf|       |
   *   // |+-----------+|    |       |
   *   // |             +----+       |
   *   // |                          |
   *   // +--------------------------+
   *   parentFrame.counterAxisAlignItems = 'BASELINE'
   * })()
   * ```
   */
  counterAxisAlignItems: 'MIN' | 'MAX' | 'CENTER' | 'BASELINE'
  /**
   * Applicable only on auto-layout frames with {@link AutoLayoutMixin.layoutWrap} set to `"WRAP"`. Determines how the wrapped tracks are spaced out inside of the auto-layout frame.
   *
   * @remarks
   *
   * Changing this property on a non-wrapping auto-layout frame will throw an error.
   *
   * - `"AUTO"`: If all children of this auto-layout frame have {@link AutoLayoutChildrenMixin.layoutAlign} set to `"STRETCH"`, the tracks will stretch to fill the auto-layout frame. This is like flexbox `align-content: stretch`. Otherwise, each track will be as tall as the tallest child of the track, and will align based on the value of {@link AutoLayoutMixin.counterAxisAlignItems}. This is like flexbox `align-content: start | center | end`. {@link AutoLayoutMixin.counterAxisSpacing} is respected when `counterAxisAlignContent` is set to `"AUTO"`.
   * - `"SPACE_BETWEEN"`: Tracks are all sized based on the tallest child in the track. The free space within the auto-layout frame is divided up evenly between each track. If the total height of all tracks is taller than the height of the auto-layout frame, the spacing will be 0.
   */
  counterAxisAlignContent: 'AUTO' | 'SPACE_BETWEEN'
  /**
   * Applicable only on "HORIZONTAL" or "VERTICAL" auto-layout frames. Determines distance between children of the frame.
   *
   * @remarks
   *
   * For auto-layout frames with {@link AutoLayoutMixin.layoutMode} set to `"HORIZONTAL"`, this is the horizontal gap between children. For auto-layout frames with {@link AutoLayoutMixin.layoutMode} set to `"VERTICAL"`, this is the vertical gap between children.
   *
   * ```ts title="Auto-layout frame with a horizontal gap between children"
   * const parentFrame = figma.createFrame()
   * parentFrame.appendChild(figma.createFrame())
   * parentFrame.appendChild(figma.createFrame())
   * parentFrame.layoutMode = 'HORIZONTAL'
   *
   * // Parent frame
   * // +------------------------------------+
   * // |+-----------+          +-----------+|
   * // ||           |          |           ||
   * // ||  Child 1  | -- 20 -- |  Child 2  ||
   * // ||           |          |           ||
   * // |+-----------+          +-----------+|
   * // +------------------------------------+
   * parentFrame.itemSpacing = 20
   * ```
   *
   * ```ts title="Auto-layout frame with a vertical gap between children"
   * const parentFrame = figma.createFrame()
   * parentFrame.appendChild(figma.createFrame())
   * parentFrame.appendChild(figma.createFrame())
   * parentFrame.layoutMode = 'VERTICAL'
   *
   * // Parent frame
   * // +-------------+
   * // |+-----------+|
   * // ||           ||
   * // ||  Child 1  ||
   * // ||           ||
   * // |+-----------+|
   * // |      |      |
   * // |      |      |
   * // |      20     |
   * // |      |      |
   * // |      |      |
   * // |+-----------+|
   * // ||           ||
   * // ||  Child 2  ||
   * // ||           ||
   * // |+-----------+|
   * // +-------------+
   * parentFrame.itemSpacing = 20
   * ```
   */
  itemSpacing: number
  /**
   * Applicable only on "HORIZONTAL" or "VERTICAL" auto-layout frames with {@link AutoLayoutMixin.layoutWrap} set to `"WRAP"`. Determines the distance between wrapped tracks. The value must be positive.
   *
   * @remarks
   *
   * Set this propety to `null` to have it sync with {@link AutoLayoutMixin.itemSpacing}. This will never return `null`. Once set to `null`, it will start returning the value of {@link AutoLayoutMixin.itemSpacing}.
   *
   * ```ts title="Auto-layout frame with children wrapping to the next line"
   * const parentFrame = figma.createFrame()
   * parentFrame.appendChild(figma.createFrame())
   * parentFrame.appendChild(figma.createFrame())
   * parentFrame.appendChild(figma.createFrame())
   *
   * // Make children flow horizontally and wrap
   * parentFrame.layoutMode = 'HORIZONTAL'
   * parentFrame.layoutWrap = 'WRAP'
   *
   * // Set a fixed width so when we set itemSpacing below, the children will wrap
   * parentFrame.primaryAxisSizingMode = 'FIXED'
   *
   * // Let the height of the parent frame resize to fit the children
   * parentFrame.counterAxisSizingMode = 'AUTO'
   *
   * // Horizontal gap between children
   * parentFrame.itemSpacing = 10
   *
   * // Parent frame
   * // +------------------------------------------+
   * // |+-----------+          +-----------+      |
   * // ||           |          |           |      |
   * // ||  Child 1  | -- 10 -- |  Child 2  |      |
   * // ||           |          |           |      |
   * // |+-----------+          +-----------+      |
   * // |      |                                   |
   * // |      |                                   |
   * // |      20                                  |
   * // |      |                                   |
   * // |      |                                   |
   * // |+-----------+                             |
   * // ||           |                             |
   * // ||  Child 3  |                             |
   * // ||           |                             |
   * // |+-----------+                             |
   * // +------------------------------------------+
   * parentFrame.counterAxisSpacing = 20
   * ```
   */
  counterAxisSpacing: number | null
  /**
   * Applicable only on "HORIZONTAL" or "VERTICAL" auto-layout frames. Determines the [canvas stacking order](https://help.figma.com/hc/en-us/articles/360040451373-Explore-auto-layout-properties#Canvas_stacking_order) of layers in this frame. When true, the first layer will be draw on top.
   *
   * @remarks
   *
   * ```ts title="Auto-layout frame with different canvas stacking"
   * const parentFrame = figma.createFrame()
   * // Create red and green children so we can see the overlap
   * const child1 = figma.createFrame()
   * child1.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }}]
   * const child2 = figma.createFrame()
   * child2.fills = [{ type: 'SOLID', color: { r: 0, g: 1, b: 0 }}]
   * parentFrame.appendChild(child1)
   * parentFrame.appendChild(child2)
   * parentFrame.layoutMode = 'HORIZONTAL'
   * // Negative horizontal gap between children so they overlap
   * parentFrame.itemSpacing = -20
   *
   * // Parent frame (last child on top)
   * // +---------------------+
   * // |+-------+-----------+|
   * // ||       |           ||
   * // ||Child 1|  Child 2  ||
   * // ||       |           ||
   * // |+-------+-----------+|
   * // +---------------------+
   * parentFrame.itemReverseZIndex = false
   *
   * // Parent frame (first child on top)
   * // +---------------------+
   * // |+-----------+-------+|
   * // ||           |       ||
   * // ||  Child 1  |Child 2||
   * // ||           |       ||
   * // |+-----------+-------+|
   * // +---------------------+
   * parentFrame.itemReverseZIndex = true
   * ```
   */
  itemReverseZIndex: boolean
}
/**
 * @see https://developers.figma.com/docs/plugins/api/GridTrackSize
 */
interface GridTrackSize {
  /**
   * Applicable only on FIXED or FLEX grid tracks. In FIXED tracks, the size of the track in pixels. In FLEX tracks, the fractional unit value (equivalent to the [`fr` unit](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Basic_concepts_of_grid_layout#the_fr_unit) in CSS)
   * Optional for `FLEX` tracks.
   */
  value?: number
  /**
   * The type of the grid track. `FLEX` indicates that the track behaves like the CSS grid [`fr` unit](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Basic_concepts_of_grid_layout#the_fr_unit).
   * `FIXED` indicates that the track will have a fixed pixel size.
   * `HUG` indicates that the track will size to fit its content, equivalent to a CSS setting of `fit-content(100%)`.
   * It is not a valid state for 'FLEX' tracks to be set on a grid when the container is set to layoutSizingHorizonal/layoutSizingVertical 'HUG'
   **/
  type: 'FLEX' | 'FIXED' | 'HUG'
}
/**
 * Options for {@link GridLayoutMixin.reorderRows} and {@link GridLayoutMixin.reorderColumns}.
 * @see https://developers.figma.com/docs/plugins/api/GridTrackReorderOptions
 */
interface GridTrackReorderOptions {
  /**
   * The indices of the rows or columns (tracks) to move. Does not need to be sorted, contiguous, or deduplicated.
   * All indices must be within bounds for the current number of rows or columns.
   */
  fromIndices: ReadonlyArray<number>
  /**
   * The index to insert the selected rows or columns (tracks) at. This is evaluated against the original
   * row/column order (before the move).
   *
   * As an example, take a grid with 4 columns and 2 rows.
   * fromIndices could be 0 to 3 (inclusive), and insertionIndex could be 0 to 4 (inclusive).
   *
   * ```
   *   0         1         2         3         4 ← possible insertion indices
   * ---- 0 --- --- 1 --- --- 2 --- --- 3 ----   ← track indices
   * +-------------------+---------+---------+
   * |                   |         |         |
   * |                   |         |         |
   * +---------+---------+---------+---------+
   * |         |         |         |         |
   * |         |         |         |         |
   * +---------+---------+---------+---------+
   * ```
   */
  insertionIndex: number
}
/**
 * Describes a single row or column (track)'s movement for a call to {@link GridLayoutMixin.reorderRows}
 *
 * @see https://developers.figma.com/docs/plugins/api/GridTrackReorderEntry
 */
interface GridTrackReorderEntry {
  /** The original index of the track before the reorder. */
  from: number
  /** The new index of the track after the reorder. */
  to: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface GridLayoutMixin {
  /**
   * Applicable only on auto-layout frames with `layoutMode` set to `"GRID"`. Determines the number of rows in the grid.
   *
   * @remarks
   *
   * If the setter for this value is called on a grid with a value less than 1, it will throw an error.
   * Users cannot remove rows from a grid if they are occupied by children, so if you try to reduce the count of rows in a grid and some of those rows have children, it will throw an error.
   * By default, when the row count is increased, the new rows will be added as {@link GridTrackSize} objects with type `"FLEX"`. If you want to change the type of the new rows, you can use the setters on GridTrackSize objects returned by {@link GridLayoutMixin.gridRowSizes} or {@link GridLayoutMixin.gridColumnSizes}.
   *
   * Caution: ⚠️ Setting `gridRowCount` will throw an error if {@link GridLayoutMixin.gridAutoTracks} is set to `"ROWS"`, since the row count is managed automatically.
   * Add or remove children to change the number of rows instead, or set `gridAutoTracks` to `NONE` before setting `gridRowCount`.
   *
   * ```ts title="Grid layout with 2 rows and 3 columns"
   * const parentFrame = figma.createFrame()
   * parentFrame.layoutMode = 'GRID'
   * parentFrame.gridRowCount = 2
   * parentFrame.gridColumnCount = 3
   *
   * // Grid frame with 2 rows and 3 columns
   * // + --- + --- + --- +
   * // |     |     |     |
   * // + --- + --- + --- +
   * // |     |     |     |
   * // + --- + --- + --- +
   * ```
   */
  gridRowCount: number
  /**
   * Applicable only on auto-layout frames with `layoutMode` set to `"GRID"`. Determines the number of columns in the grid.
   * @remarks
   * If the setter for this value is called on a grid with a value less than 1, it will throw an error.
   * Users cannot remove columns from a grid if they are occupied by children, so if you try to reduce the count of columns in a grid and some of those columns have children, it will throw an error.
   * By default, when the column count is increased, the new columns will be added as {@link GridTrackSize} objects with type `"FLEX"`. If you want to change the type of the new columns, you can use the setters on GridTrackSize objects returned by {@link GridLayoutMixin.gridRowSizes} or {@link GridLayoutMixin.gridColumnSizes}.
   */
  gridColumnCount: number
  /**
   * Applicable only on auto-layout frames with `layoutMode` set to `"GRID"`. Determines the gap between rows in the grid.
   * @remarks
   * If the setter for this value is called on a grid with a value less than 0, it will throw an error.
   */
  gridRowGap: number
  /**
   * Applicable only on auto-layout frames with `layoutMode` set to `"GRID"`. Determines the gap between columns in the grid.
   * @remarks
   * If the setter for this value is called on a grid with a value less than 0, it will throw an error.
   */
  gridColumnGap: number
  /**
   * Only applicable on auto-layout frames with `layoutMode` set to `"GRID"`.
   * Returns an array of {@link GridTrackSize} objects representing the rows in the grid in order.
   *
   * @remarks
   * The order of the rows is from top to bottom.
   * The {@link GridTrackSize} can be used to change the type of the row (either `"FLEX"` or `"FIXED"`) and the size of the track (if it is a `"FIXED"` track).
   *
   * ```ts title="Grid layout with mixed track sizes and types"
   * const parentFrame = figma.createFrame()
   * parentFrame.layoutMode = 'GRID'
   * parentFrame.gridRowCount = 2
   * parentFrame.gridColumnCount = 3
   *
   * // Change the first row to be a fixed size of 100px
   * parentFrame.gridRowSizes[0].type // 'FLEX'
   * parentFrame.gridRowSizes[0].type = 'FIXED'
   * parentFrame.gridRowSizes[0].value = 100
   * parentFrame.gridRowSizes[0].type // 'FIXED'
   * // Grid with one fixed row and one flexible rows
   * // + --- + --- + --- +
   * // |     |     |     | 100px height
   * // + --- + --- + --- +
   * // |     |     |     |
   * // |     |     |     | 'flex' height
   * // |     |     |     |  occupies remaining height in the container, because there is only one flex row.
   * // |     |     |     |
   * // + --- + --- + --- +
   * ```
   */
  gridRowSizes: Array<GridTrackSize>
  /**
   * Only applicable on auto-layout frames with `layoutMode` set to `"GRID"`.
   * Returns an array of {@link GridTrackSize} objects representing the columns in the grid in order.
   * @remarks
   * The order of the columns is from left to right.
   * The {@link GridTrackSize} can be used to change the type of the column (either `"FLEX"` or `"FIXED"`) and the size of the track (if it is a `"FIXED"` track).
   */
  gridColumnSizes: Array<GridTrackSize>
  /**
   * Applicable only on auto-layout frames with `layoutMode` set to `"GRID"`.
   * Appends a node to the grid at the specified row and column index.
   * @remarks
   * If the specified row or column index is out of bounds, it will throw an error.
   * If the specified row or column index is occupied by another node, it will throw an error.
   * If the node is already a child of the grid, it will be removed from its current position and appended to the new position.
   * ```ts title="Appending a node to a grid at a specific row and column index"
   * // + --- + --- + --- +
   * // |     |     |     |
   * // + --- + --- + --- +
   * // |     |     |     |
   * // + --- + --- + --- +
   * // |     |     |     |
   * // + --- + --- + --- +
   * const grid = figma.createFrame()
   * grid.layoutMode = 'GRID'
   * grid.gridRowCount = 3
   * grid.gridColumnCount = 3
   *
   * const child1 = figma.createFrame()
   * const child2 = figma.createFrame()
   * const child2 = figma.createFrame()
   *
   * // + --- + --- + --- +
   * // |  1  |     |     |
   * // + --- + --- + --- +
   * // |  2  |     |     |
   * // + --- + --- + --- +
   * // |  3  |     |     |
   * // + --- + --- + --- +
   * grid.appendChildAt(child1, 0, 0)
   * grid.appendChildAt(child2, 1, 0)
   * grid.appendChildAt(child3, 2, 0)
   * ```
   */
  appendChildAt(node: SceneNode, rowIndex: number, columnIndex: number): void
  /**
   * Applicable only on auto-layout frames with `layoutMode` set to `"GRID"`.
   * Controls how the grid handles automatic row creation.
   *
   * @remarks
   * - `"NONE"` (default): the row count is controlled by {@link GridLayoutMixin.gridRowCount},
   *   but will never go below the number of rows necessary to hold all children in the grid.
   * - `"ROWS"`: new rows are added automatically as children are appended, and removed when
   *   a row becomes empty. Setting {@link GridLayoutMixin.gridRowCount} directly will throw
   *   an error while this is set to `"ROWS"`.
   *
   * ```ts title="Grid with automatic rows"
   * const grid = figma.createFrame()
   * grid.layoutMode = 'GRID'
   * grid.gridColumnCount = 3
   * grid.gridAutoTracks = 'ROWS'
   *
   * // The grid starts with 1 row and 3 columns.
   * // Appending more children than the grid can fit
   * // automatically adds new rows.
   * for (let i = 0; i < 7; i++) {
   *   grid.appendChild(figma.createFrame())
   * }
   * // + --- + --- + --- +
   * // |  1  |  2  |  3  |
   * // + --- + --- + --- +
   * // |  4  |  5  |  6  |
   * // + --- + --- + --- +
   * // |  7  |     |     |
   * // + --- + --- + --- +
   * grid.gridRowCount // 3 (auto-managed)
   * ```
   */
  gridAutoTracks: 'NONE' | 'ROWS'
  /**
   * Applicable only on auto-layout frames with `layoutMode` set to `"GRID"`.
   * Controls how children are positioned within the grid.
   *
   * @remarks
   * - `"MANUAL"` (default): children stay at the grid cell they are placed in. Use
   *   {@link GridChildrenMixin.setGridChildPosition} or {@link GridLayoutMixin.appendChildAt}
   *   to position children explicitly.
   * - `"ROW_AUTO_FLOW"`: children are placed by layer order into the next available cell in
   *   row-major order (left to right, top to bottom), similar to CSS
   *   [`grid-auto-flow: row`](https://developer.mozilla.org/en-US/docs/Web/CSS/grid-auto-flow).
   *   Calling {@link GridChildrenMixin.setGridChildPosition} will throw an error in this mode —
   *   reorder children using {@link ChildrenMixin.insertChild} instead.
   *
   * ```ts title="Grid with automatic item positioning"
   * const grid = figma.createFrame()
   * grid.layoutMode = 'GRID'
   * grid.gridColumnCount = 2
   * grid.gridAutoTracks = 'ROWS'
   * grid.gridItemsPositioning = 'ROW_AUTO_FLOW'
   *
   * const a = figma.createFrame()
   * const b = figma.createFrame()
   * const c = figma.createFrame()
   * grid.appendChild(a)
   * grid.appendChild(b)
   * grid.appendChild(c)
   *
   * // Children flow automatically:
   * // + --- + --- +
   * // |  a  |  b  |
   * // + --- + --- +
   * // |  c  |     |
   * // + --- + --- +
   * ```
   */
  gridItemsPositioning: 'MANUAL' | 'ROW_AUTO_FLOW'
  /**
   * Applicable only on auto-layout frames with `layoutMode` set to `"GRID"`.
   * Moves one or more rows to a new position in the grid, shifting other rows as needed.
   *
   * @remarks
   * If a child in one of the selected rows spans multiple rows, all of those spanned rows
   * are automatically included in the move. The returned array describes both the input tracks and any
   * tracks that were added implicitly due to spanning.
   *
   * All values in `fromIndices` must be in the range `[0, gridRowCount)` and `insertionIndex`
   * must be in the range `[0, gridRowCount]`, otherwise an error will be thrown. If an error
   * is thrown, the grid is left unchanged.
   *
   * ```ts title="Moving the first row to the end of the grid"
   * const grid = figma.createFrame()
   * grid.layoutMode = 'GRID'
   * grid.gridRowCount = 3
   * grid.gridColumnCount = 2
   *
   * // Populate the grid
   * for (let i = 0; i < 6; i++) {
   *   grid.appendChild(figma.createFrame())
   * }
   * // Before:
   * // + --- + --- +
   * // |  1  |  2  |  <- row 0
   * // + --- + --- +
   * // |  3  |  4  |  <- row 1
   * // + --- + --- +
   * // |  5  |  6  |  <- row 2
   * // + --- + --- +
   *
   * const moves = grid.reorderRows({ fromIndices: [0], insertionIndex: 3 })
   * // After:
   * // + --- + --- +
   * // |  3  |  4  |
   * // + --- + --- +
   * // |  5  |  6  |
   * // + --- + --- +
   * // |  1  |  2  |
   * // + --- + --- +
   * // moves => [{ from: 0, to: 2 }, { from: 1, to: 0 }, { from: 2, to: 1 }]
   * ```
   */
  reorderRows(options: GridTrackReorderOptions): ReadonlyArray<GridTrackReorderEntry>
  /**
   * Applicable only on auto-layout frames with `layoutMode` set to `"GRID"`.
   * Moves one or more columns to a new position in the grid, shifting other columns as needed.
   *
   * @remarks
   * If a child in one of the selected columns spans multiple columns, all of those spanned columns
   * are automatically included in the move.  The returned array describes both the input tracks and
   * any tracks that were added implicitly due to spanning.
   *
   * All values in `fromIndices` must be in the range `[0, gridColumnCount)` and `insertionIndex`
   * must be in the range `[0, gridColumnCount]`, otherwise an error will be thrown. If an error
   * is thrown, the grid is left unchanged.
   */
  reorderColumns(options: GridTrackReorderOptions): ReadonlyArray<GridTrackReorderEntry>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface AutoLayoutChildrenMixin {
  /**
   * Applicable only on direct children of auto-layout frames. Determines if the layer should stretch along the parent’s counter axis. Defaults to `“INHERIT”`.
   *
   * @remarks
   *
   * Changing this property will cause the `x`, `y`, `size`, and `relativeTransform` properties on this node to change, if applicable (inside an auto-layout frame).
   *
   * - Setting `"STRETCH"` will make the node "stretch" to fill the width of the parent vertical auto-layout frame, or the height of the parent horizontal auto-layout frame excluding the frame's padding.
   * - If the current node is an auto layout frame (e.g. an auto layout frame inside a parent auto layout frame) if you set layoutAlign to `“STRETCH”` you should set the corresponding axis – either {@link AutoLayoutMixin.primaryAxisSizingMode} or {@link AutoLayoutMixin.counterAxisSizingMode} – to be`“FIXED”`. This is because an auto-layout frame cannot simultaneously stretch to fill its parent and shrink to hug its children.
   * - Setting `"INHERIT"` does not "stretch" the node.
   *
   * Caution: ⚠️ Previously, layoutAlign also determined counter axis alignment of auto-layout frame children. Counter axis alignment is now set on the auto-layout frame itself through {@link AutoLayoutMixin.counterAxisAlignItems}. Note that this means all layers in an auto-layout frame must now have the same counter axis alignment. This means `"MIN"`, `"CENTER"`,  and `"MAX"` are now deprecated values of `layoutAlign`.
   */
  layoutAlign: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'INHERIT'
  /**
   * This property is applicable only for direct children of auto-layout frames. Determines whether a layer should stretch along the parent’s primary axis. 0 corresponds to a fixed size and 1 corresponds to stretch.
   *
   * @remarks
   *
   * 0 and 1 are currently the only supported values.
   *
   * Note: If the current node is an auto-layout frame (e.g. an auto-layout frame inside a parent auto-layout frame) if you set `layoutGrow` to 1 you should set the corresponding axis – either {@link AutoLayoutMixin.primaryAxisSizingMode} or {@link AutoLayoutMixin.counterAxisSizingMode} – to be `“FIXED”`. This is because an auto-layout frame cannot simultaneously stretch to fill its parent and shrink to hug its children.
   */
  layoutGrow: number
  /**
   * This property is applicable only for direct children of auto-layout frames. Determines whether a layer's size and position should be dermined by auto-layout settings or manually adjustable.
   *
   * @remarks
   *
   * Changing this property may cause the parent layer's size to change, since it will recalculate as if this child did not exist. It will also change this node's `x`, `y`, and `relativeTransform` properties.
   *
   * - The default value of `"AUTO"` will layout this child according to auto-layout rules.
   * - Setting `"ABSOLUTE"` will take this child out of auto-layout flow, while still nesting inside the auto-layout frame. This allows explicitly setting `x`, `y`, `width`, and `height`. `"ABSOLUTE"` positioned nodes respect constraint settings.
   *
   * ```ts title="Auto-layout frame absolutely positioned red circle at the top-right corner"
   * const parentFrame = figma.createFrame()
   * parentFrame.appendChild(figma.createFrame())
   *
   * // Create a small red circle
   * const ellipse = figma.createEllipse()
   * ellipse.resize(20, 20)
   * ellipse.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }}]
   * parentFrame.appendChild(ellipse)
   * parentFrame.clipsContent = false
   * parentFrame.layoutMode = 'HORIZONTAL'
   *
   * // Enable absolute positioning so we can move the circle
   * ellipse.layoutPositioning = 'ABSOLUTE'
   *
   * // Center the circle on the top-right corner of the frame
   * ellipse.x = 90
   * ellipse.y = -10
   *
   * // Make the circle stick to the top-right corner of the frame
   * ellipse.constraints = { horizontal: 'MAX', vertical: 'MIN' }
   * ```
   */
  layoutPositioning: 'AUTO' | 'ABSOLUTE'
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface GridChildrenMixin {
  /**
   * Applicable only on direct children of 'GRID' auto-layout frames. Sets the position of the node
   *
   * @remarks
   * This method sets the position of the node within the grid based on the specified row and column indices.
   * The row and column indices are 0-based, where 0 is the top row in the grid, and 0 is the left-most column in the grid.
   * If the specified row or column index is out of bounds, it will throw an error.
   * If the specified row or column index is occupied by another node, it will throw an error.
   *
   * Caution: ⚠️ This method will throw an error if the parent grid has {@link GridLayoutMixin.gridItemsPositioning} set to `"ROW_AUTO_FLOW"`, since child positions are managed automatically. Use {@link ChildrenMixin.insertChild} to change the order of children instead.
   * ```ts title="Setting the position of a node in a grid"
   * const grid = figma.createFrame()
   * grid.layoutMode = 'GRID'
   * grid.gridRowCount = 3
   * grid.gridColumnCount = 3
   * const child1 = figma.createFrame()
   * const child2 = figma.createFrame()
   * const child2 = figma.createFrame()
   * // + --- + --- + --- +
   * // |  1  |  2  |  3  |
   * // + --- + --- + --- +
   * // |     |     |     |
   * // + --- + --- + --- +
   * // |     |     |     |
   * // + --- + --- + --- +
   *
   * // If calling `appendChild` instead of {@link GridLayoutMixin.appendChildAt}, nodes will be added to the first available position in the grid.
   * grid.appendChild(child1)
   * grid.appendChild(child2)
   * grid.appendChild(child3)
   * // Move the children to specific grid positions
   * child2.setGridPosition(1, 0)
   * child3.setGridPosition(2, 1)
   * // + --- + --- + --- +
   * // |  1  |     |     |
   * // + --- + --- + --- +
   * // |  2  |     |     |
   * // + --- + --- + --- +
   * // |     |  3  |     |
   * // + --- + --- + --- +
   */
  setGridChildPosition(rowIndex: number, columnIndex: number): void
  /**
   * Applicable only on direct children of grid auto-layout frames. Determines the starting row index for this node within the parent grid.
   *
   * @remarks
   * The row index is 0-based, where 0 is the first row in the grid. This property works in conjunction with gridRowSpan to determine the node's row position and size in the grid.
   * If the index provided is greater than the number of rows in the grid, the setter will throw an error.
   * If the index provided results in the node overlapping with another node in the grid, the setter will throw an error.
   */
  readonly gridRowAnchorIndex: number
  /**
   * Applicable only on direct children of grid auto-layout frames. Determines the starting column index for this node within the parent grid.
   *
   * @remarks
   * The column index is 0-based, where 0 is the first column in the grid. This property works in conjunction with gridColumnSpan to determine the node's column position and size in the grid.
   * If the index provided is greater than the number of columns in the grid, the setter will throw an error.
   * If the index provided results in the node overlapping with another node in the grid, the setter will throw an error.
   */
  readonly gridColumnAnchorIndex: number
  /**
   * Applicable only on direct children of grid auto-layout frames. Determines the number of rows this node will span within the parent grid.
   *
   * @remarks
   * Must be a positive integer. This property defines how many rows the node will occupy starting from gridRowAnchorIndex.
   * If the span provided results in the node overlapping with another node in the grid, the setter will throw an error.
   * If the span provided results in the node extending beyond the grid's defined rows, the setter will throw an error.
   */
  gridRowSpan: number
  /**
   * Applicable only on direct children of grid auto-layout frames. Determines the number of columns this node will span within the parent grid.
   *
   * @remarks
   * Must be a positive integer. This property defines how many columns the node will occupy starting from gridColumnAnchorIndex.
   * If the span provided results in the node overlapping with another node in the grid, the setter will throw an error.
   * If the span provided results in the node extending beyond the grid's defined columns, the setter will throw an error.
   */
  gridColumnSpan: number
  /**
   * Applicable only on direct children of grid auto-layout frames. Controls the horizontal alignment of the node within its grid cell.
   *
   * @remarks
   * Possible values are:
   * - `"MIN"`: Aligns to the left of the grid cell
   * - `"CENTER"`: Centers horizontally within the grid cell
   * - `"MAX"`: Aligns to the right of the grid cell
   * - `"AUTO"`: Uses the default alignment
   */
  gridChildHorizontalAlign: 'MIN' | 'CENTER' | 'MAX' | 'AUTO'
  /**
   * Applicable only on direct children of grid auto-layout frames. Controls the vertical alignment of the node within its grid cell.
   *
   * @remarks
   * Possible values are:
   * - `"MIN"`: Aligns to the top of the grid cell
   * - `"CENTER"`: Centers vertically within the grid cell
   * - `"MAX"`: Aligns to the bottom of the grid cell
   * - `"AUTO"`: Uses the default alignment
   */
  gridChildVerticalAlign: 'MIN' | 'CENTER' | 'MAX' | 'AUTO'
}
/**
 * @see https://developers.figma.com/docs/plugins/api/InferredAutoLayoutResult
 */
interface InferredAutoLayoutResult extends AutoLayoutChildrenMixin, AutoLayoutMixin {}
/**
 * @see https://developers.figma.com/docs/plugins/api/DetachedInfo
 */
type DetachedInfo =
  | {
      type: 'local'
      componentId: string
    }
  | {
      type: 'library'
      componentKey: string
    }
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface MinimalStrokesMixin {
  /**
   * The paints used to fill the area of the shape's strokes. For help on how to change this value, see [Editing Properties](https://developers.figma.com/docs/plugins/editing-properties).
   *
   * @remarks
   *
   * In order to set pattern strokes, you must use the {@link MinimalStrokesMixin.setStrokesAsync} method to ensure that the source node of the pattern is loaded first.
   */
  strokes: ReadonlyArray<Paint>
  /**
   * The id of the {@link PaintStyle} object that the {@link MinimalStrokesMixin.strokes} property of this node is linked to.
   *
   * If the manifest contains`"documentAccess": "dynamic-page"`, this property is read-only. Use `setStrokeStyleIdAsync` to update the style.
   */
  strokeStyleId: string
  /**
   * Set the {@link PaintStyle} that the {@link MinimalStrokesMixin.strokes} property of this node is linked to.
   */
  setStrokeStyleIdAsync(styleId: string): Promise<void>
  /**
   * The thickness of the stroke, in pixels. This value must be non-negative and can be fractional.
   *
   * Caution: For rectangle nodes or frame-like nodes using different individual stroke weights, this property will return {@link PluginAPI.mixed}.
   *
   * Note: For rectangle nodes or frame-like nodes, individual stroke weights can be set for each side using the following properties:
   *
   * - {@link IndividualStrokesMixin.strokeTopWeight}
   * - {@link IndividualStrokesMixin.strokeBottomWeight}
   * - {@link IndividualStrokesMixin.strokeLeftWeight}
   * - {@link IndividualStrokesMixin.strokeRightWeight}
   */
  strokeWeight: number | PluginAPI['mixed']
  /**
   * The decoration applied to vertices which have two or more connected segments.
   *
   * @remarks
   *
   * On a vector network, the value is set on the whole vector network. Use the vector network API to set it on individual vertices.
   *
   * This property can return {@link PluginAPI.mixed} if different vertices have different values.properties.
   */
  strokeJoin: StrokeJoin | PluginAPI['mixed']
  /**
   * The alignment of the stroke with respect to the boundaries of the shape.
   *
   * @remarks
   *
   * Center-aligned stroke means the center of the stroke falls exactly on the geometry. Inside-aligned stroke shifts the stroke so it lies completely inside the shape, and outside-aligned stroke is vice versa.
   *
   * Note: Inside and outside stroke are actually implemented by doubling the stroke weight and masking the stroke by the fill. This means inside-aligned stroke will never draw strokes outside the fill and outside-aligned stroke will never draw strokes inside the fill.
   */
  strokeAlign: 'CENTER' | 'INSIDE' | 'OUTSIDE'
  /**
   * A list of numbers specifying alternating dash and gap lengths, in pixels.
   */
  dashPattern: ReadonlyArray<number>
  /**
   * An array of paths representing the object strokes relative to the node.
   * StrokeGeometry is always from the center regardless of the nodes `strokeAlign`.
   */
  readonly strokeGeometry: VectorPaths
  /**
   * Sets the strokes of the node asynchronously. This is the only way to set pattern strokes on a node, since we need to ensure that the source node of the pattern is loaded first. See [Adding Pattern Fills and Strokes](https://developers.figma.com/docs/plugins/adding-pattern-fills-and-strokes) for more information.
   */
  setStrokesAsync(strokes: ReadonlyArray<Paint>): Promise<void>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface IndividualStrokesMixin {
  /** Determines the top stroke weight on a rectangle node or frame-like node. Must be non-negative and can be fractional. */
  strokeTopWeight: number
  /** Determines the bottom stroke weight on a rectangle node or frame-like node. Must be non-negative and can be fractional. */
  strokeBottomWeight: number
  /** Determines the left stroke weight on a rectangle node or frame-like node. Must be non-negative and can be fractional. */
  strokeLeftWeight: number
  /** Determines the right stroke weight on a rectangle node or frame-like node. Must be non-negative and can be fractional. */
  strokeRightWeight: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface MinimalFillsMixin {
  /**
   * The paints used to fill the area of the shape. For help on how to change this value, see [Editing Properties](https://developers.figma.com/docs/plugins/editing-properties).
   *
   * @remarks
   *
   * This property can return {@link PluginAPI.mixed} if the node has multiple sets of fills. Text nodes can have multiple sets of fills if some characters are colored differently than others.
   *
   * Use {@link UtilAPI.solidPaint} to create solid paint fills with CSS color strings.
   *
   * Page nodes have a [`backgrounds`](https://developers.figma.com/docs/plugins/api/PageNode#backgrounds) property instead of a `fills` property.
   *
   * In order to set pattern fills, you must use the {@link MinimalFillsMixin.setFillsAsync} method to ensure that the source node of the pattern is loaded first.
   */
  fills: ReadonlyArray<Paint> | PluginAPI['mixed']
  /**
   * The id of the {@link PaintStyle} object that the {@link MinimalFillsMixin.fills} property of this node is linked to.
   *
   * If the manifest contains`"documentAccess": "dynamic-page"`, this property is read-only. Use `setFillStyleIdAsync` to update the style.
   *
   * @remarks
   *
   * This property can return {@link PluginAPI.mixed} if the node has multiple fills.properties. Text nodes can have multiple fills if some characters are colored differently than others.
   */
  fillStyleId: string | PluginAPI['mixed']
  /**
   * Sets the {@link PaintStyle} that the {@link MinimalFillsMixin.fills} property of this node is linked to.
   */
  setFillStyleIdAsync(styleId: string): Promise<void>
  /**
   * Sets the fills of the node asynchronously. This is the only way to set pattern fills on a node, since we need to ensure that the source node of the pattern is loaded first. See [Adding Pattern Fills and Strokes](https://developers.figma.com/docs/plugins/adding-pattern-fills-and-strokes) for more information.
   */
  setFillsAsync(paints: ReadonlyArray<Paint>): Promise<void>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/VariableWidthStrokeProperties
 */
interface VariableWidthPoint {
  /** The position of the variable width point along the stroke, from 0 (the start of the stroke) to 1 (the end of the stroke). */
  position: number
  /** The width of the stroke at this variable width point as a fraction of the stroke weight. */
  width: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/VariableWidthStrokeProperties
 */
interface PresetVariableWidthStrokeProperties {
  /** The width profile of the stroke. */
  widthProfile: 'UNIFORM' | 'WEDGE' | 'TAPER' | 'QUARTER_TAPER' | 'EYE' | 'MIRRORED_TAPER'
}
/**
 * @see https://developers.figma.com/docs/plugins/api/VariableWidthStrokeProperties
 */
interface CustomVariableWidthStrokeProperties {
  /** The width profile of the stroke. Fixed to 'CUSTOM'. */
  widthProfile: 'CUSTOM'
  /** An array of variable width points defining the custom width profile. */
  variableWidthPoints: ReadonlyArray<VariableWidthPoint>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/VariableWidthStrokeProperties
 */
declare type VariableWidthStrokeProperties =
  PresetVariableWidthStrokeProperties | CustomVariableWidthStrokeProperties
/**
 * @see https://developers.figma.com/docs/plugins/api/ComplexStrokeProperties
 */
declare type ComplexStrokeProperties =
  | {
      type: 'BASIC'
    }
  | DynamicStrokeProperties
  | BrushStrokeProperties
/**
 * @see https://developers.figma.com/docs/plugins/api/ComplexStrokeProperties
 */
interface ScatterBrushProperties {
  type: 'BRUSH'
  brushType: 'SCATTER'
  /**
   * Name of the scatter brush. See the [available brushes](https://developers.figma.com/api/complex-stroke-properties.md#available-brushes) for previews of these brushes.
   * Nodes using custom brushes will have this set to 'CUSTOM'. However, setting this property to 'CUSTOM' is not yet supported.
   */
  brushName:
    | 'BUBBLEGUM'
    | 'WITCH_HOUSE'
    | 'SHOEGAZE'
    | 'HONKY_TONK'
    | 'SCREAMO'
    | 'DRONE'
    | 'DOO_WOP'
    | 'SPOKEN_WORD'
    | 'VAPORWAVE'
    | 'OI'
    | 'CUSTOM'
  /** Gap between brush instances along the stroke path. Minimum value is 0.25 */
  gap: number
  /** The amount of random movement applied to brush instances along the stroke path. The minimum value is 0. */
  wiggle: number
  /** The amount of random size variation applied to brush instances. Ranges from 0 to 3. */
  sizeJitter: number
  /** The amount of random angular variation in degrees applied to brush instances. Ranges from -180 to 180. */
  angularJitter: number
  /** The rotation in degrees applied to brush instances. Ranges from -180 to 180. */
  rotation: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/ComplexStrokeProperties
 */
interface StretchBrushProperties {
  type: 'BRUSH'
  brushType: 'STRETCH'
  /**
   * Name of the stretch brush. See the [available brushes](https://developers.figma.com/api/complex-stroke-properties.md#available-brushes) for previews of these brushes.
   * Nodes using custom brushes will have this set to 'CUSTOM'. However, setting this property to 'CUSTOM' is not yet supported.
   * */
  brushName:
    | 'HEIST'
    | 'BLOCKBUSTER'
    | 'GRINDHOUSE'
    | 'BIOPIC'
    | 'SPAGHETTI_WESTERN'
    | 'SLASHER'
    | 'HARDBOILED'
    | 'VERITE'
    | 'EPIC'
    | 'SCREWBALL'
    | 'ROM_COM'
    | 'NOIR'
    | 'PROPAGANDA'
    | 'MELODRAMA'
    | 'NEW_WAVE'
    | 'CUSTOM'
  /** The direction of the brush */
  direction: 'FORWARD' | 'BACKWARD'
}
/**
 * @see https://developers.figma.com/docs/plugins/api/ComplexStrokeProperties
 */
type BrushStrokeProperties = StretchBrushProperties | ScatterBrushProperties
/**
 * @see https://developers.figma.com/docs/plugins/api/ComplexStrokeProperties
 */
interface DynamicStrokeProperties {
  /** The type of complex stroke. Fixed to 'DYNAMIC'. */
  type: 'DYNAMIC'
  /** The frequency of the dynamic stroke. Ranges from 0.01 to 20. */
  frequency: number
  /** The amplitude of the wiggles in the dynamic stroke. Minimum value is 0. */
  wiggle: number
  /** The amount of smoothing applied to the dynamic stroke. Ranges from 0 to 1. */
  smoothen: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface GeometryMixin extends MinimalStrokesMixin, MinimalFillsMixin {
  /**
   * The decoration applied to vertices which have only one connected segment.
   *
   * @remarks
   *
   * On a vector network, the value is set on the whole vector network. Use the vector network API to set it on individual vertices.
   *
   * This property can return {@link PluginAPI.mixed} if different vertices have different values.properties.
   */
  strokeCap: StrokeCap | PluginAPI['mixed']
  /**
   * The miter limit on the stroke. This is the same as the [SVG miter limit](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/stroke-miterlimit).
   */
  strokeMiterLimit: number
  /**
   * This method performs an action similar to using the "Outline Stroke" function in the editor from the right-click menu. However, this method creates and returns a new node while leaving the original intact. Returns `null` if the node has no strokes.
   */
  outlineStroke(): VectorNode | null
  /**
   * An array of paths representing the object fills relative to the node.
   */
  readonly fillGeometry: VectorPaths
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface ComplexStrokesMixin {
  /**
   * The variable width stroke properties for the node.
   *
   * @remarks
   * Variable width strokes cannot be applied to complex vector networks (i.e. vector networks with branching paths).
   *
   * Variable width strokes are also not supported in combination with dynamic strokes.
   */
  variableWidthStrokeProperties: VariableWidthStrokeProperties | null
  /**
   * The complex stroke properties for nodes using brush or dynamic strokes.
   *
   * @remarks
   * We do not yet support setting custom brushes via the plugin API, but the API will return the brush properties for nodes that use custom brushes.
   *
   * Setting a dynamic stroke on a stroke with variable width points will remove the variable width points.
   *
   * When setting a brush on a stroke, you must first ensure that the desired brushes are loaded with {@link PluginAPI.loadBrushesAsync}.
   */
  complexStrokeProperties: ComplexStrokeProperties
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface CornerMixin {
  /**
   * The number of pixels to round the corners of the object by.
   *
   * @remarks
   *
   * This value must be non-negative and can be fractional. If an edge length is less than twice the corner radius, the corner radius for each vertex of the edge will be clamped to half the edge length.
   *
   * This property can return {@link PluginAPI.mixed} if different vertices have different values.properties. Vector nodes can have individual corner radii on each vertex. Rectangle nodes can also have different corner radii on each of the four corners.
   */
  cornerRadius: number | PluginAPI['mixed']
  /**
   * A value that lets you control how "smooth" the corners are. Ranges from 0 to 1.
   *
   * @remarks
   *
   * A value of 0 is the default and means that the corner is perfectly circular. A value of 0.6 means the corner matches the iOS 7 "squircle" icon shape. Other values produce various other curves. See [this post](https://www.figma.com/blog/desperately-seeking-squircles/) for the gory details!
   */
  cornerSmoothing: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface RectangleCornerMixin {
  /**
   * The radius of the top left corner, in pixels. This value must be non-negative and can be fractional.
   */
  topLeftRadius: number
  /**
   * The radius of the top right corner, in pixels. This value must be non-negative and can be fractional.
   */
  topRightRadius: number
  /**
   * The radius of the bottom left corner, in pixels. This value must be non-negative and can be fractional.
   */
  bottomLeftRadius: number
  /**
   * The radius of the bottom right corner, in pixels. This value must be non-negative and can be fractional.
   */
  bottomRightRadius: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface ExportMixin {
  /**
   * List of export settings stored on the node. For help on how to change this value, see [Editing Properties](https://developers.figma.com/docs/plugins/editing-properties).
   */
  exportSettings: ReadonlyArray<ExportSettings>
  /**
   * Exports the node in the format given by `settings`. Image formats (PNG, JPG), PDF, and the video formats (MP4, GIF, WebM) return a `Uint8Array` of the encoded file; `SVG_STRING` returns a string and `JSON_REST_V1` returns an object.
   *
   * If the manifest contains `"documentAccess": "dynamic-page"`, **and** the node is a {@link PageNode}, you must first call {@link PageNode.loadAsync} to access this function.
   *
   * @param settings - When this parameter is absent, this function defaults to exporting as a PNG at 1x resolution.
   *
   * ```ts title="Create a hexagon, export as PNG, and place on canvas"
   * (async () => {
   *   const polygon = figma.createPolygon()
   *   polygon.pointCount = 6
   *   polygon.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
   *
   *   // highlight-start
   *   // Export a 2x resolution PNG of the node
   *   const bytes = await polygon.exportAsync({
   *     format: 'PNG',
   *     constraint: { type: 'SCALE', value: 2 },
   *   })
   *   // highlight-end
   *
   *   // Add the image onto the canvas as an image fill in a frame
   *   const image = figma.createImage(bytes)
   *   const frame = figma.createFrame()
   *   frame.x = 200
   *   frame.resize(200, 230)
   *   frame.fills = [{
   *     imageHash: image.hash,
   *     scaleMode: "FILL",
   *     scalingFactor: 1,
   *     type: "IMAGE",
   *   }]
   * })()
   * ```
   *
   * ```ts title="Export a VectorNode as an SVG string"
   *  (async () => {
   *    // Create a triangle using the VectorPath API
   *    const vector = figma.createVector()
   *    vector.vectorPaths = [{
   *      windingRule: "EVENODD",
   *      data: "M 0 100 L 100 100 L 50 0 Z",
   *    }]
   *
   *    // highlight-start
   *    // Export the vector to SVG
   *    const svg = await vector.exportAsync({ format: 'SVG_STRING' })
   *    // highlight-end
   *    console.log(svg);
   *  })()
   * ```
   *
   * ```ts title="Export a node as a JSON object"
   * (async () => {
   *   const json = await figma.currentPage.selection[0].exportAsync({format: 'JSON_REST_V1'})
   *   // Return a JSON object in the same format as the Figma REST API response
   *   console.log(json.document)
   * })()
   * ```
   *
   * Passing an {@link ExportSettingsMP4}, {@link ExportSettingsGIF}, or {@link ExportSettingsWEBM} exports a video (returned as a `Uint8Array`). The exported node must be a top-level frame (a frame placed directly on a page) whose content is animated; the entire frame is encoded across the animation's duration. Calling video export on any other node — including a nested animated frame, or an individual layer that has keyframes but is not itself a top-level frame — rejects with an error. To export the animation a layer participates in, first resolve its enclosing top-level frame with {@link BaseNodeMixin.getTopLevelFrame}. Video export is only available when running in Figma.
   *
   * ```ts title="Export the selected layer's top-level frame as an MP4 and a GIF"
   * (async () => {
   *   const frame = figma.currentPage.selection[0]?.getTopLevelFrame()
   *   if (!frame) {
   *     figma.notify('Select a frame to export')
   *     return
   *   }
   *
   *   try {
   *     // highlight-start
   *     const mp4 = await frame.exportAsync({ format: 'MP4', fps: 30, quality: 'HIGH' })
   *     const gif = await frame.exportAsync({ format: 'GIF', fps: 15, loopCount: 0 })
   *     // highlight-end
   *   } catch (e) {
   *     // exportAsync rejects if the frame has no animated content to encode
   *     figma.notify('This frame has no animation to export')
   *   }
   * })()
   * ```
   */
  exportAsync(settings?: ExportSettings): Promise<Uint8Array>

  exportAsync(settings: ExportSettingsSVGString): Promise<string>

  exportAsync(settings: ExportSettingsREST): Promise<Object>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface FramePrototypingMixin {
  /**
   * Determines whether a frame will scroll in presentation mode when the frame contains content that exceed the frame's bounds. Reflects the value shown in "Overflow Behavior" in the Prototype tab.
   *
   * @remarks
   *
   * Frames directly parented under the canvas don't need this property to be set or for content to exceed the frame's bounds in order to scroll in presentation mode. They just need the frame to be bigger than the device or screen and will scroll automatically.
   */
  overflowDirection: OverflowDirection
  /**
   * Determines which children of the frame are fixed children in a scrolling frame.
   *
   * @remarks
   *
   * In Figma, fixed children are always on top of scrolling (non-fixed) children. Despite the "Fix position when scrolling" checkbox in the UI, fixed layers are not represented as a boolean property on individual layers. Instead, what we really have are two sections of children inside each frame. These section headers are visible in the layers panel when a frame has at least one fixed child.
   */
  numberOfFixedChildren: number
  /**
   * How this frame is positioned when opened as an overlay.
   */
  readonly overlayPositionType: OverlayPositionType
  /**
   * How this frame obscures the content under it when opened as an overlay.
   */
  readonly overlayBackground: OverlayBackground
  /**
   * How the user can interact with the content under this frame when opened as an overlay.
   */
  readonly overlayBackgroundInteraction: OverlayBackgroundInteraction
}
interface VectorLikeMixin {
  /**
   * Exposes a complete, but more complex representation of vectors as a network of edges between vectices. See {@link VectorNetwork}.
   *
   * If the manifest contains`"documentAccess": "dynamic-page"`, this property is read-only. Use `setVectorNetworkAsync` to update the value.
   */
  vectorNetwork: VectorNetwork
  /**
   * Updates the vector network.
   */
  setVectorNetworkAsync(vectorNetwork: VectorNetwork): Promise<void>
  /**
   * Exposes a simple, but incomplete representation of vectors as path. See {@link VectorPaths}
   */
  vectorPaths: VectorPaths
  /**
   * Whether the vector handles are mirrored or independent.
   */
  handleMirroring: HandleMirroring | PluginAPI['mixed']
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface ReactionMixin {
  /**
   * List of [Reactions](https://developers.figma.com/docs/plugins/api/Reaction) on this node, which includes both the method of interaction with this node in a prototype, and the behavior of that interaction. For help on how to change this value, see [Editing Properties](https://developers.figma.com/docs/plugins/editing-properties).
   *
   * If the manifest contains`"documentAccess": "dynamic-page"`, this property is read-only. Use `setReactionsAsync` to update the value.
   *
   * @remarks
   *
   * [Prototyping](https://help.figma.com/hc/en-us/articles/360040314193-Guide-to-prototyping-in-Figma) in Figma lets users create connections between nodes that consist of a trigger (click, hover, etc...) and a corresponding list of actions, such as navigating to another frame or setting a variable. The `reactions` property lets you read and modify prototyping reactions on the node.
   *
   * ```ts title="Changing the transition duration in a prototyping action"
   * const node = figma.currentPage.selection[0]
   * console.log(node.reactions)
   *
   * /*
   * Output:
   *
   * [{
   *   action: {
   *     type: 'NODE',
   *     destinationId: '4:1539',
   *     navigation: 'NAVIGATE',
   *     transition: {
   *       type:'SMART_ANIMATE',
   *       easing: { type: 'EASE_OUT' },
   *       duration: 0.20000000298023224
   *     },
   *     preserveScrollPosition: false
   *   },
   *   actions: [{
   *     type: 'NODE',
   *     destinationId: '4:1539',
   *     navigation: 'NAVIGATE',
   *     transition: {
   *       type:'SMART_ANIMATE',
   *       easing: { type: 'EASE_OUT' },
   *       duration: 0.20000000298023224
   *     },
   *     preserveScrollPosition: false
   *   }],
   *   trigger: { type: 'ON_CLICK' }
   * }]
   * *\/
   *
   * // See clone() implementation from the Editing Properties page
   * const newReactions = clone(node.reactions)
   * // highlight-start
   * newReactions[0].actions[0].transition.duration = 0.5
   * // highlight-end
   * await node.setReactionsAsync(newReactions)
   * ```
   *
   * It is also possible to add Advanced Prototyping action types through the Plugin API: [Set Variable](https://help.figma.com/hc/en-us/articles/14506587589399-Use-variables-in-prototypes) and [Conditional](https://help.figma.com/hc/en-us/articles/15253220891799-Multiple-actions-and-conditionals).
   * Moreover, Reactions now include the ability to execute multiple actions by updating the `actions` field on a `Reaction`.
   *
   * ```ts title="Create a button with a Reaction object that updates the visibility of another Frame."
   * (async () => {
   *   // Create collection with "show" variable inside
   *   const collection = figma.variables.createVariableCollection('prototyping')
   *   const modeId = collection.modes[0].modeId
   *   const showVariable = figma.variables.createVariable(
   *     'show',
   *     collection,
   *     'BOOLEAN'
   *   )
   *
   *   // Initialize "show" variable to true
   *   showVariable.setValueForMode(modeId, true)
   *
   *   const parentFrame = figma.createFrame()
   *   parentFrame.resize(350, 200)
   *
   *   // Green "Click me" button
   *   const toggleButton = figma.createFrame()
   *   parentFrame.appendChild(toggleButton)
   *   toggleButton.x = 50
   *   toggleButton.y = 50
   *   toggleButton.layoutMode = 'HORIZONTAL'
   *   toggleButton.layoutSizingHorizontal = 'HUG'
   *   toggleButton.layoutSizingVertical = 'HUG'
   *   toggleButton.fills = [{ type: 'SOLID', color: { r: 0, g: 1, b: 0 } }]
   *   const text = figma.createText()
   *   await figma.loadFontAsync(text.fontName)
   *   text.characters = 'Click me'
   *   toggleButton.appendChild(text)
   *
   *   // Red square
   *   const frame = figma.createFrame()
   *   parentFrame.appendChild(frame)
   *   frame.x = 200
   *   frame.y = 50
   *   frame.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
   *
   *   // The "show" variable will now control the visibility of the frame
   *   frame.setBoundVariable('visible', showVariable)
   *
   *   await toggleButton.setReactionsAsync([
   *   {
   *     trigger: { type: 'ON_CLICK' },
   *     actions: [
   *     {
   *       type: 'CONDITIONAL',
   *       conditionalBlocks: [
   *       {
   *         condition: { // Conditional: if "show" variable == true
   *           type: 'EXPRESSION',
   *           resolvedType: 'BOOLEAN',
   *           value: {
   *             expressionArguments: [
   *               {
   *                 type: 'VARIABLE_ALIAS',
   *                 resolvedType: 'BOOLEAN',
   *                 value: {
   *                   type: 'VARIABLE_ALIAS',
   *                   id: showVariable.id
   *                 }
   *               },
   *               {
   *                 type: 'BOOLEAN',
   *                 resolvedType: 'BOOLEAN',
   *                 value: true
   *               }
   *             ],
   *             expressionFunction: 'EQUALS'
   *           }
   *         },
   *         actions: [ // then set "show" variable to false
   *           {
   *             type: 'SET_VARIABLE',
   *             variableId: showVariable.id,
   *             variableValue: {
   *               resolvedType: 'BOOLEAN',
   *                type: 'BOOLEAN',
   *                value: false
   *             }
   *           }
   *         ]
   *       },
   *       {
   *         actions: [ // else set "show" variable to true
   *           {
   *             type: 'SET_VARIABLE',
   *             variableId: showVariable.id,
   *             variableValue: {
   *               resolvedType: 'BOOLEAN',
   *               type: 'BOOLEAN',
   *               value: true
   *             }
   *           }
   *         ]
   *       }]
   *     }]
   *   }])
   * })()
   * ```
   */
  reactions: ReadonlyArray<Reaction>
  /**
   * Updates the reactions on this node. See {@link ReactionMixin.reactions} for a usage example.
   */
  setReactionsAsync(reactions: Array<Reaction>): Promise<void>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/DocumentationLink
 */
interface DocumentationLink {
  readonly uri: string
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface PublishableMixin {
  /**
   * The plain-text annotation entered by the user for this style/component.
   *
   * @remarks
   *
   * To set a rich-text description using markdown, see {@link PublishableMixin.descriptionMarkdown}
   *
   * Caution: ⚠️ There is a currently a bug in Figma where the description field will appear to be missing or not up to date. Until this is fixed, the workaround is to re-publish nodes for which the description is missing.
   */
  description: string
  /**
   * The rich-text annotation entered by the user for this style/component.
   *
   * @remarks
   *
   *
   * Caution: ⚠️ There is a currently a bug in Figma where the description field will appear to be missing or not up to date. Until this is fixed, the workaround is to re-publish nodes for which the description is missing.
   */
  descriptionMarkdown: string
  /**
   * The documentation links for this style/component.
   *
   * @remarks
   *
   * This API currently only supports setting a single documentation link.  To clear the documentation links, set to the empty list [].
   *
   * Example:
   *
   * ```ts
   * node.documentationLinks = [{uri: "https://www.figma.com"}]
   *
   * // clear documentation links
   * node.documentationLinks = []
   * ```
   */
  documentationLinks: ReadonlyArray<DocumentationLink>
  /**
   * Whether this style/component is a remote style/component that doesn't live in the file (i.e. is from the team library). Remote components are read-only: attempts to change their properties will throw.
   */
  readonly remote: boolean
  /**
   * The key to use with {@link PluginAPI.importComponentByKeyAsync}, {@link PluginAPI.importComponentSetByKeyAsync} and {@link PluginAPI.importStyleByKeyAsync}. Note that while this key is present on local and published components, you can only import components that are already published.
   */
  readonly key: string
  /**
   * Gets the status of this style/component in the team library.
   *
   */
  getPublishStatusAsync(): Promise<PublishStatus>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface DefaultShapeMixin
  extends
    BaseNodeMixin,
    SceneNodeMixin,
    ReactionMixin,
    BlendMixin,
    GeometryMixin,
    LayoutMixin,
    ExportMixin {}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface BaseFrameMixin
  extends
    BaseNodeMixin,
    SceneNodeMixin,
    ChildrenMixin,
    ContainerMixin,
    GeometryMixin,
    ComplexStrokesMixin,
    CornerMixin,
    RectangleCornerMixin,
    BlendMixin,
    ConstraintMixin,
    LayoutMixin,
    ExportMixin,
    IndividualStrokesMixin,
    AutoLayoutMixin,
    GridLayoutMixin,
    AspectRatioLockMixin,
    AnnotationsMixin {
  /**
   * Includes the id (for local components) or key (for library components) of the component the given node was detached from, if any. If the node isn't a detached instance, it will be null. If the node is a component or instance, it will be null.
   */
  readonly detachedInfo: DetachedInfo | null
  /**
   * Array of {@link LayoutGrid} objects used as layout grids on this node. For help on how to change this value, see [Editing Properties](https://developers.figma.com/docs/plugins/editing-properties).
   */
  layoutGrids: ReadonlyArray<LayoutGrid>
  /**
   * The id of the {@link GridStyle} object that the {@link BaseFrameMixin.layoutGrids} property of this node is linked to.
   *
   * If the manifest contains`"documentAccess": "dynamic-page"`, this property is read-only. Use `setGridStyleIdAsync` to update the style.
   */
  gridStyleId: string
  /**
   * Set the {@link GridStyle} that the {@link BaseFrameMixin.layoutGrids} property of this node is linked to.
   */
  setGridStyleIdAsync(styleId: string): Promise<void>
  /**
   * Whether the frame clips its contents. That is, whether layers inside the frame are visible outside the bounds of the frame.
   */
  clipsContent: boolean
  /**
   * Array of {@link Guide} used inside the frame. Note that each frame has its own guides, separate from the canvas-wide guides. For help on how to change this value, see [Editing Properties](https://developers.figma.com/docs/plugins/editing-properties).
   */
  guides: ReadonlyArray<Guide>
  /**
   * Returns inferred auto layout properties of a {@link FrameNode} if applicable. Otherwise, returns `null`.
   *
   * This is what Figma uses to power Dev Mode’s [code snippets](https://help.figma.com/hc/en-us/articles/15023124644247#Build_faster_with_customizable_code_snippets) feature, as it makes sure the generated code is more useful.
   *
   * Note: This method uses a heuristic to infer the auto layout properties.
   */
  inferredAutoLayout: InferredAutoLayoutResult | null
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-properties
 */
interface DefaultFrameMixin extends BaseFrameMixin, FramePrototypingMixin, ReactionMixin {}

interface OpaqueNodeMixin
  extends BaseNodeMixin, SceneNodeMixin, ExportMixin, DimensionAndPositionMixin {}

interface MinimalBlendMixin {
  /**
   * Opacity of the node, as shown in the Layer panel. Must be between 0 and 1.
   */
  opacity: number
  /**
   * Blend mode of this node, as shown in the Layer panel. In addition to the blend modes that paints & effects support, the layer blend mode can also have the value PASS_THROUGH.
   */
  blendMode: BlendMode
}
interface Annotation {
  readonly label?: string
  readonly labelMarkdown?: string
  readonly properties?: ReadonlyArray<AnnotationProperty>
  readonly categoryId?: string
}
interface AnnotationProperty {
  readonly type: AnnotationPropertyType
}
type AnnotationPropertyType =
  | 'width'
  | 'height'
  | 'maxWidth'
  | 'minWidth'
  | 'maxHeight'
  | 'minHeight'
  | 'fills'
  | 'strokes'
  | 'effects'
  | 'strokeWeight'
  | 'cornerRadius'
  | 'textStyleId'
  | 'textAlignHorizontal'
  | 'fontFamily'
  | 'fontStyle'
  | 'fontSize'
  | 'fontWeight'
  | 'lineHeight'
  | 'letterSpacing'
  | 'itemSpacing'
  | 'padding'
  | 'layoutMode'
  | 'alignItems'
  | 'opacity'
  | 'mainComponent'
  | 'gridRowGap'
  | 'gridColumnGap'
  | 'gridRowCount'
  | 'gridColumnCount'
  | 'gridRowAnchorIndex'
  | 'gridColumnAnchorIndex'
  | 'gridRowSpan'
  | 'gridColumnSpan'
interface AnnotationsMixin {
  /**
   * Annotations on the node.
   *
   * Learn more about annotations in the [Help Center](https://help.figma.com/hc/en-us/articles/20774752502935) or see the [Annotation type](https://developers.figma.com/docs/plugins/api/Annotation) for usage examples.
   */
  annotations: ReadonlyArray<Annotation>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/Measurement
 */
interface Measurement {
  id: string
  start: {
    node: SceneNode
    side: MeasurementSide
  }
  end: {
    node: SceneNode
    side: MeasurementSide
  }
  offset: MeasurementOffset
  freeText: string
}
/**
 * @see https://developers.figma.com/docs/plugins/api/MeasurementSide
 */
type MeasurementSide = 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT'
/**
 * @see https://developers.figma.com/docs/plugins/api/MeasurementOffset
 */
type MeasurementOffset =
  | {
      type: 'INNER'
      relative: number
    }
  | {
      type: 'OUTER'
      fixed: number
    }
interface MeasurementsMixin {
  /**
   * Get all measurements in the current page.
   *
   * Learn more about measurements in the [Help Center](https://help.figma.com/hc/en-us/articles/20774752502935).
   */
  getMeasurements(): Measurement[]
  /**
   * Get all measurements pointing to a node in the current page. This includes all measurements whose start _or_ end node is the node passed in.
   */
  getMeasurementsForNode(node: SceneNode): Measurement[]
  /**
   * Adds a measurement between two nodes in the current page.
   *
   * Measurements are always between a start and end node. The side indicates which edge of the node to draw the measurement from.
   *
   * Measurements can only go on the same axis, i.e. from side `"LEFT"` -> `"LEFT"`, `"LEFT"` -> `"RIGHT"`, `"TOP"` -> `"BOTTOM"` etc. But not `"LEFT"` -> `"TOP"`.
   *
   * See the [Measurement type](https://developers.figma.com/docs/plugins/api/Measurement) for usage examples.
   *
   * Note: This method is only available in Dev Mode. You can check the editor type of your plugin to know if the user is in Dev Mode or not:
   *
   * ```ts
   * if (figma.editorType === 'dev') {
   *   // In Figma's Dev Mode
   * }
   * ```
   */
  addMeasurement(
    start: {
      node: SceneNode
      side: MeasurementSide
    },
    end: {
      node: SceneNode
      side: MeasurementSide
    },
    options?: {
      /**
       * @default { type: 'INNER'; relative: 0 }
       */
      offset?: MeasurementOffset
      freeText?: string
    },
  ): Measurement
  /**
   * Edit a measurement’s offset.
   *
   * See the [Measurement type](https://developers.figma.com/docs/plugins/api/Measurement) for usage examples.
   *
   * Note: This method is only available in Dev Mode. You can check the editor type of your plugin to know if the user is in Dev Mode or not:
   *
   * ```ts
   * if (figma.editorType === 'dev') {
   *   // In Figma's Dev Mode
   * }
   * ```
   */
  editMeasurement(
    id: string,
    newValue: {
      offset?: MeasurementOffset
      freeText?: string
    },
  ): Measurement
  /**
   * Delete a measurement.
   *
   * See the [Measurement type](https://developers.figma.com/docs/plugins/api/Measurement) for usage examples.
   *
   * Note: This method is only available in Dev Mode. You can check the editor type of your plugin to know if the user is in Dev Mode or not:
   *
   * ```ts
   * if (figma.editorType === 'dev') {
   *   // In Figma's Dev Mode
   * }
   * ```
   */
  deleteMeasurement(id: string): void
}
interface ComponentPropertiesMixin {
  /**
   * All component properties and their default values that exist on this component set. `'VARIANT'` properties will also have a list of all variant options. `'BOOLEAN'`, `'TEXT'`, and `'INSTANCE_SWAP'` properties will have their names suffixed by a unique identifier starting with `'#'`, which is helpful for quickly distinguishing multiple component properties that have the same name in the Figma UI. The entire property name should be used for all Component property-related API methods and properties.
   *
   * @remarks
   *
   * [Component properties-related properties](https://help.figma.com/hc/en-us/articles/5579474826519-Create-and-use-component-properties) define parts of the component people can change by tying them to specific design properties. You can create component properties for any main component or component set, and apply them to nested layers of the component or variant.
   *
   * ```ts title="Component properties-related properties and methods for component sets, components, and instances"
   * componentSet.componentPropertyDefinitions
   *
   * // Output
   * {
   *   Size: {
   *     type: 'VARIANT',
   *     defaultValue: 'Small',
   *     variantOptions: ['Small', 'Medium', 'Large'],
   *   },
   *   IconVisible#0:0: {
   *     type: 'BOOLEAN',
   *     defaultValue: false,
   *   },
   *   ButtonText#0:1: {
   *     type: 'TEXT',
   *     defaultValue: 'submit',
   *   },
   *   IconInstance#0:2: {
   *     type: 'INSTANCE_SWAP',
   *     defaultValue: '1:1',
   *     preferredValues: [
   *       {type: 'COMPONENT', key: 'ckey1'},
   *       {type: 'COMPONENT_SET', key: 'sgkey1'}
   *     ],
   *   },
   * }
   *
   * // componentProperties on an instance
   * instance.componentProperties
   *
   * // Output
   * {
   *   Size: {
   *     type: 'VARIANT',
   *     value: 'Medium',
   *   },
   *   IconVisible#0:0: {
   *     type: 'BOOLEAN',
   *     value: false,
   *   },
   *   ButtonText#0:1: {
   *     type: 'TEXT',
   *     value: 'cancel',
   *   },
   *   IconInstance#0:2: {
   *     type: 'INSTANCE_SWAP',
   *     defaultValue: '1:1',
   *     preferredValues: [
   *       {type: 'COMPONENT', key: 'ckey1'},
   *       {type: 'COMPONENT_SET', key: 'sgkey1'}
   *     ],
   *   },
   * }
   *
   * // component property definitions can be created, edited, and deleted
   * component.addComponentProperty("ButtonIcon", "INSTANCE_SWAP", "2:22")
   * // returns "ButtonIcon#4:3"
   *
   * component.editComponentProperty(
   *   "ButtonIcon#4:3",
   *   {name: "PrimaryButtonIcon", defaultValue: "1:100"}
   * )
   * // returns "PrimaryButtonIcon#5:5"
   *
   * component.deleteComponentProperty("PrimaryButtonIcon#5:5")
   *
   * // componentPropertyDefinitions and componentProperties work similarly for
   * // main components and their instances but will never have 'VARIANT'
   * // properties.
   * component.componentPropertyDefinitions
   *
   * // Output
   * {
   *   ImageVisible#0:0: {
   *     type: 'BOOLEAN',
   *     defaultValue: true,
   *   },
   *   Icon#0:1: {
   *     type: 'INSTANCE_SWAP',
   *     defaultValue: '7:23',
   *   },
   * }
   *
   * instance.componentProperties
   *
   * // Output
   * {
   *   ImageVisible#0:0: {
   *     type: 'BOOLEAN',
   *     value: true,
   *   },
   *   Icon#0:1: {
   *     type: 'INSTANCE_SWAP',
   *     value: '1:24',
   *   },
   * }
   *
   * // component properties can be applied to node properties of nested layers
   * component.children[0].children[0].componentPropertyReferences = {
   *   'visible': 'IconVisible#0:0'
   * }
   * component.children[0].children[0].visible
   *
   * // Output
   * false // gets value from component property definition
   *
   * // Use setProperties on an instance to configure it
   * instance.setProperties({ Size: 'Large', 'ButtonText#0:1': 'login' })
   * instance.componentProperties
   *
   * // Output
   * {
   *   Size: {
   *     type: 'VARIANT',
   *     value: 'Large',
   *   },
   *   IconVisible#0:0: {
   *     type: 'BOOLEAN',
   *     value: false,
   *   },
   *   ButtonText#0:1: {
   *     type: 'TEXT',
   *     value: 'login',
   *   },
   * }
   *
   * instance.setProperties({ 'IconVisible#0:0': true })
   * instance.componentProperties
   *
   * // Output
   * {
   *   Size: {
   *     type: 'VARIANT',
   *     value: 'Large',
   *   },
   *   IconVisible#0:0: {
   *     type: 'BOOLEAN',
   *     value: true,
   *   },
   *   ButtonText#0:1: {
   *     type: 'TEXT',
   *     value: 'login',
   *   },
   * }
   * ```
   */
  readonly componentPropertyDefinitions: ComponentPropertyDefinitions
  /**
   * Adds a new component property to this node and returns the property name with its unique identifier suffixed. This function supports properties with type `'BOOLEAN'`, `'TEXT'`, `'INSTANCE_SWAP'`, `'VARIANT'`, or `'SLOT'`.
   */
  addComponentProperty(
    propertyName: string,
    type: ComponentPropertyType,
    defaultValue: string | boolean | VariableAlias,
    options?: ComponentPropertyOptions,
  ): string
  /**
   * Modifies the name, default value, or preferred values of an existing component property on this node and returns the property name with its unique identifier suffixed.
   *
   * This function supports properties with type `'BOOLEAN'`, `'TEXT'`, `'INSTANCE_SWAP'`, `'VARIANT'`, or `'SLOT'` with the following restrictions:
   *
   * - `name` is supported for all properties
   * - `defaultValue` is supported for `'BOOLEAN'`, `'TEXT'`, and `'INSTANCE_SWAP'` properties, but not for `'VARIANT'` or `'SLOT'` properties
   * - `preferredValues` is only supported for `'INSTANCE_SWAP'` and `'SLOT'` properties
   * - `description` is only supported for `'SLOT'` properties
   * - `slotSettings` is only supported for `'SLOT'` properties
   */
  editComponentProperty(
    propertyName: string,
    newValue: {
      name?: string
      defaultValue?: string | boolean | VariableAlias
      preferredValues?: InstanceSwapPreferredValue[]
      description?: string
      slotSettings?: SlotSettings
    },
  ): string
  /**
   * Deletes an existing component property on this node. This function only supports properties with type `'BOOLEAN'`, `'TEXT'`, `'INSTANCE_SWAP'` or `'SLOT'`.
   */
  deleteComponentProperty(propertyName: string): void
}
/**
 * @see https://developers.figma.com/docs/plugins/api/TextNode
 */
interface BaseNonResizableTextMixin {
  /**
   * Returns whether the text uses a font currently not available to the document.
   */
  readonly hasMissingFont: boolean
  /**
   * The size of the font. Has minimum value of 1.
   */
  fontSize: number | PluginAPI['mixed']
  /**
   * The font family (e.g. `"Inter"`), font style (e.g. `"Regular"`). For [variable fonts](https://developers.figma.com/docs/plugins/api/FontName), also {@link FontName.variationSettings}. Setting this property to a different value requires the new font to be loaded.
   *
   * @remarks
   *
   * When reading, `variationSettings` is populated only when the font is a variable font, and includes every axis the family defines (not just overrides). Returns `figma.mixed` when the text node has more than one font, or when variation settings differ across character ranges.
   *
   * When writing, pass a {@link FontName} or {@link FontNameInput}. Omit `style` to let Figma pick the named instance closest to `variationSettings`. Supply `variationSettings` to override specific axes; keys must match the family's axis tags (see {@link PluginAPI.getFontFamilyVariationAxes}). An omitted axis keeps the named instance's default.
   *
   * ```ts title="Set a variable font with custom weight"
   * (async () => {
   *   const text = figma.createText()
   *   await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })
   *   text.fontName = {
   *     family: 'Inter',
   *     style: 'Regular',
   *     variationSettings: { wght: 650 },
   *   }
   *   text.characters = 'Almost bold'
   * })()
   * ```
   */
  fontName: FontName | PluginAPI['mixed']
  /**
   * The weight of the font (e.g. 400 for "Regular", 700 for "Bold").
   */
  readonly fontWeight: number | PluginAPI['mixed']
  /**
   * Overrides the case of the raw characters in the text node. Requires the font to be loaded.
   */
  textCase: TextCase | PluginAPI['mixed']
  /**
   * [OpenType features](https://help.figma.com/hc/en-us/articles/4913951097367) that have been explicitly enabled or disabled.
   *
   * @remarks
   *
   * The **Details** tab in the [Type settings panel](https://help.figma.com/hc/en-us/articles/360039956634-Explore-text-properties#type-settings) shows all the OpenType features that are available for the current font.
   *
   * This property gives you a map of four-character OpenType features to booleans indicating whether the features are explicitly enabled or disabled. For example, if the map contains `{ CALT: false }`, then the "Contextual alternates" feature is disabled.
   *
   * Note: This map only contains features that diverge from their default values. Some OpenType features are enabled by default and some are disabled by default. For example `CLIG` and `LIGA` are on by default, whereas `LNUM` and `TNUM` are disabled by default.
   *
   * Here are some useful resources for learning about OpenType features:
   *
   * - [An ode to OpenType [Figma blog]](https://www.figma.com/blog/opentype-font-features/)
   * - [OpenType feature tags [Microsoft]](https://learn.microsoft.com/en-us/typography/opentype/spec/featuretags)
   * - [OpenType font features guide [MDN]](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Fonts/OpenType_fonts_guide)
   * - [OpenType Features in CSS [Sparanoid]](https://sparanoid.com/lab/opentype-features/)
   *
   * ```ts title="Getting OpenType features from the currently-selected text node"
   * // For a node that uses the Inter font with
   * // "Contextual alternates" disabled (shows -> instead of ➔):
   * // { CALT: false }
   * console.log(figma.currentPage.selection[0].openTypeFeatures)
   * ```
   */
  readonly openTypeFeatures:
    | {
        readonly [feature in OpenTypeFeature]: boolean
      }
    | PluginAPI['mixed']
  /**
   * The spacing between the individual characters. Requires the font to be loaded.
   */
  letterSpacing: LetterSpacing | PluginAPI['mixed']
  /**
   * A {@link HyperlinkTarget} if the text node has exactly one hyperlink, or `null` if the node has none.
   */
  hyperlink: HyperlinkTarget | null | PluginAPI['mixed']
  /**
   * The raw characters in the text node. Setting this property requires the font the be loaded.
   *
   * @remarks
   *
   * Setting this property will reset styles applied to character ranges.
   *
   * Setting the `characters` property can change the {@link BaseNodeMixin.name} of the node if `autoRename === true`.
   */
  characters: string
  /**
   * Insert `characters` at index `start` in the text.
   *
   * @remarks
   *
   * This API allows you to insert characters in a text node while preserving the styles of the existing characters. However, you still need to call {@link PluginAPI.loadFontAsync} before using this API.
   *
   * The style of the inserted characters will be copied from the preceding character if `useStyle` is "BEFORE" or not provided. Otherwise, the style of inserted characters will be copied from the following character. If there is no preceding or following character (i.e. `start` is at the boundary of the string), then the style will be copied from the closest existing character.
   *
   * Caution: ⚠ Did you know: not all glyphs that you might think as a "character" are actually stored as a single character in JavaScript string? JavaScript strings are UTF-16 encoded. Some characters like "👍" are stored using two characters! Try it in the JavaScript console: "👍".length is 2! The two characters are called "surrogate pairs". Even more mindblowing: some characters are made of multiple _emojis_. For example, "👨‍👧", which you should see in your browser as a single character, has length 5. "👨‍👧".substring(0, 2) is "👨" and "👨‍👧".substring(3, 5) is "👧".
   */
  insertCharacters(start: number, characters: string, useStyle?: 'BEFORE' | 'AFTER'): void
  /**
   * Remove characters in the text from `start` (inclusive) to `end` (exclusive).
   *
   * @remarks
   *
   * This API allows you to remove characters in a text node while preserving the styles of the existing characters. However, you still need to call {@link PluginAPI.loadFontAsync} before using this API.
   *
   * Caution: ⚠ Did you know: not all glyphs that you might think as a "character" are actually stored as a single character in JavaScript string? JavaScript strings are UTF-16 encoded. Some characters like "👍" are stored using two characters! Try it in the JavaScript console: "👍".length is 2! The two characters are called "surrogate pairs". Even more mindblowing: some characters are made of multiple _emojis_. For example, "👨‍👧", which you should see in your browser as a single character, has length 5. "👨‍👧".substring(0, 2) is "👨" and "👨‍👧".substring(3, 5) is "👧".
   */
  deleteCharacters(start: number, end: number): void
  /**
   * Get the `fontSize` from characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeFontSize(start: number, end: number): number | PluginAPI['mixed']
  /**
   * Set the `fontSize` from characters in range `start` (inclusive) to `end` (exclusive). Requires the font to be loaded.
   */
  setRangeFontSize(start: number, end: number, value: number): void
  /**
   * Get the `fontName` from characters in range `start` (inclusive) to `end` (exclusive). For [variable fonts](https://developers.figma.com/docs/plugins/api/FontName), the returned {@link FontName} includes {@link FontName.variationSettings}. Returns `figma.mixed` when the range contains more than one font or when variation settings differ.
   */
  getRangeFontName(start: number, end: number): FontName | PluginAPI['mixed']
  /**
   * Set the `fontName` from characters in range `start` (inclusive) to `end` (exclusive). Requires the new font to be loaded.
   *
   * @remarks
   *
   * Accepts a {@link FontNameInput}. Pass `variationSettings` to override specific axes of a [variable font](https://developers.figma.com/docs/plugins/api/FontName). Omit `style` to let Figma pick the named instance closest to `variationSettings`.
   *
   * ```ts title="Override weight on a character range"
   * (async () => {
   *   const text = figma.createText()
   *   await figma.loadFontAsync({ family: 'Inter' })
   *   text.characters = 'Hello world'
   *   text.setRangeFontName(0, 5, {
   *     family: 'Inter',
   *     style: 'Regular',
   *     variationSettings: { wght: 700 },
   *   })
   * })()
   * ```
   */
  setRangeFontName(start: number, end: number, value: FontNameInput): void
  /**
   * Get the `fontWeight` from characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeFontWeight(start: number, end: number): number | PluginAPI['mixed']
  /**
   * Get the `fontName`s from characters in range `start` (inclusive) to `end` (exclusive). For [variable fonts](https://developers.figma.com/docs/plugins/api/FontName), each entry includes {@link FontName.variationSettings}.
   */
  getRangeAllFontNames(start: number, end: number): FontName[]
  /**
   * Get the `textCase` from characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeTextCase(start: number, end: number): TextCase | PluginAPI['mixed']
  /**
   * Set the `textCase` from characters in range `start` (inclusive) to `end` (exclusive). Requires the font to be loaded.
   */
  setRangeTextCase(start: number, end: number, value: TextCase): void
  /**
   * Get the {@link BaseNonResizableTextMixin.openTypeFeatures} from characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeOpenTypeFeatures(
    start: number,
    end: number,
  ):
    | {
        readonly [feature in OpenTypeFeature]: boolean
      }
    | PluginAPI['mixed']
  /**
   * Get the `letterSpacing` from characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeLetterSpacing(start: number, end: number): LetterSpacing | PluginAPI['mixed']
  /**
   * Set the `letterSpacing` from characters in range `start` (inclusive) to `end` (exclusive). Requires the font to be loaded.
   */
  setRangeLetterSpacing(start: number, end: number, value: LetterSpacing): void
  /**
   * Get the `hyperlink` from characters in range `start` (inclusive) to `end` (exclusive). Returns a {@link HyperlinkTarget} if the range contains exactly one hyperlink, or `null` if the range contains none.
   */
  getRangeHyperlink(start: number, end: number): HyperlinkTarget | null | PluginAPI['mixed']
  /**
   * Set the `hyperlink` from characters in range `start` (inclusive) to `end` (exclusive). Removes the hyperlink in range if `value` is `null`.
   */
  setRangeHyperlink(start: number, end: number, value: HyperlinkTarget | null): void
  /**
   * Get the `fills` from characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeFills(start: number, end: number): Paint[] | PluginAPI['mixed']
  /**
   * Set the `fills` from characters in range `start` (inclusive) to `end` (exclusive). Requires font to be loaded.
   *
   * Can be bound to color variables by using {@link VariablesAPI.setBoundVariableForPaint} on one or more of the provided `Paint`s
   */
  setRangeFills(start: number, end: number, value: Paint[]): void
  /**
   * Get the `textStyleId` from characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeTextStyleId(start: number, end: number): string | PluginAPI['mixed']
  /**
   * Set the provided {@link TextStyle} to characters in range `start` (inclusive) to `end` (exclusive). Requires the font to be loaded.
   */
  setRangeTextStyleIdAsync(start: number, end: number, styleId: string): Promise<void>
  /**
   * Get the `fillStyleId` from characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeFillStyleId(start: number, end: number): string | PluginAPI['mixed']
  /**
   * Set the provided {@link PaintStyle} as a fill to characters in range `start` (inclusive) to `end` (exclusive).
   */
  setRangeFillStyleIdAsync(start: number, end: number, styleId: string): Promise<void>
  /**
   * Get the `boundVariable` for a given field from characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeBoundVariable(
    start: number,
    end: number,
    field: VariableBindableTextField,
  ): VariableAlias | null | PluginAPI['mixed']
  /**
   * Set the `boundVariable` for a given field from characters in range `start` (inclusive) to `end` (exclusive). Requires any new fonts to be loaded.
   */
  setRangeBoundVariable(
    start: number,
    end: number,
    field: VariableBindableTextField,
    variable: Variable | null,
  ): void
  /**
   * Get text segments along with the desired text properties (font size, text case, etc...)
   *
   * @param fields - An array of text properties. Any text property that can apply to specific character ranges is supported:
   * - fontSize
   * - fontName
   * - fontWeight
   * - fontStyle
   * - textDecoration
   * - textDecorationStyle
   * - textDecorationOffset
   * - textDecorationThickness
   * - textDecorationColor
   * - textDecorationSkipInk
   * - textCase
   * - lineHeight
   * - letterSpacing
   * - fills
   * - textStyleId
   * - fillStyleId
   * - listOptions
   * - listSpacing
   * - indentation
   * - paragraphIndent
   * - paragraphSpacing
   * - hyperlink
   * - boundVariables
   * - textStyleOverrides
   * - openTypeFeatures
   *
   * @param start - An optional start index for the characters to retrieve
   * @param end - An optional end index (required if `start` is provided)
   *
   * @remarks
   *
   * This function provides an easy and performant way to get multiple text properties which may have [mixed values](https://developers.figma.com/docs/plugins/working-with-text#mixed-styles), along with which characters these values apply to.
   * It will return an array of {@link StyledTextSegment}s containing the desired fields, along with the characters and their start and end index.
   *
   * To illustrate the behavior of this function, here are a few examples:
   *
   * Node containing "**hello** world":
   * ```js
   * textNode.getStyledTextSegments(['fontName'])
   *
   * // Output: contains 2 segments because the text is no longer bolded after "hello"
   * [
   *   {
   *     characters: "hello",
   *     start: 0,
   *     end: 5,
   *     fontName: { family: 'Inter', style: 'Bold' },
   *   },
   *   {
   *     characters: " world",
   *     start: 5,
   *     end: 11,
   *     fontName: { family: 'Inter', style: 'Regular' },
   *   }
   * ]
   * ```
   *
   * Node containing:
   * - Item 1
   *   - **Item** 1.1
   * ```js
   * textNode.getStyledTextSegments(['fontName', 'indentation'])
   *
   * // Output: contains 3 segments because the font / indentation changes
   * // before and after the second "Item"
   * [
   *   {
   *     characters: 'Item 1\n',
   *     start: 0,
   *     end: 7,
   *     fontName: { family: 'Inter', style: 'Regular' },
   *     indentation: 1
   *   },
   *   {
   *     characters: 'Item',
   *     start: 7,
   *     end: 11,
   *     fontName: { family: 'Inter', style: 'Bold' },
   *     indentation: 2
   *   },
   *   {
   *     characters: ' 1.1',
   *     start: 11,
   *     end: 15,
   *     fontName: { family: 'Inter', style: 'Regular' },
   *     indentation: 2
   *   }
   * ]
   * ```
   *
   * Node containing "😁 😭 😅😂😳😎":
   * ```js
   * textNode.getStyledTextSegments(['letterSpacing'])
   *
   * // Output: many emoji have length 2 in Javascript
   * [
   *   {
   *     characters: '😁😭',
   *     start: 0,
   *     end: 4,
   *     letterSpacing: { unit: 'PERCENT', value: 50 }
   *   },
   *   {
   *     characters: '😅😂😳😎',
   *     start: 4,
   *     end: 12,
   *     letterSpacing: { unit: 'PERCENT', value: 0 }
   *   }
   * ]
   *
   * textNode.getStyledTextSegments(['letterSpacing'], 1, 3)
   *
   * // Output: if the requested range starts or ends in the middle
   * // of surrogate pairs, those pairs will be trimmed and you will
   * // see raw Unicode code points
   * [
   *   {
   *     characters: '\uDE01\uD83D',
   *     start: 1,
   *     end: 3,
   *     letterSpacing: { unit: 'PERCENT', value: 50 }
   *   }
   * ]
   *
   * textNode.getStyledTextSegments(['letterSpacing'], 3, 5)
   *
   * // Output: similar to above, but Unicode code points span
   * // a change in letter spacing
   * [
   *   {
   *     characters: '\uDE2D',
   *     start: 3,
   *     end: 4,
   *     letterSpacing: { unit: 'PERCENT', value: 50 }
   *   },
   *   {
   *     characters: '\uD83D',
   *     start: 4,
   *     end: 5,
   *     letterSpacing: { unit: 'PERCENT', value: 0 }
   *   }
   * ]
   * ```
   *
   * See {@link BaseNonResizableTextMixin.insertCharacters} for more information on surrogate pairs.
   */
  getStyledTextSegments<
    StyledTextSegmentFields extends (keyof Omit<
      StyledTextSegment,
      'characters' | 'start' | 'end'
    >)[],
  >(
    fields: StyledTextSegmentFields,
    start?: number,
    end?: number,
  ): Array<
    Pick<StyledTextSegment, StyledTextSegmentFields[number] | 'characters' | 'start' | 'end'>
  >
}
/**
 * @see https://developers.figma.com/docs/plugins/api/TextNode
 */
interface NonResizableTextMixin extends BaseNonResizableTextMixin {
  /**
   * The indentation of paragraphs (offset of the first line from the left). Setting this property requires the font the be loaded.
   */
  paragraphIndent: number | PluginAPI['mixed']
  /**
   * The vertical distance between paragraphs. Setting this property requires the font to be loaded.
   *
   * @remarks
   *
   * **Working with Paragraph Level Fields**
   *
   * ```ts
   * const text = figma.createText()
   * await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })
   *
   * // Create text with two paragraphs, separated by \n
   * text.characters = "hello figma, welcome to my plugin!\nI love the Figma Plugin API!"
   * text.resize(120, 30)
   * text.textAutoResize = 'HEIGHT'
   *
   * // Apply 20px paragraph spacing - all paragraphs covered by the provided text range will be
   * // modified, and remaining paragraphs will be untouched.
   * text.setRangeParagraphSpacing(0, 1, 20)
   * // text.paragraphSpacing = Symbol(figma.mixed)
   * // text.getStyledTextSegments(['paragraphSpacing']) =
   * //    [
   * //      {
   * //        "characters": "hello figma, welcome to my plugin!\n",
   * //        "start": 0,
   * //        "end": 35,
   * //        "paragraphSpacing": 20
   * //      },
   * //      {
   * //        "characters": "I love the Figma Plugin API!",
   * //        "start": 35,
   * //        "end": 63,
   * //        "paragraphSpacing": 0
   * //      }
   * //    ]
   *
   * text.setRangeTextWrapStyle(38, 39, 'BALANCE')
   * // text.textWrapStyle = Symbol(figma.mixed)
   * // text.getStyledTextSegments(['textWrapStyle']) =
   * //    [
   * //      {
   * //        "characters": "hello figma, welcome to my plugin!\n",
   * //        "start": 0,
   * //        "end": 35,
   * //        "textWrapStyle": "AUTO"
   * //      },
   * //      {
   * //        "characters": "I love the Figma Plugin API!",
   * //        "start": 35,
   * //        "end": 63,
   * //        "textWrapStyle": "BALANCE"
   * //      }
   * //    ]
   * ```
   *
   */
  paragraphSpacing: number | PluginAPI['mixed']
  /**
   * Controls how text wraps within each paragraph. Setting this property requires the font to be loaded.
   *
   * @remarks
   *
   * **Working with Paragraph Level Fields**
   *
   * ```ts
   * const text = figma.createText()
   * await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })
   *
   * // Create text with two paragraphs, separated by \n
   * text.characters = "hello figma, welcome to my plugin!\nI love the Figma Plugin API!"
   * text.resize(120, 30)
   * text.textAutoResize = 'HEIGHT'
   *
   * // Apply 20px paragraph spacing - all paragraphs covered by the provided text range will be
   * // modified, and remaining paragraphs will be untouched.
   * text.setRangeParagraphSpacing(0, 1, 20)
   * // text.paragraphSpacing = Symbol(figma.mixed)
   * // text.getStyledTextSegments(['paragraphSpacing']) =
   * //    [
   * //      {
   * //        "characters": "hello figma, welcome to my plugin!\n",
   * //        "start": 0,
   * //        "end": 35,
   * //        "paragraphSpacing": 20
   * //      },
   * //      {
   * //        "characters": "I love the Figma Plugin API!",
   * //        "start": 35,
   * //        "end": 63,
   * //        "paragraphSpacing": 0
   * //      }
   * //    ]
   *
   * text.setRangeTextWrapStyle(38, 39, 'BALANCE')
   * // text.textWrapStyle = Symbol(figma.mixed)
   * // text.getStyledTextSegments(['textWrapStyle']) =
   * //    [
   * //      {
   * //        "characters": "hello figma, welcome to my plugin!\n",
   * //        "start": 0,
   * //        "end": 35,
   * //        "textWrapStyle": "AUTO"
   * //      },
   * //      {
   * //        "characters": "I love the Figma Plugin API!",
   * //        "start": 35,
   * //        "end": 63,
   * //        "textWrapStyle": "BALANCE"
   * //      }
   * //    ]
   * ```
   *
   */
  textWrapStyle: TextWrapStyle | PluginAPI['mixed']
  /**
   * The vertical distance between lines of a list.
   */
  listSpacing: number | PluginAPI['mixed']
  /**
   * Whether punctuation, like quotation marks, hangs outside the text box.
   */
  hangingPunctuation: boolean
  /**
   * Whether numbered list counters or unordered list bullets hang outside the text box.
   */
  hangingList: boolean
  /**
   * Whether the text is underlined or has a strikethrough. Requires the font to be loaded.
   */
  textDecoration: TextDecoration | PluginAPI['mixed']
  /**
   * The text decoration style (e.g. "SOLID"). If the text is not underlined, this value will be null. Requires the font to be loaded.
   */
  textDecorationStyle: TextDecorationStyle | PluginAPI['mixed'] | null
  /**
   * The text decoration offset. If the text is not underlined, this value will be null. Requires the font to be loaded.
   */
  textDecorationOffset: TextDecorationOffset | PluginAPI['mixed'] | null
  /**
   * The text decoration thickness. If the text is not underlined, this value will be null. Requires the font to be loaded.
   */
  textDecorationThickness: TextDecorationThickness | PluginAPI['mixed'] | null
  /**
   * The text decoration color. If the text is not underlined, this value will be null. Requires the font to be loaded.
   */
  textDecorationColor: TextDecorationColor | PluginAPI['mixed'] | null
  /**
   * Whether the text decoration skips descenders. If the text is not underlined, this value will be null. Requires the font to be loaded.
   */
  textDecorationSkipInk: boolean | PluginAPI['mixed'] | null
  /**
   * The spacing between the lines in a paragraph of text. Requires the font to be loaded.
   */
  lineHeight: LineHeight | PluginAPI['mixed']
  /**
   * The removal of the vertical space above and below text glyphs. Requires the font to be loaded.
   */
  leadingTrim: LeadingTrim | PluginAPI['mixed']
  /**
   * Get the `textDecoration` from characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeTextDecoration(start: number, end: number): TextDecoration | PluginAPI['mixed']
  /**
   * Set the `textDecoration` from characters in range `start` (inclusive) to `end` (exclusive). Requires the font to be loaded.
   */
  setRangeTextDecoration(start: number, end: number, value: TextDecoration): void
  /**
   * Get the `textDecorationStyle` from characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeTextDecorationStyle(
    start: number,
    end: number,
  ): TextDecorationStyle | PluginAPI['mixed'] | null
  /**
   * Set the `textDecorationStyle` from characters in range `start` (inclusive) to `end` (exclusive). Requires the font to be loaded.
   */
  setRangeTextDecorationStyle(start: number, end: number, value: TextDecorationStyle): void
  /**
   * Get the `textDecorationOffset` from characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeTextDecorationOffset(
    start: number,
    end: number,
  ): TextDecorationOffset | PluginAPI['mixed'] | null
  /**
   * Set the `textDecorationOffset` from characters in range `start` (inclusive) to `end` (exclusive). Requires the font to be loaded.
   */
  setRangeTextDecorationOffset(start: number, end: number, value: TextDecorationOffset): void
  /**
   * Get the `textDecorationThickness` from characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeTextDecorationThickness(
    start: number,
    end: number,
  ): TextDecorationThickness | PluginAPI['mixed'] | null
  /**
   * Set the `textDecorationThickness` from characters in range `start` (inclusive) to `end` (exclusive). Requires the font to be loaded.
   */
  setRangeTextDecorationThickness(start: number, end: number, value: TextDecorationThickness): void
  /**
   * Get the `textDecorationColor` from characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeTextDecorationColor(
    start: number,
    end: number,
  ): TextDecorationColor | PluginAPI['mixed'] | null
  /**
   * Set the `textDecorationColor` from characters in range `start` (inclusive) to `end` (exclusive). Requires the font to be loaded.
   */
  setRangeTextDecorationColor(start: number, end: number, value: TextDecorationColor): void
  /**
   * Get the `textDecorationSkipInk` from characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeTextDecorationSkipInk(start: number, end: number): boolean | PluginAPI['mixed'] | null
  /**
   * Set the `textDecorationSkipInk` from characters in range `start` (inclusive) to `end` (exclusive). Requires the font to be loaded.
   */
  setRangeTextDecorationSkipInk(start: number, end: number, value: boolean): void
  /**
   * Get the `lineHeight` from characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeLineHeight(start: number, end: number): LineHeight | PluginAPI['mixed']
  /**
   * Set the `lineHeight` from characters in range `start` (inclusive) to `end` (exclusive). Requires the font to be loaded.
   */
  setRangeLineHeight(start: number, end: number, value: LineHeight): void
  /**
   * Get the `textListOptions` from characters in range `start` (inclusive) to `end` (exclusive). Returns a {@link TextListOptions}
   */
  getRangeListOptions(start: number, end: number): TextListOptions | PluginAPI['mixed']
  /**
   * Set the `textListOptions` from characters in range `start` (inclusive) to `end` (exclusive).
   */
  setRangeListOptions(start: number, end: number, value: TextListOptions): void
  /**
   * Get the `listSpacing` from characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeListSpacing(start: number, end: number): number | PluginAPI['mixed']
  /**
   * Set the `listSpacing` from characters in range `start` (inclusive) to `end` (exclusive).
   */
  setRangeListSpacing(start: number, end: number, value: number): void
  /**
   * Get the `indentation` from characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeIndentation(start: number, end: number): number | PluginAPI['mixed']
  /**
   * Set the `indentation` from characters in range `start` (inclusive) to `end` (exclusive).
   */
  setRangeIndentation(start: number, end: number, value: number): void
  /**
   * Get the `paragraphIndent` for a paragraph containing characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeParagraphIndent(start: number, end: number): number | PluginAPI['mixed']
  /**
   * Set the `paragraphIndent` for a paragraph containing characters in range `start` (inclusive) to `end` (exclusive).
   */
  setRangeParagraphIndent(start: number, end: number, value: number): void
  /**
   * Get the `paragraphSpacing` for a paragraph containing characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeParagraphSpacing(start: number, end: number): number | PluginAPI['mixed']
  /**
   * Set the `paragraphSpacing` for a paragraph containing characters in range `start` (inclusive) to `end` (exclusive).
   */
  setRangeParagraphSpacing(start: number, end: number, value: number): void
  /**
   * Get the `textWrapStyle` for a paragraph containing characters in range `start` (inclusive) to `end` (exclusive).
   */
  getRangeTextWrapStyle(start: number, end: number): TextWrapStyle | PluginAPI['mixed']
  /**
   * Set the `textWrapStyle` for a paragraph containing characters in range `start` (inclusive) to `end` (exclusive). Requires the font to be loaded.
   */
  setRangeTextWrapStyle(start: number, end: number, value: TextWrapStyle): void
}
/**
 * @see https://developers.figma.com/docs/plugins/api/TextPathNode
 */
interface NonResizableTextPathMixin extends BaseNonResizableTextMixin {}
/**
 * @see https://developers.figma.com/docs/plugins/api/TextNode
 */
interface TextSublayerNode extends NonResizableTextMixin, MinimalFillsMixin {}
interface DocumentNode extends BaseNodeMixin {
  /**
   * The type of this node, represented by the string literal "DOCUMENT"
   */
  readonly type: 'DOCUMENT'
  /**
   * The list of children. For `DocumentNode`s, children are always {@link PageNode}s.
   */
  readonly children: ReadonlyArray<PageNode>
  /**
   * The color profile of this document. This will be "LEGACY" for documents created before color management was launched.
   */
  readonly documentColorProfile: 'LEGACY' | 'SRGB' | 'DISPLAY_P3'
  /**
   * Adds a new page to the end of the `children` array.
   */
  appendChild(child: PageNode): void
  /**
   * Adds a new page at the specified index in the `children` array.
   */
  insertChild(index: number, child: PageNode): void
  /**
   * Searches the immediate children of this node (i.e. all page nodes, not including their children). Returns all pages for which `callback` returns true.
   *
   * @param callback - A function that evaluates whether to return the provided `node`. If this argument is omitted, `findChildren` returns `node.children`.
   *
   * @remarks
   *
   * Example: find pages matching a certain name scheme
   * ```ts
   * const templates = figma.root.findChildren(n => n.name.includes("template"))
   * ```
   */
  findChildren(callback?: (node: PageNode) => boolean): Array<PageNode>
  /**
   * Searches the immediate children of this node (i.e. all page nodes, not including their children). Returns the first page for which `callback` returns true.
   *
   * @param callback - A function that evaluates whether to return the provided `node`.
   *
   * @remarks
   *
   * This function returns `null` if no matching node is found.
   *
   * Example: find the first page matching a certain name scheme
   * ```ts
   * const firstTemplate = figma.root.findChild(n => n.name.includes("template"))
   * ```
   */
  findChild(callback: (node: PageNode) => boolean): PageNode | null
  /**
   * Searches the entire document tree. Returns all nodes for which `callback` returns true.
   *
   * If the manifest contains `"documentAccess": "dynamic-page"`, you must first call {@link PluginAPI.loadAllPagesAsync} to access this function.
   *
   * @param callback - A function that evaluates whether to return the provided `node`. If this argument is omitted, `findAll` returns all nodes in the subtree.
   *
   * @remarks
   *
   * Nodes are included in **back-to-front** order. Parents always appear before their children, and children appear in same relative order before their children, and children appear in same relative order as in the {@link ChildrenMixin.children} array.
   *
   * This traversal method is known as ["pre-order traversal"](https://en.wikipedia.org/wiki/Tree_traversal#Pre-order_(NLR)).
   *
   * Note that the root node itself is **not included**.
   *
   * Example: find all nodes whose name is "Color":
   * ```ts
   * await figma.loadAllPagesAsync() // call this once when the plugin runs
   * const colors = figma.root.findAll(n => n.name === "Color")
   * ```
   *
   * Caution: ⚠ Large documents in Figma can have tens of thousands of nodes. Be careful using this function as it could be very slow.
   * Please refer to our [recommendations](https://developers.figma.com/docs/plugins/accessing-document#full-document-traversal) for how to optimize document traversals.
   */
  findAll(callback?: (node: PageNode | SceneNode) => boolean): Array<PageNode | SceneNode>
  /**
   * Searches this entire page (this node's children, its children's children, etc.). Returns the first node for which `callback` returns true.
   *
   * If the manifest contains `"documentAccess": "dynamic-page"`, you must first call {@link PluginAPI.loadAllPagesAsync} to access this function.
   *
   * @param callback - A function that evaluates whether to return the provided `node`.
   *
   * @remarks
   *
   * This function returns `null` if no matching node is found. The traversal order is the same as in {@link ChildrenMixin.findAll}.
   *
   * Note that the root node itself is **not included**.
   *
   * Example: find one node whose name is "Template":
   * ```ts
   * await figma.loadAllPagesAsync() // call this once when the plugin runs
   * const template = figma.root.findOne(n => n.name === "Template")
   * ```
   *
   * Caution: ⚠ Large documents in Figma can have tens of thousands of nodes. Be careful using this function as it could be very slow.
   * Please refer to our [recommendations](https://developers.figma.com/docs/plugins/accessing-document#full-document-traversal) for how to optimize document traversals.
   */
  findOne(callback: (node: PageNode | SceneNode) => boolean): PageNode | SceneNode | null
  /**
   * Searches the entire document tree. Returns all nodes that satisfy all of specified criteria.
   *
   * If the manifest contains `"documentAccess": "dynamic-page"`, you must first call {@link PluginAPI.loadAllPagesAsync} to access this function.
   *
   * Similar to {@link ChildrenMixin.findAllWithCriteria} with the main difference being that this searches all the nodes in the document, which also includes {@link PageNode} objects.
   */
  findAllWithCriteria<T extends NodeType[]>(
    criteria: FindAllCriteria<T>,
  ): Array<
    {
      type: T[number]
    } & (PageNode | SceneNode)
  >
  /**
   * Searches the entire document tree. Returns all widget nodes that match the provided `widgetId`.
   *
   * If the manifest contains `"documentAccess": "dynamic-page"`, you must first call {@link PluginAPI.loadAllPagesAsync} to access this function.
   *
   * @param widgetId - The widget ID to search for, which represents unique identifier for the widget.
   *
   * @remarks
   *
   * `node.widgetId` is not to be confused with `node.id`, which is the unique identifier for the node on the canvas. In other words, if you clone a widget, the cloned widget will have a matching `widgetId` but a different `id`.
   */
  findWidgetNodesByWidgetId(widgetId: string): Array<WidgetNode>
}
interface ExplicitVariableModesMixin {
  /**
   * The explicitly set modes for this node.
   * For `SceneNodes`, represents a subset of {@link SceneNodeMixin.resolvedVariableModes }.
   * Note that this does not include [workspace and team-default modes](https://help.figma.com/hc/en-us/articles/12611253730071).
   */
  explicitVariableModes: {
    [collectionId: string]: string
  }
  /**
   * Clears an explicit mode for the given collection on this node
   *
   * @param collection - A variable collection. Make sure to pass a collection object here; passing a variable collection ID is deprecated.
   */
  clearExplicitVariableModeForCollection(collection: VariableCollection): void
  /**
   * Sets an explicit mode for the given collection on this node
   *
   * @param collection - A variable collection. Make sure to pass a collection object here; passing a variable collection ID is deprecated.
   * @param modeId - A variable mode ID.
   */
  setExplicitVariableModeForCollection(collection: VariableCollection, modeId: string): void
}
interface PageNode
  extends BaseNodeMixin, ChildrenMixin, ExportMixin, ExplicitVariableModesMixin, MeasurementsMixin {
  /**
   * The type of this node, represented by the string literal "PAGE"
   */
  readonly type: 'PAGE'
  /**
   * Create a clone of this page, parented under {@link PluginAPI.root}. Prototyping connections will be copied such that they point to their equivalent in the cloned page. Components will be cloned as instances who master is the original component.
   */
  clone(): PageNode
  /**
   * The guides on this page.
   *
   * @remarks
   *
   * Like many of our array properties, `page.guide` creates a new, read-only array every time it is called. To change the guides, you will need to make a copy of the existing array and/or assign a new array.
   *
   * Example:
   * ```ts
   * function addNewGuide(page: PageNode, guide: Guide) {
   *   // .concat() creates a new array
   *   page.guides = page.guides.concat(guide)
   * }
   * ```
   */
  guides: ReadonlyArray<Guide>
  /**
   * The selected nodes on this page. Each page stores its own selection separately. The ordering of nodes in the selection is **unspecified**, you should not be relying on it.
   *
   * @remarks
   *
   * Like many of our array properties, `page.selection` returns a new, read-only array every time it is called (the nodes inside are references to existing nodes, not copies). To change the selection, you will need to make a copy of the existing array and/or assign a new array.
   *
   * Example:
   * ```ts
   * function addNewNodeToSelection(page: PageNode, node: SceneNode) {
   *   // .concat() creates a new array
   *   page.selection = page.selection.concat(node)
   * }
   *
   * function selectFirstChildOfNode(page: PageNode, node: SceneNode) {
   *   if (node.children.length > 0) {
   *     page.selection = [node.children[0]]
   *   }
   * }
   * ```
   *
   * - As the selection is just a node property, the selection is preserved when the user switches between pages.
   * - Nodes in the selection are unique. When setting the selection, the API will de-deduplicate nodes in the selection. This API could have been a `Set<SceneNode>`, but it's generally easier to work with array and to get the first node using just selection[0].
   * - Only **directly selected nodes** are present in this array. A node is directly selected when it is selected and none of its ancestors are selected. That means the array will never contain both a node and one of its descendents.
   */
  selection: ReadonlyArray<SceneNode>
  /**
   * The current text node being edited, if any, and the text currently being selected within that text node.
   *
   * @remarks
   *
   * This property will return `null` if there is no text node being edited. Setting this property to a `node` will enter text edit mode on that `node`. Leaving text edit mode will set this value to `null`.
   *
   * When `start == end`, it means that no characters is currently selected -- i.e., there is just a cursor.
   *
   * Changing `selectedTextRange` will trigger a `selectionchange` message.
   */
  selectedTextRange: {
    node: TextNode
    start: number
    end: number
  } | null
  /**
   * The sorted list of flow starting points used when accessing Presentation view.
   *
   * @remarks
   *
   * The default starting point is the first one (e.g., used when no frames are selected and you click the toolbar's play icon to enter Presentation view).
   */
  flowStartingPoints: ReadonlyArray<{
    nodeId: string
    name: string
  }>
  /**
   * The background color of the canvas (currently only supports a single solid color paint).
   */
  backgrounds: ReadonlyArray<Paint>
  /**
   * The background color of the prototype (currently only supports a single solid color paint).
   */
  prototypeBackgrounds: ReadonlyArray<Paint>
  /**
   * The starting point when launching a prototype. Prototypes with a starting node contain all frames reachable from that node. Prototypes without a starting node contain all frames on the current page. Note that prototypes are per-page.
   */
  readonly prototypeStartNode: FrameNode | GroupNode | ComponentNode | InstanceNode | null
  /**
   * Returns true if the node is a page divider, which is only possible when the page node is empty and has a page divider name. A page divider name consists of all asterisks, all en dashes, all em dashes, or all spaces. To create a page divider, use {@link PluginAPI.createPageDivider} or rename an empty page to a page divider name.
   */
  readonly isPageDivider: boolean
  /**
   * Loads the contents of the page node.
   */
  loadAsync(): Promise<void>
  /**
   *
   * Note: This API is only available in Figma Slides
   *
   * When in single slide view, the Slide that is currently focused is accessible via this property.
   *
   * @remarks
   *
   * You can also set this via:
   *
   * ```ts
   * figma.currentPage.focusedSlide = slideNode
   * ```
   */
  focusedSlide?: SlideNode | null
  /**
   *
   * Note: This API is only available in Figma Slides, Figma Buzz, and Dev Mode.
   *
   * For Figma Slides and Figma Buzz:
   * When in Asset View, this is the focused slide or asset.
   *
   * For Dev Mode:
   * This is the node currently focused in Dev Mode focus view. This property is read-only in Dev Mode.
   *
   * @remarks
   *
   * In Figma Slides and Figma Buzz, you can also set this via:
   *
   * ```ts
   * figma.currentPage.focusedNode = node
   * ```
   */
  focusedNode: SceneNode | null
}
interface FrameNode extends DefaultFrameMixin {
  /**
   * The type of this node, represented by the string literal "FRAME".
   */
  readonly type: 'FRAME'
  /**
   * Duplicates the frame node. By default, the duplicate will be parented under `figma.currentPage`. Nested components will be cloned as instances who master is the original component.
   */
  clone(): FrameNode
}
interface GroupNode
  extends
    BaseNodeMixin,
    SceneNodeMixin,
    ReactionMixin,
    ChildrenMixin,
    ContainerMixin,
    BlendMixin,
    LayoutMixin,
    ExportMixin,
    AspectRatioLockMixin {
  /**
   * The type of this node, represented by the string literal "GROUP".
   */
  readonly type: 'GROUP'
  /**
   * Duplicates the group node. By default, the duplicate will be parented under `figma.currentPage`. Nested components will be cloned as instances who master is the original component.
   */
  clone(): GroupNode
}
/**
 * @see https://developers.figma.com/docs/plugins/api/TransformGroupNode
 */
interface TransformGroupNode
  extends
    BaseNodeMixin,
    SceneNodeMixin,
    ReactionMixin,
    ChildrenMixin,
    ContainerMixin,
    BlendMixin,
    LayoutMixin,
    ExportMixin,
    AspectRatioLockMixin {
  /**
   * The type of this node, represented by the string literal "TRANSFORM_GROUP".
   */
  readonly type: 'TRANSFORM_GROUP'
  /**
   * Duplicates the transform group node. By default, the duplicate will be parented under `figma.currentPage`. Nested components will be cloned as instances who master is the original component.
   */
  clone(): TransformGroupNode
  /**
   * An array of transform modifiers applied to the child nodes within the group.
   */
  transformModifiers: TransformModifier[]
}
interface SliceNode extends BaseNodeMixin, SceneNodeMixin, LayoutMixin, ExportMixin {
  /**
   * The type of this node, represented by the string literal "SLICE"
   */
  readonly type: 'SLICE'
  /**
   * Duplicates the slice node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): SliceNode
}
interface RectangleNode
  extends
    DefaultShapeMixin,
    ConstraintMixin,
    CornerMixin,
    ComplexStrokesMixin,
    RectangleCornerMixin,
    IndividualStrokesMixin,
    AnnotationsMixin,
    AspectRatioLockMixin {
  /**
   * The type of this node, represented by the string literal "RECTANGLE"
   */
  readonly type: 'RECTANGLE'
  /**
   * Duplicates the rectangle node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): RectangleNode
}
interface LineNode
  extends DefaultShapeMixin, ConstraintMixin, AnnotationsMixin, ComplexStrokesMixin {
  /**
   * The type of this node, represented by the string literal "LINE"
   */
  readonly type: 'LINE'
  /**
   * Duplicates the line node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): LineNode
}
interface EllipseNode
  extends
    DefaultShapeMixin,
    ConstraintMixin,
    CornerMixin,
    ComplexStrokesMixin,
    AnnotationsMixin,
    AspectRatioLockMixin {
  /**
   * The type of this node, represented by the string literal "ELLIPSE"
   */
  readonly type: 'ELLIPSE'
  /**
   * Duplicates the ellipse node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): EllipseNode
  /**
   * Exposes the values of the sweep and ratio handles used in our UI to create arcs and donuts. See the {@link ArcData} property.
   */
  arcData: ArcData
}
interface PolygonNode
  extends
    DefaultShapeMixin,
    ConstraintMixin,
    CornerMixin,
    ComplexStrokesMixin,
    AnnotationsMixin,
    AspectRatioLockMixin {
  /**
   * The type of this node, represented by the string literal "POLYGON"
   */
  readonly type: 'POLYGON'
  /**
   * Duplicates the polygon node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): PolygonNode
  /**
   * Number of sides of the polygon. Must be an integer >= 3.
   */
  pointCount: number
}
interface StarNode
  extends
    DefaultShapeMixin,
    ConstraintMixin,
    CornerMixin,
    ComplexStrokesMixin,
    AnnotationsMixin,
    AspectRatioLockMixin {
  /**
   * The type of this node, represented by the string literal "STAR"
   */
  readonly type: 'STAR'
  /**
   * Duplicates the star node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): StarNode
  /**
   * Number of "spikes", or outer points of the star. Must be an integer >= 3.
   */
  pointCount: number
  /**
   * The percentage value that defines the acuteness of the star's angles. This value must be between 0.0 and 1.0 inclusive.
   *
   * Contrary to cornerRadius, which controls the outer corners of the star, innerRadius controls the inner rounded corners of the star. A value closer to 0 makes the angles on each point more acute, resulting in a more "spiky" look. A value closer to 1 makes the star closer to a Polygon node. A value equals 1 means that the node is a regular polygon with 2 * pointCount edges.
   */
  innerRadius: number
}
interface VectorNode
  extends
    DefaultShapeMixin,
    ConstraintMixin,
    CornerMixin,
    ComplexStrokesMixin,
    VectorLikeMixin,
    AnnotationsMixin,
    AspectRatioLockMixin {
  /**
   * The type of this node, represented by the string literal "VECTOR"
   */
  readonly type: 'VECTOR'
  /**
   * Duplicates the vector node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): VectorNode
}
interface TextNode
  extends
    DefaultShapeMixin,
    ConstraintMixin,
    NonResizableTextMixin,
    ComplexStrokesMixin,
    AnnotationsMixin,
    AspectRatioLockMixin {
  /**
   * The type of this node, represented by the string literal "TEXT"
   */
  readonly type: 'TEXT'
  /**
   * Duplicates the text node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): TextNode
  /**
   * The horizontal alignment of the text with respect to the textbox. Setting this property requires the font the be loaded.
   */
  textAlignHorizontal: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'
  /**
   * The vertical alignment of the text with respect to the textbox. Setting this property requires the font the be loaded.
   */
  textAlignVertical: 'TOP' | 'CENTER' | 'BOTTOM'
  /**
   * The behavior of how the size of the text box adjusts to fit the characters. Setting this property requires the font the be loaded.
   *
   * @remarks
   * - "NONE": The size of the textbox is fixed and is independent of its content.
   * - "HEIGHT": The width of the textbox is fixed. Characters wrap to fit in the textbox. The height of the textbox automatically adjusts to fit its content.
   * - "WIDTH_AND_HEIGHT": Both the width and height of the textbox automatically adjusts to fit its content. Characters do not wrap.
   * - [DEPRECATED] "TRUNCATE": Like "NONE", but text that overflows the bounds of the text node will be truncated with an ellipsis. This value will be removed in the future - prefer reading from {@link TextNode.textTruncation} instead.
   */
  textAutoResize: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE'
  /**
   * Whether this text node will truncate with an ellipsis when the text node size is smaller than the text inside.
   *
   * @remarks
   *
   * When {@link TextNode.textAutoResize} is set to `"NONE"`, the text will truncate when the fixed size is smaller than the text inside. When it is `"HEIGHT"` or `"WIDTH_AND_HEIGHT"`, truncation will only occur if used in conjunction with {@link DimensionAndPositionMixin.maxHeight} or {@link TextNode.maxLines}.
   */
  textTruncation: 'DISABLED' | 'ENDING'
  /**
   * The maximum number of lines a text node can reach before it truncates. Only applicable when {@link TextNode.textTruncation} is set to `"ENDING"`.
   *
   * @remarks
   *
   * The value must be >= 1. To disable truncation at a maximum number of lines, set to `null`.
   */
  maxLines: number | null
  /**
   * Whether updating the characters in the text node should update the name of the node. If this is set to true, `name` will be auto-derived from `characters`.
   *
   * @remarks
   *
   * This is automatically reset to false if `name` is modified in order to allow the node to keep the new name.
   */
  autoRename: boolean
  /**
   * The id of the {@link TextStyle} object that the text properties of this node are linked to. Requires the font to be loaded.
   *
   * If the manifest contains`"documentAccess": "dynamic-page"`, this property is read-only. Use {@link TextNode.setTextStyleIdAsync} to update the style.
   */
  textStyleId: string | PluginAPI['mixed']
  /**
   * Set the {@link TextStyle} that the text properties of this node are linked to. Requires the font to be loaded.
   */
  setTextStyleIdAsync(styleId: string): Promise<void>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/TextPathNode
 */
interface TextPathNode
  extends
    DefaultShapeMixin,
    ConstraintMixin,
    NonResizableTextPathMixin,
    ComplexStrokesMixin,
    AnnotationsMixin,
    AspectRatioLockMixin {
  /**
   * The type of this node, represented by the string literal "TEXT_PATH"
   */
  readonly type: 'TEXT_PATH'
  /**
   * Duplicates the text path node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): TextPathNode
  /**
   * The horizontal alignment of the text with respect to the textbox. Setting this property requires the font the be loaded.
   */
  textAlignHorizontal: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'
  /**
   * The vertical alignment of the text with respect to the textbox. Setting this property requires the font the be loaded.
   */
  textAlignVertical: 'TOP' | 'CENTER' | 'BOTTOM'
  /**
   * Whether updating the characters in the text node should update the name of the node. If this is set to true, `name` will be auto-derived from `characters`.
   *
   * @remarks
   *
   * This is automatically reset to false if `name` is modified in order to allow the node to keep the new name.
   */
  autoRename: boolean
  /**
   * The id of the {@link TextStyle} object that the text properties of this node are linked to. Requires the font to be loaded.
   *
   * If the manifest contains`"documentAccess": "dynamic-page"`, this property is read-only. Use {@link TextPathNode.setTextStyleIdAsync} to update the style.
   */
  textStyleId: string | PluginAPI['mixed']
  /**
   * Set the {@link TextStyle} that the text properties of this node are linked to. Requires the font to be loaded.
   */
  setTextStyleIdAsync(styleId: string): Promise<void>
  /**
   * The vector paths of the text path node.
   */
  readonly vectorPaths: VectorPaths
  /**
   * The vector network of the text path node.
   */
  readonly vectorNetwork: VectorNetwork
  /**
   * Whether the vector handles are mirrored or independent.
   */
  readonly handleMirroring: HandleMirroring | PluginAPI['mixed']
  /**
   * A data structure defining where the text starts along the path.
   */
  textPathStartData: TextPathStartData
}
/**
 * @see https://developers.figma.com/docs/plugins/api/ComponentPropertyType
 */
type ComponentPropertyType = 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP' | 'VARIANT' | 'SLOT'
/**
 * @see https://developers.figma.com/docs/plugins/api/InstanceSwapPreferredValue
 */
type InstanceSwapPreferredValue = {
  type: 'COMPONENT' | 'COMPONENT_SET'
  key: string
}
type SlotSettings = {
  stretchChildOnInsert?: boolean
  displayEmptyByDefault?: boolean
  minChildren?: number | null
  maxChildren?: number | null
  allowPreferredValuesOnly?: boolean
}
/**
 * @see https://developers.figma.com/docs/plugins/api/ComponentPropertyOptions
 */
type ComponentPropertyOptions = {
  preferredValues?: InstanceSwapPreferredValue[]
  description?: string
  slotSettings?: SlotSettings
}
/**
 * @see https://developers.figma.com/docs/plugins/api/ComponentPropertyDefinitions
 */
type ComponentPropertyDefinitions = {
  [propertyName: string]: {
    type: ComponentPropertyType
    defaultValue: string | boolean
    preferredValues?: InstanceSwapPreferredValue[]
    variantOptions?: string[]
    description?: string
    slotSettings?: SlotSettings
    readonly boundVariables?: {
      [field in VariableBindableComponentPropertyDefinitionField]?: VariableAlias
    }
  }
}
interface ComponentSetNode extends BaseFrameMixin, PublishableMixin, ComponentPropertiesMixin {
  /**
   * The type of this node, represented by the string literal "COMPONENT_SET"
   */
  readonly type: 'COMPONENT_SET'
  /**
   * Duplicates the component set as a new component set. Its children will be duplicated as **new** components with no instances of them. By default, the duplicate will be parented under figma.currentPage.
   */
  clone(): ComponentSetNode
  /**
   * The default variant of this component set, which is the top-left-most variant, spatially. This corresponds to the variant that would be inserted when dragging in a component set from the team library in the Figma UI.
   */
  readonly defaultVariant: ComponentNode
}
/**
 * @see https://developers.figma.com/docs/plugins/api/ComponentNode
 */
interface ComponentNode extends DefaultFrameMixin, PublishableMixin, ComponentPropertiesMixin {
  /**
   * The type of this node, represented by the string literal "COMPONENT"
   */
  readonly type: 'COMPONENT'
  /**
   * Duplicates the component node as a **new** component with no instances of it. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): ComponentNode
  /**
   * Creates an instance of this component. By default, the instance will be parented under `figma.currentPage`.
   */
  createInstance(): InstanceNode
  /**
   * Creates a new slot node within this component.
   */
  createSlot(): SlotNode
  /**
   * Returns an array of all of the instances of this component in the document.
   */
  getInstancesAsync(): Promise<InstanceNode[]>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/ComponentProperties
 */
type ComponentProperties = {
  [propertyName: string]: {
    type: ComponentPropertyType
    value: string | boolean
    preferredValues?: InstanceSwapPreferredValue[]
    readonly boundVariables?: {
      [field in VariableBindableComponentPropertyField]?: VariableAlias
    }
  }
}
interface InstanceNode extends DefaultFrameMixin {
  /**
   * The type of this node, represented by the string literal "INSTANCE"
   */
  readonly type: 'INSTANCE'
  /**
   * Duplicates the instance node. The new instance has the same main component. By default, the duplicate's parent is `figma.currentPage`.
   */
  clone(): InstanceNode
  /**
   * The component that this instance reflects. This could be a remote, read-only component. This can be set to turn this instance into a different component. On nested instances (instances inside other instances), setting this value clears all overrides and performs nested instance swapping.
   */
  getMainComponentAsync(): Promise<ComponentNode | null>
  /**
   * The component that this instance reflects. This could be a remote, read-only component. This can be set to turn this instance into a different component. On nested instances (instances inside other instances), setting this value clears all overrides and performs nested instance swapping.
   *
   * If the plugin manifest contains `"documentAccess": "dynamic-page"`, this property is **write-only**. Use {@link InstanceNode.getMainComponentAsync} to read the value.
   */
  mainComponent: ComponentNode | null
  /**
   * Swaps this instance's current main component with `componentNode` and preserves overrides using the same heuristics as instance swap in the Figma editor UI. Note that we may update these override preservation heuristics from time to time.
   *
   * @remarks
   *
   * Learn more about instance swap and override preservation in our <a href="https://help.figma.com/hc/en-us/articles/360039150413-Swap-between-component-instances-in-a-file">help center</a>. If you do not want to preserve overrides when swapping, you should assign to {@link InstanceNode.mainComponent}, which sets the instance's main component directly and clears all overrides.
   */
  swapComponent(componentNode: ComponentNode): void
  /**
   * Sets the component properties and values for this instance. `propertyName` corresponds to the names returned by `componentPropertyDefinitions` and should be suffixed with `'#'` and a unique ID for `'TEXT'`, `'BOOLEAN'`, and `'INSTANCE_SWAP'` properties. Does not support `'SLOT'` properties and will throw `cannotSetSlotProperty`. In the case of name collision, this function prioritizes updating the `'VARIANT'` type properties. Existing properties that are non-specified in the function will maintain their current value.
   */
  setProperties(properties: { [propertyName: string]: string | boolean | VariableAlias }): void
  /**
   * Component properties and values for this instance. If conflicting property names are encountered, prioritizes showing `'VARIANT'` type properties.
   */
  readonly componentProperties: ComponentProperties
  /**
   * Detaches the given instance from its component.  Returns the frame node that results from detaching the instance. For nested instances (instances inside of other instances), also detaches all ancestors nodes that
   * are instances.
   */
  detachInstance(): FrameNode
  /**
   * The scale factor applied to the instance.
   *
   * @remarks
   *
   * Normally, this has value `1`, even if the instance is resized. However, if the instance is resized via the scale tool (shortcut `K`), then the instance is scaled and the scale factor is stored in this property.
   */
  scaleFactor: number
  /**
   * All nested instances that have been exposed to this `InstanceNode`'s level. These nested instances' component properties will be visible at the top level of this `InstanceNode`.
   */
  readonly exposedInstances: InstanceNode[]
  /**
   * Whether this instance has been marked as exposed to its containing `ComponentNode` or `ComponentSetNode`. This property is only writeable on primary `InstanceNode`s contained within a `ComponentNode` or `ComponentSetNode` but is inherited on nested `InstanceNode`s.
   */
  isExposedInstance: boolean
  /**
   * Returns an array of all of the fields directly overridden on this instance. Inherited overrides are not included.
   */
  readonly overrides: {
    id: string
    overriddenFields: NodeChangeProperty[]
  }[]
  /**
   * Removes all direct overrides on this instance.
   */
  removeOverrides(): void
}
interface SlotNode extends DefaultFrameMixin {
  /**
   * The type of this node, represented by the string literal "SLOT"
   */
  readonly type: 'SLOT'
  /**
   * Create a copy of this node. By default, the duplicate will be parented under `figma.currentPage`.
   * The clone is returned as a plain `FrameNode` rather than a `SlotNode`, because slots are
   * defined by a component property reference that only makes sense inside their parent component.
   */
  clone(): FrameNode
  /**
   * Resets a given slot node to the original component slot content.
   */
  resetSlot(): void
  /**
   * The set of limits, configured on the corresponding `'SLOT'` component property's {@link SlotSettings}, that the current contents of this slot violate. Returns an empty array when within limits. Multiple kinds may be present simultaneously (e.g. `['BELOW_MIN', 'HAS_NON_PREFERRED']`), since `HAS_NON_PREFERRED` is independent of the child count. `BELOW_MIN` and `ABOVE_MAX` are mutually exclusive.
   *
   * - `'BELOW_MIN'`: the slot has fewer children than its configured `minChildren`.
   * - `'ABOVE_MAX'`: the slot has more children than its configured `maxChildren`.
   * - `'HAS_NON_PREFERRED'`: the slot contains a child that is not in the property's preferred values, while `allowPreferredValuesOnly` is `true`.
   *
   */
  readonly limitViolations: Array<'BELOW_MIN' | 'ABOVE_MAX' | 'HAS_NON_PREFERRED'>
}
interface BooleanOperationNode
  extends
    DefaultShapeMixin,
    ChildrenMixin,
    CornerMixin,
    ComplexStrokesMixin,
    ContainerMixin,
    AspectRatioLockMixin {
  /**
   * The type of this node, represented by the string literal "BOOLEAN_OPERATION"
   */
  readonly type: 'BOOLEAN_OPERATION'
  /**
   * Duplicates the boolean operation node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): BooleanOperationNode
  /**
   * The type of operation used to combine the children of this node.
   */
  booleanOperation: 'UNION' | 'INTERSECT' | 'SUBTRACT' | 'EXCLUDE'
}
interface StickyNode extends OpaqueNodeMixin, MinimalFillsMixin, MinimalBlendMixin {
  /**
   * The type of this node, represented by the string literal "STICKY"
   */
  readonly type: 'STICKY'
  /**
   * Text sublayer of the StickyNode
   */
  readonly text: TextSublayerNode
  /**
   * Indicates whether the author field is visible
   */
  authorVisible: boolean
  /**
   * Returns the author name.
   */
  authorName: string
  /**
   *  Indicates whether the sticky note has a [wide rectangular shape](https://help.figma.com/hc/en-us/articles/1500004414322-Sticky-notes-in-FigJam#Size), as opposed to a square shape.
   */
  isWideWidth: boolean
  /**
   * Duplicates the node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): StickyNode
}
interface StampNode
  extends DefaultShapeMixin, ConstraintMixin, StickableMixin, AspectRatioLockMixin {
  /**
   * The type of this node, represented by the string literal "STAMP"
   */
  readonly type: 'STAMP'
  /**
   * Duplicates the node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): StampNode
}
/**
 * @see https://developers.figma.com/docs/plugins/api/TableNode
 */
interface TableNode extends OpaqueNodeMixin, MinimalFillsMixin, MinimalBlendMixin {
  /**
   * The type of this node, represented by the string literal "TABLE"
   */
  readonly type: 'TABLE'
  /**
   * Duplicates the node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): TableNode
  /**
   * The number of rows in the table.
   *
   */
  readonly numRows: number
  /**
   * The number of columns in the table.
   *
   */
  readonly numColumns: number
  /**
   * Returns the table cell node at a specific cell coordinate.
   *
   * @param rowIndex - The index of the row. Must satisfy `0 <= rowIndex < numRows`.
   * @param columnIndex - The index of the column. Must satisfy `0 <= columnInde < numColumns`.
   *
   */
  cellAt(rowIndex: number, columnIndex: number): TableCellNode
  /**
   * Inserts a row before the specified index.
   *
   * @param rowIndex - Index of the new row. Must satisfy `0 <= rowIndex <= numRows`.
   *
   */
  insertRow(rowIndex: number): void
  /**
   * Inserts a column before the specified index.
   *
   * @param columnIndex - Index of the new column. Must satisfy `0 <= columnIndex <= numColumns`.
   *
   */
  insertColumn(columnIndex: number): void
  /**
   * Removes the row at the specified index.
   *
   * @param rowIndex - Index of the row to remove. Must satisfy `0 <= rowIndex < numRows`.
   *
   */
  removeRow(rowIndex: number): void
  /**
   * Removes the column at the specified index.
   *
   * @param columnIndex - Index of the column to remove. Must satisfy `0 <= columnIndex < numColumns`.
   *
   */
  removeColumn(columnIndex: number): void
  /**
   * Moves the row from the start index to the destination index.
   *
   * @param fromIndex - Index of the row to move. Must satisfy `0 <= rowIndex < numRows`.
   * @param toIndex - Index that specifies where the row will be moved before. Must satisfy `0 <= rowIndex < numRows`.
   *
   */
  moveRow(fromIndex: number, toIndex: number): void
  /**
   * Moves the column from the start index to the destination index.
   *
   * @param fromIndex - Index of the column to move. Must satisfy `0 <= columnIndex < numColumns`.
   * @param toIndex - Index that specifies where the column will be moved before. Must satisfy `0 <= columnIndex < numColumns`.
   *
   */
  moveColumn(fromIndex: number, toIndex: number): void
  /**
   * Resizes the row. Rows cannot be resized to be smaller than their minimum size.
   *
   * @param height - New width of the row. Must be `>= 0.01`
   *
   */
  resizeRow(rowIndex: number, height: number): void
  /**
   * Resizes the column. Columns cannot be resized to be smaller than their minimum size.
   *
   * @param width - New width of the column. Must be >= 0.01
   *
   */
  resizeColumn(columnIndex: number, width: number): void
}
/**
 * @see https://developers.figma.com/docs/plugins/api/TableCellNode
 */
interface TableCellNode extends MinimalFillsMixin {
  /**
   * The type of this node, represented by the string literal "TABLE_CELL"
   */
  readonly type: 'TABLE_CELL'
  /**
   * Text sublayer of the TableCellNode
   */
  readonly text: TextSublayerNode
  /**
   * The row index of this cell relative to its parent table.
   */
  readonly rowIndex: number
  /**
   * The column index of this cell relative to its parent table.
   */
  readonly columnIndex: number

  readonly toString: string

  readonly parent: TableNode

  readonly height: number

  readonly width: number
}
interface HighlightNode
  extends
    DefaultShapeMixin,
    ConstraintMixin,
    CornerMixin,
    VectorLikeMixin,
    StickableMixin,
    AspectRatioLockMixin {
  /**
   * The type of this node, represented by the string literal "HIGHLIGHT"
   */
  readonly type: 'HIGHLIGHT'
  /**
   * Duplicates the highlight node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): HighlightNode
}
interface WashiTapeNode extends DefaultShapeMixin, StickableMixin, AspectRatioLockMixin {
  /**
   * The type of this node, represented by the string literal "WASHI_TAPE"
   */
  readonly type: 'WASHI_TAPE'
  /**
   * Duplicates the washi tape node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): WashiTapeNode
}
interface ShapeWithTextNode
  extends OpaqueNodeMixin, MinimalFillsMixin, MinimalBlendMixin, MinimalStrokesMixin {
  /**
   * The type of this node, represented by the string literal "SHAPE_WITH_TEXT".
   */
  readonly type: 'SHAPE_WITH_TEXT'
  /**
   * The shape of this node.
   *
   * Most shape types have the same name as their tooltip but there are a few exceptions.
   * ENG_DATABASE: Cylinder, ENG_QUEUE: Horizontal cylinder, ENG_FILE: File, ENG_FOLDER: Folder.
   */
  shapeType:
    | 'SQUARE'
    | 'ELLIPSE'
    | 'ROUNDED_RECTANGLE'
    | 'DIAMOND'
    | 'TRIANGLE_UP'
    | 'TRIANGLE_DOWN'
    | 'PARALLELOGRAM_RIGHT'
    | 'PARALLELOGRAM_LEFT'
    | 'ENG_DATABASE'
    | 'ENG_QUEUE'
    | 'ENG_FILE'
    | 'ENG_FOLDER'
    | 'TRAPEZOID'
    | 'PREDEFINED_PROCESS'
    | 'SHIELD'
    | 'DOCUMENT_SINGLE'
    | 'DOCUMENT_MULTIPLE'
    | 'MANUAL_INPUT'
    | 'HEXAGON'
    | 'CHEVRON'
    | 'PENTAGON'
    | 'OCTAGON'
    | 'STAR'
    | 'PLUS'
    | 'ARROW_LEFT'
    | 'ARROW_RIGHT'
    | 'SUMMING_JUNCTION'
    | 'OR'
    | 'SPEECH_BUBBLE'
    | 'INTERNAL_STORAGE'
  /**
   * Text sublayer of the ShapeWithTextNode.
   */
  readonly text: TextSublayerNode
  /**
   * How rounded a shape's corner is.
   */
  readonly cornerRadius?: number
  /**
   * The rotation of the node in degrees. Returns values from -180 to 180. Identical to `Math.atan2(-m10, m00)` in the {@link DimensionAndPositionMixin.relativeTransform} matrix. When setting `rotation`, it will also set `m00`, `m01`, `m10`, `m11`.
   *
   * @remarks
   *
   * The rotation is with respect to the top-left of the object. Therefore, it is independent from the position of the object. If you want to rotate with respect to the center (or any arbitrary point), you can do so via matrix transformations and {@link DimensionAndPositionMixin.relativeTransform}.
   */
  rotation: number
  /**
   * Resize the ShapeWithText.
   * @param width - New width of the node. Must be >= 0.01
   * @param height - New height of the node. Must be >= 0.01
   */
  resize(width: number, height: number): void
  /**
   * Rescale the ShapeWithText.
   * @param scale - The scale by which to resize the node from the top-left corner.
   */
  rescale(scale: number): void
  /**
   * Duplicates the node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): ShapeWithTextNode
}
/**
 * @see https://developers.figma.com/docs/plugins/api/CodeBlockNode
 */
interface CodeBlockNode extends OpaqueNodeMixin, MinimalBlendMixin {
  /**
   * The type of this node, represented by the string literal "CODE_BLOCK"
   */
  readonly type: 'CODE_BLOCK'
  /**
   * The contents of the code block.
   */
  code: string
  /**
   * The language of the code block. New languages will be added to this enum without the major version updating, so be careful not to exhaustively match on this type without a default case.
   */
  codeLanguage:
    | 'TYPESCRIPT'
    | 'CPP'
    | 'RUBY'
    | 'CSS'
    | 'JAVASCRIPT'
    | 'HTML'
    | 'JSON'
    | 'GRAPHQL'
    | 'PYTHON'
    | 'GO'
    | 'SQL'
    | 'SWIFT'
    | 'KOTLIN'
    | 'RUST'
    | 'BASH'
    | 'PLAINTEXT'
    | 'DART'
  /**
   * Duplicates the node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): CodeBlockNode
}
/**
 * @see https://developers.figma.com/docs/plugins/api/LabelSublayer
 */
interface LabelSublayerNode {
  fills: Paint[] | PluginAPI['mixed']
}
interface ConnectorNode extends OpaqueNodeMixin, MinimalBlendMixin, MinimalStrokesMixin {
  /**
   * The type of this node, represented by the string literal "CONNECTOR"
   */
  readonly type: 'CONNECTOR'
  /**
   * Text sublayer of the ConnectorNode
   */
  readonly text: TextSublayerNode
  /**
   * Text sublayer of the ConnectorNode
   */
  readonly textBackground: LabelSublayerNode
  /**
   * How rounded a connector's edges are
   */
  readonly cornerRadius?: number
  /**
   * Connector path type
   */
  connectorLineType: 'ELBOWED' | 'STRAIGHT' | 'CURVED'
  /**
   * Connector starting endpoint
   */
  connectorStart: ConnectorEndpoint
  /**
   * Connector ending endpoint
   */
  connectorEnd: ConnectorEndpoint
  /**
   * Connector start stroke cap
   */
  connectorStartStrokeCap: ConnectorStrokeCap
  /**
   * Connector end stroke cap
   */
  connectorEndStrokeCap: ConnectorStrokeCap
  /**
   * The rotation of the node in degrees. Returns values from -180 to 180. Identical to `Math.atan2(-m10, m00)` in the {@link DimensionAndPositionMixin.relativeTransform} matrix. When setting `rotation`, it will also set `m00`, `m01`, `m10`, `m11`.
   *
   * @remarks
   *
   * The rotation is with respect to the top-left of the object. Therefore, it is independent from the position of the object. If you want to rotate with respect to the center (or any arbitrary point), you can do so via matrix transformations and {@link DimensionAndPositionMixin.relativeTransform}.
   */
  rotation: number
  /**
   * Duplicates the node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): ConnectorNode
}
type VariableResolvedDataType = 'BOOLEAN' | 'COLOR' | 'EASING' | 'FLOAT' | 'STRING' | 'TIMING'
interface VariableAlias {
  type: 'VARIABLE_ALIAS'
  id: string
}
type VariableValue = boolean | string | number | RGB | RGBA | MotionEasing | VariableAlias
type VariableScope =
  | 'ALL_SCOPES'
  | 'TEXT_CONTENT'
  | 'CORNER_RADIUS'
  | 'WIDTH_HEIGHT'
  | 'GAP'
  | 'ALL_FILLS'
  | 'FRAME_FILL'
  | 'SHAPE_FILL'
  | 'TEXT_FILL'
  | 'STROKE_COLOR'
  | 'STROKE_FLOAT'
  | 'EFFECT_FLOAT'
  | 'EFFECT_COLOR'
  | 'OPACITY'
  | 'FONT_FAMILY'
  | 'FONT_STYLE'
  | 'FONT_WEIGHT'
  | 'FONT_SIZE'
  | 'LINE_HEIGHT'
  | 'LETTER_SPACING'
  | 'PARAGRAPH_SPACING'
  | 'PARAGRAPH_INDENT'
/**
 * @see https://developers.figma.com/docs/plugins/api/VariableCodeSyntaxPlatform
 */
type CodeSyntaxPlatform = 'WEB' | 'ANDROID' | 'iOS'
interface Variable extends PluginDataMixin {
  /**
   * The unique identifier of this variable.
   */
  readonly id: string
  /** The name of this variable. */
  name: string
  /** Description of this variable. */
  description: string
  /**
   * Whether this variable is hidden when publishing the current file as a library. Can only true if {@link Variable.remote} is false (e.g. this is a local variable).
   *
   * @remarks
   *
   * If the parent {@link VariableCollection} is marked as `hiddenFromPublishing`, then this variable will also be hidden from publishing via the UI.
   * `hiddenFromPublishing` is independently toggled for a variable and collection, however both must be true for a given variable to be publishable.
   */
  hiddenFromPublishing: boolean
  /**
   * Returns the publishing status of this variable in the current file.
   */
  getPublishStatusAsync(): Promise<PublishStatus>
  /** Whether this variable is remote or local. */
  readonly remote: boolean
  /** The ID of the collection that contains this variable. */
  readonly variableCollectionId: string
  /**
   * The key to use with {@link VariablesAPI.importVariableByKeyAsync}. Note that while this key is present on local and published variables, you can only import variables that are already published.
   */
  readonly key: string
  /** The resolved type of the variable. */
  readonly resolvedType: VariableResolvedDataType
  /**
   * Retrieves the resolved value for this variable if it was bound to `consumer`.
   *
   * @remarks
   *
   * The value that a variable resolves to depends on the following:
   *
   * - The node consuming the variable and which of the collection's modes is [currently selected in the node](https://help.figma.com/hc/en-us/articles/15343816063383)
   * - The variable's value for the selected mode
   * - If that value is an alias, then the resolved value is determined using the selected modes of each collection in the alias chain
   *
   * Note: It is not possible to statically determine the resolved value of a variable when there are multiple modes involved (either in the variable itself or in any variables in the alias chain).
   *
   *
   * The consuming node can have any combination of explicit or inherited variable modes per collection assigned to it.
   *
   * Here are some examples illustrating how variables can resolve to different values depending on the consuming node. These examples do not work if the current file is on the Starter plan, which is limited to a single mode.
   *
   * For a variable in a collection with two modes, it can resolve to up to two different values:
   *
   * ```ts title="Simple variable value resolution without aliasing"
   * // Create a collection with two modes and a variable with a different
   * // float value for each mode
   * const collection = figma.variables.createVariableCollection("Collection")
   * const mode1Id = collection.modes[0].modeId
   * const mode2Id = collection.addMode('Mode 2')
   * const variable = figma.variables.createVariable(
   *   "My Variable",
   *   collection,
   *   'FLOAT'
   * )
   * variable.setValueForMode(mode1Id, 1)
   * variable.setValueForMode(mode2Id, 2)
   *
   * const frame = figma.createFrame()
   * frame.setExplicitVariableModeForCollection(collection, mode1Id)
   * // Output: {value: 1, resolvedType: 'FLOAT'}
   * console.log(variable.resolveForConsumer(frame))
   *
   * frame.setExplicitVariableModeForCollection(collection, mode2Id)
   * // Output: {value: 2, resolvedType: 'FLOAT'}
   * console.log(variable.resolveForConsumer(frame))
   * ```
   *
   * For a variable in a collection with two modes with each value aliasing to different variables in another collection with two modes, it can resolve to up to four different values.
   *
   * ```ts title="Variable value resolution with aliasing"
   * // Create two collections:
   * // 1. A collection with two modes and two float variables
   * // 2. A collection with two modes and a variable aliasing to
   * //    different variables in the first collection
   * const collection1 = figma.variables.createVariableCollection("Collection 1")
   * const collection1Mode1Id = collection1.modes[0].modeId
   * const collection1Mode2Id = collection1.addMode('Mode 2')
   * const collection1Var1 = figma.variables.createVariable(
   *   "Variable 1",
   *   collection1,
   *   'FLOAT'
   * )
   * collection1Var1.setValueForMode(collection1Mode1Id, 1)
   * collection1Var1.setValueForMode(collection1Mode2Id, 2)
   * const collection1Var2 = figma.variables.createVariable(
   *   "Variable 2",
   *   collection1,
   *   'FLOAT'
   * )
   * collection1Var2.setValueForMode(collection1Mode1Id, 3)
   * collection1Var2.setValueForMode(collection1Mode2Id, 4)
   *
   * const collection2 = figma.variables.createVariableCollection("Collection 2")
   * const collection2Mode1Id = collection2.modes[0].modeId
   * const collection2Mode2Id = collection2.addMode('Mode 2')
   * const collection2Var = figma.variables.createVariable(
   *   "Variable 1",
   *   collection2,
   *   'FLOAT'
   * )
   * collection2Var.setValueForMode(
   *   collection2Mode1Id,
   *   figma.variables.createVariableAlias(collection1Var1)
   * )
   * collection2Var.setValueForMode(
   *   collection2Mode2Id,
   *   figma.variables.createVariableAlias(collection1Var2)
   * )
   *
   * const frame = figma.createFrame()
   *
   * frame.setExplicitVariableModeForCollection(collection1, collection1Mode1Id)
   * frame.setExplicitVariableModeForCollection(collection2, collection2Mode1Id)
   * // Output: {value: 1, resolvedType: 'FLOAT'}
   * console.log(collection2Var.resolveForConsumer(frame))
   *
   * frame.setExplicitVariableModeForCollection(collection1, collection1Mode2Id)
   * frame.setExplicitVariableModeForCollection(collection2, collection2Mode1Id)
   * // Output: {value: 2, resolvedType: 'FLOAT'}
   * console.log(collection2Var.resolveForConsumer(frame))
   *
   * frame.setExplicitVariableModeForCollection(collection1, collection1Mode1Id)
   * frame.setExplicitVariableModeForCollection(collection2, collection2Mode2Id)
   * // Output: {value: 3, resolvedType: 'FLOAT'}
   * console.log(collection2Var.resolveForConsumer(frame))
   *
   * frame.setExplicitVariableModeForCollection(collection1, collection1Mode2Id)
   * frame.setExplicitVariableModeForCollection(collection2, collection2Mode2Id)
   * // Output: {value: 4, resolvedType: 'FLOAT'}
   * console.log(collection2Var.resolveForConsumer(frame))
   * ```
   */
  resolveForConsumer(consumer: SceneNode): {
    value: VariableValue
    resolvedType: VariableResolvedDataType
  }
  /**
   * Sets the value of this variable for the provided mode. If the modeId belongs to an extended collection, the value will be overridden on the extension.
   */
  setValueForMode(modeId: string, newValue: VariableValue): void
  /**
   * The values for each mode of this variable. Note that this will not resolve any aliases. To return fully resolved values in all cases, consider using {@link Variable.resolveForConsumer}.
   */
  readonly valuesByMode: {
    [modeId: string]: VariableValue
  }
  /** Removes this variable from the document. */
  remove(): void
  /**
   * An array of scopes in the UI where this variable is shown. Setting this property will show/hide this variable in the variable picker UI for different fields.
   *
   * @remarks
   *
   * Setting scopes for a variable does not prevent that variable from being bound in other scopes (for example, via the Plugin API). This only limits the variables that are shown in pickers within the Figma UI.
   */
  scopes: Array<VariableScope>
  /** Code syntax definitions for this variable. Supported platforms are `'WEB'`, `'ANDROID'`, and `'iOS'`. */
  readonly codeSyntax: {
    [platform in CodeSyntaxPlatform]?: string
  }
  /**
   * Add or modify a platform definition on {@link Variable.codeSyntax}. Acceptable platforms are `'WEB'`, `'ANDROID'`, and `'iOS'`.
   * @remarks
   *
   * Here’s an example of adding code syntax definitions to a variable:
   *
   * ```ts
   *  const collection = figma.variables.createVariableCollection(
   *    'Example Collection'
   *  )
   *  const variable = figma.variables.createVariable(
   *    'ExampleVariableName',
   *    collection,
   *    'STRING'
   *  )
   *  variable.setVariableCodeSyntax('WEB', 'example-variable-name')
   *  variable.setVariableCodeSyntax('ANDROID', 'exampleVariableName')
   *  variable.setVariableCodeSyntax('iOS', 'exampleVariableName')
   *
   *  // Output:
   *  // {
   *  //   WEB: 'example-variable-name',
   *  //   ANDROID: 'exampleVariableName',
   *  //   iOS: 'exampleVariableName'
   *  // }
   *
   *  console.log(variable.codeSyntax)
   * ```
   */
  setVariableCodeSyntax(platform: CodeSyntaxPlatform, value: string): void
  /**
   * Remove a platform definition from {@link Variable.codeSyntax}. Acceptable parameters are `'WEB'`, `'ANDROID'`, and `'iOS'` if previously defined.
   */
  removeVariableCodeSyntax(platform: CodeSyntaxPlatform): void
  /**
   * The overridden or inherited values for each mode for the provided collection that inherits this variable. Note that this will not resolve any aliases. To return fully resolved values in all cases, consider using {@link Variable.resolveForConsumer}.
   */
  valuesByModeForCollectionAsync(collection: VariableCollection): Promise<{
    [modeId: string]: VariableValue
  }>
  /**
   * Removes the overridden value for the given mode if it exists and returns to the inherited value.
   */
  removeOverrideForMode(extendedModeId: string): void
}
interface VariableCollection extends PluginDataMixin {
  /**
   * The unique identifier of this variable collection.
   */
  readonly id: string
  /** The name of this variable collection. */
  name: string
  /**
   * Whether this variable collection is hidden when publishing the current file as a library. Can only true if {@link VariableCollection.remote} is false (e.g. this is a local variable collection).
   */
  hiddenFromPublishing: boolean
  /**
   * Returns the publishing status of this variable collection in the current file.
   */
  getPublishStatusAsync(): Promise<PublishStatus>
  /** Whether this variable collection is remote or local. */
  readonly remote: boolean
  /** Whether this variable collection is an extension of another variable collection. */
  readonly isExtension: boolean
  /** The list of modes defined for this variable collection. */
  readonly modes: Array<{
    modeId: string
    name: string
  }>
  /**
   * The list of variables contained in this variable collection.
   *
   * Note that the order of these variables is roughly the same as what is shown in Figma Design,
   * however it does not account for groups. As a result, the order of these variables may not
   * exactly reflect the exact ordering and grouping shown in the authoring UI.
   */
  readonly variableIds: string[]
  /** The default mode ID for this collection. */
  readonly defaultModeId: string
  /**
   * The key to use with {@link TeamLibraryAPI.getVariablesInLibraryCollectionAsync}.
   *
   * Note that while this key is present on local and published variable collections, `TeamLibaryAPI` can only be used to query the variables of variable collections that are already published.
   */
  readonly key: string
  /**
   * Creates an extended variable collection from this variable collection. Returns the newly created extended variable collection. This method is only available on local variable collections.
   *
   * Note: This API is limited to the Enterprise plan.
   * If limited by the current pricing tier, this method will throw an error with the message
   * `in extend: Cannot create extended collections outside of enterprise plan.`
   *
   * See [Figma plans and features](https://help.figma.com/hc/en-us/articles/360040328273) for more information.
   *
   */
  extend(name: string): ExtendedVariableCollection
  /** Removes this variable collection and all of its variables from the document. */
  remove(): void
  /** Removes the given mode by ID. */
  removeMode(modeId: string): void
  /**
   * Adds a new mode with the given name to this collection. Returns the newly created mode ID.
   *
   * Note: This API is limited by the current file's pricing tier.
   * If limited the current pricing tier, this method will throw an error with the message
   * `in addMode: Limited to N modes only`, where N is the mode limit.
   *
   * See [Figma plans and features](https://help.figma.com/hc/en-us/articles/360040328273) for more information.
   *
   */
  addMode(name: string): string
  /** Renames the given mode. */
  renameMode(modeId: string, newName: string): void
}
interface ExtendedVariableCollection extends Omit<VariableCollection, 'addMode'> {
  /** `isExtension` is set to `true` to distinguish an extended collection from base variable collections. */
  readonly isExtension: true
  /**
   * The ID of the parent variable collection.
   */
  readonly parentVariableCollectionId: string
  /**
   * The ID of the root variable collection in the extension chain.
   * This is the collection ID at the top of the parent chain.
   * For example, if Collection C extends B which extends A (root),
   * then `rootVariableCollectionId` is A's ID.
   */
  readonly rootVariableCollectionId: string
  /**
   * The list of variables contained in this extended variable collection including variables that are inherited from its parent collection.
   */
  readonly variableIds: string[]
  /** The overridden variable values in this extended variable collection. */
  readonly variableOverrides: {
    [variableId: string]: {
      [extendedModeId: string]: VariableValue
    }
  }
  /** Removes all overridden values in this extended collection for the given variable. */
  removeOverridesForVariable(variableToClear: Variable): void
  /** The modes inherited from the parent collection. */
  readonly modes: Array<{
    modeId: string
    name: string
    parentModeId: string
  }>
  /** Removes the given mode by ID if its parent mode has been deleted. */
  removeMode(modeId: string): void
}
type AnnotationCategoryColor =
  'yellow' | 'orange' | 'red' | 'pink' | 'violet' | 'blue' | 'teal' | 'green'
interface AnnotationCategory {
  /**
   * The unique identifier of the annotation category.
   */
  readonly id: string
  /**
   * The label of the annotation category.
   */
  readonly label: string
  /**
   * The color of the annotation category.
   */
  readonly color: AnnotationCategoryColor
  /**
   * Whether this annotation category is a preset.
   */
  readonly isPreset: boolean
  /**
   * Removes this annotation category from the document.
   */
  remove(): void
  /** Sets the color of the annotation category. */
  setColor(color: AnnotationCategoryColor): void
  /** Sets the label of the annotation category. */
  setLabel(label: string): void
}
interface WidgetNode extends OpaqueNodeMixin, StickableMixin {
  /**
   * The type of this node, represented by the string literal "WIDGET"
   */
  readonly type: 'WIDGET'
  /**
   * The value specified in widget's `manifest.json` "id" field.
   *
   * If this WidgetNode was created by your widget `WidgetNode.widgetId` will match `figma.widgetId`. This is useful when managing multiple widget nodes that belong to the same `widgetId`.
   */
  readonly widgetId: string
  /**
   *  Returns the synced state stored on the widget. This is only readable by widgets created by the same `manifest.id`.
   *
   * For more information, check out [this page in our widget documentation](https://figma.com/widget-docs/managing-multiple-widgets#widgetnodewidgetsyncedstate).
   */
  readonly widgetSyncedState: {
    [key: string]: any
  }
  /**
   * Create an identical copy of this WidgetNode. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): WidgetNode
}
interface EmbedData {
  /**
   * The srcUrl of an embed is the URL that will be loaded in an iFrame when the embed is activated
   *
   * @example https://www.example.com/embed/items/abcdefg
   */
  srcUrl: string
  /**
   * The canonicalUrl of an embed is the URL that will be navigated to when the embed is opened in an external tab
   *
   * @example https://www.example.com/items/abcdefg
   */
  canonicalUrl: string | null
  /**
   * The title of the embed, as displayed on the canvas
   */
  title: string | null
  /**
   * The description of the embed, as displayed on the canvas
   */
  description: string | null
  /**
   * The name of the provider of an embed.
   *
   * ex. 'Spotify', 'YouTube'
   */
  provider: string | null
}
interface EmbedNode extends OpaqueNodeMixin {
  /**
   * The type of this node, represented by the string literal "EMBED"
   */
  readonly type: 'EMBED'
  /**
   * Readonly metadata about this particular embed
   */
  readonly embedData: EmbedData
  /**
   * Create a copy of this node
   */
  clone(): EmbedNode
}
interface LinkUnfurlData {
  /**
   * The URL of the link being unfurled
   *
   * Example: https://mynewssite.com/stories/abcdefg
   */
  url: string
  /**
   * The title of the link being unfurled
   *
   * Example: "Important News Headline"
   */
  title: string | null
  /**
   * The description of the link being unfurled
   *
   * Example: "An astonishing event happened today in a random part of the world...."
   */
  description: string | null
  /**
   * The provider name of the link being unfurled
   *
   * Example: "CNN" | "The Onion" | "TechCrunch"
   */
  provider: string | null
}
interface LinkUnfurlNode extends OpaqueNodeMixin {
  /**
   * The type of this node, represented by the string literal "LINK_UNFURL"
   */
  readonly type: 'LINK_UNFURL'
  /**
   * Metadata about this link unfurl node
   */
  readonly linkUnfurlData: LinkUnfurlData
  /**
   * Create a copy of this node
   */
  clone(): LinkUnfurlNode
}
interface MediaData {
  /**
   * A unique hash of the contents of the media node
   */
  hash: string
}
interface MediaNode extends OpaqueNodeMixin {
  /**
   * The type of this node, represented by the string literal "MEDIA"
   */
  readonly type: 'MEDIA'
  /**
   * Metadata about this media node
   */
  readonly mediaData: MediaData
  /**
   * Resizes the media node.
   *
   * @param width - New width of the node. Must be >= 0.01
   * @param height - New height of the node. Must be >= 0.01
   *
   */
  resize(width: number, height: number): void
  /**
   * Resizes the media node without constraints.
   *
   * @param width - New width of the node. Must be >= 0.01
   * @param height - New height of the node. Must be >= 0.01
   *
   */
  resizeWithoutConstraints(width: number, height: number): void
  /**
   * Create a copy of this node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): MediaNode
}
/**
 * @see https://developers.figma.com/docs/plugins/api/SectionNode
 */
interface SectionNode
  extends
    ChildrenMixin,
    MinimalFillsMixin,
    OpaqueNodeMixin,
    AspectRatioLockMixin,
    MinimalStrokesMixin,
    CornerMixin,
    RectangleCornerMixin {
  /**
   * The type of this node, represented by the string literal "SECTION"
   */
  readonly type: 'SECTION'
  /**
   * Whether the section node contents are [marked as hidden](https://help.figma.com/hc/en-us/articles/4939765379351-Organize-your-FigJam-board-with-sections#Hide_section).
   */
  sectionContentsHidden: boolean
  /**
   * Create a copy of this node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): SectionNode
  /**
   * Resizes the section node without constraints.
   *
   * @param width - New width of the node. Must be >= 0.01
   * @param height - New height of the node. Must be >= 0.01
   *
   */
  resizeWithoutConstraints(width: number, height: number): void
  /**
   * Resizes the section node. Sections do not propagate constraints to their
   * children, so this behaves equivalently to {@link SectionNode.resizeWithoutConstraints}
   * and is provided to match the resize ergonomics of other resizable nodes.
   *
   * @param width - New width of the node. Must be >= 0.01
   * @param height - New height of the node. Must be >= 0.01
   *
   */
  resize(width: number, height: number): void
}
/**
 * @see https://developers.figma.com/docs/plugins/api/SlideNode
 */
interface SlideNode extends BaseFrameMixin {
  /**
   * The type of this node, represented by the string literal "SLIDE"
   */
  readonly type: 'SLIDE'
  /**
   * Create a copy of this node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): SlideNode
  /**
   * Get the {@link SlideTransition} of the slide node.
   */
  getSlideTransition(): SlideTransition
  /**
   * Set the {@link SlideTransition} of the slide node.
   */
  setSlideTransition(transition: SlideTransition): void
  /**
   * Read and set whether or not the slide is skipped in the presentation.
   */
  isSkippedSlide: boolean
  /**
   * Read and set the slide's speaker notes as Markdown. Empty when the slide has
   * no speaker notes.
   */
  speakerNotes: string
}
/**
 * @see https://developers.figma.com/docs/plugins/api/SlideRowNode
 */
interface SlideRowNode extends OpaqueNodeMixin, ChildrenMixin {
  /**
   * The type of this node, represented by the string literal "SLIDE_ROW"
   */
  readonly type: 'SLIDE_ROW'
  /**
   * Create a copy of this node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): SlideRowNode
}
/**
 * @see https://developers.figma.com/docs/plugins/api/SlideGridNode
 */
interface SlideGridNode extends OpaqueNodeMixin, ChildrenMixin {
  /**
   * The type of this node, represented by the string literal "SLIDE_GRID"
   */
  readonly type: 'SLIDE_GRID'
  /**
   * You cannot make a copy of a slide grid node and calling this method throw a runtime exception.
   */
  clone(): SlideGridNode
}
/**
 * @see https://developers.figma.com/docs/plugins/api/InteractiveSlideElementNode
 */
interface InteractiveSlideElementNode extends OpaqueNodeMixin {
  /**
   * The type of this node, represented by the string literal "INTERACTIVE_SLIDE_ELEMENT"
   */
  readonly type: 'INTERACTIVE_SLIDE_ELEMENT'
  /**
   * The type of interactive slide element this node is.
   */
  readonly interactiveSlideElementType: 'POLL' | 'EMBED' | 'FACEPILE' | 'ALIGNMENT' | 'YOUTUBE'
  /**
   * Create a copy of this node. By default, the duplicate will be parented under `figma.currentPage`.
   */
  clone(): InteractiveSlideElementNode
}
/**
 * @see https://developers.figma.com/docs/plugins/api/SlideTransition
 */
interface SlideTransition {
  /**
   * The type of slide transition.
   */
  readonly style:
    | 'NONE'
    | 'DISSOLVE'
    | 'SLIDE_FROM_LEFT'
    | 'SLIDE_FROM_RIGHT'
    | 'SLIDE_FROM_BOTTOM'
    | 'SLIDE_FROM_TOP'
    | 'PUSH_FROM_LEFT'
    | 'PUSH_FROM_RIGHT'
    | 'PUSH_FROM_BOTTOM'
    | 'PUSH_FROM_TOP'
    | 'MOVE_FROM_LEFT'
    | 'MOVE_FROM_RIGHT'
    | 'MOVE_FROM_TOP'
    | 'MOVE_FROM_BOTTOM'
    | 'SLIDE_OUT_TO_LEFT'
    | 'SLIDE_OUT_TO_RIGHT'
    | 'SLIDE_OUT_TO_TOP'
    | 'SLIDE_OUT_TO_BOTTOM'
    | 'MOVE_OUT_TO_LEFT'
    | 'MOVE_OUT_TO_RIGHT'
    | 'MOVE_OUT_TO_TOP'
    | 'MOVE_OUT_TO_BOTTOM'
    | 'SMART_ANIMATE'
  /**
   * The duration of the slide transition, in seconds.
   */
  readonly duration: number
  /**
   * The easing of the slide transition.
   */
  readonly curve:
    'EASE_IN' | 'EASE_OUT' | 'EASE_IN_AND_OUT' | 'LINEAR' | 'GENTLE' | 'QUICK' | 'BOUNCY' | 'SLOW'
  /**
   * The timing of the slide transition.
   */
  readonly timing: {
    /**
     * The type of timing.
     */
    readonly type: 'ON_CLICK' | 'AFTER_DELAY'
    /**
     * The delay of the timing, in seconds.
     */
    readonly delay?: number
  }
}
/**
 * @see https://developers.figma.com/docs/plugins/api/node-types
 */
type BaseNode = DocumentNode | PageNode | SceneNode
/**
 * @see https://developers.figma.com/docs/plugins/api/node-types
 */
type SceneNode =
  | SliceNode
  | FrameNode
  | GroupNode
  | ComponentSetNode
  | ComponentNode
  | InstanceNode
  | BooleanOperationNode
  | VectorNode
  | StarNode
  | LineNode
  | EllipseNode
  | PolygonNode
  | RectangleNode
  | TextNode
  | TextPathNode
  | TransformGroupNode
  | StickyNode
  | ConnectorNode
  | ShapeWithTextNode
  | CodeBlockNode
  | StampNode
  | WidgetNode
  | EmbedNode
  | LinkUnfurlNode
  | MediaNode
  | SectionNode
  | HighlightNode
  | WashiTapeNode
  | TableNode
  | SlideNode
  | SlideRowNode
  | SlideGridNode
  | SlotNode
  | InteractiveSlideElementNode
/**
 * @see https://developers.figma.com/docs/plugins/api/node-types
 */
type NodeType = BaseNode['type']
type StyleType = 'PAINT' | 'TEXT' | 'EFFECT' | 'GRID'
/**
 * @see https://developers.figma.com/docs/plugins/api/InheritedStyleField
 */
type InheritedStyleField =
  | 'fillStyleId'
  | 'strokeStyleId'
  | 'backgroundStyleId'
  | 'textStyleId'
  | 'effectStyleId'
  | 'gridStyleId'
  | 'strokeStyleId'
/**
 * @see https://developers.figma.com/docs/plugins/api/StyleConsumers
 */
interface StyleConsumers {
  /**
   * Node consuming style. */
  node: SceneNode
  /** Field in which style is applied. */
  fields: InheritedStyleField[]
}
interface BaseStyleMixin extends PublishableMixin, PluginDataMixin {
  /**
   * The unique identifier of the style in the document the plugin is executing from. You can assign this value via `setFillStyleIdAsync`, `setStrokeStyleIdAsync`, `setTextStyleIdAsync`, etc. to make the node properties reflect that of the style node.
   */
  readonly id: string

  readonly type: StyleType
  /**
   * The consumers of this style. The `fields` in `StyleConsumers` refers to the field where the style is applied (e.g. a PaintStyle can be applied in `setFillStyleIdAsync` or `setStrokeStyleIdAsync`).
   */
  getStyleConsumersAsync(): Promise<StyleConsumers[]>
  /**
   * The name of the style node. Note that setting this also sets "autoRename" to false on {@link TextNode}.
   */
  name: string
  /**
   * Deletes a local style.
   */
  remove(): void
}
interface PaintStyle extends BaseStyleMixin {
  /**
   * The string literal "PAINT" representing the style type. Always check the `type` before reading other properties.
   */
  type: 'PAINT'
  /**
   * List of {@link Paint} to replace the `fills`, `strokes`, or `backgrounds` property with.
   */
  paints: ReadonlyArray<Paint>
  /**
   * The variables bound to a particular field on this paint style.
   */
  readonly boundVariables?: {
    readonly [field in VariableBindablePaintStyleField]?: VariableAlias[]
  }
}
interface TextStyle extends BaseStyleMixin {
  /**
   * The string literal "TEXT" representing the style type. Always check the `type` before reading other properties.
   */
  type: 'TEXT'
  /**
   * Value to replace the text {@link BaseNonResizableTextMixin.fontSize} with.
   */
  fontSize: number
  /**
   * Value to replace the text {@link NonResizableTextMixin.textDecoration} with.
   */
  textDecoration: TextDecoration
  /**
   * Value to replace the text {@link BaseNonResizableTextMixin.fontName} with. For [variable fonts](https://developers.figma.com/docs/plugins/api/FontName), this includes {@link FontName.variationSettings}.
   */
  fontName: FontName
  /**
   * Value to replace the text {@link BaseNonResizableTextMixin.letterSpacing} with.
   */
  letterSpacing: LetterSpacing
  /**
   * Value to replace the text {@link NonResizableTextMixin.lineHeight} with.
   */
  lineHeight: LineHeight
  /**
   * Value to replace the text {@link NonResizableTextMixin.leadingTrim} with.
   */
  leadingTrim: LeadingTrim
  /**
   * Value to replace the text {@link NonResizableTextMixin.paragraphIndent} with.
   */
  paragraphIndent: number
  /**
   * Value to replace the text {@link NonResizableTextMixin.paragraphSpacing} with.
   */
  paragraphSpacing: number
  /**
   * Value to replace the text {@link NonResizableTextMixin.textWrapStyle} with.
   */
  textWrapStyle: TextWrapStyle
  /**
   * Value to replace the text {@link NonResizableTextMixin.listSpacing} with.
   */
  listSpacing: number
  /**
   * Value to replace the text {@link NonResizableTextMixin.hangingPunctuation} with.
   */
  hangingPunctuation: boolean
  /**
   * Value to replace the text {@link NonResizableTextMixin.hangingList} with.
   */
  hangingList: boolean
  /**
   * Value to replace the text {@link BaseNonResizableTextMixin.textCase} with.
   */
  textCase: TextCase
  /**
   * The variables bound to a particular field on this text style.
   */
  boundVariables?: {
    [field in VariableBindableTextField]?: VariableAlias
  }
  /**
   * Binds the provided `field` on this node to the given variable. Please see the [Working with Variables](https://developers.figma.com/docs/plugins/working-with-variables) guide for how to get and set variable bindings.
   *
   * If `null` is provided as the variable, the given `field` will be unbound from any variables.
   *
   * @param field - The field to bind the variable to.
   * @param variable - The variable to bind to the field. If `null` is provided, the field will be unbound from any variables. Make sure to pass a Variable object or null; passing a variable ID is not supported.
   */
  setBoundVariable(field: VariableBindableTextField, variable: Variable | null): void
}
interface EffectStyle extends BaseStyleMixin {
  /**
   * The string literal "EFFECT" representing the style type. Always check the `type` before reading other properties.
   */
  type: 'EFFECT'
  /**
   * List of {@link Effect} to replace the `effects` property with.
   */
  effects: ReadonlyArray<Effect>
  /**
   * The variables bound to a particular field on this effect style.
   */
  readonly boundVariables?: {
    readonly [field in VariableBindableEffectStyleField]?: VariableAlias[]
  }
}
interface GridStyle extends BaseStyleMixin {
  /**
   * The string literal "GRID" representing the style type. Always check the `type` before reading other properties.
   */
  type: 'GRID'
  /**
   * List of {@link LayoutGrid} to replace the `layoutGrids` property with.
   */
  layoutGrids: ReadonlyArray<LayoutGrid>
  /**
   * The variables bound to a particular field on this grid style.
   */
  readonly boundVariables?: {
    readonly [field in VariableBindableGridStyleField]?: VariableAlias[]
  }
}
type BaseStyle = PaintStyle | TextStyle | EffectStyle | GridStyle
interface Image {
  /**
   * A unique hash of the contents of the image file.
   */
  readonly hash: string
  /**
   * The contents of the corresponding image file. This returns a promise because the image may still need to be downloaded (images in Figma are loaded separately from the rest of the document).
   */
  getBytesAsync(): Promise<Uint8Array>
  /**
   * The width and height of the image in pixels. This returns a promise because the image may still need to be downloaded (images in Figma are loaded separately from the rest of the document).
   */
  getSizeAsync(): Promise<{
    width: number
    height: number
  }>
}
/**
 * @see https://developers.figma.com/docs/plugins/api/FindAllCriteria
 */
interface FindAllCriteria<T extends NodeType[]> {
  /**
   * If specified, the search will match nodes that have one of the given types.
   *
   * ```ts
   * // Find children of type text or frame.
   * node.findAllWithCriteria({ types: ["TEXT", "FRAME"] })
   * ```
   */
  types?: T
  /**
   * If specified, the search will match nodes that have {@link PluginDataMixin.getPluginData | PluginData} stored for your plugin.
   *
   * ```ts
   * // Find children that have plugin data stored.
   * node.findAllWithCriteria({ pluginData: {} })
   *
   * // Find children that have plugin data stored with keys
   * // "a" or "b"
   * node.findAllWithCriteria({
   *   pluginData: {
   *     keys: ["a", "b"]
   *   }
   * })
   * ```
   */
  pluginData?: {
    keys?: string[]
  }
  /**
   * If specified, the search will match nodes that have {@link PluginDataMixin.getSharedPluginData | SharedPluginData} stored on the given `namespace` and `keys`.
   *
   * ```ts
   * // Find children that have shared plugin data
   * // on the "foo" namespace.
   * node.findAllWithCriteria({
   *   sharedPluginData: {
   *     namespace: "foo"
   *   }
   * })
   *
   * // Find children that have shared plugin data
   * // on the "foo" namespace with keys "a" or "b"
   * node.findAllWithCriteria({
   *   sharedPluginData: {
   *     namespace: "foo",
   *     keys: ["a", "b"]
   *   }
   * })
   * ```
   */
  sharedPluginData?: {
    namespace: string
    keys?: string[]
  }
}
/**
 * @see https://developers.figma.com/docs/plugins/api/TransformModifier
 */
type TransformModifier = LinearRepeatModifier | RadialRepeatModifier
/**
 * @see https://developers.figma.com/docs/plugins/api/TransformModifier
 * Base interface for repeat transform modifiers.
 */
interface RepeatModifier {
  /** Type of transform modifier. Currently, only 'REPEAT' is supported. */
  type: 'REPEAT'
  /** Number of times to repeat the children. */
  count: number
  /** Unit for the offset between each repetition. `RELATIVE` refers to the size of the child node, while `PIXELS` refers to an absolute pixel value. */
  unitType: 'RELATIVE' | 'PIXELS'
  /** Offset between each repetition. For `LINEAR` repeats, this is the distance between each repetition along the specified axis. For `RADIAL` repeats, this is the distance from the center of the group to the repeated nodes. */
  offset: number
}
/**
 * @see https://developers.figma.com/docs/plugins/api/TransformModifier
 * Interface for linear repeat transform modifiers.
 */
interface LinearRepeatModifier extends RepeatModifier {
  /** Type of repeat modifier. */
  repeatType: 'LINEAR'
  /** Axis along which to repeat the children. */
  axis: 'HORIZONTAL' | 'VERTICAL'
}
/**
 * @see https://developers.figma.com/docs/plugins/api/TransformModifier
 * Interface for radial repeat transform modifiers.
 */
interface RadialRepeatModifier extends RepeatModifier {
  /** Type of repeat modifier. */
  repeatType: 'RADIAL'
}
/** Result returned by node.query(). */
interface QueryResult extends Iterable<SceneNode> {
  readonly length: number
  first(): SceneNode | null
  last(): SceneNode | null
  toArray(): SceneNode[]
  each(callback: (node: SceneNode, index: number) => void): QueryResult
  map<T>(callback: (node: SceneNode, index: number) => T): T[]
  filter(callback: (node: SceneNode, index: number) => boolean): QueryResult
  values(keys: string[]): Record<string, unknown>[]
  set(props: Record<string, unknown>): QueryResult
  query(selector: string): QueryResult
}
interface ScreenshotOptions {
  /** Defaults to 0.5 and is capped to a 1024px maximum dimension. */
  scale?: number
  /** Include overlapping content from sibling nodes when false. */
  contentsOnly?: boolean
}
interface BaseNodeMixin {
  /**
   * Set multiple properties and return this node.
   */
  set(props: Record<string, unknown>): this
  /**
   * Query this node's subtree with a CSS-like selector.
   */
  query(selector: string): QueryResult
  /**
   * Test whether this node matches a CSS-like selector.
   */
  matches(selector: string): boolean
}
interface SceneNodeMixin {
  /**
   * Export this node as a PNG and write the result to figma.io for inspection.
   *
   * @param settings Screenshot options, if applicable
   */
  screenshot(settings?: ScreenshotOptions): Promise<void>
  /**
   * Show or hide the in-progress shimmer overlay.
   */
  placeholder: boolean
  /**
   * Generates a pretty-printed string representation of the node tree with
   * indentation for nested children.
   *
   * @param options - The options for the tree. `fields` is an array of fields to include for each node, and supports path projection.
   *
   */
  tree(options?: { maxDepth?: number; maxChildren?: number; fields?: string[] }): string
}
interface PluginAPI {
  /**
   * Write output files to the tool response.
   */
  readonly io: {
    /**
     * Write image or data output to the tool response.
     */
    write(path: string, data: Uint8Array | string): void
  }
}
interface PageNode {
  /**
   * Computes optimal placement bounds for a new top-level node,
   * avoiding collisions with existing nodes on the page.
   *
   * Only callable on the current page — throws if called on a
   * non-active page reference.
   *
   * @param size - The size of the node to be placed
   *
   * @returns The bounds of where the node should be placed if it can be placed
   *   without collision, null otherwise.
   */
  findPlacement(size: { width: number; height: number }): Rect | null
}

// prettier-ignore
export { PluginAPI, VariablesAPI, LibraryVariableCollection, LibraryVariable, AnnotationsAPI, BuzzTextField, BuzzMediaField, TeamLibraryAPI, MotionAPI, UtilAPI, ViewportAPI, SuggestionResults, ParametersAPI, NodeChangeProperty, Transform, Vector, Rect, RGB, RGBA, FontName, FontVariationSettings, FontNameInput, TextCase, TextDecoration, TextDecorationStyle, FontStyle, TextDecorationOffset, TextDecorationThickness, TextDecorationColor, OpenTypeFeature, ArcData, DropShadowEffect, InnerShadowEffect, BlurEffectBase, BlurEffectNormal, BlurEffectProgressive, BlurEffect, NoiseEffectBase, NoiseEffectMonotone, NoiseEffectDuotone, NoiseEffectMultitone, NoiseEffect, TextureEffect, GlassEffect, ShaderEffect, Effect, ConstraintType, Constraints, ColorStop, ImageFilters, SolidPaint, GradientPaint, ImagePaint, VideoPaint, PatternPaint, ShaderPaint, Paint, ShaderPropertyValue, ShaderPropertyDefinition, Shader, Guide, RowsColsLayoutGrid, GridLayoutGrid, LayoutGrid, ExportSettingsConstraints, ExportSettingsImage, ExportSettingsSVGBase, ExportSettingsSVG, ExportSettingsSVGString, ExportSettingsPDF, ExportSettingsREST, ExportSettings, WindingRule, VectorVertex, VectorSegment, VectorRegion, VectorNetwork, VectorPath, VectorPaths, LetterSpacing, LineHeight, LeadingTrim, TextWrapStyle, HyperlinkTarget, TextListOptions, BlendMode, MaskType, Font, TextStyleOverrideType, StyledTextSegment, TextPathStartData, Reaction, VariableDataType, ExpressionFunction, Expression, VariableValueWithExpression, VariableData, ConditionalBlock, Action, SimpleTransition, DirectionalTransition, Transition, Trigger, Navigation, Easing, EasingFunctionBezier, EasingFunctionSpring, MotionEasing, PhysicalSpring, NormalizedSpring, AnimationStylePropValue, AvailableAnimationStylePropValue, BaseAnimationStyle, AvailableAnimationStyle, AnimationStyleConfiguration, AppliedAnimationStyle, KeyframeValue, ManualKeyframeInput, ManualKeyframeTrackInput, ManualKeyframe, ManualKeyframeBinding, ManualKeyframeTrack, KeyframeBinding, KeyframePropertyFieldName, EffectKeyframeFieldName, KeyframeField, ComponentPropKeyframeTracks, ComponentPropKeyframeBindings, PaintManualKeyframeTrack, PaintKeyframeBinding, EffectManualKeyframeTracks, EffectKeyframeBindings, ManualKeyframeTracks, Animations, Timeline, OverflowDirection, OverlayPositionType, OverlayBackground, OverlayBackgroundInteraction, PublishStatus, ConnectorEndpointPosition, ConnectorEndpointPositionAndEndpointNodeId, ConnectorEndpointEndpointNodeIdAndMagnet, ConnectorEndpoint, ConnectorStrokeCap, BaseNodeMixin, PluginDataMixin, SceneNodeMixin, MotionNodeMixin, VariableBindableNodeField, VariableBindableTextField, VariableBindablePaintField, VariableBindablePaintStyleField, VariableBindableColorStopField, VariableBindableEffectField, VariableBindableEffectStyleField, VariableBindableLayoutGridField, VariableBindableGridStyleField, VariableBindableComponentPropertyField, VariableBindableComponentPropertyDefinitionField, StickableMixin, ChildrenMixin, ConstraintMixin, DimensionAndPositionMixin, LayoutMixin, AspectRatioLockMixin, BlendMixin, ContainerMixin, StrokeCap, StrokeJoin, HandleMirroring, AutoLayoutMixin, GridTrackSize, GridTrackReorderOptions, GridTrackReorderEntry, GridLayoutMixin, AutoLayoutChildrenMixin, GridChildrenMixin, InferredAutoLayoutResult, DetachedInfo, MinimalStrokesMixin, IndividualStrokesMixin, MinimalFillsMixin, VariableWidthPoint, PresetVariableWidthStrokeProperties, CustomVariableWidthStrokeProperties, VariableWidthStrokeProperties, ComplexStrokeProperties, ScatterBrushProperties, StretchBrushProperties, BrushStrokeProperties, DynamicStrokeProperties, GeometryMixin, ComplexStrokesMixin, CornerMixin, RectangleCornerMixin, ExportMixin, FramePrototypingMixin, VectorLikeMixin, ReactionMixin, DocumentationLink, PublishableMixin, DefaultShapeMixin, BaseFrameMixin, DefaultFrameMixin, OpaqueNodeMixin, MinimalBlendMixin, Annotation, AnnotationProperty, AnnotationPropertyType, AnnotationsMixin, Measurement, MeasurementSide, MeasurementOffset, MeasurementsMixin, ComponentPropertiesMixin, BaseNonResizableTextMixin, NonResizableTextMixin, NonResizableTextPathMixin, TextSublayerNode, DocumentNode, ExplicitVariableModesMixin, PageNode, FrameNode, GroupNode, TransformGroupNode, SliceNode, RectangleNode, LineNode, EllipseNode, PolygonNode, StarNode, VectorNode, TextNode, TextPathNode, ComponentPropertyType, InstanceSwapPreferredValue, SlotSettings, ComponentPropertyOptions, ComponentPropertyDefinitions, ComponentSetNode, ComponentNode, ComponentProperties, InstanceNode, SlotNode, BooleanOperationNode, StickyNode, StampNode, TableNode, TableCellNode, HighlightNode, WashiTapeNode, ShapeWithTextNode, CodeBlockNode, LabelSublayerNode, ConnectorNode, VariableResolvedDataType, VariableAlias, VariableValue, VariableScope, CodeSyntaxPlatform, Variable, VariableCollection, ExtendedVariableCollection, AnnotationCategoryColor, AnnotationCategory, WidgetNode, EmbedData, EmbedNode, LinkUnfurlData, LinkUnfurlNode, MediaData, MediaNode, SectionNode, SlideNode, SlideRowNode, SlideGridNode, InteractiveSlideElementNode, SlideTransition, BaseNode, SceneNode, NodeType, StyleType, InheritedStyleField, StyleConsumers, BaseStyleMixin, PaintStyle, TextStyle, EffectStyle, GridStyle, BaseStyle, Image, FindAllCriteria, TransformModifier, RepeatModifier, LinearRepeatModifier, RadialRepeatModifier, QueryResult, ScreenshotOptions }
