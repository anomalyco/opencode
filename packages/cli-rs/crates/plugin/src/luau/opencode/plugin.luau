--!strict
-- OpenCode plugin contract 2.0: the types of a Luau plugin, as the module `@opencode/plugin`.
-- Generated from crates/plugin-abi/schema/v2.json by `bun run generate` (script/gen/plugin-types-luau.ts). Do not edit.
--
-- The host registers the real module; this file only types it for luau-analyze and luau-lsp. Point the alias
-- `opencode` at this directory in a `.luaurc` beside your plugin or above it:
--   { "languageMode": "strict", "aliases": { "opencode": "<path to crates/plugin/src/luau/opencode>" } }
-- then `luau-analyze --formatter=gnu <your .luau files>` or open the plugin in luau-lsp.

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
}

export type BorderStyle = ("single" | "double" | "rounded" | "heavy")

export type Button = ("left" | "middle" | "right")

export type Cause = ("first" | "resized" | "version" | "animate")

--- What changed since a surface's last view, as a 1.x render hears it.
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
    type: any,
    id: any,
    name: any,
    executed: any,
    native: any,
    state: (any | {
        status: "completed",
        input: { [string]: any },
        content: { any },
        metadata: { [string]: any }?,
    }),
    time: any,
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
}))

export type DiffView = ("unified" | "split")

--- Where a dropped drag started.
export type Dragged = {
    surface: string,
    node: string,
}

--- What a `draw` request answers: bytes, not JSON, and none to keep the list the host holds. A version byte (1), then records: an operation byte, the payload's length as a little-endian u32, and the payload. Every integer is little-endian; coordinates are cells from the canvas's top left corner. A color is r, g, b, a bytes. A style is 10 bytes: flags (1 a foreground, 2 a background), attributes (bold 1, dim 2, italic 4, underline 8, inverse 16, strikethrough 32), then the foreground and the background colors, each written whether it is set or not. A border is 0 single, 1 double, 2 rounded, 3 heavy. A reader skips a record of an operation it does not know, which is how a later 2.x adds one; a list the host cannot read fails the plugin, and one over a limit shows a placeholder.
export type DrawList = any

--- A span of time in whole seconds and nanoseconds, as serde writes `std::time::Duration`.
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
    min_width_zero: boolean?,
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

--- What `create` answers: everything the plugin registered in its setup.
export type Manifest = {
    id: string,
    commands: { Command },
    fences: { string },
    slots: { SlotClaim },
    routes: { string },
    storage: { string },
    render: number?,
    events: { { string } }?,
    render_routes: { string }?,
    wake: boolean?,
    route_mounts: { string }?,
    fence_gone: boolean?,
    deltas: boolean?,
    plugins: boolean?,
    surfaces: { SurfaceClaim }?,
    claims: { ClaimEntry }?,
    messages: boolean?,
    layers: { Layer }?,
    searches: { string }?,
}

--- A session of a family.
export type Member = {
    id: string,
    status: SessionStatus,
    updated: number,
    parent: string?,
}

--- What a 2.x library's `describe` answers: its nonempty ID, which the host reads before any `create`.
export type Metadata = {
    id: string,
    version: string?,
    requires: { string }?,
}

--- What a 1.x library's `describe` answers; the ID may be left out.
export type MetadataV1 = {
    version: string?,
    id: string?,
    requires: { string }?,
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

--- A panel dialog of a 1.x node body.
export type Panel = {
    key: string,
    title: { Span },
    body: V1Node,
    size: PanelSize?,
    subtitle: string?,
    actions: { PanelAction }?,
    binds: { PanelBind }?,
    bleed: boolean?,
    centered: boolean?,
    bare: boolean?,
    close: string?,
    height: number?,
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
    node: V1Node,
    type: "show",
})

--- A fence, with the index of its render.
export type RenderFence = (Fence & {
    index: number?,
})

--- A request the host sends a plugin's `call`.
export type Request = ({
    language: string,
    info: string,
    code: string,
    streaming: boolean,
    type: "fence",
} | {
    claim: number,
    session_id: string?,
    type: "slot",
} | {
    name: string,
    type: "route",
} | {
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
    event: any,
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
    events: { any },
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
    info: any,
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

--- A 1.x slot claim.
export type SlotClaim = {
    kind: SlotKind,
    path: string,
    render: boolean?,
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

--- A node of ABI 1.x, which a render and a dialog body draw.
export type V1Node = ({
    row: boolean?,
    gap: number?,
    padding: { number }?,
    justify: Justify?,
    align: Align?,
    bg: Color?,
    layout: Layout?,
    on_click: Click?,
    children: { V1Node }?,
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

-- The plugin's objects -------------------------------------------------------------------------------------------

--- What a render or a view reads; every read of one call sees one store snapshot.
export type Read = {
    themeMode: (self: Read) -> "dark" | "light",
    color: (self: Read, token: string) -> Rgba?,
    storageGet: (self: Read, key: string) -> any,
    session: (self: Read, id: string) -> Session?,
    sessions: (self: Read) -> { Session },
    family: (self: Read, id: string) -> Family,
    messages: (self: Read, id: string) -> { any },
    --- The inbox items of session `id` the server has not delivered yet, oldest first; empty while its inbox is not loaded.
    pending: (self: Read, id: string) -> { any },
    --- The models of `location`, or where the TUI works; `nil` while they are not loaded.
    models: (self: Read, location: LocationRef?) -> { any }?,
    --- The providers where the TUI works; `nil` while they are not loaded.
    providers: (self: Read) -> { any }?,
    --- The OpenCode Console workspace's usage limits; `nil` while they are not loaded.
    limits: (self: Read) -> any,
    model: (self: Read) -> any,
    info: (self: Read) -> Info,
    route: (self: Read) -> Route,
    interactive: (self: Read) -> boolean,
    shortcut: (self: Read, name: string) -> string?,
    dialogOpen: (self: Read, key: string) -> boolean,
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
}

--- The version a host serves the plugin: its major, its minor of that major, and its optional features.
export type Abi = { major: number, minor: number, features: { string } }

--- What a handler acts with: the reads, and effects, which wait until the outermost call returns. A render or a view
--- that calls an effect fails.
export type Host = {
    themeMode: (self: Read) -> "dark" | "light",
    color: (self: Read, token: string) -> Rgba?,
    storageGet: (self: Read, key: string) -> any,
    session: (self: Read, id: string) -> Session?,
    sessions: (self: Read) -> { Session },
    family: (self: Read, id: string) -> Family,
    messages: (self: Read, id: string) -> { any },
    --- The inbox items of session `id` the server has not delivered yet, oldest first; empty while its inbox is not loaded.
    pending: (self: Read, id: string) -> { any },
    --- The models of `location`, or where the TUI works; `nil` while they are not loaded.
    models: (self: Read, location: LocationRef?) -> { any }?,
    --- The providers where the TUI works; `nil` while they are not loaded.
    providers: (self: Read) -> { any }?,
    --- The OpenCode Console workspace's usage limits; `nil` while they are not loaded.
    limits: (self: Read) -> any,
    model: (self: Read) -> any,
    info: (self: Read) -> Info,
    route: (self: Read) -> Route,
    interactive: (self: Read) -> boolean,
    shortcut: (self: Read, name: string) -> string?,
    dialogOpen: (self: Read, key: string) -> boolean,
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
    storageSet: (self: Host, key: string, value: { [any]: any }) -> (),
    storageMerge: (self: Host, key: string, fields: { [string]: any }) -> (),
    dispatch: (self: Host, name: string, input: string?) -> (),
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
    --- A request's ID, or `nil` and why the host did not take it; its reply comes to `setup:onReply`.
    fetch: (self: Host, fetch: Fetch) -> (number?, string?),
    foreground: (self: Host, program: Foreground) -> (number?, string?),
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
export type CommandSpec = { name: string, title: string?, palette: boolean?, group: string?, slash: string?, keybind: string?, description: string?, arguments: boolean?, scope: Scope? }

--- A surface as `setup:surface` takes it.
export type SurfaceSpec = { name: string, place: SurfacePlace, layers: { Layer }?, mounts: boolean?, palette: boolean? }

--- What setup registers on; each method holds only while setup runs.
export type Setup = {
    id: string,
    --- The `options` of the plugin's `plugins` entry, decoded.
    options: any,
    host: Host,
    storageKey: (self: Setup, key: string) -> (),
    command: (self: Setup, command: CommandSpec, run: (host: Host, input: string?) -> ()) -> (),
    slot: (self: Setup, at: At, render: (read: Read, input: SlotInput, changed: Changed) -> Render?) -> (),
    --- Calls `run` as the host mounts the claim registered last at `at` (`true`, before it first renders) and as it
    --- unmounts it (`false`).
    onMount: (self: Setup, at: At, run: (host: Host, input: SlotInput, mounted: boolean) -> ()) -> (),
    route: (self: Setup, name: string, render: (read: Read, changed: Changed) -> Render?) -> (),
    onRouteMount: (self: Setup, name: string, run: (host: Host, mounted: boolean) -> ()) -> (),
    codeBlock: (self: Setup, language: string, render: (read: Read, fence: Fence) -> Fenced?) -> (),
    onEvent: (self: Setup, types: { string }, run: (host: Host, event: any) -> ()) -> (),
    onReply: (self: Setup, run: (host: Host, id: number, value: any, error: string?) -> ()) -> (),
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

--- `require("@opencode/plugin")`.
export type Plugin = {
    contract: string,
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
}

local plugin: Plugin = nil :: any
return plugin
