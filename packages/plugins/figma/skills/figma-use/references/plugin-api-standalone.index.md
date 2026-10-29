# Plugin API Index

> Full typings: `plugin-api-standalone.d.ts` (10,191 lines)
> Grep by symbol name to jump to definition. All `L#` line numbers refer to that file.
> This index describes the APIs available through `use_figma`. See the `.d.ts` for full type declarations.

---

## figma.\* — PluginAPI (L4)

### Identity & State

| Member                          | Type                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apiVersion`                    | `'1.0.0'`                                                                                                                                        |
| `editorType`                    | `'figma' \| 'figjam' \| 'dev' \| 'slides' \| 'buzz'`                                                                                             |
| `fileKey`                       | `string \| undefined`                                                                                                                            |
| `root`                          | `DocumentNode`                                                                                                                                   |
| `currentPage`                   | `PageNode` — **read-only**; sync setter `figma.currentPage = page` does NOT work and throws; use `await figma.setCurrentPageAsync(page)` instead |
| `mixed`                         | `unique symbol` — sentinel for mixed values in selection                                                                                         |
| `skipInvisibleInstanceChildren` | `boolean`                                                                                                                                        |

### Navigation & Lookup

| Method                      | Returns                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `setCurrentPageAsync(page)` | `Promise<void>` — **MUST use this**; sync setter `figma.currentPage = page` does NOT work |
| `getNodeByIdAsync(id)`      | `Promise<BaseNode \| null>`                                                               |
| `getStyleByIdAsync(id)`     | `Promise<BaseStyle \| null>`                                                              |

### Create Nodes

| Method                              | Returns                                                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `createFrame()`                     | `FrameNode`                                                                                                                                    |
| `createAutoLayout(direction?)`      | `FrameNode`                                                                                                                                    |
| `createComponent()`                 | `ComponentNode`                                                                                                                                |
| `createComponentFromNode(node)`     | `ComponentNode`                                                                                                                                |
| `createRectangle()`                 | `RectangleNode`                                                                                                                                |
| `createEllipse()`                   | `EllipseNode`                                                                                                                                  |
| `createLine()`                      | `LineNode`                                                                                                                                     |
| `createPolygon()`                   | `PolygonNode`                                                                                                                                  |
| `createStar()`                      | `StarNode`                                                                                                                                     |
| `createVector()`                    | `VectorNode`                                                                                                                                   |
| `createText()`                      | `TextNode`                                                                                                                                     |
| `createSection()`                   | `SectionNode`                                                                                                                                  |
| `createPage()`                      | `PageNode` — **Design files only** (`figma.com/design/...`); throws in both FigJam (`figma.com/board/...`) and Slides (`figma.com/slides/...`) |
| `createSlice()`                     | `SliceNode`                                                                                                                                    |
| `createTable(rows?, cols?)`         | `TableNode`                                                                                                                                    |
| `createImage(data: Uint8Array)`     | `Image`                                                                                                                                        |
| `createNodeFromSvg(svg)`            | `FrameNode`                                                                                                                                    |
| `importComponentByKeyAsync(key)`    | `Promise<ComponentNode>`                                                                                                                       |
| `importComponentSetByKeyAsync(key)` | `Promise<ComponentSetNode>`                                                                                                                    |
| `importStyleByKeyAsync(key)`        | `Promise<BaseStyle>`                                                                                                                           |

### Styles (Local)

| Method                        | Returns                  |
| ----------------------------- | ------------------------ |
| `createPaintStyle()`          | `PaintStyle`             |
| `createTextStyle()`           | `TextStyle`              |
| `createEffectStyle()`         | `EffectStyle`            |
| `createGridStyle()`           | `GridStyle`              |
| `getLocalPaintStylesAsync()`  | `Promise<PaintStyle[]>`  |
| `getLocalTextStylesAsync()`   | `Promise<TextStyle[]>`   |
| `getLocalEffectStylesAsync()` | `Promise<EffectStyle[]>` |
| `getLocalGridStylesAsync()`   | `Promise<GridStyle[]>`   |

### Fonts

| Method                      | Notes                              |
| --------------------------- | ---------------------------------- |
| `loadFontAsync(fontName)`   | **MUST call before any text edit** |
| `listAvailableFontsAsync()` | `Promise<Font[]>`                  |
| `hasMissingFont`            | `boolean`                          |

### Plugin Lifecycle

| Method                  | Notes                                                  |
| ----------------------- | ------------------------------------------------------ |
| `closePlugin(message?)` | Auto-called; use `return` instead to pass results back |

> Undo, notifications, external URLs, version-history saves, and `closePluginWithFailure` are not available through `use_figma`.

### Sub-APIs (properties on figma)

| Property            | Interface        | L#    |
| ------------------- | ---------------- | ----- |
| `figma.variables`   | `VariablesAPI`   | L1093 |
| `figma.motion`      | `MotionAPI`      | L1333 |
| `figma.util`        | `UtilAPI`        | L1371 |
| `figma.viewport`    | `ViewportAPI`    | L1495 |
| `figma.parameters`  | `ParametersAPI`  | L1613 |
| `figma.teamLibrary` | `TeamLibraryAPI` | L1289 |
| `figma.annotations` | `AnnotationsAPI` | L1223 |

> UI, client storage, codegen, payments, text review, timers, Buzz, and constants are not available through `use_figma`.

---

## VariablesAPI — figma.variables (L1093)

```
getVariableByIdAsync(id)                 Promise<Variable | null>    ← preferred; sync deprecated
getVariableCollectionByIdAsync(id)       Promise<VariableCollection | null>    ← preferred; sync deprecated
getLocalVariablesAsync(type?)            Promise<Variable[]>         ← preferred; filter by VariableResolvedDataType; sync deprecated
getLocalVariableCollectionsAsync()       Promise<VariableCollection[]>    ← preferred; sync deprecated
createVariable(name, collection, type)   Variable
createVariableCollection(name)           VariableCollection
createVariableAlias(variable)            VariableAlias
importVariableByKeyAsync(key)            Promise<Variable>
setBoundVariableForPaint(paint, field, variable)    → returns NEW paint — reassign
setBoundVariableForEffect(effect, field, variable)  → returns NEW effect — reassign
setBoundVariableForLayoutGrid(grid, field, variable)
```

**Variable (L9130):** `name`, `resolvedType`, `codeSyntax`, `scopes`, `hiddenFromPublishing`, `valuesByMode`, `variableCollectionId`

- `setVariableCodeSyntax(platform, value)` — platform: `'WEB' | 'ANDROID' | 'iOS'`
- `setValueForMode(collectionId, modeId, value)`
- `remove()`

**VariableCollection (L9344):** `name`, `modes`, `variableIds`, `defaultModeId`, `hiddenFromPublishing`

- `addMode(name)` → `modeId`; `removeMode(modeId)`; `renameMode(modeId, name)`

---

## Node Types

### Concrete Scene Nodes

| Node                   | L#    | Key characteristics                                |
| ---------------------- | ----- | -------------------------------------------------- |
| `DocumentNode`         | L7942 | Root; `children: PageNode[]`                       |
| `PageNode`             | L8089 | `children`, local styles, `backgrounds`            |
| `FrameNode`            | L8223 | `DefaultFrameMixin` — auto-layout, clips, children |
| `GroupNode`            | L8233 | Children only, no auto-layout                      |
| `ComponentNode`        | L8597 | Like Frame + publishable                           |
| `ComponentSetNode`     | L8580 | Variant set container                              |
| `InstanceNode`         | L8632 | Like Frame; `mainComponent`, `detach()`            |
| `RectangleNode`        | L8290 | `DefaultShapeMixin` + corners                      |
| `EllipseNode`          | L8320 | + `arcData`                                        |
| `LineNode`             | L8309 |                                                    |
| `PolygonNode`          | L8341 |                                                    |
| `StarNode`             | L8362 |                                                    |
| `VectorNode`           | L8389 | Vector paths                                       |
| `TextNode`             | L8407 | Rich text, fonts, segments                         |
| `TextPathNode`         | L8479 | Text along path                                    |
| `BooleanOperationNode` | L8725 | `booleanOperation` property                        |
| `SliceNode`            | L8280 | Export only                                        |
| `SectionNode`          | L9621 | Grouping + fills                                   |
| `TableNode`            | L8786 | `TableCellNode` children                           |

**FigJam only:** `StickyNode` L8746, `ConnectorNode` L9047, `ShapeWithTextNode` L8928, `StampNode` L8772, `CodeBlockNode` L9006, `EmbedNode` L9528, `LinkUnfurlNode` L9568, `MediaNode` L9588

**Slides only:** `SlideNode` L9664, `SlideRowNode` L9694, `SlideGridNode` L9707

**Union types:**

```
type SceneNode  (L9795) = FrameNode | GroupNode | SliceNode | RectangleNode | LineNode
  | EllipseNode | PolygonNode | StarNode | VectorNode | TextNode | ComponentSetNode
  | ComponentNode | InstanceNode | BooleanOperationNode | SectionNode | ...
type BaseNode   (L9791) = DocumentNode | PageNode | SceneNode
```

---

## Mixin Interfaces

| Mixin                        | L#    | Provides                                                                                        |
| ---------------------------- | ----- | ----------------------------------------------------------------------------------------------- |
| `BaseNodeMixin`              | L3944 | `id`, `name`, `type`, `parent`, `remove()`, plugin data                                         |
| `SceneNodeMixin`             | L4092 | `visible`, `locked`, `opacity`, variable bindings                                               |
| `ChildrenMixin`              | L4461 | `children`, `appendChild()`, `insertChild()`, `findAll()`, `findOne()`, `findAllWithCriteria()` |
| `LayoutMixin`                | L4826 | `x`, `y`, `width`, `height`, `rotation`, `resize()`, `rescale()`                                |
| `AutoLayoutMixin`            | L5106 | `layoutMode`, axis alignment, padding, `itemSpacing`, `layoutSizingHorizontal/Vertical`         |
| `AutoLayoutChildrenMixin`    | L5926 | `layoutAlign`, `layoutGrow`, sizing — **set AFTER `appendChild()`**                             |
| `GridLayoutMixin`            | L5668 | CSS Grid tracks, gap, template                                                                  |
| `GridChildrenMixin`          | L5989 | grid child positioning                                                                          |
| `GeometryMixin`              | L6348 | `fills`, `strokes`, `strokeWeight`, `strokeAlign`                                               |
| `MinimalFillsMixin`          | L6192 | `fills` only                                                                                    |
| `MinimalStrokesMixin`        | L6110 | `strokes`, `strokeWeight`                                                                       |
| `BlendMixin`                 | L5022 | `opacity`, `blendMode`, `isMask`, `effects`                                                     |
| `CornerMixin`                | L6400 | `cornerRadius`, `cornerSmoothing`                                                               |
| `RectangleCornerMixin`       | L6423 | Per-corner radii                                                                                |
| `ExportMixin`                | L6444 | `exportSettings`, `exportAsync()`                                                               |
| `ReactionMixin`              | L6593 | `reactions` (prototyping)                                                                       |
| `PublishableMixin`           | L6764 | `description`, `key`, `getPublishStatusAsync()`                                                 |
| `ComponentPropertiesMixin`   | L7065 | `componentProperties`, `addComponentProperty()`                                                 |
| `PluginDataMixin`            | L4035 | `getSharedPluginData()`, `setSharedPluginData()`, `getSharedPluginDataKeys()`                   |
| `FramePrototypingMixin`      | L6540 | `overflowDirection`, `numberOfFixedChildren`                                                    |
| `BaseFrameMixin`             | L6830 | ChildrenMixin + LayoutMixin + AutoLayoutMixin + GeometryMixin + …                               |
| `DefaultFrameMixin`          | L6887 | BaseFrameMixin + FramePrototypingMixin + ReactionMixin                                          |
| `DefaultShapeMixin`          | L6818 | BlendMixin + GeometryMixin + LayoutMixin + ExportMixin + ReactionMixin                          |
| `ExplicitVariableModesMixin` | L8066 | `setExplicitVariableModeForCollection()`                                                        |

---

## Paint & Fill (L2693)

| Type            | L#    | Notes                                                                             |
| --------------- | ----- | --------------------------------------------------------------------------------- |
| `SolidPaint`    | L2490 | `type:'SOLID'`, `color: RGB`, `opacity`, `visible`, `blendMode`                   |
| `GradientPaint` | L2545 | `type: 'GRADIENT_LINEAR\|RADIAL\|ANGULAR\|DIAMOND'`, `gradientStops: ColorStop[]` |
| `ImagePaint`    | L2565 | `type:'IMAGE'`, `imageHash`, `scaleMode`                                          |
| `VideoPaint`    | L2601 | `type:'VIDEO'`                                                                    |
| `PatternPaint`  | L2637 | `type:'PATTERN'`                                                                  |
| `type Paint`    | L2693 | Union of all five                                                                 |
| `ColorStop`     | L2459 | `{ position: number, color: RGBA }`                                               |
| `ImageFilters`  | L2478 | exposure, contrast, saturation, etc.                                              |

> **CRITICAL**: Fills/strokes are **read-only arrays** — clone, modify, reassign.

---

## Effects (L2115)

| Type                               | L#    |
| ---------------------------------- | ----- |
| `DropShadowEffect`                 | L2115 |
| `InnerShadowEffect`                | L2158 |
| `BlurEffect` (Normal/Progressive)  | L2250 |
| `NoiseEffect` (Mono/Duo/Multitone) | L2331 |
| `TextureEffect`                    | L2335 |
| `GlassEffect`                      | L2371 |
| `type Effect`                      | L2437 |

---

## Typography

| Type                | L#    | Notes                                                                                  |
| ------------------- | ----- | -------------------------------------------------------------------------------------- |
| `FontName`          | L1802 | `{ family: string, style: string }`                                                    |
| `TextNode`          | L8407 | `characters`, `textAlignHorizontal`, `fontSize`, `fontName`, `getStyledTextSegments()` |
| `StyledTextSegment` | L3207 | Per-range text properties                                                              |
| `LetterSpacing`     | L3147 | `{ value, unit: 'PIXELS'\|'PERCENT' }`                                                 |
| `LineHeight`        | L3151 | `{ value, unit } \| { unit: 'AUTO' }`                                                  |
| `TextCase`          | L1850 | `'ORIGINAL'\|'UPPER'\|'LOWER'\|'TITLE'\|'SMALL_CAPS'`                                  |
| `TextDecoration`    | L1851 | `'NONE'\|'UNDERLINE'\|'STRIKETHROUGH'`                                                 |
| `OpenTypeFeature`   | L1877 | Ligatures, numerals, etc.                                                              |

---

## Variables & Bindings

| Type                          | L#    | Notes                                                                         |
| ----------------------------- | ----- | ----------------------------------------------------------------------------- |
| `Variable`                    | L9130 | Core variable object                                                          |
| `VariableCollection`          | L9344 | Collection of variables + modes                                               |
| `VariableAlias`               | L9098 | Reference to another variable                                                 |
| `VariableValue`               | L9102 | `boolean \| string \| number \| RGB \| RGBA \| MotionEasing \| VariableAlias` |
| `VariableResolvedDataType`    | L9097 | `'BOOLEAN' \| 'COLOR' \| 'FLOAT' \| 'STRING' \| 'TIMING' \| 'EASING'`         |
| `VariableDataType`            | L3348 | Includes `'VARIABLE_ALIAS' \| 'EXPRESSION'`                                   |
| `VariableScope`               | L9103 | Where variable can be applied                                                 |
| `CodeSyntaxPlatform`          | L9129 | `'WEB' \| 'ANDROID' \| 'iOS'`                                                 |
| `VariableBindableNodeField`   | L4399 | Node fields that accept variable binding                                      |
| `VariableBindableTextField`   | L4427 | Text-specific bindable fields                                                 |
| `VariableBindablePaintField`  | L4436 | `'color'`                                                                     |
| `VariableBindableEffectField` | L4439 | `'color'\|'radius'\|'spread'\|'offsetX'\|'offsetY'`                           |

---

## Styles

| Interface        | L#     | Notes                                                  |
| ---------------- | ------ | ------------------------------------------------------ |
| `BaseStyleMixin` | L9856  | `name`, `id`, `key`, `type`, `description`, `remove()` |
| `PaintStyle`     | L9876  | `type:'PAINT'`, `paints: Paint[]`                      |
| `TextStyle`      | L9892  | `type:'TEXT'`, font properties                         |
| `EffectStyle`    | L9965  | `type:'EFFECT'`, `effects: Effect[]`                   |
| `GridStyle`      | L9981  | `type:'GRID'`, `layoutGrids`                           |
| `type BaseStyle` | L9997 | Union of all four                                      |
| `type StyleType` | L9834  | `'PAINT' \| 'TEXT' \| 'EFFECT' \| 'GRID'`              |

---

## Primitives & Geometry

| Type             | L#    | Shape                                         |
| ---------------- | ----- | --------------------------------------------- |
| `Vector`         | L1751 | `{ x: number, y: number }`                    |
| `Rect`           | L1755 | `{ x, y, width, height }`                     |
| `RGB`            | L1764 | `{ r, g, b }` — **0–1 range, not 0–255**      |
| `RGBA`           | L1772 | `{ r, g, b, a }` — **0–1 range**              |
| `Transform`      | L1750 | `[[a,b,tx],[c,d,ty]]` 2×3 affine matrix       |
| `ArcData`        | L2107 | `{ startingAngle, endingAngle, innerRadius }` |
| `Constraints`    | L2452 | `{ horizontal, vertical }: ConstraintType`    |
| `ConstraintType` | L2448 | `'MIN'\|'CENTER'\|'MAX'\|'STRETCH'\|'SCALE'`  |
| `VectorPath`     | L3113 | `{ windingRule, data: string }`               |
| `VectorNetwork`  | L3096 | vertices + segments + regions                 |
| `Guide`          | L2803 | `{ axis, offset }`                            |

---

## Prototyping

| Type                  | L#    | Notes                                                     |
| --------------------- | ----- | --------------------------------------------------------- |
| `Reaction`            | L3344 | trigger + action pair                                     |
| `Trigger`             | L3456 | what initiates the reaction                               |
| `Action`              | L3383 | what happens                                              |
| `Transition`          | L3455 | `SimpleTransition \| DirectionalTransition`               |
| `Easing`              | L3492 | easing curve definition                                   |
| `Navigation`          | L3488 | `'NAVIGATE'\|'SWAP'\|'OVERLAY'\|'SCROLL_TO'\|'CHANGE_TO'` |
| `OverflowDirection`   | L3869 | `'NONE'\|'HORIZONTAL'\|'VERTICAL'\|'BOTH'`                |
| `OverlayPositionType` | L3873 | overlay placement                                         |

---

## Export

| Type                        | L#    | Notes                                         |
| --------------------------- | ----- | --------------------------------------------- |
| `ExportSettingsImage`       | L2882 | PNG/JPG/WEBP/BMP                              |
| `ExportSettingsSVG`         | L2955 |                                               |
| `ExportSettingsPDF`         | L2974 |                                               |
| `ExportSettingsREST`        | L2988 |                                               |
| `ExportSettingsConstraints` | L2875 | `{ type: 'SCALE'\|'WIDTH'\|'HEIGHT', value }` |

---

## Key Sub-API Surfaces

**ViewportAPI (L1495):** `center: Vector`, `zoom: number`, `scrollAndZoomIntoView(nodes)`, `bounds: Rect`

**UtilAPI (L1371):** `solidPaint(color, overrides?)`, `rgba(color)`, `rgb(color)`, `normalizeMarkdown(markdown)`, `getSfSymbolCharacter(name)`

**TeamLibraryAPI (L1289):** `getAvailableLibraryVariableCollectionsAsync()`, `importVariableByKeyAsync(key)`

**Image (L9998):** `hash`, `getBytesAsync()`, `getSizeAsync()`

---

## All Symbols (flat — grep these against the .d.ts file)

To find any symbol: `grep -n "^interface Foo\|^type Foo\|^declare type Foo" plugin-api-standalone.d.ts`

```
PluginAPI               VariablesAPI            LibraryVariableCollectionLibraryVariable
AnnotationsAPI          BuzzTextField           BuzzMediaField          TeamLibraryAPI
MotionAPI               UtilAPI                 ViewportAPI             SuggestionResults
ParametersAPI           NodeChangeProperty      Transform               Vector
Rect                    RGB                     RGBA                    FontName
FontVariationSettings   FontNameInput           TextCase                TextDecoration
TextDecorationStyle     FontStyle               TextDecorationOffset    TextDecorationThickness
TextDecorationColor     OpenTypeFeature         ArcData                 DropShadowEffect
InnerShadowEffect       BlurEffectBase          BlurEffectNormal        BlurEffectProgressive
BlurEffect              NoiseEffectBase         NoiseEffectMonotone     NoiseEffectDuotone
NoiseEffectMultitone    NoiseEffect             TextureEffect           GlassEffect
ShaderEffect            Effect                  ConstraintType          Constraints
ColorStop               ImageFilters            SolidPaint              GradientPaint
ImagePaint              VideoPaint              PatternPaint            ShaderPaint
Paint                   ShaderPropertyValue     ShaderPropertyDefinitionShader
Guide                   RowsColsLayoutGrid      GridLayoutGrid          LayoutGrid
ExportSettingsConstraintsExportSettingsImage     ExportSettingsSVGBase   ExportSettingsSVG
ExportSettingsSVGString ExportSettingsPDF       ExportSettingsREST      ExportSettings
WindingRule             VectorVertex            VectorSegment           VectorRegion
VectorNetwork           VectorPath              VectorPaths             LetterSpacing
LineHeight              LeadingTrim             TextWrapStyle           HyperlinkTarget
TextListOptions         BlendMode               MaskType                Font
TextStyleOverrideType   StyledTextSegment       TextPathStartData       Reaction
VariableDataType        ExpressionFunction      Expression              VariableValueWithExpression
VariableData            ConditionalBlock        Action                  SimpleTransition
DirectionalTransition   Transition              Trigger                 Navigation
Easing                  EasingFunctionBezier    EasingFunctionSpring    MotionEasing
PhysicalSpring          NormalizedSpring        AnimationStylePropValue AvailableAnimationStylePropValue
BaseAnimationStyle      AvailableAnimationStyle AnimationStyleConfigurationAppliedAnimationStyle
KeyframeValue           ManualKeyframeInput     ManualKeyframeTrackInputManualKeyframe
ManualKeyframeBinding   ManualKeyframeTrack     KeyframeBinding         KeyframePropertyFieldName
EffectKeyframeFieldName KeyframeField           ComponentPropKeyframeTracksComponentPropKeyframeBindings
PaintManualKeyframeTrackPaintKeyframeBinding    EffectManualKeyframeTracksEffectKeyframeBindings
ManualKeyframeTracks    Animations              Timeline                OverflowDirection
OverlayPositionType     OverlayBackground       OverlayBackgroundInteractionPublishStatus
ConnectorEndpointPositionConnectorEndpointPositionAndEndpointNodeIdConnectorEndpointEndpointNodeIdAndMagnetConnectorEndpoint
ConnectorStrokeCap      BaseNodeMixin           PluginDataMixin         SceneNodeMixin
MotionNodeMixin         VariableBindableNodeFieldVariableBindableTextFieldVariableBindablePaintField
VariableBindablePaintStyleFieldVariableBindableColorStopFieldVariableBindableEffectFieldVariableBindableEffectStyleField
VariableBindableLayoutGridFieldVariableBindableGridStyleFieldVariableBindableComponentPropertyFieldVariableBindableComponentPropertyDefinitionField
StickableMixin          ChildrenMixin           ConstraintMixin         DimensionAndPositionMixin
LayoutMixin             AspectRatioLockMixin    BlendMixin              ContainerMixin
StrokeCap               StrokeJoin              HandleMirroring         AutoLayoutMixin
GridTrackSize           GridTrackReorderOptions GridTrackReorderEntry   GridLayoutMixin
AutoLayoutChildrenMixin GridChildrenMixin       InferredAutoLayoutResultDetachedInfo
MinimalStrokesMixin     IndividualStrokesMixin  MinimalFillsMixin       VariableWidthPoint
PresetVariableWidthStrokePropertiesCustomVariableWidthStrokePropertiesVariableWidthStrokePropertiesComplexStrokeProperties
ScatterBrushProperties  StretchBrushProperties  BrushStrokeProperties   DynamicStrokeProperties
GeometryMixin           ComplexStrokesMixin     CornerMixin             RectangleCornerMixin
ExportMixin             FramePrototypingMixin   VectorLikeMixin         ReactionMixin
DocumentationLink       PublishableMixin        DefaultShapeMixin       BaseFrameMixin
DefaultFrameMixin       OpaqueNodeMixin         MinimalBlendMixin       Annotation
AnnotationProperty      AnnotationPropertyType  AnnotationsMixin        Measurement
MeasurementSide         MeasurementOffset       MeasurementsMixin       ComponentPropertiesMixin
BaseNonResizableTextMixinNonResizableTextMixin   NonResizableTextPathMixinTextSublayerNode
DocumentNode            ExplicitVariableModesMixinPageNode                FrameNode
GroupNode               TransformGroupNode      SliceNode               RectangleNode
LineNode                EllipseNode             PolygonNode             StarNode
VectorNode              TextNode                TextPathNode            ComponentPropertyType
InstanceSwapPreferredValueSlotSettings            ComponentPropertyOptionsComponentPropertyDefinitions
ComponentSetNode        ComponentNode           ComponentProperties     InstanceNode
SlotNode                BooleanOperationNode    StickyNode              StampNode
TableNode               TableCellNode           HighlightNode           WashiTapeNode
ShapeWithTextNode       CodeBlockNode           LabelSublayerNode       ConnectorNode
VariableResolvedDataTypeVariableAlias           VariableValue           VariableScope
CodeSyntaxPlatform      Variable                VariableCollection      ExtendedVariableCollection
AnnotationCategoryColor AnnotationCategory      WidgetNode              EmbedData
EmbedNode               LinkUnfurlData          LinkUnfurlNode          MediaData
MediaNode               SectionNode             SlideNode               SlideRowNode
SlideGridNode           InteractiveSlideElementNodeSlideTransition         BaseNode
SceneNode               NodeType                StyleType               InheritedStyleField
StyleConsumers          BaseStyleMixin          PaintStyle              TextStyle
EffectStyle             GridStyle               BaseStyle               Image
FindAllCriteria         TransformModifier       RepeatModifier          LinearRepeatModifier
RadialRepeatModifier    QueryResult             ScreenshotOptions
```

---

## use_figma Conveniences

These helpers are available when running code with `use_figma`.

### Node Methods

| Method / Property                 | Returns / Type  | Description                                |
| --------------------------------- | --------------- | ------------------------------------------ |
| `node.query(selector)`            | `QueryResult`   | CSS-like selector search within subtree    |
| `node.matches(selector)`          | `boolean`       | Test if node matches a selector            |
| `node.set(props)`                 | `this`          | Set multiple properties at once, chainable |
| `await node.screenshot(options?)` | `Promise<void>` | Capture PNG inline in tool response        |
| `node.placeholder`                | `boolean`       | Show/hide shimmer overlay                  |

### figma.io Namespace

| Method                       | Returns | Description                                      |
| ---------------------------- | ------- | ------------------------------------------------ |
| `figma.io.write(path, data)` | `void`  | Write image/data to be returned in tool response |

### Types

| Type                | Description                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `QueryResult`       | Iterable result from `node.query()` with `.first()`, `.last()`, `.each()`, `.map()`, `.filter()`, `.values()`, `.set()`, `.query()` |
| `ScreenshotOptions` | `{ scale?: number, contentsOnly?: boolean }`                                                                                        |
