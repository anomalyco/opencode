--!strict
-- OpenCode plugin contract 2.0: the types of a Luau plugin, as the module `@opencode/plugin`.
-- Generated from crates/plugin-abi/schema/v2.json by `bun run generate` (script/gen/plugin-types-luau.ts). Do not edit.
--
-- The host registers the real module; this file only types it for luau-analyze and luau-lsp. Point the alias
-- `opencode` at this directory in a `.luaurc` beside your plugin or above it:
--   { "languageMode": "strict", "aliases": { "opencode": "<path to crates/plugin/src/luau/opencode>" } }
-- then `luau-analyze --formatter=gnu <your .luau files>` or open the plugin in luau-lsp. At run time the host keeps
-- `@opencode` its own whatever a `.luaurc` says, and reads no `.luaurc` outside the plugin. Require your own modules
-- by Luau's rules: `@self/x` in `init.luau`, `./x` in the other modules.
--
-- A handler that acts is a task: `local ok = host:confirm({ ... })` and `local body, err = host:fetch({ ... })` wait in
-- a straight line, and the plugin goes on with other calls meanwhile. A fetch its mount asked for, when that mount
-- closes before the reply, returns `nil, "cancelled"` once: the host cancelled the request. A task keeps the owner of
-- the handler that started it: what it asks for after a wait is still that mount's, or the activation's.
-- `plugin.sleep` and `plugin.every` keep time on the host's clock, with no thread.

-- The contract's definitions ----------------------------------------------------------------------------------------

--- Where an absolute node sits: cells from its parent's edges, and its paint order.
export type Absolute = {
    top: number?,
    right: number?,
    bottom: number?,
    left: number?,
    z: number?,
}

--- What a click asks the host to do.
export type Action = {
    name: string,
    input: string?,
    type: "command",
}

--- A notice.
export type Alert = {
    title: string,
    message: string,
    action: Action?,
    size: PanelSize?,
    centered: boolean?,
}

export type Align = ("stretch" | "start" | "center" | "end")

--- One of a named group of a scroll's anchors.
export type Anchor = {
    group: string,
    variant: string?,
}

--- An anchor and its row in its scroll's content.
export type AnchorAt = {
    id: string,
    owner: string,
    row: number,
    index: number?,
    variant: string?,
}

--- A notification and a sound.
export type Attention = {
    message: string,
    title: string?,
    notify: When?,
    sound: Sound?,
}

--- One key of a layer.
export type Bind = {
    key: string,
    name: string,
    title: string?,
    hold: boolean?,
    command: string?,
}

--- Content: text when it is UTF-8, else base64.
export type Blob = (string | {
    base64: string,
})

--- A border on a box's edge.
export type Border = {
    sides: Sides?,
    style: BorderStyle?,
    color: Color?,
    title: string?,
    title_align: TitleAlign?,
    bottom_title: string?,
    bottom_title_align: TitleAlign?,
}

export type BorderStyle = ("single" | "double" | "rounded" | "heavy")

export type Button = ("left" | "middle" | "right")

export type Cause = ("first" | "resized" | "version" | "animate")

--- What changed since a render's or a surface's last view.
export type Changed = {
    all: boolean?,
    sessions: { string }?,
    lists: { string }?,
    messages: { { string } }?,
    locations: { LocationRef }?,
    ["local"]: boolean?,
    size: boolean?,
    woken: boolean?,
}

--- A renderer claim, without its view.
export type ClaimEntry = {
    target: ClaimTarget,
    palette: boolean?,
}

--- A claimed part as it is now.
export type ClaimPart = ((ToolPart & {
    type: "tool",
}) | (FencePart & {
    type: "fence",
}))

--- What a `claim` request answers; a null node leaves the part to the host.
export type ClaimReply = {
    node: Node?,
    content: { { (ContentRef | Blob) } }?,
    released: { ContentRef }?,
    memo: number?,
}

--- What a claim draws.
export type ClaimTarget = ({
    name: string,
    type: "tool",
} | {
    name: string,
    type: "fence",
})

--- A tool call as a claim's view gets it: the HTTP API's assistant tool part without what the call returned, which its `part-output` source names.
export type ClaimTool = {
    type: "tool",
    id: string,
    name: string,
    executed: boolean?,
    native: SessionMessageNative?,
    state: (SessionMessageToolStateStreaming | SessionMessageToolStateRunning | {
        status: "completed",
        input: { [string]: any },
        content: { any },
        metadata: { [string]: any }?,
    } | SessionMessageToolStateError),
    time: {
        created: number,
        ran: number?,
        completed: number?,
    },
}

--- What a click on a node runs.
export type Click = {
    action: Action,
    on: Press,
}

--- A theme token path (`text.muted`), a scale step (`interactive.500`), `#rrggbb`, or an Rgba.
export type Color = (Rgba | string)

--- A command: in the palette, as a slash command, and on a keybind.
export type Command = {
    name: string,
    title: string,
    palette: boolean,
    group: string?,
    slash: string?,
    keybind: string?,
    description: string?,
    arguments: boolean?,
    scope: Scope?,
    aliases: { string }?,
    enabled: boolean?,
}

--- The composer on screen.
export type Composer = {
    text: string,
    cursor: number,
    focused: boolean,
}

--- An edit of the composer.
export type ComposerEdit = ({
    text: string,
    type: "set",
} | {
    text: string,
    type: "insert",
} | {
    type: "submit",
})

--- A question with two answers.
export type Confirm = {
    title: string,
    message: string,
    action: Action,
    label: ConfirmLabel?,
    size: PanelSize?,
    centered: boolean?,
}

--- The labels of a confirm's answers.
export type ConfirmLabel = {
    confirm: string?,
    cancel: string?,
}

--- Content a view gave the host (`View::content`).
export type ContentRef = number

--- A dialog the host shows.
export type Dialog = ({
    title: string,
    action: Action,
    placeholder: string?,
    value: string?,
    description: string?,
    type: "prompt",
} | {
    key: string,
    type: "close",
} | {
    dialog: Dialog,
    dismissed: Action,
    type: "dismissable",
} | (Panel & {
    type: "panel",
}) | (Select & {
    type: "select",
}) | (Confirm & {
    type: "confirm",
}) | (Alert & {
    type: "alert",
}) | (ErrorDetails & {
    type: "error-details",
}) | (Images & {
    type: "images",
}) | (DialogSurface & {
    type: "surface",
}))

--- A dialog whose body is a new mount of the plugin's dialog surface.
export type DialogSurface = {
    surface: string,
    key: string?,
    size: PanelSize?,
    centered: boolean?,
    title: string?,
}

export type DiffView = ("unified" | "split")

--- Where a dropped drag started.
export type Dragged = {
    surface: string,
    node: string,
}

--- What a `draw` request answers: bytes, not JSON, and none to keep the list the host holds. A version byte (1), then records: an operation byte, the payload's length as a little-endian u32, and the payload. Every integer is little-endian; coordinates are cells from the canvas's top left corner. A color is r, g, b, a bytes. A style is 10 bytes: flags (1 a foreground, 2 a background), attributes (bold 1, dim 2, italic 4, underline 8, inverse 16, strikethrough 32), then the foreground and the background colors, each written whether it is set or not. A border is 0 single, 1 double, 2 rounded, 3 heavy. A reader skips a record of an operation it does not know, which is how a later 2.x adds one; a list the host cannot read fails the plugin, and one over a limit shows a placeholder.
export type DrawList = any

--- A span of time in whole seconds and nanoseconds, as serde writes `std::time::Duration`, which refuses a field it does not know.
export type Duration = {
    secs: number,
    nanos: number,
}

export type Edge = ("top" | "bottom")

--- Cells at each edge.
export type Edges = {
    top: number?,
    right: number?,
    bottom: number?,
    left: number?,
}

--- The host's view of an error.
export type ErrorDetails = {
    title: string,
    error: string,
    source: string?,
    context: string?,
    back: Action?,
    reference: string?,
    key: string?,
    plugin: string?,
}

--- A session's family: its subagent sessions.
export type Family = {
    members: { Member },
    cost: number,
    shells: number?,
    scripts: number?,
}

--- A Markdown code fence.
export type Fence = {
    language: string,
    info: string,
    code: string,
    streaming: boolean,
    closed: boolean,
    key: number,
    width: number?,
}

--- A fenced code block the transcript shows.
export type FencePart = {
    language: string,
    info: string,
    code: string,
    streaming: boolean,
    closed: boolean,
}

--- What a `render-fence` request answers.
export type Fenced = ({
    type: "code",
} | {
    type: "keep",
} | {
    lines: { Line },
    fg: Color?,
    drag: boolean?,
    type: "lines",
})

--- A request of the HTTP API, which a `reply` request answers.
export type Fetch = {
    method: string,
    path: string,
    query: { { string } }?,
    body: any,
    bytes: boolean?,
}

export type Fit = ("contain" | "cover" | "fill")

--- Where the focus is, for the call's mount.
export type Focused = {
    surface: boolean,
    node: string?,
}

--- A program the host runs in the foreground.
export type Foreground = {
    command: string,
    args: { string }?,
    cwd: string?,
}

--- The frame a canvas draws for: its size in cells, why, and the animation's time.
export type Frame = {
    width: number,
    height: number,
    cause: Cause,
    dt: Duration,
}

--- What a `layout` call gets: this frame's geometry of what the surface named.
export type Geometry = {
    rects: { { (string | Rect) } },
    scrolls: { { (string | ScrollState) } },
    groups: { { (string | { AnchorAt }) } },
    tops: { Top },
    moved_only: boolean,
    reached: { { (string | number) } },
    transcript: TranscriptView?,
    mount: MountId?,
}

--- What a row shows before its title.
export type Gutter = ("spinner" | {
    span: Span,
})

export type Handled = ("consume" | "pass")

--- A request a plugin sends the host table's `call`.
export type HostRequest = ({
    level: Level,
    message: string,
    type: "log",
} | {
    variant: Variant,
    message: string,
    title: string?,
    session: string?,
    type: "toast",
} | {
    key: string,
    type: "storage-get",
} | {
    key: string,
    value: string,
    type: "storage-set",
} | {
    name: string,
    type: "open-route",
} | {
    key: string,
    type: "storage-key",
} | {
    token: string,
    type: "color",
} | {
    id: string,
    type: "session",
} | {
    id: string,
    type: "family",
} | {
    id: string,
    type: "messages",
} | {
    session: string,
    message: string,
    type: "message",
} | {
    location: LocationRef?,
    type: "models",
} | {
    type: "model",
} | {
    type: "limits",
} | {
    location: LocationRef?,
    type: "providers",
} | {
    type: "info",
} | {
    location: LocationRef?,
    type: "mcp-servers",
} | {
    location: LocationRef?,
    type: "integrations",
} | {
    location: LocationRef?,
    type: "vcs",
} | {
    type: "route",
} | {
    name: string,
    input: string?,
    type: "dispatch",
} | {
    route: Route,
    type: "navigate",
} | {
    dialog: Dialog,
    type: "dialog",
} | {
    text: string,
    ["then"]: Action?,
    type: "copy",
} | {
    type: "interactive",
} | {
    name: string,
    type: "shortcut",
} | {
    key: string,
    type: "dialog-open",
} | {
    key: string,
    fields: { [string]: any },
    type: "storage-merge",
} | {
    type: "composer",
} | {
    edit: ComposerEdit,
    type: "composer-edit",
} | {
    type: "checkpoint",
} | {
    mark: number,
    type: "rollback",
} | {
    type: "variants",
} | {
    variant: string?,
    type: "set-variant",
} | {
    provider: string,
    model: string,
    type: "set-model",
} | {
    type: "tabs-enabled",
} | {
    type: "tabs",
} | {
    edit: TabEdit,
    type: "tab",
} | {
    type: "keymap-pending",
} | {
    type: "keymap-active",
} | {
    type: "keymap-commands",
} | {
    name: string,
    type: "shortcuts",
} | {
    type: "selection",
} | {
    type: "clear-selection",
} | {
    ms: number,
    type: "timer",
} | {
    id: RequestId,
    type: "cancel-timer",
} | {
    type: "owner",
} | {
    owner: number?,
    type: "set-owner",
} | {
    title: string,
    type: "title",
} | {
    type: "theme",
} | {
    type: "themes",
} | {
    type: "plugins",
} | {
    name: string,
    type: "setting",
} | {
    bytes: string,
    type: "image-size",
} | {
    type: "image-bounds",
} | {
    at: number,
    type: "utc-offset",
} | {
    text: string,
    type: "measure",
} | {
    name: string,
    value: any,
    type: "set-setting",
} | {
    name: string,
    type: "set-theme",
} | {
    name: string,
    theme: any,
    type: "install-theme",
} | {
    target: Target,
    verb: Scroll,
    type: "scroll",
} | {
    target: Target,
    type: "scroll-state",
} | {
    target: Target,
    group: string,
    type: "anchors",
} | {
    target: Target,
    group: string,
    inset: number?,
    type: "top-anchor",
} | {
    type: "transcript",
} | {
    surface: string,
    type: "close-panel",
} | {
    surface: string,
    type: "close-overlay",
} | {
    name: string,
    enabled: boolean,
    type: "set-enabled",
} | {
    node: string,
    type: "focus",
} | {
    type: "blur",
} | {
    mode: string?,
    type: "set-mode",
} | {
    type: "release-keys",
} | {
    node: string,
    type: "rect",
} | {
    type: "focused",
} | {
    type: "input-mode",
} | {
    type: "sessions",
} | {
    id: string,
    type: "pending",
} | (Attention & {
    type: "attention",
}) | (Fetch & {
    type: "fetch",
}) | (Foreground & {
    type: "foreground",
}) | (OpenPanel & {
    type: "open-panel",
}) | (Overlay & {
    type: "overlay",
}))

--- An image, in base64.
export type Image = {
    data: string,
    name: string?,
}

--- The bounds of the images a host with `image-bounds` decodes.
export type ImageBounds = {
    bytes: number,
    side: number,
}

--- Images to look through.
export type Images = {
    images: { Image },
    index: number?,
}

--- The host's version, size and location.
export type Info = {
    version: string,
    size: { number },
    location: LocationRef,
    failed_plugins: number?,
    locale: string?,
}

--- An event the host routes to a handler.
export type InputEvent = ({
    text: string,
    type: "paste",
} | {
    node: string,
    inside: boolean,
    type: "hover",
} | {
    surface: string,
    type: "closed",
} | {
    event: ScrollEvent,
    type: "scroll",
} | {
    node: string,
    text: string,
    seq: number?,
    type: "change",
} | {
    node: string,
    text: string,
    type: "submit",
} | {
    mount: MountId,
    mounted: boolean,
    slot: SlotInput?,
    type: "mount",
} | (Key & {
    type: "key",
}) | (Pointer & {
    type: "pointer",
}))

--- Whose handler an input request calls.
export type InputTo = ({
    surface: number,
    mount: MountId?,
    type: "surface",
} | {
    layer: number,
    type: "layer",
})

export type Justify = ("start" | "end" | "center" | "space-between" | "space-around")

--- A key.
export type Key = {
    key: string,
    bind: string?,
    text: string?,
}

--- A key the sequence in progress may continue with.
export type KeymapActive = {
    key: string,
    title: string?,
    description: string?,
    group: string?,
    continues: boolean?,
}

--- A command of the keymap.
export type KeymapCommand = {
    id: string,
    enabled: boolean,
    title: string?,
    description: string?,
    group: string?,
    palette: boolean?,
    slash: KeymapSlash?,
    suggested: boolean?,
}

--- A key of a sequence in progress.
export type KeymapPending = {
    key: string,
    token: string?,
}

--- A command's slash form.
export type KeymapSlash = {
    name: string,
    aliases: { string }?,
    arguments: boolean?,
}

--- Keys a plugin takes while its scope holds.
export type Layer = {
    scope: LayerScope,
    priority: number?,
    mode: string?,
    keys: { Bind }?,
    any: boolean?,
    paste: boolean?,
}

--- Where a layer holds.
export type LayerScope = (("surface" | "composer" | "global") | {
    node: string,
})

--- How a node takes space in its parent's row or column.
export type Layout = {
    width: Width?,
    grow: boolean?,
    shrink: boolean?,
    min_width: Width?,
    max_width: Width?,
    height: Width?,
    min_height: Width?,
    max_height: Width?,
    margin: Edges?,
    absolute: Absolute?,
}

--- What a `layout` call returns.
export type LayoutReply = {
    paints: { Paint }?,
    again: boolean?,
}

export type Level = ("debug" | "info" | "warn" | "error")

--- A line of styled text.
export type Line = { Span }

--- An item of a list: a node with an id, and the rows assumed until it is laid out.
export type ListItem = {
    node: Node,
    estimate: number?,
}

--- A location: a directory, and a workspace in it.
export type LocationRef = {
    directory: string,
    workspace: string?,
}

--- Everything the plugin registered in its setup.
export type Manifest = {
    id: string,
    commands: { Command },
    fences: { string },
    slots: { SlotClaim },
    routes: { string },
    storage: { string },
    events: { { string } }?,
    wake: boolean?,
    route_mounts: { string }?,
    fence_gone: boolean?,
    cancelled: boolean?,
    deltas: boolean?,
    plugins: boolean?,
    surfaces: { SurfaceClaim }?,
    claims: { ClaimEntry }?,
    messages: boolean?,
    layers: { Layer }?,
    searches: { string }?,
}

--- A text as the host's text layout counts it: its cells in a row, and its graphemes.
export type Measure = {
    cells: number,
    graphemes: number,
}

--- A session of a family.
export type Member = {
    id: string,
    status: SessionStatus,
    updated: number,
    parent: string?,
    jobs: number?,
}

export type Mode = ("dark" | "light")

--- One mount of a surface; a new generation each time.
export type MountId = {
    surface: string,
    key: string,
    generation: number,
}

--- A node of a surface's tree.
export type Node = ({
    id: string?,
    row: boolean?,
    gap: number?,
    padding: { number }?,
    justify: Justify?,
    align: Align?,
    bg: Color?,
    layout: Layout?,
    on_click: Click?,
    children: { Node }?,
    border: Border?,
    padding_sides: Edges?,
    wrap: boolean?,
    overflow: Overflow?,
    sticky: Edge?,
    anchor: Anchor?,
    split: Split?,
    type: "box",
    visible: boolean?,
    focusable: boolean?,
    pointer: boolean?,
    hover: Color?,
    hover_events: boolean?,
} | {
    spans: { Span },
    id: string?,
    fg: Color?,
    wrap: Wrap?,
    truncate: boolean?,
    selectable: boolean?,
    hover_fg: Color?,
    layout: Layout?,
    on_click: Click?,
    hover_events: boolean?,
    type: "text",
} | {
    path: string,
    type: "slot",
} | {
    source: Source,
    id: string?,
    type: "markdown",
} | {
    label: string,
    id: string?,
    type: "spinner",
} | {
    id: string?,
    height: number?,
    follow: boolean?,
    layout: Layout?,
    children: { Node }?,
    notify_top: string?,
    user_scroll: boolean?,
    scrollbar: boolean?,
    type: "scroll",
} | {
    content: Source,
    id: string?,
    view: DiffView?,
    filetype: string?,
    hunks: string?,
    wrap: Wrap?,
    padding: number?,
    type: "diff",
} | {
    id: string?,
    value: string?,
    placeholder: string?,
    lines: number?,
    layout: Layout?,
    seen: number?,
    type: "input",
} | {
    id: string?,
    row: boolean?,
    items: { ListItem }?,
    layout: Layout?,
    notify_top: string?,
    user_scroll: boolean?,
    type: "list",
} | {
    content: Source,
    id: string?,
    filetype: string?,
    numbers: boolean?,
    layout: Layout?,
    type: "code",
} | {
    content: Source,
    id: string?,
    fit: Fit?,
    layout: Layout?,
    type: "image",
} | {
    key: string,
    type: "keep",
} | {
    id: string?,
    layout: Layout?,
    version: number?,
    animate: boolean?,
    type: "canvas",
} | {
    id: string?,
    bg: Color?,
    layout: Layout?,
    type: "fence",
})

--- A node's place on the screen.
export type NodeRect = {
    x: number,
    y: number,
    width: number,
    height: number,
}

--- What a surface asks its `layout` call to be told about.
export type Notify = ({
    id: string,
    type: "node",
} | {
    id: string,
    type: "scroll",
} | {
    scroll: string,
    group: string,
    type: "group",
} | {
    type: "transcript",
})

--- Opens a panel surface.
export type OpenPanel = {
    surface: string,
    session: string?,
    fullscreen: boolean?,
}

export type Overflow = ("visible" | "hidden")

--- Opens an overlay surface.
export type Overlay = {
    surface: string,
    anchor: OverlayAnchor,
    width: number,
    height: number,
}

--- Where an overlay's top left corner goes.
export type OverlayAnchor = ({
    point: {
        x: number,
        y: number,
    },
} | {
    node: {
        node: string,
    },
} | {
    edge: ScreenEdge,
} | {
    surface: {
        surface: string,
        edge: ScreenEdge,
    },
})

--- A box's background `layout` sets.
export type Paint = {
    node: string,
    bg: Color,
}

--- Every token of the page theme, by its path.
export type Palette = {
    mode: Mode,
    colors: { [string]: Rgba },
}

--- A panel dialog, whose body is a `RenderNode`.
export type Panel = {
    key: string,
    title: { Span },
    body: RenderNode,
    size: PanelSize?,
    subtitle: string?,
    actions: { PanelAction }?,
    binds: { PanelBind }?,
    bleed: boolean?,
    centered: boolean?,
    bare: boolean?,
    close: string?,
    height: number?,
    fit_screen: boolean?,
}

--- A footer action of a panel.
export type PanelAction = {
    title: string,
    action: Action,
    key: string?,
    color: Color?,
    close: boolean?,
}

--- A key of a panel.
export type PanelBind = {
    key: string,
    title: string,
    action: Action,
}

--- How a panel surface shows.
export type PanelInput = {
    width: number,
    fullscreen: boolean,
    focused: boolean,
    forced: boolean?,
}

export type PanelSize = ("medium" | "large" | "xlarge")

--- A tool call of a session, whose output a node shows.
export type PartRef = {
    session: string,
    part: string,
}

--- A TUI plugin, as the host lists it.
export type PluginEntry = {
    key: string,
    id: string,
    origin: PluginOrigin,
    status: PluginStatus,
    target: string?,
    active: boolean?,
    slow: string?,
}

export type PluginOrigin = ("builtin" | "added" | "configured" | "external")

export type PluginStatus = ("active" | "inactive" | "skipped" | "failed" | "pending" | "declined")

--- A pointer event on a node.
export type Pointer = {
    node: string,
    kind: PointerKind,
    x: number,
    y: number,
    screen_x: number,
    screen_y: number,
    button: Button?,
    from: Dragged?,
}

export type PointerKind = ("down" | "up" | "drag" | "wheel-up" | "wheel-down" | "drop")

export type Press = ("down" | "up")

--- The prompt's mode, and whether its details show.
export type PromptInput = {
    shell: boolean,
    show_details: boolean,
}

--- A rect in the surface's own cells.
export type Rect = {
    x: number,
    y: number,
    width: number,
    height: number,
}

--- What a `render` and a `render-route` request answer.
export type Render = ({
    type: "keep",
} | {
    type: "hide",
} | {
    node: RenderNode,
    type: "show",
})

--- A fence, with the index of its render.
export type RenderFence = (Fence & {
    index: number?,
})

--- The node tree a render and a dialog body draw.
export type RenderNode = ({
    row: boolean?,
    gap: number?,
    padding: { number }?,
    justify: Justify?,
    align: Align?,
    bg: Color?,
    layout: Layout?,
    on_click: Click?,
    children: { RenderNode }?,
    border: Border?,
    padding_sides: Edges?,
    wrap: boolean?,
    overflow: Overflow?,
    type: "box",
} | {
    spans: { Span },
    fg: Color?,
    wrap: Wrap?,
    truncate: boolean?,
    selectable: boolean?,
    hover_fg: Color?,
    layout: Layout?,
    on_click: Click?,
    type: "text",
} | {
    path: string,
    type: "slot",
} | {
    text: string,
    type: "markdown",
} | {
    label: string,
    type: "spinner",
})

--- A request the host sends a plugin's `call`.
export type Request = ({
    name: string,
    input: string?,
    type: "command",
} | {
    claim: number,
    input: SlotInput,
    changed: Changed,
    type: "render",
} | {
    handler: number,
    event: V2Event,
    type: "event",
} | {
    name: string,
    changed: Changed,
    type: "render-route",
} | {
    id: RequestId,
    result: ({
        Ok: any,
    } | {
        Err: string,
    }),
    type: "reply",
} | {
    claim: number,
    input: SlotInput,
    mounted: boolean,
    type: "mount",
} | {
    type: "wake",
} | {
    name: string,
    mounted: boolean,
    type: "route-mount",
} | {
    key: number,
    type: "fence-gone",
} | {
    id: RequestId,
    type: "cancelled",
} | {
    events: { V2Event },
    type: "deltas",
} | {
    surface: number,
    mount: MountId,
    input: SurfaceInput,
    next: number,
    type: "view",
} | {
    surface: number,
    mount: MountId,
    canvas: string,
    frame: Frame,
    type: "draw",
} | {
    claim: number,
    mount: MountId,
    input: SurfaceInput,
    part: ClaimPart,
    next: number,
    type: "claim",
} | {
    mount: MountId,
    type: "unmount",
} | {
    message: string,
    type: "message",
} | {
    surface: number,
    geometry: Geometry,
    type: "layout",
} | {
    to: InputTo,
    event: InputEvent,
    type: "input",
} | {
    name: string,
    query: string,
    options: { SelectOption },
    type: "search",
} | {
    type: "plugins",
} | (RenderFence & {
    type: "render-fence",
}))

--- What a `fetch` or a `foreground` the host takes answers, which its one reply names; never 0, which names no request. One the host does not take, as when its queue of effects is full, answers an error, and no reply comes.
export type RequestId = number

--- `#rrggbbaa`; the host writes lowercase.
export type Rgba = string

--- A route of the TUI.
export type Route = ({
    type: "home",
} | {
    id: string,
    type: "session",
} | {
    id: string,
    name: string,
    type: "plugin",
})

--- Where a command holds: everywhere, on one of the plugin's routes, or in the host's base mode.
export type Scope = (("global" | "base") | {
    route: string,
})

export type ScreenEdge = ("top" | "bottom" | "left" | "right")

--- A scroll verb, an effect of a handler; the host clamps it to the content.
export type Scroll = ({
    node: string,
    align: ScrollAlign?,
    type: "to",
} | {
    offset: number,
    type: "offset",
} | {
    rows: number,
    type: "by",
} | {
    percent: number,
    type: "page",
} | {
    edge: Edge,
    type: "edge",
} | {
    group: string,
    by: number,
    inset: number?,
    type: "step",
} | {
    type: "forget",
})

--- Where a node goes when a `to` verb brings it into view.
export type ScrollAlign = ({
    type: "start",
} | {
    type: "keep",
} | {
    inset: number?,
    type: "nearest",
})

--- What the host tells a surface about its scrolls.
export type ScrollEvent = ({
    scroll: string,
    anchor: AnchorAt,
    type: "landed",
} | {
    scroll: string,
    type: "user-scroll",
})

--- Where a scroll is, in rows.
export type ScrollState = {
    offset: number,
    viewport: number,
    extent: number,
}

--- A select dialog.
export type Select = {
    title: string,
    options: { SelectOption },
    action: Action,
    placeholder: string?,
    current: string?,
    key: string?,
    actions: { SelectAction }?,
    binds: { PanelBind }?,
    search: string?,
    size: PanelSize?,
    focus: string?,
    query: Action?,
    query_delay: number?,
    filterless: boolean?,
    empty: Span?,
    note: Span?,
    centered: boolean?,
}

--- A footer action of a select.
export type SelectAction = {
    title: string,
    action: Action,
    key: string?,
    hidden: { string }?,
    primary: boolean?,
    rowless: boolean?,
    command: string?,
    disabled: boolean?,
    hidden_all: boolean?,
}

--- A row of a select.
export type SelectOption = {
    title: string,
    value: string,
    description: string?,
    footer: string?,
    category: string?,
    disabled: boolean?,
    footer_color: Color?,
    gutter: Gutter?,
    action: Action?,
    toggle: string?,
    search_text: string?,
}

--- A session and its status.
export type Session = {
    info: SessionInfo,
    status: SessionStatus,
}

export type SessionStatus = ("idle" | "running")

--- The sides a border draws; all of them when left out.
export type Sides = {
    top: boolean?,
    right: boolean?,
    bottom: boolean?,
    left: boolean?,
}

--- A slot claim, which a `render` draws.
export type SlotClaim = {
    kind: SlotKind,
    path: string,
    mount: boolean?,
    size: boolean?,
}

--- What a slot passes to what renders in it.
export type SlotInput = {
    session_id: string?,
    prompt: PromptInput?,
    width: number?,
    height: number?,
}

export type SlotKind = ("prepend" | "append" | "before" | "after" | "replace")

--- A sound.
export type Sound = {
    name: SoundName,
    when: When,
    volume: number?,
}

export type SoundName = ("default" | "question" | "permission" | "error" | "done" | "subagent_done")

--- What a text-bearing node shows.
export type Source = ({
    text: string,
} | {
    content: ContentRef,
} | {
    ["part-output"]: PartRef,
})

--- Styled text.
export type Span = {
    text: string,
    fg: Color?,
    bg: Color?,
    bold: boolean?,
    italic: boolean?,
    underline: boolean?,
    dim: boolean?,
    strikethrough: boolean?,
    link: string?,
}

--- A row whose first child the user resizes.
export type Split = {
    at: number,
    min: number?,
}

--- A surface of contract 2.0, without its view.
export type SurfaceClaim = {
    name: string,
    place: SurfacePlace,
    palette: boolean?,
    draw: boolean?,
    notify: { Notify }?,
    layout: boolean?,
    handler: boolean?,
    layers: { Layer }?,
    mounts: boolean?,
}

--- What a surface's view gets besides the plugin's own state.
export type SurfaceInput = {
    width: number,
    height: number,
    palette: Palette,
    full: boolean?,
    panel: PanelInput?,
    changed: Changed?,
    slot: SlotInput?,
}

--- Where a surface shows.
export type SurfacePlace = ({
    name: string,
    type: "route",
} | {
    kind: SlotKind,
    path: string,
    type: "slot",
} | {
    name: string,
    type: "panel",
} | {
    name: string,
    type: "overlay",
} | {
    name: string,
    type: "dialog",
})

--- A session tab.
export type Tab = {
    session_id: string,
    title: string?,
    active: boolean?,
    busy: boolean?,
    attention: boolean?,
    unread: Unread?,
}

--- An edit of the session tabs.
export type TabEdit = ({
    session: string,
    type: "open",
} | {
    session: string,
    type: "focus",
} | {
    session: string,
    index: number,
    type: "move",
} | {
    session: string?,
    type: "close",
})

--- What a verb or a read names: a scroll of the plugin's surface, or the transcript.
export type Target = ({
    surface: string,
    id: string,
    type: "node",
} | {
    type: "transcript",
})

export type TitleAlign = ("left" | "center" | "right")

--- A toast.
export type Toast = {
    variant: Variant,
    message: string,
    title: string?,
    session: string?,
}

--- A tool call in an assistant message.
export type ToolPart = {
    session: string,
    message: string,
    state: ToolState,
    permission: boolean,
    tool: ClaimTool,
}

export type ToolState = ("pending" | "running" | "completed" | "error")

--- The top anchor of a group in a scroll.
export type Top = {
    scroll: string,
    group: string,
    anchor: AnchorAt?,
}

--- A mounted row of the transcript.
export type TranscriptRow = {
    kind: string,
    message: string,
    row: number,
    height: number,
    part: string?,
}

--- The session transcript's scroll, as the host publishes it.
export type TranscriptView = {
    offset: number,
    viewport: number,
    extent: number,
    revision: number,
    above: number,
    rows: { TranscriptRow },
}

export type Unread = ("activity" | "error")

export type Variant = ("info" | "success" | "warning" | "error")

--- What a `view` request answers.
export type ViewReply = {
    node: Node,
    content: { { (ContentRef | Blob) } }?,
    released: { ContentRef }?,
    memo: number?,
}

export type When = ("always" | "focused" | "blurred")

--- A size in cells or in percent of the parent.
export type Width = ({
    cells: number,
} | {
    percent: number,
})

export type Wrap = ("word" | "char" | "none")

-- The HTTP API's types (packages/protocol/openapi.json) ---------------------------------------------------------

type _Event1<Kind, Payload> = {
    id: EventID,
    created: number,
    metadata: { [string]: any }?,
    type: Kind,
    location: ApiLocationRef?,
    data: Payload,
}

type _Event2<Kind, Payload> = {
    id: EventID,
    created: number,
    metadata: { [string]: any }?,
    type: Kind,
    durable: {
        aggregateID: string,
        seq: EventSeq,
        version: EventVersionEncodedC77c5abcb68d,
    },
    location: ApiLocationRef?,
    data: Payload,
}

type _Event3<Kind, Payload> = {
    id: EventID,
    created: number,
    metadata: { [string]: any }?,
    type: Kind,
    durable: {
        aggregateID: string,
        seq: EventSeq,
        version: EventVersionEncodedC3ea984aceae,
    },
    location: ApiLocationRef?,
    data: Payload,
}

type _Event4<Kind, Payload> = {
    id: EventID,
    metadata: { [string]: any }?,
    location: LocationPublicRef?,
    type: Kind,
    data: Payload,
}

export type AbsolutePath = string

export type AgentColor = string

export type AgentID = string

export type AgentInfo = {
    id: AgentID,
    name: string,
    model: ModelRef?,
    request: ProviderRequest,
    system: string?,
    instructions: (string | {
        selected: string,
        unselected: string,
    })?,
    description: string?,
    mode: ("subagent" | "primary" | "all"),
    hidden: boolean,
    color: AgentColor?,
    steps: number?,
    permissions: PermissionRuleset,
}

export type AgentUpdated = _Event1<"agent.updated", any>

export type ApiLocationRef = {
    directory: AbsolutePath,
    workspaceID: WorkspaceID?,
}

export type ApiSessionStatus = ({
    type: "idle",
} | {
    type: "retry",
    attempt: number,
    message: string,
    action: {
        reason: string,
        provider: string,
        title: string,
        message: string,
        label: string,
        link: string?,
    }?,
    next: number,
} | {
    type: "busy",
})

export type ArtifactCapability = ("static" | "server-code" | "sqlite" | "durable-objects")

export type ArtifactContent = {
    info: ArtifactInfo,
    files: { [string]: string },
}

export type ArtifactID = string

export type ArtifactInfo = {
    id: ArtifactID,
    provider: ArtifactProviderIDEncoded,
    sessionID: SessionID?,
    title: string,
    entry: string,
    url: string,
    time: ArtifactTime,
}

export type ArtifactProvider = {
    id: ArtifactProviderIDEncoded,
    name: string,
    capabilities: { ArtifactCapability },
    default: boolean,
}

export type ArtifactProviderIDEncoded = string

export type ArtifactTime = {
    created: number,
    updated: number,
}

export type ArtifactUpdated = _Event1<"artifact.updated", any>

export type AutomationAction = (AutomationActionPrompt | AutomationActionCode | AutomationActionShell)

export type AutomationActionCode = {
    type: "code",
    code: string,
    args: any,
}

--- What it does: { type: "prompt", prompt, to? } sends a prompt; { type: "code", code, args? } runs Code Mode; { type: "shell", command } runs a fixed shell command.
export type AutomationActionInput = (AutomationPromptActionInput | AutomationCodeActionInput | AutomationShellActionInput)

export type AutomationActionPrompt = {
    type: "prompt",
    prompt: string,
    to: AutomationTarget,
}

export type AutomationActionShell = {
    type: "shell",
    command: string,
}

export type AutomationCodeActionInput = {
    type: "code",
    code: string,
    args: any,
}

--- A duration such as "90 seconds", "5 minutes" or "2 hours".
export type AutomationDuration = string

export type AutomationID = string

export type AutomationInfo = {
    id: AutomationID,
    name: string,
    projectID: ProjectID,
    sessionID: SessionID?,
    directory: string,
    trigger: AutomationTrigger1,
    tz: string,
    action: AutomationAction,
    expires: number?,
    status: AutomationStatus,
    nextDueAt: number?,
    runCount: number,
    lastRunAt: number?,
    lastOutcome: AutomationOutcome?,
    lastOutput: string?,
    state: any,
    time: {
        created: number,
        updated: number,
    },
}

export type AutomationOutcome = ("fired" | "late" | "skipped" | "disabled" | "failed" | "expired")

export type AutomationPromptActionInput = {
    type: "prompt",
    prompt: string,
    to: AutomationTarget?,
}

export type AutomationShellActionInput = {
    type: "shell",
    command: string,
}

export type AutomationStatus = ("active" | "paused" | "done")

export type AutomationTarget = ({
    session: SessionID,
    subagent: any,
} | {
    subagent: AgentID,
    session: any,
})

--- When it runs: { type: "at", at: "in 20 minutes" | "2026-10-27T09:00" }, { type: "every", every: "1 hour" } or { type: "cron", cron: "0 9 * * 1-5" }, each with an optional tz. Or { type: "event", server, event, args? } for a connected MCP server advertising push delivery.
export type AutomationTrigger = (AutomationTriggerAt | AutomationTriggerEvery | AutomationTriggerCron | AutomationTriggerEvent)

export type AutomationTrigger1 = (AutomationTriggerAt | AutomationTriggerEvery | AutomationTriggerCron | AutomationTriggerEvent)

export type AutomationTriggerAt = {
    type: "at",
    at: string,
    tz: string?,
}

export type AutomationTriggerCron = {
    type: "cron",
    cron: string,
    tz: string?,
}

export type AutomationTriggerEvent = {
    type: "event",
    server: string,
    event: string,
    args: { [string]: any }?,
}

export type AutomationTriggerEvery = {
    type: "every",
    every: AutomationDuration,
    tz: string?,
}

--- A stored blob, such as a generated video, which outlives the job that made it
export type BlobID = string

export type BlobInfo = {
    id: BlobID,
    mime: string,
    bytes: number,
}

export type CommandInfo = {
    name: string,
    description: string?,
}

export type CommandUpdated = _Event1<"command.updated", any>

export type ConfigAgentEncoded = {
    model: (string | {
        providerID: string,
        model: string,
        variant: string?,
    })?,
    request: {
        headers: { [string]: string }?,
        body: { [string]: any }?,
    }?,
    system: string?,
    description: string?,
    mode: ("subagent" | "primary" | "all")?,
    hidden: boolean?,
    color: string?,
    steps: number?,
    disabled: boolean?,
    permissions: PermissionRuleset?,
}

export type ConfigCommandEncoded = {
    template: string,
    description: string?,
    agent: string?,
    model: (string | {
        providerID: string,
        model: string,
        variant: string?,
    })?,
    subagent: boolean?,
    subtask: boolean?,
}

export type ConfigCompactionPercent = string

export type ConfigDirectoryEncoded = {
    type: "directory",
    path: AbsolutePath,
}

export type ConfigDocumentEncoded = {
    type: "document",
    path: AbsolutePath?,
    info: ConfigInfoEncoded,
}

export type ConfigEntry = (ConfigDocumentEncoded | ConfigDirectoryEncoded)

export type ConfigFormatterEntryEncoded = {
    disabled: boolean?,
    command: { string }?,
    environment: { [string]: string }?,
    extensions: { string }?,
}

export type ConfigInfoEncoded = {
    ["$schema"]: string?,
    shell: string?,
    model: (string | {
        providerID: string,
        model: string,
        variant: string?,
    })?,
    default_agent: string?,
    update: ("disable" | "notify" | "auto")?,
    share: ("manual" | "auto" | "disabled")?,
    enterprise: {
        url: string?,
    }?,
    username: string?,
    timezone: string?,
    automations: boolean?,
    permissions: PermissionRuleset?,
    policies: { {
        action: ("provider.use" | "tool.use" | "integration.connect" | "integration.use" | "mcp.use" | "skill.use" | "plugin.use" | "websearch.use"),
        resource: string,
        effect: ("allow" | "deny"),
    } }?,
    agents: { [string]: ConfigAgentEncoded }?,
    snapshots: boolean?,
    watcher: {
        ignore: { string }?,
    }?,
    formatter: (boolean | { [string]: ConfigFormatterEntryEncoded })?,
    lsp: (boolean | { [string]: ({
        disabled: true,
    } | ConfigLSPServerEncoded) })?,
    media: {
        image: {
            auto_resize: boolean?,
            max_width: number?,
            max_height: number?,
            max_base64_bytes: number?,
        }?,
    }?,
    tool_output: {
        max_lines: number?,
        max_bytes: number?,
    }?,
    mcp: {
        timeout: {
            startup: number?,
            catalog: number?,
            execution: number?,
        }?,
        servers: { [string]: (McpLocalConfigEncoded | McpRemoteConfigEncoded) }?,
    }?,
    compaction: {
        auto: boolean?,
        background: boolean?,
        keep: {
            tokens: number?,
        }?,
        buffer: (ConfigCompactionPercent | number)?,
    }?,
    skills: { string }?,
    commands: { [string]: ConfigCommandEncoded }?,
    instructions: { string }?,
    references: { [string]: (string | ConfigReferenceGitEncoded | ConfigReferenceLocalEncoded) }?,
    websearch: (false | ConfigWebSearchInfoEncoded)?,
    plugins: { (string | ConfigPluginEntryEncoded) }?,
    worktree: ConfigWorktree?,
    warming: (boolean | ConfigWarmingEncoded)?,
    providers: { [string]: ConfigProviderEncoded }?,
    experimental: {
        portable_shell_scanner: boolean?,
        codemode_vm: boolean?,
        all_flags: boolean?,
        todo: boolean?,
        media_blob: boolean?,
        artifacts: boolean?,
        console_watches: boolean?,
        recommended_api: boolean?,
        full_codemode: boolean?,
        codemode_agents: boolean?,
        machines: boolean?,
        home_memory: boolean?,
        project_overlay: boolean?,
        opencode_api: boolean?,
        mcp_skills: boolean?,
        compaction_jobs: boolean?,
        sqlite_fts: boolean?,
        browser_stream_tunnel: boolean?,
        go_settings: boolean?,
        video_generate: (boolean | {
            model: (string | {
                providerID: string,
                model: string,
                variant: string?,
            })?,
        })?,
        part_rows: boolean?,
        image_generate: (boolean | {
            model: (string | {
                providerID: string,
                model: string,
                variant: string?,
            })?,
        })?,
        subagent_depth: number?,
        location_idle_timeout: (string | false)?,
        policies: { {
            action: ("provider.use" | "tool.use" | "integration.connect" | "integration.use" | "mcp.use" | "skill.use" | "plugin.use" | "websearch.use"),
            resource: string,
            effect: ("allow" | "deny"),
        } }?,
    }?,
}

export type ConfigLSPServerEncoded = {
    command: { string },
    extensions: { string }?,
    disabled: boolean?,
    env: { [string]: string }?,
    initialization: { [string]: any }?,
}

export type ConfigModelCapabilities = {
    tools: boolean?,
    freeform: { ToolFreeformFormat }?,
    input: { string }?,
    output: { string }?,
    temperature: boolean?,
    reasoning: ConfigModelReasoning?,
}

export type ConfigModelCostEncoded = {
    tier: {
        type: "context",
        size: number,
    }?,
    input: MoneyUSDPerMillionTokens,
    output: MoneyUSDPerMillionTokens,
    cache: {
        read: MoneyUSDPerMillionTokens?,
        write: MoneyUSDPerMillionTokens?,
    }?,
}

export type ConfigModelEncoded = {
    modelID: string?,
    type: ModelType?,
    family: string?,
    name: string?,
    releaseDate: string?,
    compatibility: ModelCompatibility?,
    package: string?,
    settings: ConfigModelSettings?,
    headers: { [string]: string }?,
    body: { [string]: any }?,
    capabilities: ConfigModelCapabilities?,
    variants: { {
        id: string,
        settings: ConfigModelVariantSettings?,
        headers: { [string]: string }?,
        body: { [string]: any }?,
    } }?,
    cost: (ConfigModelCostEncoded | { ConfigModelCostEncoded })?,
    disabled: boolean?,
    limit: {
        context: number?,
        input: number?,
        output: number?,
    }?,
}

export type ConfigModelReasoning = ({
    supported: false,
} | {
    supported: true,
    toggle: boolean?,
    effort: { string }?,
    budget: {
        min: number?,
        max: number?,
    }?,
})

export type ConfigModelSettings = { [string]: any }

export type ConfigModelVariantSettings = { [string]: any }

export type ConfigPluginEntryEncoded = {
    package: string,
    options: { [string]: any }?,
}

export type ConfigProviderEncoded = {
    canonical: ProviderID?,
    name: string?,
    env: { string }?,
    package: string?,
    compatibility: ProviderCompatibility?,
    settings: ConfigProviderSettings?,
    headers: { [string]: string }?,
    body: { [string]: any }?,
    models: { [string]: ConfigModelEncoded }?,
}

export type ConfigProviderSettings = { [string]: any }

export type ConfigReferenceGitEncoded = {
    repository: string,
    branch: string?,
    description: string?,
    hidden: boolean?,
}

export type ConfigReferenceLocalEncoded = {
    path: string,
    description: string?,
    hidden: boolean?,
}

export type ConfigShellOption = {
    path: string,
    name: string,
    acceptable: boolean,
}

export type ConfigUpdated = _Event1<"config.updated", any>

export type ConfigWarmingEncoded = {
    prompt: string?,
    interval: ("auto" | string)?,
    duration: string?,
}

export type ConfigWebSearchInfoEncoded = {
    provider: ("random" | WebSearchID),
}

export type ConfigWorktree = {
    directory: string,
}

export type ConnectionCredentialInfo = {
    type: "credential",
    id: CredentialID,
    label: string,
    method: ("key" | "oauth" | "external"),
    status: ConnectionStatus?,
}

export type ConnectionEnvInfo = {
    type: "env",
    name: string,
    status: ConnectionStatus?,
}

export type ConnectionInfo = (ConnectionCredentialInfo | ConnectionEnvInfo)

export type ConnectionStatus = {
    status: "needs_auth",
    message: string,
    url: string?,
}

export type CredentialEntry = {
    id: CredentialID,
    integrationID: IntegrationID,
    label: string,
    active: boolean,
    value: CredentialValue,
}

export type CredentialExternal = {
    type: "external",
    methodID: IntegrationMethodID,
    metadata: { [string]: any }?,
}

export type CredentialID = string

export type CredentialKey = {
    type: "key",
    key: string,
    metadata: { [string]: any }?,
}

export type CredentialOAuth = {
    type: "oauth",
    methodID: IntegrationMethodID,
    refresh: string,
    access: string,
    expires: number,
    metadata: { [string]: any }?,
}

export type CredentialSwitched = _Event1<"credential.switched", {
    integrationID: IntegrationID,
    credentialID: CredentialID?,
}>

export type CredentialUpdated = _Event1<"credential.updated", {
    integrationID: IntegrationID,
    credentialID: CredentialID,
}>

export type CredentialValue = (CredentialOAuth | CredentialKey | CredentialExternal)

export type EventID = string

export type EventSeq = number

export type EventVersionEncodedC3ea984aceae = number

export type EventVersionEncodedC77c5abcb68d = number

export type ExperimentalJobUpdated = _Event1<"experimental.job.updated", {
    info: JobInfo,
}>

export type ExperimentalMcpEvent = _Event1<"experimental.mcp.event", {
    id: string,
    server: string,
    name: string,
    eventId: string,
    timestamp: string,
    data: any,
    cursor: string?,
    truncated: boolean?,
}>

export type ExperimentalPushUpdated = _Event1<"experimental.push.updated", any>

export type ExperimentalSpaceDeleted = _Event1<"experimental.space.deleted", {
    space: SpaceName,
    key: SpaceKey,
    revision: SpaceRevision,
}>

export type ExperimentalSpaceResync = _Event1<"experimental.space.resync", {
    space: SpaceName,
}>

export type ExperimentalSpaceUpdated = _Event1<"experimental.space.updated", {
    space: SpaceName,
    key: SpaceKey,
    value: SpaceValue,
    revision: SpaceRevision,
}>

export type FileDiffInfo = {
    file: string,
    patch: string,
    additions: number,
    deletions: number,
    status: ("added" | "deleted" | "modified"),
    more: true?,
}

export type FileSystemEntry = {
    path: RelativePath,
    type: ("file" | "directory"),
}

export type FileSystemWrite = {
    path: AbsolutePath,
}

export type FilesystemChanged = _Event1<"filesystem.changed", {
    file: string,
    event: ("add" | "change" | "unlink"),
}>

export type FormAnswer = { [string]: FormValue }

export type FormAnswer1 = { [string]: FormValue1 }

export type FormBooleanField = {
    key: string,
    title: string?,
    description: string?,
    required: boolean?,
    hidden: boolean?,
    when: { FormWhen }?,
    type: "boolean",
    default: boolean?,
}

export type FormBooleanField1 = {
    key: string,
    title: string?,
    description: string?,
    required: boolean?,
    hidden: boolean?,
    when: { FormWhen1 }?,
    type: "boolean",
    default: boolean?,
}

export type FormCancelled = _Event1<"form.cancelled", {
    id: FormID,
    sessionID: string,
}>

export type FormCreated = _Event1<"form.created", {
    form: FormInfo1,
}>

export type FormDetail = {
    id: FormID,
    sessionID: string,
    title: string,
    metadata: FormMetadata?,
    fields: FormFields,
    state: FormState,
}

export type FormExternalField = {
    key: string,
    type: "external",
    url: string,
    title: string?,
    description: string?,
}

export type FormField = (FormStringField | FormNumberField | FormIntegerField | FormBooleanField | FormMultiselectField | FormExternalField)

export type FormField1 = (FormStringField1 | FormNumberField1 | FormIntegerField1 | FormBooleanField1 | FormMultiselectField1 | FormExternalField)

export type FormFields = { FormField }

export type FormFields1 = { FormField1 }

export type FormID = string

export type FormInfo = {
    id: FormID,
    sessionID: string,
    title: string,
    metadata: FormMetadata?,
    fields: FormFields,
}

export type FormInfo1 = {
    id: FormID,
    sessionID: string,
    title: string,
    metadata: FormMetadata?,
    fields: FormFields1,
}

export type FormIntegerField = {
    key: string,
    title: string?,
    description: string?,
    required: boolean?,
    hidden: boolean?,
    when: { FormWhen }?,
    type: "integer",
    minimum: (number | ("Infinity" | "-Infinity" | "NaN"))?,
    maximum: (number | ("Infinity" | "-Infinity" | "NaN"))?,
    default: (number | ("Infinity" | "-Infinity" | "NaN"))?,
}

export type FormIntegerField1 = {
    key: string,
    title: string?,
    description: string?,
    required: boolean?,
    hidden: boolean?,
    when: { FormWhen1 }?,
    type: "integer",
    minimum: (number | ("NaN" | "Infinity" | "-Infinity"))?,
    maximum: (number | ("NaN" | "Infinity" | "-Infinity"))?,
    default: (number | ("NaN" | "Infinity" | "-Infinity"))?,
}

export type FormMetadata = { [string]: any }

export type FormMultiselectField = {
    key: string,
    title: string?,
    description: string?,
    required: boolean?,
    hidden: boolean?,
    when: { FormWhen }?,
    type: "multiselect",
    options: { FormOption },
    minItems: number?,
    maxItems: number?,
    custom: boolean?,
    default: { string }?,
}

export type FormMultiselectField1 = {
    key: string,
    title: string?,
    description: string?,
    required: boolean?,
    hidden: boolean?,
    when: { FormWhen1 }?,
    type: "multiselect",
    options: { FormOption },
    minItems: number?,
    maxItems: number?,
    custom: boolean?,
    default: { string }?,
}

export type FormNumberField = {
    key: string,
    title: string?,
    description: string?,
    required: boolean?,
    hidden: boolean?,
    when: { FormWhen }?,
    type: "number",
    minimum: (number | ("Infinity" | "-Infinity" | "NaN"))?,
    maximum: (number | ("Infinity" | "-Infinity" | "NaN"))?,
    default: (number | ("Infinity" | "-Infinity" | "NaN"))?,
}

export type FormNumberField1 = {
    key: string,
    title: string?,
    description: string?,
    required: boolean?,
    hidden: boolean?,
    when: { FormWhen1 }?,
    type: "number",
    minimum: (number | ("NaN" | "Infinity" | "-Infinity"))?,
    maximum: (number | ("NaN" | "Infinity" | "-Infinity"))?,
    default: (number | ("NaN" | "Infinity" | "-Infinity"))?,
}

export type FormOption = {
    value: string,
    label: string,
    description: string?,
}

export type FormReplied = _Event1<"form.replied", {
    id: FormID,
    sessionID: string,
    answer: FormAnswer1,
}>

export type FormState = ({
    status: "pending",
} | {
    status: "answered",
    answer: FormAnswer,
} | {
    status: "cancelled",
    message: string?,
})

export type FormStringField = {
    key: string,
    title: string?,
    description: string?,
    required: boolean?,
    hidden: boolean?,
    when: { FormWhen }?,
    type: "string",
    format: ("email" | "uri" | "date" | "date-time")?,
    minLength: number?,
    maxLength: number?,
    pattern: string?,
    placeholder: string?,
    default: string?,
    options: { FormOption }?,
    custom: boolean?,
}

export type FormStringField1 = {
    key: string,
    title: string?,
    description: string?,
    required: boolean?,
    hidden: boolean?,
    when: { FormWhen1 }?,
    type: "string",
    format: ("email" | "uri" | "date" | "date-time")?,
    minLength: number?,
    maxLength: number?,
    pattern: string?,
    placeholder: string?,
    default: string?,
    options: { FormOption }?,
    custom: boolean?,
}

export type FormValue = (string | number | ("Infinity" | "-Infinity" | "NaN") | boolean | { string })

export type FormValue1 = (string | number | ("NaN" | "Infinity" | "-Infinity") | boolean | { string })

export type FormWhen = {
    key: string,
    op: ("eq" | "neq"),
    value: (string | number | ("Infinity" | "-Infinity" | "NaN") | boolean),
}

export type FormWhen1 = {
    key: string,
    op: ("eq" | "neq"),
    value: (string | number | ("NaN" | "Infinity" | "-Infinity") | boolean),
}

export type GenerateChoiceAnswer = {
    type: "choice",
    name: string,
    choice: GenerateChoiceValue,
    probabilities: { {
        value: GenerateChoiceValue,
        probability: number,
    } },
    confidence: number,
}

--- Pick one value from a fixed set
export type GenerateChoiceQuestion = {
    type: "choice",
    name: string,
    instructions: string,
    choices: { {
        value: GenerateChoiceValue,
        description: string?,
    } },
}

--- Choice values are typed: true and "true" are different values
export type GenerateChoiceValue = (string | boolean)

export type GenerateDecisionAnswer = (GeneratePredicateAnswer | GenerateChoiceAnswer | GenerateScoreAnswer | GenerateErrorAnswer)

export type GenerateDecisionFilePart = {
    type: "file",
    data: PromptBase64,
    mime: string,
    name: string?,
}

export type GenerateDecisionJsonPart = {
    type: "json",
    value: any,
}

export type GenerateDecisionPart = (GenerateDecisionTextPart | GenerateDecisionJsonPart | GenerateDecisionFilePart)

export type GenerateDecisionQuestion = (GeneratePredicateQuestion | GenerateChoiceQuestion | GenerateScoreQuestion)

export type GenerateDecisionResult = {
    answers: { GenerateDecisionAnswer },
    cost: MoneyUSD?,
    tokens: GenerateUsage?,
    native: GenerateNative?,
}

export type GenerateDecisionTextPart = {
    type: "text",
    text: string,
}

--- This one question has no answer; the other answers still came back
export type GenerateErrorAnswer = {
    type: "error",
    name: string,
    reason: string,
    message: string?,
}

export type GenerateFile = {
    data: PromptBase64,
    mime: string,
    name: string?,
}

--- Aspect ratio as width:height, for example 16:9
export type GenerateImageAspect = string

export type GenerateImageFile = {
    data: PromptBase64,
    mime: string,
    name: string?,
}

export type GenerateImageOutput = {
    type: "image",
    data: PromptBase64,
    mime: string,
    name: string?,
}

--- Size tier such as 1K, 2K or 4K; 1K is about as many pixels as 1024x1024 at the requested aspect
export type GenerateImageResolution = (("1K" | "2K" | "4K") | string)

export type GenerateImageResult = {
    images: { GenerateImageOutput },
    cost: MoneyUSD?,
    tokens: GenerateUsage?,
    native: GenerateNative?,
}

--- Provider-specific data the shared fields do not cover
export type GenerateNative = { [string]: any }

export type GeneratePredicateAnswer = {
    type: "predicate",
    name: string,
    probability: number,
}

--- The probability that a statement is true
export type GeneratePredicateQuestion = {
    type: "predicate",
    name: string,
    instructions: string,
    criteria: {
        ["true"]: string?,
        ["false"]: string?,
    }?,
}

export type GenerateScoreAnswer = {
    type: "score",
    name: string,
    score: number,
    probabilities: { {
        value: number,
        label: string,
        probability: number,
    } },
    confidence: number,
}

--- Place the input on ordered levels, lowest first
export type GenerateScoreQuestion = {
    type: "score",
    name: string,
    instructions: string,
    levels: { {
        label: string,
        description: string?,
    } },
}

--- Token counts, when the provider reports them
export type GenerateUsage = {
    input: number?,
    output: number?,
}

--- Aspect ratio as width:height, or auto to follow the start image
export type GenerateVideoAspect = (GenerateImageAspect | "auto")

export type GenerateVideoCompleted = {
    id: GenerateVideoID,
    status: "completed",
    blobs: { BlobInfo },
}

export type GenerateVideoError = {
    id: GenerateVideoID,
    status: "error",
    error: string,
    reason: GenerateVideoErrorReason,
}

--- failed: the provider failed the job. cancelled: the provider cancelled it. expired: the provider expired it. unknown: the provider gave no result in time
export type GenerateVideoErrorReason = ("failed" | "cancelled" | "expired" | "unknown")

export type GenerateVideoID = string

export type GenerateVideoJob = (GenerateVideoRunning | GenerateVideoCompleted | GenerateVideoError)

export type GenerateVideoResolution = (("480p" | "720p" | "1080p" | "4k") | string)

export type GenerateVideoRunning = {
    id: GenerateVideoID,
    status: "running",
}

export type InstallationUpdateAvailable = _Event1<"installation.update-available", {
    version: string,
}>

export type InstallationUpdated = _Event1<"installation.updated", {
    version: string,
}>

export type InstructionEntryInfo = {
    key: InstructionEntryKey,
    value: any,
}

--- Instruction entry key (lowercase alphanumerics plus . _ -)
export type InstructionEntryKey = string

export type InstructionEntrySnapshot = { {
    key: InstructionEntryKey,
    value: any,
    removed: boolean,
} }

export type InstructionHash = string

export type IntegrationAttemptEncoded = {
    attemptID: IntegrationAttemptID,
    url: string,
    instructions: string,
    mode: ("auto" | "code"),
    paste: true?,
    time: {
        created: (number | ("Infinity" | "-Infinity" | "NaN")),
        expires: (number | ("Infinity" | "-Infinity" | "NaN")),
    },
}

export type IntegrationAttemptID = string

export type IntegrationAttemptStatus = ({
    status: "pending",
    time: {
        created: (number | ("Infinity" | "-Infinity" | "NaN")),
        expires: (number | ("Infinity" | "-Infinity" | "NaN")),
    },
} | {
    status: "complete",
    time: {
        created: (number | ("Infinity" | "-Infinity" | "NaN")),
        expires: (number | ("Infinity" | "-Infinity" | "NaN")),
    },
} | {
    status: "failed",
    message: string,
    time: {
        created: (number | ("Infinity" | "-Infinity" | "NaN")),
        expires: (number | ("Infinity" | "-Infinity" | "NaN")),
    },
} | {
    status: "expired",
    time: {
        created: (number | ("Infinity" | "-Infinity" | "NaN")),
        expires: (number | ("Infinity" | "-Infinity" | "NaN")),
    },
})

export type IntegrationCommandAttempt = {
    attemptID: IntegrationAttemptID,
    time: {
        created: (number | ("Infinity" | "-Infinity" | "NaN")),
        expires: (number | ("Infinity" | "-Infinity" | "NaN")),
    },
}

export type IntegrationCommandAttemptStatus = ({
    status: "pending",
    message: string?,
    time: {
        created: (number | ("Infinity" | "-Infinity" | "NaN")),
        expires: (number | ("Infinity" | "-Infinity" | "NaN")),
    },
} | {
    status: "complete",
    time: {
        created: (number | ("Infinity" | "-Infinity" | "NaN")),
        expires: (number | ("Infinity" | "-Infinity" | "NaN")),
    },
} | {
    status: "failed",
    message: string,
    time: {
        created: (number | ("Infinity" | "-Infinity" | "NaN")),
        expires: (number | ("Infinity" | "-Infinity" | "NaN")),
    },
} | {
    status: "expired",
    time: {
        created: (number | ("Infinity" | "-Infinity" | "NaN")),
        expires: (number | ("Infinity" | "-Infinity" | "NaN")),
    },
})

export type IntegrationCommandMethod = {
    id: IntegrationMethodID,
    type: "command",
    label: string,
    command: { string },
}

export type IntegrationEnvMethod = {
    type: "env",
    names: { string },
}

export type IntegrationExternalMethod = {
    id: IntegrationMethodID,
    type: "external",
    label: string,
    form: FormFields?,
}

export type IntegrationID = string

export type IntegrationInfo = {
    id: IntegrationID,
    name: string,
    metadata: { [string]: any }?,
    methods: { IntegrationMethod },
    connections: { ConnectionInfo },
}

export type IntegrationKeyMethod = {
    type: "key",
    label: string?,
    form: FormFields?,
}

export type IntegrationMethod = (IntegrationOAuthMethod | IntegrationCommandMethod | IntegrationKeyMethod | IntegrationExternalMethod | IntegrationEnvMethod)

export type IntegrationMethodID = string

export type IntegrationOAuthMethod = {
    id: IntegrationMethodID,
    type: "oauth",
    label: string,
    form: FormFields?,
}

export type IntegrationUpdated = _Event1<"integration.updated", any>

export type JobCodeMode = {
    kind: "codemode",
    id: string,
    sessionID: SessionID,
    status: JobStatus,
    title: string?,
    time: JobTime,
}

export type JobImage = {
    kind: "image",
    id: string,
    sessionID: SessionID,
    status: JobStatus,
    title: string?,
    time: JobTime,
    path: string,
    model: string,
}

export type JobInfo = (JobShell | JobSubagent | JobImage | JobVideo | JobCodeMode)

export type JobShell = {
    kind: "shell",
    id: string,
    sessionID: SessionID,
    status: JobStatus,
    title: string?,
    time: JobTime,
    shellID: string,
    command: string,
}

export type JobStatus = ("running" | "completed" | "error" | "cancelled")

export type JobSubagent = {
    kind: "subagent",
    id: string,
    sessionID: SessionID,
    status: JobStatus,
    title: string?,
    time: JobTime,
    childSessionID: SessionID,
    agent: string,
    description: string,
}

export type JobTime = {
    started: number,
    completed: number?,
}

export type JobVideo = {
    kind: "video",
    id: string,
    sessionID: SessionID,
    status: JobStatus,
    title: string?,
    time: JobTime,
    path: string,
}

export type LocationPublicInfo = {
    directory: AbsolutePath,
    project: {
        id: ProjectID,
        directory: AbsolutePath,
        canonical: AbsolutePath,
    },
}

export type LocationPublicRef = {
    directory: AbsolutePath,
}

export type LocationShutdown = _Event1<"location.shutdown", any>

export type MachineInfo = {
    id: string,
    online: boolean,
    paired: boolean,
    os: string?,
    arch: string?,
    connection: {
        kind: ("websocket" | "iroh"),
        path: ("direct" | "relayed")?,
        rtt: (number | ("Infinity" | "-Infinity" | "NaN"))?,
    }?,
}

export type MachineInvite = {
    name: string,
    join: string,
    expires: number,
    reach: { (MachineReach | {
        type: "iroh",
    }) },
}

export type MachineReach = {
    type: "url",
    url: string,
}

export type McpLocalConfigEncoded = {
    type: "local",
    command: { string },
    cwd: string?,
    environment: { [string]: string }?,
    disabled: boolean?,
    codemode: boolean?,
    timeout: {
        startup: number?,
        catalog: number?,
        execution: number?,
    }?,
    protocol: McpProtocol?,
    pool: boolean?,
}

export type McpOAuthConfigEncoded = {
    client_id: string?,
    client_secret: string?,
    scope: string?,
    callback_port: number?,
    redirect_uri: string?,
    auth_server_metadata_url: string?,
}

--- MCP protocol negotiation. "auto" (default) probes for the 2026-07-28 revision and falls back to legacy when the server does not support it. "legacy" opens with the initialize handshake and speaks protocol revisions up to 2025-11-25. "2026-07-28" requires that revision and fails otherwise.
export type McpProtocol = ("legacy" | "auto" | "2026-07-28")

export type McpRemoteConfigEncoded = {
    type: "remote",
    url: string,
    headers: { [string]: string }?,
    oauth: (McpOAuthConfigEncoded | false)?,
    disabled: boolean?,
    codemode: boolean?,
    timeout: {
        startup: number?,
        catalog: number?,
        execution: number?,
    }?,
    protocol: McpProtocol?,
    pool: boolean?,
}

export type McpResource = {
    server: string,
    name: string,
    uri: string,
    description: string?,
    mimeType: string?,
}

export type McpResourceCatalog = {
    resources: { McpResource },
    templates: { McpResourceTemplate },
}

export type McpResourceTemplate = {
    server: string,
    name: string,
    uriTemplate: string,
    description: string?,
    mimeType: string?,
}

export type McpResourcesChanged = _Event1<"mcp.resources.changed", {
    server: string,
}>

export type McpServer = {
    name: string,
    status: (McpStatusConnected | McpStatusPending | McpStatusDisabled | McpStatusFailed | McpStatusNeedsAuth),
    title: string?,
    integrationID: IntegrationID?,
}

export type McpStatusChanged = _Event1<"mcp.status.changed", {
    server: string,
}>

export type McpStatusConnected = {
    status: "connected",
}

export type McpStatusDisabled = {
    status: "disabled",
}

export type McpStatusFailed = {
    status: "failed",
    error: string,
}

export type McpStatusNeedsAuth = {
    status: "needs_auth",
    error: string,
}

export type McpStatusPending = {
    status: "pending",
}

export type ModelCacheFormat = ("anthropic" | "alibaba")

export type ModelCapabilities = {
    tools: boolean,
    freeform: { ToolFreeformFormat }?,
    input: { string },
    output: { string },
    temperature: boolean?,
}

export type ModelCompatibility = {
    reasoningField: ModelReasoningField?,
    requireReasoning: boolean?,
    maxTokensField: ModelMaxTokensField?,
    requireFinishReason: boolean?,
    requireAssistantAfterTool: boolean?,
    supportsPromptCacheKey: boolean?,
    streamUsage: boolean?,
    cacheFormat: ModelCacheFormat?,
    supportsThinkingBlockBinding: boolean?,
    supportsEffortUpdates: boolean?,
    supportsSystemUpdates: boolean?,
    mediaInput: ModelMediaInput?,
}

export type ModelCost = {
    tier: {
        type: "context",
        size: number,
    }?,
    input: MoneyUSDPerMillionTokens,
    output: MoneyUSDPerMillionTokens,
    cache: {
        read: MoneyUSDPerMillionTokens,
        write: MoneyUSDPerMillionTokens,
    },
}

export type ModelInfo = {
    id: string,
    modelID: string,
    providerID: ProviderID,
    canonical: ProviderID?,
    type: ModelType?,
    family: string?,
    name: string,
    compatibility: ModelCompatibility?,
    package: string?,
    settings: ModelSettings?,
    headers: { [string]: string }?,
    body: { [string]: any }?,
    capabilities: ModelCapabilities,
    variants: { ModelVariant },
    experimental: {
        speed: ModelSpeed?,
    }?,
    time: {
        released: number,
    },
    cost: { ModelCost },
    status: ("alpha" | "beta" | "deprecated" | "active"),
    enabled: boolean,
    limit: {
        context: number,
        input: number?,
        output: number,
    },
}

export type ModelMaxTokensField = ("max_completion_tokens" | "max_tokens")

export type ModelMediaInput = ("assets" | "state" | "root")

export type ModelReasoningField = (("reasoning" | "reasoning_content" | "reasoning_text") | string)

export type ModelRef = {
    id: string,
    providerID: ProviderID,
    variant: string?,
}

export type ModelSettings = { [string]: any }

export type ModelSpeed = {
    base: string,
    id: string,
    faster: boolean,
}

export type ModelType = (("chat" | "decision" | "image" | "video" | "realtime" | "embedding" | "transcription") | string)

export type ModelUpdated = _Event1<"model.updated", any>

export type ModelVariant = {
    id: string,
    settings: ModelVariantSettings?,
    headers: { [string]: string }?,
    body: { [string]: any }?,
}

export type ModelVariantSettings = { [string]: any }

export type ModelsDevRefreshed = _Event1<"models-dev.refreshed", any>

export type MoneyUSD = number

export type MoneyUSDPerMillionTokens = number

export type PairingCode = {
    code: string,
    expires_in: number,
}

export type PairingSession = {
    token: string,
}

export type PermissionAsked = _Event1<"permission.asked", {
    id: PermissionID,
    sessionID: SessionID,
    action: string,
    resources: { string },
    save: { string }?,
    metadata: { [string]: any }?,
    source: PermissionSource?,
    message: string?,
}>

export type PermissionEffect = ("allow" | "deny" | "ask")

export type PermissionID = string

export type PermissionReplied = _Event1<"permission.replied", {
    sessionID: SessionID,
    requestID: PermissionID,
    reply: PermissionReply,
}>

export type PermissionReply = ("once" | "always" | "reject")

export type PermissionRequest = {
    id: PermissionID,
    sessionID: SessionID,
    action: string,
    resources: { string },
    save: { string }?,
    metadata: { [string]: any }?,
    source: PermissionSource?,
    message: string?,
}

export type PermissionRule = {
    action: string,
    resource: string,
    effect: PermissionEffect,
}

export type PermissionRuleset = { PermissionRule }

export type PermissionSavedID = string

export type PermissionSavedInfo = {
    id: PermissionSavedID,
    projectID: ProjectID,
    action: string,
    resource: string,
    time: {
        created: number,
        updated: number,
    },
}

export type PermissionSource = {
    type: "tool",
    messageID: string,
    id: string,
}

export type PersistentPtyAdded = _Event1<"persistent-pty.added", {
    sessionID: SessionID,
    terminal: PersistentPtyInfo,
}>

export type PersistentPtyHandoff = {
    directory: string,
    instanceID: string,
    ticket: string,
    expiresAt: (number | ("Infinity" | "-Infinity" | "NaN")),
}

export type PersistentPtyInfo = {
    id: PtyID,
    title: string,
    command: string,
    args: { string },
    cwd: string,
    status: ("running" | "exited"),
    pid: number,
    exitCode: number?,
    sessionID: SessionID,
    userTitle: string?,
    foregroundProcess: string?,
    size: {
        cols: number,
        rows: number,
    },
    output: {
        head: number,
        tail: number,
    },
}

export type PersistentPtyReadResult = {
    ptyID: PtyID,
    title: string,
    cwd: string,
    foregroundProcess: string?,
    screen: {
        text: string,
        cols: number,
        rows: number,
        cursor: {
            x: number,
            y: number,
        },
    },
}

export type PersistentPtyRemoved = _Event1<"persistent-pty.removed", {
    sessionID: SessionID,
    ptyID: PtyID,
}>

export type PersistentPtySnapshot = {
    info: PersistentPtyInfo,
    text: string,
    checkpoint: string,
    cursor: {
        x: number,
        y: number,
    },
}

export type PersistentPtyUpdated = _Event1<"persistent-pty.updated", {
    sessionID: SessionID,
    terminal: PersistentPtyInfo,
}>

export type PluginFeatures = {
    server: true?,
    tui: true?,
    rpc: true?,
    gui: true?,
}

export type PluginGuiBundle = {
    code: string,
    revision: string,
    options: { [string]: any },
}

export type PluginID = string

export type PluginInfo = {
    id: PluginID?,
    source: PluginSource,
    features: PluginFeatures,
    state: PluginState,
}

export type PluginSource = ({
    type: "builtin",
} | {
    type: "package",
    target: string,
    version: string?,
    outdated: true?,
    updating: true?,
} | {
    type: "local",
    path: string,
} | {
    type: "sdk",
})

export type PluginState = ({
    status: "active",
} | {
    status: "failed",
    error: string,
    ref: string?,
})

export type PluginUpdated = _Event1<"plugin.updated", any>

export type Project = {
    id: ProjectID,
    canonical: AbsolutePath,
    vcs: ProjectVcs?,
    name: string?,
    icon: ProjectIcon?,
    commands: ProjectCommands?,
    time: ProjectTime,
    sandboxes: { string },
}

export type ProjectCommands = {
    start: string?,
}

export type ProjectID = string

export type ProjectIcon = {
    url: string?,
    override: string?,
    color: string?,
}

export type ProjectTime = {
    created: number,
    updated: number,
    active: number,
    archived: number?,
}

export type ProjectUpdated = _Event1<"project.updated", {
    id: ProjectID,
    canonical: AbsolutePath,
    vcs: ProjectVcs?,
    name: string?,
    icon: ProjectIcon?,
    commands: ProjectCommands?,
    time: ProjectTime,
    sandboxes: { string },
}>

export type ProjectVcs = string

--- An agent @-mentioned in the prompt, such as @explore, to suggest the model use it. Only the @name in text reaches the model; this records which agent it names and doesn't change the session's own agent.
export type PromptAgentAttachment = {
    name: string,
    mention: PromptMention?,
}

export type PromptBase64 = string

export type PromptFileAttachment = {
    data: PromptBase64,
    mime: string,
    source: PromptFileSource,
    name: string?,
    description: string?,
    mention: PromptMention?,
}

export type PromptFileSource = ({
    type: "inline",
} | {
    type: "uri",
    uri: string,
})

export type PromptInputFileAttachment = {
    uri: string,
    source: PromptFileSource?,
    name: string?,
    description: string?,
    mention: PromptMention?,
}

export type PromptInputSkillAttachment = {
    id: SkillID,
    mention: PromptMention?,
}

export type PromptMention = {
    start: number,
    ["end"]: number,
    text: string,
}

export type PromptSkillAttachment = {
    id: SkillID,
    name: SkillName,
    text: string?,
    mention: PromptMention?,
}

export type ProviderCompatibility = {
    reasoningField: ModelReasoningField?,
    requireReasoning: boolean?,
    maxTokensField: ModelMaxTokensField?,
    requireFinishReason: boolean?,
    requireAssistantAfterTool: boolean?,
    supportsPromptCacheKey: boolean?,
    streamUsage: boolean?,
    cacheFormat: ModelCacheFormat?,
    mediaInput: ModelMediaInput?,
}

export type ProviderID = string

export type ProviderInfo = {
    id: ProviderID,
    canonical: ProviderID?,
    integrationID: IntegrationID?,
    name: string,
    activation: ("auto" | "enabled" | "disabled"),
    package: string,
    compatibility: ProviderCompatibility?,
    settings: ProviderSettings?,
    headers: { [string]: string }?,
    body: { [string]: any }?,
}

export type ProviderRequest = {
    settings: ProviderSettings,
    headers: { [string]: string },
    body: { [string]: any },
}

export type ProviderSettings = { [string]: any }

export type ProviderUpdated = _Event1<"provider.updated", any>

export type Pty = {
    id: PtyID,
    title: string,
    command: string,
    args: { string },
    cwd: string,
    status: ("running" | "exited"),
    pid: number,
    exitCode: number?,
}

export type PtyCreated = _Event1<"pty.created", {
    info: Pty,
}>

export type PtyDeleted = _Event1<"pty.deleted", {
    id: PtyID,
}>

export type PtyExited = _Event1<"pty.exited", {
    id: PtyID,
    exitCode: number,
}>

export type PtyID = string

export type PtyTicketConnectToken = {
    ticket: string,
    expires_in: number,
}

export type PtyUpdated = _Event1<"pty.updated", {
    info: Pty,
}>

export type PushBell = {
    level: PushLevel,
    ["until"]: number?,
}

export type PushDevice = {
    id: PushDeviceID,
    name: string,
    platform: PushPlatform,
    expiresAt: number,
    settings: PushDeviceSettings,
    paused: boolean,
    sessions: { [string]: PushBell },
    time: {
        created: number,
        updated: number,
    },
}

--- A lowercase canonical UUID chosen by the phone
export type PushDeviceID = string

export type PushDeviceSettings = {
    default: PushLevel,
}

export type PushInfo = {
    settings: PushSettings,
    devices: { PushDevice },
    sessions: { [string]: PushBell },
}

export type PushLevel = ("all" | "attention" | "none")

export type PushPlatform = ("android" | "ios")

export type PushRegistered = {
    publicKey: string,
}

export type PushSettings = {
    paused: boolean,
    ["until"]: number?,
}

export type ReferenceGitSource = {
    type: "git",
    repository: string,
    branch: string?,
}

export type ReferenceInfo = {
    name: string,
    path: AbsolutePath,
    description: string?,
    hidden: boolean?,
    source: ReferenceSource,
}

export type ReferenceLocalSource = {
    type: "local",
    path: AbsolutePath,
}

export type ReferenceSource = (ReferenceLocalSource | ReferenceGitSource)

export type ReferenceUpdated = _Event1<"reference.updated", any>

export type RelativePath = string

export type RpcOutput = {
    output: any,
}

export type ServerInfo = {
    version: string,
    pid: number,
    hostname: string?,
    urls: { string },
    paths: {
        tmp: string,
    },
    capabilities: {
        persistentPty: boolean?,
    }?,
}

export type SessionAgentSelected = _Event2<"session.agent.selected", {
    sessionID: SessionID,
    agent: AgentID,
    previous: AgentID?,
}>

export type SessionArchived = _Event2<"session.archived", {
    sessionID: SessionID,
}>

export type SessionCompactionDelta = _Event1<"session.compaction.delta", {
    sessionID: SessionID,
    text: string,
}>

export type SessionCompactionEnded = _Event2<"session.compaction.ended", {
    sessionID: SessionID,
    reason: ("auto" | "manual"),
    model: ModelRef?,
    native: SessionMessageNative?,
    text: string,
    cost: MoneyUSD?,
    tokens: TokenUsageInfo?,
}>

export type SessionCompactionFailed = _Event2<"session.compaction.failed", {
    sessionID: SessionID,
    reason: ("auto" | "manual"),
    error: SessionStructuredError,
    inputID: SessionMessageID?,
    cost: MoneyUSD?,
    tokens: TokenUsageInfo?,
}>

export type SessionCompactionStarted = _Event2<"session.compaction.started", {
    sessionID: SessionID,
    reason: ("auto" | "manual"),
    inputID: SessionMessageID?,
}>

export type SessionCreated = _Event2<"session.created", {
    sessionID: SessionID,
    projectID: ProjectID,
    location: ApiLocationRef,
    subpath: RelativePath?,
    parentID: SessionID?,
    slug: string,
    title: string?,
    agent: AgentID?,
    model: ModelRef?,
    metadata: SessionMetadata?,
    permissions: PermissionRuleset?,
    version: string,
}>

export type SessionDeleted = _Event3<"session.deleted", {
    sessionID: SessionID,
}>

export type SessionExecutionFailed = _Event2<"session.execution.failed", {
    sessionID: SessionID,
    error: SessionStructuredError,
}>

export type SessionExecutionInterrupted = _Event2<"session.execution.interrupted", {
    sessionID: SessionID,
    reason: ("user" | "shutdown" | "superseded" | "inactivity"),
}>

export type SessionExecutionStarted = _Event2<"session.execution.started", {
    sessionID: SessionID,
}>

export type SessionExecutionSucceeded = _Event2<"session.execution.succeeded", {
    sessionID: SessionID,
}>

export type SessionForkBoundary = ({
    type: "before",
    messageID: SessionMessageID,
} | {
    type: "through",
    messageID: SessionMessageID,
})

export type SessionForked = _Event3<"session.forked", {
    sessionID: SessionID,
    parentID: SessionID,
    boundary: SessionForkBoundary,
    instructions: { [string]: any }?,
    instructionEntries: InstructionEntrySnapshot?,
}>

export type SessionID = string

export type SessionIdle = _Event1<"session.idle", {
    sessionID: SessionID,
}>

export type SessionInboxCancelled = _Event2<"session.inbox.cancelled", {
    sessionID: SessionID,
    inboxID: SessionMessageID,
}>

export type SessionInboxCompaction = {
    id: SessionMessageID,
    sessionID: SessionID,
    time: {
        created: number,
    },
    type: "compaction",
    payload: SessionInboxCompactionPayload,
    delivery: SessionInboxDelivery,
}

export type SessionInboxCompactionPayload = any

export type SessionInboxDelivered = _Event2<"session.inbox.delivered", {
    sessionID: SessionID,
    inboxID: SessionMessageID,
}>

--- steer delivers before the agent's next model call, even mid-work. queue waits until the agent finishes its current work, then delivers one queued item at a time. Sending defaults to steer.
export type SessionInboxDelivery = ("steer" | "queue")

export type SessionInboxDeliveryChanged = _Event2<"session.inbox.delivery.changed", {
    sessionID: SessionID,
    inboxID: SessionMessageID,
    delivery: SessionInboxDelivery,
}>

export type SessionInboxEnqueued = _Event2<"session.inbox.enqueued", {
    sessionID: SessionID,
    inboxID: SessionMessageID,
    item: SessionInboxItem,
}>

export type SessionInboxInfo = (SessionInboxUser | SessionInboxSynthetic | SessionInboxCompaction | SessionInboxMove)

export type SessionInboxItem = ({
    type: "user",
    payload: SessionInboxUserPayload,
    delivery: SessionInboxDelivery,
} | {
    type: "synthetic",
    payload: SessionInboxSyntheticPayload,
    delivery: SessionInboxDelivery,
} | {
    type: "compaction",
    payload: SessionInboxCompactionPayload,
    delivery: SessionInboxDelivery,
} | {
    type: "move",
    payload: SessionInboxMovePayload1,
    delivery: SessionInboxDelivery,
})

export type SessionInboxMove = {
    id: SessionMessageID,
    sessionID: SessionID,
    time: {
        created: number,
    },
    type: "move",
    delivery: SessionInboxDelivery,
    payload: SessionInboxMovePayload,
}

export type SessionInboxMovePayload = {
    projectID: ProjectID,
    subpath: RelativePath?,
    location: LocationPublicRef,
}

export type SessionInboxMovePayload1 = {
    location: ApiLocationRef,
    projectID: ProjectID,
    subpath: RelativePath?,
}

export type SessionInboxSynthetic = {
    id: SessionMessageID,
    sessionID: SessionID,
    time: {
        created: number,
    },
    type: "synthetic",
    payload: SessionInboxSyntheticPayload,
    delivery: SessionInboxDelivery,
}

export type SessionInboxSyntheticPayload = {
    text: string,
    description: string?,
    metadata: { [string]: any }?,
}

export type SessionInboxUser = {
    id: SessionMessageID,
    sessionID: SessionID,
    time: {
        created: number,
    },
    type: "user",
    payload: SessionInboxUserPayload,
    delivery: SessionInboxDelivery,
}

export type SessionInboxUserPayload = {
    text: string,
    files: { PromptFileAttachment }?,
    agents: { PromptAgentAttachment }?,
    skills: { PromptSkillAttachment }?,
    metadata: { [string]: any }?,
}

export type SessionInfo = {
    id: SessionID,
    parentID: SessionID?,
    fork: {
        sessionID: SessionID,
        boundary: SessionForkBoundary,
    }?,
    projectID: ProjectID,
    agent: AgentID?,
    model: ModelRef?,
    cost: MoneyUSD,
    tokens: TokenUsageInfo,
    outcome: ("succeeded" | "failed" | "interrupted")?,
    time: {
        created: number,
        updated: number,
        busy: number?,
        idle: number?,
        viewed: number?,
        archived: number?,
    },
    title: string?,
    subpath: RelativePath?,
    metadata: SessionMetadata?,
    permissions: PermissionRuleset?,
    revert: SessionRevert?,
    location: LocationPublicRef,
}

export type SessionInstructionsUpdated = _Event3<"session.instructions.updated", {
    sessionID: SessionID,
    delta: { [string]: (InstructionHash | "removed") },
    text: string?,
}>

export type SessionInterruptResponse = {
    interrupted: boolean,
}

export type SessionMessageAgentSelected = {
    id: SessionMessageID,
    metadata: { [string]: any }?,
    time: {
        created: number,
    },
    type: "agent-switched",
    agent: AgentID,
    previous: AgentID?,
}

export type SessionMessageAssistant = {
    id: SessionMessageID,
    metadata: { [string]: any }?,
    time: {
        created: number,
        firstToken: number?,
        streamed: number?,
        completed: number?,
    },
    type: "assistant",
    agent: AgentID,
    model: ModelRef,
    content: { (SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool) },
    snapshot: {
        start: SnapshotID?,
        ["end"]: SnapshotID?,
        files: { RelativePath }?,
    }?,
    finish: ("stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown")?,
    rawFinish: string?,
    native: SessionMessageNative?,
    cost: MoneyUSD?,
    tokens: TokenUsageInfo?,
    error: SessionStructuredError?,
    retry: SessionMessageAssistantRetry?,
}

export type SessionMessageAssistantReasoning = {
    type: "reasoning",
    text: string,
    native: SessionMessageNative?,
    time: {
        created: number,
        completed: number?,
    }?,
}

export type SessionMessageAssistantRetry = {
    attempt: number,
    at: number,
    error: SessionStructuredError,
}

export type SessionMessageAssistantText = {
    type: "text",
    text: string,
    native: SessionMessageNative?,
}

export type SessionMessageAssistantTool = {
    type: "tool",
    id: string,
    name: string,
    executed: boolean?,
    native: SessionMessageNative?,
    state: (SessionMessageToolStateStreaming | SessionMessageToolStateRunning | SessionMessageToolStateCompleted | SessionMessageToolStateError),
    time: {
        created: number,
        ran: number?,
        completed: number?,
    },
}

export type SessionMessageCompaction = (SessionMessageCompactionRunning | SessionMessageCompactionCompleted | SessionMessageCompactionFailed)

export type SessionMessageCompactionCompleted = {
    type: "compaction",
    id: SessionMessageID,
    metadata: { [string]: any }?,
    time: {
        created: number,
    },
    status: "completed",
    reason: ("auto" | "manual"),
    model: ModelRef?,
    native: SessionMessageNative?,
    summary: string,
    cost: MoneyUSD?,
    tokens: TokenUsageInfo?,
}

export type SessionMessageCompactionFailed = {
    type: "compaction",
    id: SessionMessageID,
    metadata: { [string]: any }?,
    time: {
        created: number,
    },
    status: "failed",
    reason: ("auto" | "manual"),
    error: SessionStructuredError,
    cost: MoneyUSD?,
    tokens: TokenUsageInfo?,
}

export type SessionMessageCompactionRunning = {
    type: "compaction",
    id: SessionMessageID,
    metadata: { [string]: any }?,
    time: {
        created: number,
    },
    status: "running",
    reason: ("auto" | "manual"),
    summary: string,
}

export type SessionMessageID = string

export type SessionMessageIdle = {
    id: SessionMessageID,
    metadata: { [string]: any }?,
    time: {
        created: number,
    },
    type: "idle",
    outcome: ("succeeded" | "failed" | "interrupted"),
    error: SessionStructuredError?,
}

export type SessionMessageInfo = (SessionMessageAgentSelected | SessionMessageModelSelected | SessionMessageLocationSwitched | SessionMessageUser | SessionMessageSynthetic | SessionMessageSystem | SessionMessageSkill | SessionMessageShell | SessionMessageAssistant | SessionMessageCompaction | SessionMessageIdle)

export type SessionMessageLocationSwitched = {
    id: SessionMessageID,
    metadata: { [string]: any }?,
    time: {
        created: number,
    },
    type: "location-switched",
    projectID: ProjectID?,
    subpath: RelativePath?,
    location: LocationPublicRef,
    previous: {
        location: LocationPublicRef,
        projectID: ProjectID?,
        subpath: RelativePath?,
    }?,
}

export type SessionMessageModelSelected = {
    id: SessionMessageID,
    metadata: { [string]: any }?,
    time: {
        created: number,
    },
    type: "model-switched",
    model: ModelRef,
    previous: ModelRef?,
}

export type SessionMessageNative = { [string]: any }

export type SessionMessageShell = {
    id: SessionMessageID,
    metadata: { [string]: any }?,
    time: {
        created: number,
        completed: number?,
    },
    type: "shell",
    shellID: ShellID,
    command: string,
    status: ("running" | "exited" | "timeout" | "killed"),
    exit: (number | ("Infinity" | "-Infinity" | "NaN"))?,
    output: {
        output: string,
        cursor: number,
        size: number,
        truncated: boolean,
    }?,
}

export type SessionMessageSkill = {
    id: SessionMessageID,
    metadata: { [string]: any }?,
    time: {
        created: number,
    },
    type: "skill",
    skill: SkillID,
    name: SkillName,
    text: string,
}

export type SessionMessageSynthetic = {
    id: SessionMessageID,
    metadata: { [string]: any }?,
    time: {
        created: number,
    },
    text: string,
    description: string?,
    type: "synthetic",
}

export type SessionMessageSystem = {
    id: SessionMessageID,
    metadata: { [string]: any }?,
    time: {
        created: number,
    },
    type: "system",
    text: string,
    description: string?,
}

export type SessionMessageToolStateCompleted = {
    status: "completed",
    input: { [string]: any },
    content: { ToolContent },
    metadata: { [string]: any }?,
}

export type SessionMessageToolStateError = {
    status: "error",
    input: { [string]: any },
    error: SessionStructuredError,
    content: { ToolContent }?,
    metadata: { [string]: any }?,
}

export type SessionMessageToolStateRunning = {
    status: "running",
    input: { [string]: any },
    metadata: { [string]: any },
}

export type SessionMessageToolStateStreaming = {
    status: "streaming",
    input: string,
}

export type SessionMessageUser = {
    id: SessionMessageID,
    metadata: { [string]: any }?,
    time: {
        created: number,
    },
    text: string,
    files: { PromptFileAttachment }?,
    agents: { PromptAgentAttachment }?,
    skills: { PromptSkillAttachment }?,
    type: "user",
}

export type SessionMessagesResponse = {
    data: { SessionMessageInfo },
    cursor: {
        previous: string?,
        next: string?,
    },
}

export type SessionMetadata = { [string]: any }

export type SessionMetadataUpdated = _Event2<"session.metadata.updated", {
    sessionID: SessionID,
    metadata: SessionMetadata,
}>

export type SessionModelSelected = _Event2<"session.model.selected", {
    sessionID: SessionID,
    model: ModelRef,
    previous: ModelRef?,
}>

export type SessionMoved = _Event2<"session.moved", {
    sessionID: SessionID,
    location: ApiLocationRef,
    projectID: ProjectID,
    subpath: RelativePath?,
}>

export type SessionPermissions = _Event2<"session.permissions", {
    sessionID: SessionID,
    permissions: PermissionRuleset,
}>

export type SessionReasoningDelta = _Event1<"session.reasoning.delta", {
    sessionID: SessionID,
    assistantMessageID: SessionMessageID,
    ordinal: number,
    delta: string,
}>

export type SessionReasoningEnded = _Event2<"session.reasoning.ended", {
    sessionID: SessionID,
    assistantMessageID: SessionMessageID,
    ordinal: number,
    text: string,
    native: SessionMessageNative?,
}>

export type SessionReasoningStarted = _Event2<"session.reasoning.started", {
    sessionID: SessionID,
    assistantMessageID: SessionMessageID,
    ordinal: number,
    native: SessionMessageNative?,
}>

export type SessionRenamed = _Event2<"session.renamed", {
    sessionID: SessionID,
    title: string,
}>

export type SessionRetryScheduled = _Event2<"session.retry.scheduled", {
    sessionID: SessionID,
    assistantMessageID: SessionMessageID,
    attempt: number,
    at: number,
    error: SessionStructuredError,
}>

export type SessionRevert = {
    messageID: SessionMessageID,
    partID: string?,
    snapshot: SnapshotID?,
    files: { FileDiffInfo }?,
}

export type SessionRevertCleared = _Event2<"session.revert.cleared", {
    sessionID: SessionID,
}>

export type SessionRevertCommitted = _Event2<"session.revert.committed", {
    sessionID: SessionID,
    to: SessionMessageID,
}>

export type SessionRevertStaged = _Event2<"session.revert.staged", {
    sessionID: SessionID,
    revert: SessionRevert,
}>

export type SessionShellEnded = _Event2<"session.shell.ended", {
    sessionID: SessionID,
    shell: ShellInfo,
    output: {
        output: string,
        cursor: number,
        size: number,
        truncated: boolean,
    },
}>

export type SessionShellStarted = _Event2<"session.shell.started", {
    sessionID: SessionID,
    shell: ShellInfo,
}>

export type SessionSkillActivated = _Event2<"session.skill.activated", {
    sessionID: SessionID,
    id: SkillID,
    name: SkillName,
    text: string,
}>

export type SessionStatsActivity = {
    date: string,
    steps: number,
}

export type SessionStatsInfo = {
    range: {
        from: number,
        to: number,
    },
    sessions: number,
    subagents: number,
    prompts: number,
    steps: number,
    tokens: TokenUsageInfo,
    cost: MoneyUSD,
    tools: SessionStatsTools,
    activeDays: number,
    streak: number,
    activity: { SessionStatsActivity },
    models: { SessionStatsModelUsage },
}

export type SessionStatsModelUsage = {
    model: ModelRef,
    steps: number,
    tokens: TokenUsageInfo,
    cost: MoneyUSD,
}

export type SessionStatsToolTotals = {
    calls: number,
    succeeded: number,
    failed: number,
    unfinished: number,
}

export type SessionStatsToolUsage = {
    name: string,
    calls: number,
    succeeded: number,
    failed: number,
    unfinished: number,
    durationP50: number?,
}

export type SessionStatsTools = ({
    mode: "none",
} | {
    mode: "summary",
    totals: SessionStatsToolTotals,
} | {
    mode: "detail",
    totals: SessionStatsToolTotals,
    usage: { SessionStatsToolUsage },
})

export type SessionStatusUpdated = _Event1<"session.status", {
    sessionID: SessionID,
    status: ApiSessionStatus,
}>

export type SessionStepEnded = _Event2<"session.step.ended", {
    sessionID: SessionID,
    assistantMessageID: SessionMessageID,
    finish: ("stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"),
    rawFinish: string?,
    native: SessionMessageNative?,
    cost: MoneyUSD,
    tokens: TokenUsageInfo,
    snapshot: SnapshotID?,
    files: { RelativePath }?,
}>

export type SessionStepFailed = _Event2<"session.step.failed", {
    sessionID: SessionID,
    assistantMessageID: SessionMessageID,
    error: SessionStructuredError,
    finish: "content-filter"?,
    rawFinish: string?,
    native: SessionMessageNative?,
    cost: MoneyUSD?,
    tokens: TokenUsageInfo?,
    snapshot: SnapshotID?,
    files: { RelativePath }?,
}>

export type SessionStepFirstToken = _Event2<"session.step.first-token", {
    sessionID: SessionID,
    assistantMessageID: SessionMessageID,
}>

export type SessionStepStarted = _Event2<"session.step.started", {
    sessionID: SessionID,
    assistantMessageID: SessionMessageID,
    agent: AgentID,
    model: ModelRef,
    snapshot: SnapshotID?,
    started: number,
}>

export type SessionStepStreamed = _Event2<"session.step.streamed", {
    sessionID: SessionID,
    assistantMessageID: SessionMessageID,
}>

export type SessionStructuredError = {
    type: string,
    message: string,
    status: number?,
    response: {
        body: string,
    }?,
    retryAfterMs: number?,
}

export type SessionSynthetic = _Event2<"session.synthetic", {
    sessionID: SessionID,
    text: string,
    description: string?,
    metadata: { [string]: any }?,
}>

export type SessionTextDelta = _Event1<"session.text.delta", {
    sessionID: SessionID,
    assistantMessageID: SessionMessageID,
    ordinal: number,
    delta: string,
}>

export type SessionTextEnded = _Event2<"session.text.ended", {
    sessionID: SessionID,
    assistantMessageID: SessionMessageID,
    ordinal: number,
    text: string,
    native: SessionMessageNative?,
}>

export type SessionTextStarted = _Event2<"session.text.started", {
    sessionID: SessionID,
    assistantMessageID: SessionMessageID,
    ordinal: number,
}>

export type SessionToolCalled = _Event2<"session.tool.called", {
    sessionID: SessionID,
    assistantMessageID: SessionMessageID,
    id: string,
    input: { [string]: any },
    executed: boolean,
    native: SessionMessageNative?,
}>

export type SessionToolFailed = _Event3<"session.tool.failed", {
    sessionID: SessionID,
    assistantMessageID: SessionMessageID,
    id: string,
    error: SessionStructuredError,
    content: { ToolContent }?,
    metadata: { [string]: any }?,
    executed: boolean,
    native: SessionMessageNative?,
}>

export type SessionToolInputDelta = _Event1<"session.tool.input.delta", {
    sessionID: SessionID,
    assistantMessageID: SessionMessageID,
    id: string,
    delta: string,
}>

export type SessionToolInputEnded = _Event2<"session.tool.input.ended", {
    sessionID: SessionID,
    assistantMessageID: SessionMessageID,
    id: string,
    text: string,
}>

export type SessionToolInputStarted = _Event2<"session.tool.input.started", {
    sessionID: SessionID,
    assistantMessageID: SessionMessageID,
    id: string,
    name: string,
}>

export type SessionToolProgress = _Event1<"session.tool.progress", {
    sessionID: SessionID,
    assistantMessageID: SessionMessageID,
    id: string,
    metadata: { [string]: any },
}>

export type SessionToolSuccess = _Event3<"session.tool.success", {
    sessionID: SessionID,
    assistantMessageID: SessionMessageID,
    id: string,
    content: { ToolContent },
    metadata: { [string]: any }?,
    executed: boolean,
    native: SessionMessageNative?,
}>

export type SessionTransferData = {
    info: SessionInfo,
    messages: { SessionMessageInfo },
}

export type SessionUnarchived = _Event2<"session.unarchived", {
    sessionID: SessionID,
}>

export type SessionUsageUpdated = _Event1<"session.usage.updated", {
    sessionID: SessionID,
    cost: MoneyUSD,
    tokens: TokenUsageInfo,
}>

export type SessionViewed = _Event2<"session.viewed", {
    sessionID: SessionID,
    idle: number,
}>

--- Opaque pagination cursor returned as cursor.previous or cursor.next in the previous response.
export type SessionsCursor = string

export type SessionsResponse = {
    data: { SessionInfo },
    cursor: {
        previous: SessionsCursor?,
        next: SessionsCursor?,
    },
}

export type ShellCreated = _Event1<"shell.created", {
    info: ShellInfo,
}>

export type ShellDeleted = _Event1<"shell.deleted", {
    id: ShellID,
}>

export type ShellExited = _Event1<"shell.exited", {
    id: ShellID,
    exit: number?,
    status: ("running" | "exited" | "timeout" | "killed"),
}>

export type ShellID = string

export type ShellInfo = {
    id: ShellID,
    status: ("running" | "exited" | "timeout" | "killed"),
    command: string,
    cwd: string,
    shell: string,
    file: string,
    pid: number?,
    exit: number?,
    signal: string?,
    metadata: { [string]: any },
    time: {
        started: number,
        completed: number?,
    },
}

export type SkillID = string

export type SkillInfo = {
    id: SkillID,
    name: SkillName,
    description: string?,
    autoinvoke: boolean?,
    path: AbsolutePath,
    content: string,
}

export type SkillName = string

export type SkillUpdated = _Event1<"skill.updated", any>

export type SnapshotID = string

export type SpaceChange = {
    space: SpaceName,
    key: SpaceKey,
    value: SpaceValue?,
}

--- Covers this write and every change of the space before it.
export type SpaceCursor = string

export type SpaceCursor1 = string

--- Covers every change up to this page; save it to subscribe or sync from.
export type SpaceCursor2 = string

export type SpaceDelta = {
    type: "delta",
    space: SpaceName,
    epoch: SpaceEpoch,
    revision: SpaceRevision,
    entries: { SpaceEntry },
    cursor: SpaceCursor2,
    next: SpaceCursor1?,
    deleted: { SpaceKey },
}

export type SpaceEntry = {
    key: SpaceKey,
    value: SpaceValue,
}

export type SpaceEpoch = string

export type SpaceKey = string

--- Client-chosen namespace: 1-128 letters, digits, '.', '_' or '-'.
export type SpaceName = string

export type SpacePage = (SpaceSnapshot | SpaceDelta)

export type SpaceRevision = number

export type SpaceSnapshot = {
    type: "snapshot",
    space: SpaceName,
    epoch: SpaceEpoch,
    revision: SpaceRevision,
    entries: { SpaceEntry },
    cursor: SpaceCursor2,
    next: SpaceCursor1?,
}

export type SpaceValue = string

export type TokenUsageInfo = {
    input: number,
    output: number,
    reasoning: number,
    cache: {
        read: number,
        write: number,
    },
}

export type ToolContent = (ToolTextContent | ToolFileContent)

export type ToolFileContent = {
    type: "file",
    uri: string,
    mime: string,
    name: string?,
}

export type ToolFreeformFormat = ("text" | "regex" | "lark")

export type ToolTextContent = {
    type: "text",
    text: string,
}

export type TuiCommandExecute = _Event1<"tui.command.execute", {
    command: (("session.list" | "session.new" | "session.interrupt" | "session.background" | "session.compact" | "session.page.up" | "session.page.down" | "session.line.up" | "session.line.down" | "session.half.page.up" | "session.half.page.down" | "session.first" | "session.last" | "prompt.clear" | "prompt.submit" | "agent.cycle") | string),
}>

export type TuiPromptAppend = _Event1<"tui.prompt.append", {
    text: string,
}>

export type TuiSessionSelect = _Event1<"tui.session.select", {
    sessionID: (SessionID & any),
}>

export type TuiToastShow = _Event1<"tui.toast.show", {
    title: string?,
    message: string,
    variant: ("info" | "success" | "warning" | "error"),
    duration: number?,
}>

export type UsageLimitsBudget = {
    id: string,
    limit: MoneyUSD,
    spent: MoneyUSD,
    scope: ("each" | "combined"),
    per: ("set" | "model"),
    coverage: ("all" | "models"),
    models: { UsageLimitsBudgetModel },
    vendors: { string },
    inputPriceAtLeast: MoneyUSDPerMillionTokens?,
    picked: boolean,
    shared: boolean,
    resetsAt: number,
}

export type UsageLimitsBudgetModel = {
    providerID: ProviderID,
    modelID: string,
    name: string,
    spent: MoneyUSD?,
}

export type UsageLimitsGo = {
    rolling: UsageLimitsMeter,
    weekly: UsageLimitsMeter,
    monthly: UsageLimitsMeter,
}

export type UsageLimitsGoConnection = {
    connection: ("account" | "key"),
    workspace: {
        id: string,
        name: string?,
        goURL: string,
    }?,
    usage: UsageLimitsGo?,
}

export type UsageLimitsInfo = {
    workspace: {
        id: string,
        name: string?,
        usageURL: string,
    },
    go: UsageLimitsGo?,
    budgets: { UsageLimitsBudget },
}

export type UsageLimitsMeter = {
    percent: number,
    limited: boolean,
    resetsAt: number,
}

export type V2Event = (LocationShutdown | ModelsDevRefreshed | CredentialUpdated | CredentialSwitched | IntegrationUpdated | ProviderUpdated | ModelUpdated | AgentUpdated | SessionCreated | SessionAgentSelected | SessionModelSelected | SessionMoved | SessionRenamed | SessionMetadataUpdated | SessionPermissions | SessionViewed | SessionArchived | SessionUnarchived | SessionUsageUpdated | SessionDeleted | SessionForked | SessionInboxDelivered | SessionInboxEnqueued | SessionInboxCancelled | SessionInboxDeliveryChanged | SessionExecutionStarted | SessionExecutionSucceeded | SessionExecutionFailed | SessionExecutionInterrupted | SessionInstructionsUpdated | SessionSynthetic | SessionSkillActivated | SessionShellStarted | SessionShellEnded | SessionStepStarted | SessionStepFirstToken | SessionStepStreamed | SessionStepEnded | SessionStepFailed | SessionTextStarted | SessionTextDelta | SessionTextEnded | SessionReasoningStarted | SessionReasoningDelta | SessionReasoningEnded | SessionToolInputStarted | SessionToolInputDelta | SessionToolInputEnded | SessionToolCalled | SessionToolProgress | SessionToolSuccess | SessionToolFailed | SessionRetryScheduled | SessionCompactionStarted | SessionCompactionDelta | SessionCompactionEnded | SessionCompactionFailed | SessionRevertStaged | SessionRevertCleared | SessionRevertCommitted | FilesystemChanged | ReferenceUpdated | PermissionAsked | PermissionReplied | PluginUpdated | ProjectUpdated | WorktreeUpdated | WorktreeResolved | CommandUpdated | ConfigUpdated | SkillUpdated | PtyCreated | PtyUpdated | PtyExited | PtyDeleted | PersistentPtyAdded | PersistentPtyRemoved | PersistentPtyUpdated | ShellCreated | ShellExited | ShellDeleted | ExperimentalJobUpdated | FormCreated | FormReplied | FormCancelled | WebsearchUpdated | ExperimentalPushUpdated | ArtifactUpdated | SessionStatusUpdated | SessionIdle | TuiPromptAppend | TuiCommandExecute | TuiToastShow | TuiSessionSelect | InstallationUpdated | InstallationUpdateAvailable | VcsBranchUpdated | McpStatusChanged | McpResourcesChanged | ExperimentalMcpEvent | ExperimentalSpaceResync | ExperimentalSpaceUpdated | ExperimentalSpaceDeleted | V2EventRpc | V2EventServerConnected)

export type V2EventRpc = {
    id: EventID,
    created: number,
    metadata: { [string]: any }?,
    type: string,
    location: LocationPublicRef,
    data: { [string]: any },
}

export type V2EventServerConnected = _Event4<"server.connected", {
    stream: string?,
}>

export type VcsBase = {
    name: string,
    ref: string,
    source: ("reflog" | "default"),
}

export type VcsBranch = {
    current: string?,
    default: string?,
}

export type VcsBranchList = { string }

export type VcsBranchUpdated = _Event1<"vcs.branch.updated", {
    branch: string?,
}>

export type VcsFileStatus = {
    file: string,
    additions: number,
    deletions: number,
    status: ("added" | "deleted" | "modified"),
}

export type VcsInfo = {
    provider: string?,
    branch: VcsBranch,
}

export type VoiceModel = {
    model: string,
    name: string,
    engine: string,
    provider: string,
    transports: { VoiceTransportType },
    available: boolean,
}

export type VoiceTransport = (VoiceWebRTCTransport | VoiceWebSocketTransport)

export type VoiceTransportInput = (VoiceWebRTCTransportInput | VoiceWebSocketTransportInput)

export type VoiceTransportType = ("webrtc" | "websocket")

export type VoiceWebRTCTransport = {
    type: "webrtc",
    sdp: string,
}

export type VoiceWebRTCTransportInput = {
    type: "webrtc",
    sdp: string,
    dcid: (number | ("Infinity" | "-Infinity" | "NaN"))?,
}

export type VoiceWebSocketTransport = {
    type: "websocket",
    url: string,
    token: string,
    expiresAt: (number | ("Infinity" | "-Infinity" | "NaN")),
}

export type VoiceWebSocketTransportInput = {
    type: "websocket",
}

export type WebSearchID = string

export type WebSearchProvider = {
    id: WebSearchID,
    name: string,
}

export type WebSearchResponseEncoded = {
    providerID: WebSearchID,
    results: { WebSearchResult },
}

export type WebSearchResult = {
    url: string,
    title: string?,
    content: string?,
    time: {
        published: number?,
    },
}

export type WebsearchUpdated = _Event1<"websearch.updated", any>

export type WorkspaceID = string

export type WorktreeDirectory = {
    directory: AbsolutePath,
    strategy: string?,
}

export type WorktreeInfo = {
    directory: AbsolutePath,
}

export type WorktreeList = { WorktreeDirectory }

export type WorktreeResolved = _Event2<"worktree.resolved", {
    projectID: ProjectID,
    directory: AbsolutePath,
    previous: ProjectID,
    adopted: { ProjectID }?,
}>

export type WorktreeUpdated = _Event1<"worktree.updated", {
    projectID: ProjectID,
}>

-- The plugin's objects -------------------------------------------------------------------------------------------

--- What a render or a view reads; every read of one call sees one store snapshot.
export type Read = {
    themeMode: (self: Read) -> "dark" | "light",
    color: (self: Read, token: string) -> Rgba?,
    storageGet: (self: Read, key: string) -> any,
    session: (self: Read, id: string) -> Session?,
    sessions: (self: Read) -> { Session },
    family: (self: Read, id: string) -> Family,
    messages: (self: Read, id: string) -> { SessionMessageInfo },
    --- The inbox items of session `id` the server has not delivered yet, oldest first; empty while its inbox is not loaded.
    pending: (self: Read, id: string) -> { SessionInboxInfo },
    --- The models of `location`, or where the TUI works; `nil` while they are not loaded.
    models: (self: Read, location: LocationRef?) -> { ModelInfo }?,
    --- The providers of `location`, or where the TUI works; `nil` while they are not loaded.
    providers: (self: Read, location: LocationRef?) -> { ProviderInfo }?,
    --- The OpenCode Console workspace's usage limits; `nil` while they are not loaded.
    limits: (self: Read) -> UsageLimitsInfo?,
    model: (self: Read) -> ModelRef?,
    info: (self: Read) -> Info,
    route: (self: Read) -> Route,
    interactive: (self: Read) -> boolean,
    shortcut: (self: Read, name: string) -> string?,
    dialogOpen: (self: Read, key: string) -> boolean,
    --- The pending key sequence, one entry a stroke; empty when none is pending.
    keymapPending: (self: Read) -> { KeymapPending },
    composer: (self: Read) -> Composer?,
    tabs: (self: Read) -> { Tab },
    --- Whether session tabs are on in this TUI.
    tabsEnabled: (self: Read) -> boolean,
    theme: (self: Read) -> string?,
    themes: (self: Read) -> { string },
    selection: (self: Read) -> string?,
    rect: (self: Read, id: string) -> NodeRect?,
    focused: (self: Read) -> Focused,
    mode: (self: Read) -> string?,
    mount: (self: Read) -> MountId?,
    setting: (self: Read, name: string) -> any,
    plugins: (self: Read) -> { PluginEntry },
    --- The host's version and its optional features.
    abi: (self: Read) -> Abi,
    --- Whether the host has optional feature `name` (`plugin.FOCUS_INPUT`, `plugin.FENCE_NODE`).
    hasFeature: (self: Read, name: string) -> boolean,
    --- The seconds local time is east of UTC at `at`, in milliseconds since the epoch: it depends on the date.
    utcOffset: (self: Read, at: number) -> number,
    --- The cells `text` takes in a row and its graphemes, as the host draws it: pad and cut columns by it.
    measure: (self: Read, text: string) -> Measure,
}

--- The version a host serves the plugin: its major, its minor of that major, and its optional features.
export type Abi = { major: number, minor: number, features: { string } }

--- What a handler acts with: the reads, and effects, which wait until the outermost call returns. A render or a view
--- that calls an effect fails. The waiting calls (`fetch`, `foreground`, `select`, `prompt`, `confirm`, `alert`) park
--- the task that calls them and return its answer.
export type Host = {
    themeMode: (self: Read) -> "dark" | "light",
    color: (self: Read, token: string) -> Rgba?,
    storageGet: (self: Read, key: string) -> any,
    session: (self: Read, id: string) -> Session?,
    sessions: (self: Read) -> { Session },
    family: (self: Read, id: string) -> Family,
    messages: (self: Read, id: string) -> { SessionMessageInfo },
    --- The inbox items of session `id` the server has not delivered yet, oldest first; empty while its inbox is not loaded.
    pending: (self: Read, id: string) -> { SessionInboxInfo },
    --- The models of `location`, or where the TUI works; `nil` while they are not loaded.
    models: (self: Read, location: LocationRef?) -> { ModelInfo }?,
    --- The providers of `location`, or where the TUI works; `nil` while they are not loaded.
    providers: (self: Read, location: LocationRef?) -> { ProviderInfo }?,
    --- The OpenCode Console workspace's usage limits; `nil` while they are not loaded.
    limits: (self: Read) -> UsageLimitsInfo?,
    model: (self: Read) -> ModelRef?,
    info: (self: Read) -> Info,
    route: (self: Read) -> Route,
    interactive: (self: Read) -> boolean,
    shortcut: (self: Read, name: string) -> string?,
    dialogOpen: (self: Read, key: string) -> boolean,
    --- The pending key sequence, one entry a stroke; empty when none is pending.
    keymapPending: (self: Read) -> { KeymapPending },
    composer: (self: Read) -> Composer?,
    tabs: (self: Read) -> { Tab },
    --- Whether session tabs are on in this TUI.
    tabsEnabled: (self: Read) -> boolean,
    theme: (self: Read) -> string?,
    themes: (self: Read) -> { string },
    selection: (self: Read) -> string?,
    rect: (self: Read, id: string) -> NodeRect?,
    focused: (self: Read) -> Focused,
    mode: (self: Read) -> string?,
    mount: (self: Read) -> MountId?,
    setting: (self: Read, name: string) -> any,
    plugins: (self: Read) -> { PluginEntry },
    --- The host's version and its optional features.
    abi: (self: Read) -> Abi,
    --- Whether the host has optional feature `name` (`plugin.FOCUS_INPUT`, `plugin.FENCE_NODE`).
    hasFeature: (self: Read, name: string) -> boolean,
    --- The seconds local time is east of UTC at `at`, in milliseconds since the epoch: it depends on the date.
    utcOffset: (self: Read, at: number) -> number,
    --- The cells `text` takes in a row and its graphemes, as the host draws it: pad and cut columns by it.
    measure: (self: Read, text: string) -> Measure,
    storageSet: (self: Host, key: string, value: { [any]: any }) -> (),
    storageMerge: (self: Host, key: string, fields: { [string]: any }) -> (),
    dispatch: (self: Host, name: string, input: string?) -> (),
    --- Enables or disables the plugin's own command `name`, once the call returns: a disabled command binds no key and
    --- is in neither the palette nor the slash list.
    setEnabled: (self: Host, name: string, enabled: boolean) -> (),
    toast: (self: Host, toast: Toast) -> (),
    attention: (self: Host, attention: Attention) -> (),
    openRoute: (self: Host, name: string) -> (),
    navigate: (self: Host, route: Route) -> (),
    dialog: (self: Host, dialog: Dialog) -> (),
    copy: (self: Host, text: string, thenAction: Action?) -> (),
    editComposer: (self: Host, edit: ComposerEdit) -> (),
    setTitle: (self: Host, title: string) -> (),
    setVariant: (self: Host, variant: string?) -> boolean,
    setModel: (self: Host, provider: string, model: string) -> (),
    editTab: (self: Host, edit: TabEdit) -> boolean,
    clearSelection: (self: Host) -> (),
    setTheme: (self: Host, name: string) -> boolean,
    setSetting: (self: Host, name: string, value: any) -> (),
    scroll: (self: Host, target: Target, verb: Scroll) -> (),
    openPanel: (self: Host, open: OpenPanel) -> (),
    closePanel: (self: Host, surface: string) -> (),
    overlay: (self: Host, overlay: Overlay) -> (),
    closeOverlay: (self: Host, surface: string) -> (),
    focus: (self: Host, id: string) -> (),
    blur: (self: Host) -> (),
    setMode: (self: Host, mode: string?) -> (),
    releaseKeys: (self: Host) -> (),
    --- Waits for the reply: its body (`nil` without one), or `nil` and the error, also when the host did not take
    --- the request. Only a task waits (`plugin.spawn`).
    fetch: (self: Host, fetch: Fetch) -> (any, string?),
    --- Waits until the program exits: its exit code (`nil` when a signal ended it, which `signal` names), or `nil`
    --- and why it did not start.
    foreground: (self: Host, program: Foreground) -> ({ code: number?, signal: string? }?, string?),
    --- Shows a select and waits: the value of the option picked, or `nil` when it closed without one.
    select: (self: Host, select: SelectSpec) -> string?,
    --- Shows a one-line prompt and waits: the text entered, or `nil` when it closed without one.
    prompt: (self: Host, prompt: PromptSpec) -> string?,
    --- Shows a confirm and waits: `true` or `false`, or `nil` when it closed without an answer.
    confirm: (self: Host, confirm: ConfirmSpec) -> boolean?,
    --- Shows an alert and waits until it closed.
    alert: (self: Host, alert: AlertSpec) -> (),
}

--- A select as `host:select` shows it: the contract's `Select` without its `action`.
export type SelectSpec = {
    title: string,
    options: { SelectOption },
    placeholder: string?,
    current: string?,
    key: string?,
    actions: { SelectAction }?,
    binds: { PanelBind }?,
    search: string?,
    size: PanelSize?,
    focus: string?,
    query: Action?,
    query_delay: number?,
    filterless: boolean?,
    empty: Span?,
    note: Span?,
    centered: boolean?,
}

--- A prompt as `host:prompt` shows it.
export type PromptSpec = {
    title: string,
    placeholder: string?,
    value: string?,
    description: string?,
}

--- A confirm as `host:confirm` shows it: the contract's `Confirm` without its `action`.
export type ConfirmSpec = {
    title: string,
    message: string,
    label: ConfirmLabel?,
    size: PanelSize?,
    centered: boolean?,
}

--- An alert as `host:alert` shows it.
export type AlertSpec = {
    title: string,
    message: string,
    size: PanelSize?,
    centered: boolean?,
}

--- A surface's view: what it reads, its input, and a memo that keeps a subtree while its value stays.
export type View = {
    read: Read,
    input: SurfaceInput,
    memo: (self: View, key: string, value: any, build: (view: View) -> Node) -> Node,
}

--- Where a slot claim goes; `kind` is `append` when left out.
export type At = { path: string, kind: SlotKind? }

--- A command; only `name` is needed, the rest are the contract's defaults.
export type CommandSpec = { name: string, title: string?, palette: boolean?, group: string?, slash: string?, keybind: string?, description: string?, arguments: boolean?, scope: Scope?, enabled: boolean? }

--- A surface as `setup:surface` takes it.
export type SurfaceSpec = { name: string, place: SurfacePlace, layers: { Layer }?, mounts: boolean?, palette: boolean? }

--- What setup registers on; each method holds only while setup runs. A handler given a `host` (a command's, an
--- event's, a mount's, a layer's or a surface's) runs as a task, so it may wait; a key handler that waits has taken its
--- key. A command that returns `"pass"` declines the key that ran it, which goes on to whatever else takes it.
--- Renders, views, code blocks and `onDispose` read only and cannot wait.
export type Setup = {
    id: string,
    --- The `options` of the plugin's `plugins` entry, decoded.
    options: any,
    host: Host,
    storageKey: (self: Setup, key: string) -> (),
    command: (self: Setup, command: CommandSpec, run: (host: Host, input: string?) -> ...("pass")) -> (),
    slot: (self: Setup, at: At, render: (read: Read, input: SlotInput, changed: Changed) -> Render?) -> (),
    --- Calls `run` as the host mounts the claim registered last at `at` (`true`, before it first renders) and as it
    --- unmounts it (`false`).
    onMount: (self: Setup, at: At, run: (host: Host, input: SlotInput, mounted: boolean) -> ()) -> (),
    route: (self: Setup, name: string, render: (read: Read, changed: Changed) -> Render?) -> (),
    onRouteMount: (self: Setup, name: string, run: (host: Host, mounted: boolean) -> ()) -> (),
    codeBlock: (self: Setup, language: string, render: (read: Read, fence: Fence) -> Fenced?) -> (),
    --- `event` is one of the API's events, a union tagged by `type`: `if event.type == "…" then` narrows it.
    onEvent: (self: Setup, types: { string }, run: (host: Host, event: V2Event) -> ()) -> (),
    onDispose: (self: Setup, run: (host: Host) -> ()) -> (),
    layer: (self: Setup, layer: Layer, handler: (host: Host, event: InputEvent) -> Handled?) -> (),
    surface: (self: Setup, surface: SurfaceSpec, view: (view: View) -> Node, handler: ((host: Host, event: InputEvent) -> Handled?)?) -> (),
}

--- The style `plugin.span` adds to a span's text.
export type SpanStyle = {
    fg: Color?,
    bg: Color?,
    bold: boolean?,
    italic: boolean?,
    underline: boolean?,
    dim: boolean?,
    strikethrough: boolean?,
    link: string?,
}

--- The fields `plugin.text` adds to a text node.
export type TextProps = {
    id: string?,
    fg: Color?,
    wrap: Wrap?,
    truncate: boolean?,
    selectable: boolean?,
    hover_fg: Color?,
    layout: Layout?,
    on_click: Click?,
    hover_events: boolean?,
}

--- The fields `plugin.column` and `plugin.row` add to a box.
export type BoxProps = {
    id: string?,
    gap: number?,
    padding: { number }?,
    justify: Justify?,
    align: Align?,
    bg: Color?,
    layout: Layout?,
    on_click: Click?,
    border: Border?,
    padding_sides: Edges?,
    wrap: boolean?,
    overflow: Overflow?,
    sticky: Edge?,
    anchor: Anchor?,
    split: Split?,
    visible: boolean?,
    focusable: boolean?,
    pointer: boolean?,
    hover: Color?,
    hover_events: boolean?,
}

--- The API's operations, by the generated client's names: `plugin.client.session.inbox.list({ sessionID = id })` waits,
--- as `host:fetch` does, and returns the operation's output (the reply's `data` where it answers in `data`) or `nil`
--- and the error. Only a task can call one.
export type Client = {
    agent: {
        get: (input: {
            agentID: string,
            location: { directory: string? }?,
        }) -> ({
            location: LocationPublicRef,
            data: AgentInfo,
        }?, string?),
        list: (input: {
            location: { directory: string? }?,
        }?) -> ({
            location: LocationPublicRef,
            data: { AgentInfo },
        }?, string?),
    },
    command: {
        list: (input: {
            location: { directory: string? }?,
        }?) -> ({
            location: LocationPublicRef,
            data: { CommandInfo },
        }?, string?),
    },
    config: {
        get: (input: {
            location: { directory: string? }?,
        }?) -> ({ ConfigEntry }?, string?),
        shells: (input: {}?) -> ({ ConfigShellOption }?, string?),
    },
    credential: {
        activate: (input: {
            credentialID: string,
        }) -> (nil, string?),
        create: (input: {
            id: CredentialID?,
            integrationID: IntegrationID,
            label: string?,
            value: CredentialValue,
            activate: boolean?,
        }) -> (CredentialEntry?, string?),
        list: (input: {}?) -> ({ CredentialEntry }?, string?),
        remove: (input: {
            credentialID: string,
        }) -> (nil, string?),
        update: (input: {
            credentialID: string,
            label: string,
        }) -> (nil, string?),
    },
    debug: {
        heapDump: (input: {
            directory: string?,
        }?) -> (({
            path: string,
            pid: number,
            memory: {
                rss: (number | ("Infinity" | "-Infinity" | "NaN")),
                heapTotal: (number | ("Infinity" | "-Infinity" | "NaN")),
                heapUsed: (number | ("Infinity" | "-Infinity" | "NaN")),
                external: (number | ("Infinity" | "-Infinity" | "NaN")),
                arrayBuffers: (number | ("Infinity" | "-Infinity" | "NaN")),
            },
        })?, string?),
        location: {
            evict: (input: {
                location: { directory: string? }?,
            }?) -> (nil, string?),
            list: (input: {}?) -> ({ LocationPublicRef }?, string?),
        },
    },
    event: {
        subscribe: (input: {
            types: { (("location.shutdown" | "models-dev.refreshed" | "credential.updated" | "credential.switched" | "integration.updated" | "provider.updated" | "model.updated" | "agent.updated" | "session.created" | "session.agent.selected" | "session.model.selected" | "session.moved" | "session.renamed" | "session.metadata.updated" | "session.permissions" | "session.viewed" | "session.archived" | "session.unarchived" | "session.usage.updated" | "session.deleted" | "session.forked" | "session.inbox.delivered" | "session.inbox.enqueued" | "session.inbox.cancelled" | "session.inbox.delivery.changed" | "session.execution.started" | "session.execution.succeeded" | "session.execution.failed" | "session.execution.interrupted" | "session.instructions.updated" | "session.synthetic" | "session.skill.activated" | "session.shell.started" | "session.shell.ended" | "session.step.started" | "session.step.first-token" | "session.step.streamed" | "session.step.ended" | "session.step.failed" | "session.text.started" | "session.text.delta" | "session.text.ended" | "session.reasoning.started" | "session.reasoning.delta" | "session.reasoning.ended" | "session.tool.input.started" | "session.tool.input.delta" | "session.tool.input.ended" | "session.tool.called" | "session.tool.progress" | "session.tool.success" | "session.tool.failed" | "session.retry.scheduled" | "session.compaction.started" | "session.compaction.delta" | "session.compaction.ended" | "session.compaction.failed" | "session.revert.staged" | "session.revert.cleared" | "session.revert.committed" | "filesystem.changed" | "reference.updated" | "permission.asked" | "permission.replied" | "plugin.updated" | "project.updated" | "worktree.updated" | "worktree.resolved" | "command.updated" | "config.updated" | "skill.updated" | "pty.created" | "pty.updated" | "pty.exited" | "pty.deleted" | "persistent-pty.added" | "persistent-pty.removed" | "persistent-pty.updated" | "shell.created" | "shell.exited" | "shell.deleted" | "experimental.job.updated" | "form.created" | "form.replied" | "form.cancelled" | "websearch.updated" | "experimental.push.updated" | "artifact.updated" | "session.status" | "session.idle" | "tui.prompt.append" | "tui.command.execute" | "tui.toast.show" | "tui.session.select" | "installation.updated" | "installation.update-available" | "vcs.branch.updated" | "mcp.status.changed" | "mcp.resources.changed" | "experimental.mcp.event") | string) }?,
        }?) -> (nil, string?),
    },
    experimental: {
        artifacts: {
            create: (input: {
                location: { directory: string? }?,
                title: string,
                files: { [string]: string },
                entry: string?,
                provider: string?,
                sessionID: SessionID?,
            }) -> ({
                location: LocationPublicRef,
                data: ArtifactInfo,
            }?, string?),
            delete: (input: {
                artifactID: string,
                location: { directory: string? }?,
            }) -> (nil, string?),
            get: (input: {
                artifactID: string,
                location: { directory: string? }?,
            }) -> ({
                location: LocationPublicRef,
                data: ArtifactContent,
            }?, string?),
            list: (input: {
                location: { directory: string? }?,
                sessionID: string?,
                provider: string?,
            }?) -> ({
                location: LocationPublicRef,
                data: { ArtifactInfo },
            }?, string?),
            providers: (input: {
                location: { directory: string? }?,
            }?) -> ({
                location: LocationPublicRef,
                data: { ArtifactProvider },
            }?, string?),
            update: (input: {
                artifactID: string,
                location: { directory: string? }?,
                title: string?,
                files: { [string]: string },
                entry: string?,
                sessionID: SessionID?,
            }) -> ({
                location: LocationPublicRef,
                data: ArtifactInfo,
            }?, string?),
            view: (input: {
                artifactID: string,
                location: { directory: string? }?,
                path: string,
            }) -> (string?, string?),
        },
        automation: {
            create: (input: {
                sessionID: SessionID?,
                directory: string?,
                name: string,
                trigger: AutomationTrigger,
                action: AutomationActionInput,
                expires: string?,
            }) -> (AutomationInfo?, string?),
            delete: (input: {
                automationID: string,
            }) -> (nil, string?),
            get: (input: {
                automationID: string,
            }) -> (AutomationInfo?, string?),
            list: (input: {
                sessionID: string?,
                directory: string?,
            }?) -> ({ AutomationInfo }?, string?),
            pause: (input: {
                automationID: string,
            }) -> (AutomationInfo?, string?),
            resume: (input: {
                automationID: string,
            }) -> (AutomationInfo?, string?),
        },
        blob: {
            get: (input: {
                id: string,
            }) -> (string?, string?),
        },
        browser: {
            tunnel: (input: {}?) -> (boolean?, string?),
        },
        config: {
            update: (input: {
                shell: string?,
            }) -> (nil, string?),
        },
        file: {
            unwatch: (input: {
                location: { directory: string? }?,
                path: string,
            }) -> (nil, string?),
            watch: (input: {
                location: { directory: string? }?,
                path: string,
            }) -> (nil, string?),
            write: (input: {
                location: { directory: string? }?,
                path: string,
                payload: string,
            }) -> ({
                location: LocationPublicRef,
                data: FileSystemWrite,
            }?, string?),
        },
        flag: {
            get: (input: {
                location: { directory: string? }?,
            }?) -> ({
                location: LocationPublicRef,
                data: { [string]: boolean },
            }?, string?),
        },
        generate: {
            decisions: (input: {
                model: ModelRef,
                input: { GenerateDecisionPart },
                questions: { GenerateDecisionQuestion },
            }) -> (GenerateDecisionResult?, string?),
            image: (input: {
                model: ModelRef,
                prompt: string,
                images: { GenerateFile }?,
                n: number?,
                aspect: GenerateImageAspect?,
                resolution: GenerateImageResolution?,
            }) -> (GenerateImageResult?, string?),
            text: (input: {
                prompt: string,
                model: ModelRef?,
            }) -> ({
                text: string,
            }?, string?),
            video: {
                create: (input: {
                    model: ModelRef,
                    prompt: string,
                    start: GenerateImageFile?,
                    ["end"]: GenerateImageFile?,
                    references: { GenerateFile }?,
                    duration: number?,
                    aspect: GenerateVideoAspect?,
                    resolution: GenerateVideoResolution?,
                    sound: boolean?,
                }) -> (GenerateVideoRunning?, string?),
                get: (input: {
                    id: string,
                }) -> (GenerateVideoJob?, string?),
            },
        },
        integration: {
            wellknown: {
                add: (input: {
                    location: { directory: string? }?,
                    url: string,
                }) -> (nil, string?),
            },
        },
        job: {
            cancel: (input: {
                id: string,
            }) -> (nil, string?),
            list: (input: {
                sessionID: string?,
                kind: ("shell" | "subagent" | "image" | "video" | "codemode")?,
                status: ("running" | "completed" | "error" | "cancelled")?,
                descendants: boolean?,
            }?) -> ({ JobInfo }?, string?),
        },
        machine: {
            add: (input: {
                name: string,
                reach: { MachineReach },
                replace: boolean?,
            }) -> (MachineInvite?, string?),
            list: (input: {}?) -> ({ MachineInfo }?, string?),
            remove: (input: {
                name: string,
            }) -> (nil, string?),
        },
        mcp: {
            add: (input: {
                server: string,
                location: { directory: string? }?,
                config: (McpLocalConfigEncoded | McpRemoteConfigEncoded),
            }) -> (nil, string?),
            client: {
                token: (input: {
                    location: { directory: string? }?,
                    name: string,
                    ["x-opencode-ticket"]: string?,
                }) -> ({
                    location: LocationPublicRef,
                    data: PtyTicketConnectToken,
                }?, string?),
            },
            connect: (input: {
                server: string,
                location: { directory: string? }?,
            }) -> (nil, string?),
            disconnect: (input: {
                server: string,
                location: { directory: string? }?,
            }) -> (nil, string?),
            remove: (input: {
                server: string,
                location: { directory: string? }?,
            }) -> (nil, string?),
        },
        media: {
            get: (input: {
                hash: string,
            }) -> (string?, string?),
        },
        migration: {
            v1: {
                status: (input: {}?) -> (({
                    status: ("required" | "completed"),
                } | {
                    status: "running",
                    progress: {
                        label: string,
                        numerator: number?,
                        denominator: number?,
                    },
                } | {
                    status: "error",
                    error: string,
                })?, string?),
            },
        },
        persistentPty: {
            connectToken: (input: {
                ptyID: string,
                ["x-opencode-ticket"]: string?,
            }) -> (PtyTicketConnectToken?, string?),
            create: (input: {
                sessionID: string,
                command: string?,
                args: { string },
                cwd: string?,
                title: string,
                env: { [string]: string },
                size: {
                    cols: number,
                    rows: number,
                }?,
            }) -> (PersistentPtyInfo?, string?),
            get: (input: {
                ptyID: string,
            }) -> (PersistentPtyInfo?, string?),
            handoff: (input: {}?) -> ({
                handoff: PersistentPtyHandoff?,
            }?, string?),
            list: (input: {
                sessionID: string,
            }) -> ({ PersistentPtyInfo }?, string?),
            read: (input: {
                sessionID: string,
                lines: number?,
            }) -> ((PersistentPtyReadResult)?, string?),
            remove: (input: {
                ptyID: string,
            }) -> (nil, string?),
            shutdown: (input: {}?) -> (nil, string?),
            snapshot: (input: {
                ptyID: string,
            }) -> (PersistentPtySnapshot?, string?),
            update: (input: {
                ptyID: string,
                attachmentID: string?,
                size: {
                    cols: number,
                    rows: number,
                }?,
                title: string?,
            }) -> (PersistentPtyInfo?, string?),
        },
        push: {
            device: {
                register: (input: {
                    deviceID: string,
                    callbackURL: string,
                    expiresAt: number,
                    publicKey: string,
                    platform: PushPlatform,
                    name: string,
                    settings: PushDeviceSettings?,
                }) -> (PushRegistered?, string?),
                remove: (input: {
                    deviceID: string,
                }) -> (nil, string?),
                session: {
                    remove: (input: {
                        deviceID: string,
                        sessionID: string,
                    }) -> (nil, string?),
                    set: (input: {
                        deviceID: string,
                        sessionID: string,
                        level: PushLevel,
                        ["until"]: number?,
                    }) -> (PushBell?, string?),
                },
                update: (input: {
                    deviceID: string,
                    paused: boolean?,
                    settings: PushDeviceSettings?,
                }) -> (PushDevice?, string?),
            },
            get: (input: {}?) -> (PushInfo?, string?),
            session: {
                remove: (input: {
                    sessionID: string,
                }) -> (nil, string?),
                set: (input: {
                    sessionID: string,
                    level: PushLevel,
                    ["until"]: number?,
                }) -> (PushBell?, string?),
            },
            settings: {
                set: (input: {
                    paused: boolean,
                    ["until"]: number?,
                }) -> (PushSettings?, string?),
            },
        },
        session: {
            export: (input: {
                sessionID: string,
                sanitize: boolean?,
            }) -> (SessionTransferData?, string?),
            import: (input: {
                info: SessionInfo,
                messages: { any },
                location: LocationPublicRef?,
            }) -> (SessionInfo?, string?),
            instructions: {
                entry: {
                    list: (input: {
                        sessionID: string,
                    }) -> ({ InstructionEntryInfo }?, string?),
                    put: (input: {
                        sessionID: string,
                        key: string,
                        value: any,
                    }) -> (nil, string?),
                    remove: (input: {
                        sessionID: string,
                        key: string,
                    }) -> (nil, string?),
                },
            },
            log: (input: {
                sessionID: string,
                after: number?,
                follow: boolean?,
            }) -> (nil, string?),
            skill: (input: {
                sessionID: string,
                id: SkillID,
                resume: boolean?,
            }) -> (nil, string?),
            stats: (input: {
                from: number?,
                to: number?,
                project: string?,
                timezone: string?,
                tools: ("none" | "summary" | "detail")?,
            }?) -> (SessionStatsInfo?, string?),
            wait: (input: {
                sessionID: string,
            }) -> (nil, string?),
        },
        skill: {
            file: (input: {
                skillID: string,
                location: { directory: string? }?,
                path: string,
            }) -> (string?, string?),
        },
        space: {
            reset: (input: {}?) -> (nil, string?),
            subscribe: (input: {
                stream: string,
                spaces: { {
                    space: SpaceName,
                    cursor: SpaceCursor1,
                } },
            }) -> (nil, string?),
            sync: (input: {
                spaces: { {
                    space: SpaceName,
                    cursor: SpaceCursor1?,
                } },
            }) -> ({
                pages: { SpacePage },
            }?, string?),
            unsubscribe: (input: {
                stream: string,
                spaces: { SpaceName },
            }) -> (nil, string?),
            write: (input: {
                changes: { SpaceChange },
            }) -> ({
                spaces: { {
                    space: SpaceName,
                    revision: SpaceRevision,
                    cursor: SpaceCursor,
                } },
            }?, string?),
        },
        usage: {
            go: (input: {
                location: { directory: string? }?,
            }?) -> ({
                location: LocationPublicRef,
                data: UsageLimitsGoConnection?,
            }?, string?),
            limits: (input: {
                location: { directory: string? }?,
            }?) -> ({
                location: LocationPublicRef,
                data: UsageLimitsInfo?,
            }?, string?),
        },
        voice: {
            models: (input: {}?) -> ({
                models: { VoiceModel },
                default: string?,
            }?, string?),
            session: (input: {
                model: string,
                session: { [string]: any }?,
                transport: VoiceTransportInput,
            }) -> ({
                transport: VoiceTransport,
            }?, string?),
        },
    },
    file: {
        find: (input: {
            location: { directory: string? }?,
            query: string,
            type: ("file" | "directory")?,
            limit: number?,
        }) -> ({
            location: LocationPublicRef,
            data: { FileSystemEntry },
        }?, string?),
        list: (input: {
            location: { directory: string? }?,
            path: string?,
        }?) -> ({
            location: LocationPublicRef,
            data: { FileSystemEntry },
        }?, string?),
        read: (input: {
            location: { directory: string? }?,
            path: string,
        }) -> (string?, string?),
    },
    form: {
        list: (input: {
            location: { directory: string? }?,
        }?) -> ({
            location: LocationPublicRef,
            data: { FormInfo },
        }?, string?),
    },
    integration: {
        command: {
            cancel: (input: {
                integrationID: string,
                attemptID: string,
                location: { directory: string? }?,
            }) -> (nil, string?),
            connect: (input: {
                integrationID: string,
                location: { directory: string? }?,
                methodID: IntegrationMethodID,
                label: string?,
            }) -> ({
                location: LocationPublicRef,
                data: IntegrationCommandAttempt,
            }?, string?),
            status: (input: {
                integrationID: string,
                attemptID: string,
                location: { directory: string? }?,
            }) -> ({
                location: LocationPublicRef,
                data: IntegrationCommandAttemptStatus,
            }?, string?),
        },
        connect: {
            external: (input: {
                integrationID: string,
                location: { directory: string? }?,
                methodID: IntegrationMethodID,
                answer: FormAnswer?,
                label: string?,
            }) -> (nil, string?),
            key: (input: {
                integrationID: string,
                location: { directory: string? }?,
                key: string,
                answer: FormAnswer?,
                label: string?,
            }) -> (nil, string?),
        },
        get: (input: {
            integrationID: string,
            location: { directory: string? }?,
        }) -> ({
            location: LocationPublicRef,
            data: IntegrationInfo,
        }?, string?),
        list: (input: {
            location: { directory: string? }?,
        }?) -> ({
            location: LocationPublicRef,
            data: { IntegrationInfo },
        }?, string?),
        oauth: {
            cancel: (input: {
                integrationID: string,
                attemptID: string,
                location: { directory: string? }?,
            }) -> (nil, string?),
            complete: (input: {
                integrationID: string,
                attemptID: string,
                location: { directory: string? }?,
                code: string?,
            }) -> (nil, string?),
            connect: (input: {
                integrationID: string,
                location: { directory: string? }?,
                methodID: IntegrationMethodID,
                answer: FormAnswer?,
                label: string?,
            }) -> ({
                location: LocationPublicRef,
                data: IntegrationAttemptEncoded,
            }?, string?),
            status: (input: {
                integrationID: string,
                attemptID: string,
                location: { directory: string? }?,
            }) -> ({
                location: LocationPublicRef,
                data: IntegrationAttemptStatus,
            }?, string?),
        },
    },
    location: {
        get: (input: {
            location: { directory: string? }?,
        }?) -> (LocationPublicInfo?, string?),
        reload: (input: {}?) -> (nil, string?),
    },
    mcp: {
        list: (input: {
            location: { directory: string? }?,
        }?) -> ({
            location: LocationPublicRef,
            data: { McpServer },
        }?, string?),
        resource: {
            catalog: (input: {
                location: { directory: string? }?,
            }?) -> ({
                location: LocationPublicRef,
                data: McpResourceCatalog,
            }?, string?),
        },
    },
    message: {
        list: (input: {
            sessionID: string,
            limit: number?,
            order: ("asc" | "desc")?,
            cursor: string?,
            type: ("agent-switched" | "model-switched" | "location-switched" | "user" | "synthetic" | "system" | "skill" | "shell" | "assistant" | "compaction" | "idle")?,
        }) -> (SessionMessagesResponse?, string?),
    },
    model: {
        default: (input: {
            location: { directory: string? }?,
        }?) -> ({
            location: LocationPublicRef,
            data: ModelInfo?,
        }?, string?),
        list: (input: {
            location: { directory: string? }?,
            types: { (("chat" | "decision" | "image" | "video" | "realtime" | "embedding" | "transcription") | string) }?,
        }?) -> ({
            location: LocationPublicRef,
            data: { ModelInfo },
        }?, string?),
    },
    permission: {
        create: (input: {
            sessionID: string,
            id: PermissionID?,
            action: string,
            resources: { string },
            save: { string }?,
            metadata: { [string]: any }?,
            source: PermissionSource?,
            agent: AgentID?,
        }) -> ({
            id: PermissionID,
            effect: PermissionEffect,
        }?, string?),
        get: (input: {
            sessionID: string,
            requestID: string,
        }) -> (PermissionRequest?, string?),
        list: (input: {
            sessionID: string,
        }) -> ({ PermissionRequest }?, string?),
        reply: (input: {
            sessionID: string,
            requestID: string,
            decision: PermissionReply,
            message: string?,
        }) -> (nil, string?),
        request: {
            list: (input: {
                location: { directory: string? }?,
            }?) -> ({
                location: LocationPublicRef,
                data: { PermissionRequest },
            }?, string?),
        },
        saved: {
            list: (input: {
                projectID: string?,
            }?) -> ({ PermissionSavedInfo }?, string?),
            remove: (input: {
                id: string,
            }) -> (nil, string?),
            update: (input: {
                id: string,
                action: string?,
                resource: string?,
            }) -> (PermissionSavedInfo?, string?),
        },
    },
    plugin: {
        check: (input: {
            location: { directory: string? }?,
            target: string?,
        }?) -> ({
            location: LocationPublicRef,
            data: { PluginInfo },
        }?, string?),
        gui: (input: {
            location: { directory: string? }?,
            id: string,
        }) -> ({
            location: LocationPublicRef,
            data: PluginGuiBundle,
        }?, string?),
        list: (input: {
            location: { directory: string? }?,
        }?) -> ({
            location: LocationPublicRef,
            data: { PluginInfo },
        }?, string?),
        update: (input: {
            location: { directory: string? }?,
            targets: { string },
        }) -> (nil, string?),
    },
    project: {
        list: (input: {
            archived: boolean?,
        }?) -> ({ Project }?, string?),
        update: (input: {
            projectID: string,
            canonical: AbsolutePath?,
            name: string?,
            icon: ProjectIcon?,
            commands: ProjectCommands?,
        }) -> (Project?, string?),
    },
    provider: {
        get: (input: {
            providerID: string,
            location: { directory: string? }?,
        }) -> ({
            location: LocationPublicRef,
            data: ProviderInfo,
        }?, string?),
        list: (input: {
            location: { directory: string? }?,
        }?) -> ({
            location: LocationPublicRef,
            data: { ProviderInfo },
        }?, string?),
    },
    pty: {
        connect: {
            token: (input: {
                ptyID: string,
                location: { directory: string? }?,
                ["x-opencode-ticket"]: string?,
            }) -> ({
                location: LocationPublicRef,
                data: PtyTicketConnectToken,
            }?, string?),
        },
        create: (input: {
            location: { directory: string? }?,
            command: string?,
            args: { string }?,
            cwd: string?,
            title: string?,
            env: { [string]: string }?,
        }?) -> ({
            location: LocationPublicRef,
            data: Pty,
        }?, string?),
        get: (input: {
            ptyID: string,
            location: { directory: string? }?,
        }) -> ({
            location: LocationPublicRef,
            data: Pty,
        }?, string?),
        list: (input: {
            location: { directory: string? }?,
        }?) -> ({
            location: LocationPublicRef,
            data: { Pty },
        }?, string?),
        remove: (input: {
            ptyID: string,
            location: { directory: string? }?,
        }) -> (nil, string?),
        update: (input: {
            ptyID: string,
            location: { directory: string? }?,
            title: string?,
            size: {
                rows: number,
                cols: number,
            }?,
        }) -> ({
            location: LocationPublicRef,
            data: Pty,
        }?, string?),
    },
    reference: {
        list: (input: {
            location: { directory: string? }?,
        }?) -> ({
            location: LocationPublicRef,
            data: { ReferenceInfo },
        }?, string?),
    },
    rpc: {
        call: (input: {
            rpcID: string,
            method: string,
            location: { directory: string? }?,
            input: any?,
        }) -> (RpcOutput?, string?),
    },
    server: {
        connect: (input: {
            code: string,
        }) -> (PairingSession?, string?),
        info: (input: {}?) -> (ServerInfo?, string?),
        pair: (input: {}?) -> (PairingCode?, string?),
    },
    session: {
        active: (input: {}?) -> ({ [string]: any }?, string?),
        background: (input: {
            sessionID: string,
        }) -> (nil, string?),
        command: (input: {
            sessionID: string,
            name: string,
            text: string,
            files: { PromptInputFileAttachment }?,
            agents: { PromptAgentAttachment }?,
            skills: { PromptInputSkillAttachment }?,
            delivery: SessionInboxDelivery?,
        }) -> (nil, string?),
        compact: (input: {
            sessionID: string,
            id: SessionMessageID?,
            delivery: SessionInboxDelivery?,
        }) -> (SessionInboxCompaction?, string?),
        context: (input: {
            sessionID: string,
        }) -> ({ SessionMessageInfo }?, string?),
        create: (input: {
            id: SessionID?,
            parentID: SessionID?,
            title: string?,
            agent: AgentID?,
            model: ModelRef?,
            location: LocationPublicRef?,
            metadata: SessionMetadata?,
            permissions: PermissionRuleset?,
        }?) -> (SessionInfo?, string?),
        diff: (input: {
            sessionID: string,
            from: string?,
            to: string?,
            context: number?,
        }) -> ({ FileDiffInfo }?, string?),
        environment: (input: {
            sessionID: string,
            variables: { [string]: string },
        }) -> (nil, string?),
        fork: (input: {
            sessionID: string,
            before: SessionMessageID?,
        }) -> (SessionInfo?, string?),
        form: {
            cancel: (input: {
                sessionID: string,
                formID: string,
                message: string?,
            }) -> (nil, string?),
            create: (input: {
                sessionID: string,
                id: FormID?,
                title: string,
                metadata: FormMetadata?,
                fields: FormFields,
            }) -> (FormInfo?, string?),
            get: (input: {
                sessionID: string,
                formID: string,
            }) -> (FormDetail?, string?),
            list: (input: {
                sessionID: string,
            }) -> ({ FormInfo }?, string?),
            reply: (input: {
                sessionID: string,
                formID: string,
                answer: FormAnswer,
            }) -> (nil, string?),
        },
        generate: (input: {
            sessionID: string,
            prompt: string,
        }) -> ({
            text: string,
            tokens: TokenUsageInfo,
            cost: MoneyUSD,
        }?, string?),
        get: (input: {
            sessionID: string,
        }) -> (SessionInfo?, string?),
        inbox: {
            cancel: (input: {
                sessionID: string,
                inboxID: string,
            }) -> (nil, string?),
            list: (input: {
                sessionID: string,
            }) -> ({ SessionInboxInfo }?, string?),
            update: (input: {
                sessionID: string,
                inboxID: string,
                delivery: SessionInboxDelivery,
            }) -> (nil, string?),
        },
        interrupt: (input: {
            sessionID: string,
            resume: boolean?,
        }) -> (SessionInterruptResponse?, string?),
        list: (input: {
            limit: number?,
            order: ("asc" | "desc")?,
            search: string?,
            parentID: string?,
            archived: boolean?,
            directory: string?,
            project: string?,
            subpath: string?,
            cursor: string?,
        }?) -> (SessionsResponse?, string?),
        message: {
            get: (input: {
                sessionID: string,
                messageID: string,
            }) -> (SessionMessageInfo?, string?),
        },
        move: (input: {
            sessionID: string,
            directory: AbsolutePath,
            delivery: SessionInboxDelivery?,
        }) -> (nil, string?),
        prompt: (input: {
            sessionID: string,
            id: SessionMessageID?,
            text: string,
            files: { PromptInputFileAttachment }?,
            agents: { PromptAgentAttachment }?,
            skills: { PromptInputSkillAttachment }?,
            metadata: { [string]: any }?,
            delivery: SessionInboxDelivery?,
            resume: boolean?,
        }) -> (SessionInboxUser?, string?),
        remove: (input: {
            sessionID: string,
        }) -> (nil, string?),
        revert: {
            clear: (input: {
                sessionID: string,
            }) -> (nil, string?),
            commit: (input: {
                sessionID: string,
            }) -> (nil, string?),
            stage: (input: {
                sessionID: string,
                messageID: SessionMessageID,
                files: boolean?,
            }) -> (SessionRevert?, string?),
        },
        shell: (input: {
            sessionID: string,
            id: SessionMessageID?,
            command: string,
        }) -> (nil, string?),
        switchAgent: (input: {
            sessionID: string,
            agent: AgentID,
        }) -> (nil, string?),
        switchModel: (input: {
            sessionID: string,
            model: ModelRef,
        }) -> (nil, string?),
        synthetic: (input: {
            sessionID: string,
            id: SessionMessageID?,
            text: string,
            description: string?,
            metadata: { [string]: any }?,
            delivery: SessionInboxDelivery?,
            resume: boolean?,
        }) -> (SessionInboxSynthetic?, string?),
        update: (input: {
            sessionID: string,
            title: string?,
            metadata: SessionMetadata?,
            permissions: PermissionRuleset?,
            archived: boolean?,
        }) -> (nil, string?),
        view: (input: {
            sessionID: string,
            idle: number,
        }) -> (nil, string?),
    },
    shell: {
        create: (input: {
            location: { directory: string? }?,
            command: string,
            cwd: string?,
            timeout: number?,
            metadata: { [string]: any }?,
        }) -> ({
            location: LocationPublicRef,
            data: ShellInfo,
        }?, string?),
        get: (input: {
            id: string,
            location: { directory: string? }?,
        }) -> ({
            location: LocationPublicRef,
            data: ShellInfo,
        }?, string?),
        list: (input: {
            location: { directory: string? }?,
        }?) -> ({
            location: LocationPublicRef,
            data: { ShellInfo },
        }?, string?),
        output: (input: {
            id: string,
            location: { directory: string? }?,
            cursor: number?,
            limit: number?,
        }) -> ({
            location: LocationPublicRef,
            data: {
                output: string,
                cursor: number,
                size: number,
                truncated: boolean,
            },
        }?, string?),
        remove: (input: {
            id: string,
            location: { directory: string? }?,
        }) -> (nil, string?),
    },
    skill: {
        list: (input: {
            location: { directory: string? }?,
        }?) -> ({
            location: LocationPublicRef,
            data: { SkillInfo },
        }?, string?),
    },
    vcs: {
        base: (input: {
            location: { directory: string? }?,
        }?) -> ({
            location: LocationPublicRef,
            data: VcsBase?,
        }?, string?),
        branch: {
            list: (input: {
                location: { directory: string? }?,
                search: string?,
                limit: number?,
            }?) -> ({
                location: LocationPublicRef,
                data: VcsBranchList,
            }?, string?),
        },
        diff: (input: {
            location: { directory: string? }?,
            mode: ("working" | "branch" | "committed"),
            base: string?,
            context: number?,
            untracked: ("files" | "folders")?,
        }) -> ({
            location: LocationPublicRef,
            data: { FileDiffInfo },
        }?, string?),
        get: (input: {
            location: { directory: string? }?,
        }?) -> ({
            location: LocationPublicRef,
            data: VcsInfo,
        }?, string?),
        init: (input: {
            location: { directory: string? }?,
            provider: string?,
        }?) -> (nil, string?),
        status: (input: {
            location: { directory: string? }?,
        }?) -> ({
            location: LocationPublicRef,
            data: { VcsFileStatus },
        }?, string?),
    },
    websearch: {
        providers: (input: {
            location: { directory: string? }?,
        }?) -> ({
            location: LocationPublicRef,
            data: { WebSearchProvider },
        }?, string?),
        query: (input: {
            location: { directory: string? }?,
            query: string,
            providerID: WebSearchID?,
        }) -> ({
            location: LocationPublicRef,
            data: WebSearchResponseEncoded,
        }?, string?),
    },
    worktree: {
        create: (input: {
            projectID: ProjectID,
            from: AbsolutePath?,
            branch: string?,
            directory: AbsolutePath?,
            name: string?,
        }) -> (WorktreeInfo?, string?),
        list: (input: {
            projectID: string,
        }) -> (WorktreeList?, string?),
        refresh: (input: {
            projectID: ProjectID,
        }) -> (nil, string?),
        remove: (input: {
            projectID: ProjectID,
            directory: AbsolutePath,
            force: boolean,
        }) -> (nil, string?),
    },
}

--- `require("@opencode/plugin")`.
export type Plugin = {
    contract: string,
    client: Client,
    IMAGE_BOUNDS: string,
    FOCUS_INPUT: string,
    FENCE_NODE: string,
    KEEP: Render,
    HIDE: Render,
    define: (setup: (setup: Setup) -> ()) -> any,
    span: (text: string, style: SpanStyle?) -> Span,
    text: (content: string | { Span }, props: TextProps?) -> Node,
    column: (children: { Node }, props: BoxProps?) -> Node,
    row: (children: { Node }, props: BoxProps?) -> Node,
    --- A slot or route render of `node`; the host draws it with the node kinds a render takes (box, text, slot,
    --- markdown and spinner).
    show: (node: Node) -> Render,
    command: (name: string, input: string?) -> Action,
    click: (name: string, input: string?) -> Click,
    --- Starts `f(...)` as a task of its own, from a handler, a task or setup; it runs until it ends or waits.
    spawn: (f: (...any) -> ...any, ...any) -> (),
    --- Runs each function as a task and waits until all ended: their values in order, or `nil` and the error of the
    --- first that returned one. Only a task waits.
    all: (fns: { () -> (any, any) }) -> ({ any }?, any),
    --- JSON with the host's reader and writer, under the bounds of any value a plugin hands the host.
    json: Json,
    --- Sorts `list` in place by `less` (`a < b` when left out) and returns it; equal items keep their order.
    sort: <T>(list: { T }, less: ((T, T) -> boolean)?) -> { T },
    --- Waits `ms` milliseconds on the host's clock, at least 20 and a part of one kept (`math.huge` waits for ever):
    --- `true`, or `nil` and why the host took no timer (32 of the plugin wait) or cancelled it (`"cancelled"`). Only
    --- a task waits.
    sleep: (ms: number) -> (boolean?, string?),
    --- Runs `f(host)` every `ms` milliseconds in a task of its own, until `f` returns `false` or a sleep fails.
    --- Started from a mount's handler, it is that mount's and ends when the mount closes.
    every: (ms: number, f: (host: Host) -> boolean?) -> (),
}

--- `plugin.json`. A table is a JSON array when its keys are `1..n` (an empty table is one), an object otherwise, and a
--- table with the object marker is an object whatever its keys; a table the host builds from JSON carries its marker.
export type Json = {
    --- JSON's `null` where a table must hold it: what `decode` gives with `{ null = true }`.
    null: any,
    --- `text` as a value and `nil`, or `nil` and why. A `null` field is left out and a `null` item is `null`; with
    --- `{ null = true }` every `null` is `null`.
    decode: (text: string, options: { null: boolean? }?) -> (any, string?),
    --- The JSON text of `value`: an object's keys in byte order (a number key as its text), an array's items in order,
    --- the same in every VM. `pairs` walks a table in no set order, which differs from VM to VM.
    encode: (value: any) -> string,
    --- Whether table `t` goes to JSON as an array.
    isArray: (t: { [any]: any }) -> boolean,
    --- Marks `t` an array, and returns it: an empty one goes as `[]`.
    array: <T>(t: T) -> T,
    --- Marks `t` an object, and returns it: an empty one goes as `{}`.
    object: <T>(t: T) -> T,
}

local plugin: Plugin = nil :: any
return plugin
