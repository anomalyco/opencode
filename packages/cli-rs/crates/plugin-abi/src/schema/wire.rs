//! The schema of the envelopes and replies of the C ABI (big-boi 14, carbon-13): what `describe` and `create` answer,
//! the requests each side sends and what each answers, and the binary list a draw answers. As in the parent, each
//! definition names every field and variant of its type, so a field or a variant added to one does not compile until
//! its schema has it.

use super::*;
use crate::claim::{self, FencePart, ToolPart};
use crate::interact::{self, Bind, Button, Dragged, Focused, Handled, Key, Layer, LayerScope, Pointer, PointerKind};
use crate::{
    Alert, Attention, Blob, Command, Composer, ComposerEdit, Confirm, ConfirmLabel, Dialog, ErrorDetails, Family,
    Fence, Fenced, Fetch, Foreground, Gutter, HostRequest, Image, ImageBounds, Images, Info, InputTo, KeymapActive,
    KeymapCommand, KeymapPending, KeymapSlash, Level, Manifest, Measure, Member, Metadata, Panel, PanelAction,
    PanelBind, PanelSize, PluginEntry, PluginOrigin, PluginStatus, Prompt, Render, RenderFence, Request, RequestId,
    Route, Scope, Select, SelectAction, SelectOption, Session, SessionStatus, SlotClaim, SlotKind, Sound, SoundName,
    SurfaceClaim, SurfacePlace, Tab, TabEdit, Toast, Unread, Variant, ViewReply, When,
};

/// The node tree of a render (`render`, `render-fence`, `render-route`) and of a dialog body, beside a surface's keyed
/// tree (`Node`).
type RenderNode = crate::Node;
type ClaimTarget = claim::Target;
type ClaimEntry = claim::Entry;
type ClaimPart = claim::Part;
type ToolState = claim::State;
type ClaimReply = claim::Reply;
type InputEvent = interact::Event;
type NodeRect = interact::Rect;
type OverlayAnchor = interact::Anchor;
type ScreenEdge = interact::Edge;
type Overlay = interact::Overlay;
type OpenPanel = interact::OpenPanel;

/// The definitions of the envelopes and replies, beside the parent's of the tree and the calls of P3.
pub(super) fn definitions() -> Vec<(&'static str, Value)> {
    vec![
        ("Metadata", {
            let _ = |value: &Metadata| {
                let Metadata { version: _, id: _, requires: _ } = value;
            };
            object(
                &[("id", json!({ "type": "string", "minLength": 1 }))],
                &[("version", nullable(string())), ("requires", array(string()))],
                None,
                "What a library's `describe` answers: its nonempty ID, which the host reads before any `create`.",
            )
        }),
        (
            "Manifest",
            object!(Manifest, "What `create` answers: everything the plugin registered in its setup.", {
                id: string(), commands: array(reference("Command")), fences: array(string()),
                slots: array(reference("SlotClaim")), routes: array(string()), storage: array(string()),
            } {
                events: array(array(string())), wake: boolean(), route_mounts: array(string()), fence_gone: boolean(),
                cancelled: boolean(), deltas: boolean(), plugins: boolean(),
                surfaces: array(reference("SurfaceClaim")), claims: array(reference("ClaimEntry")), messages: boolean(),
                layers: array(reference("Layer")), searches: array(string()),
            }),
        ),
        (
            "Command",
            object!(Command, "A command: in the palette, as a slash command, and on a keybind.", {
                name: string(), title: string(), palette: boolean(),
            } {
                group: nullable(string()), slash: nullable(string()), keybind: nullable(string()),
                description: nullable(string()), arguments: boolean(), scope: reference("Scope"),
                aliases: array(string()), enabled: boolean(),
            }),
        ),
        ("Scope", {
            let _ = |value: &Scope| match value {
                Scope::Global | Scope::Route(_) | Scope::Base => (),
            };
            described(
                json!({ "oneOf": [strings(&[Scope::Global, Scope::Base]), single("route", string())] }),
                "Where a command holds: everywhere, on one of the plugin's routes, or in the host's base mode.",
            )
        }),
        (
            "SlotClaim",
            object!(SlotClaim, "A slot claim, which a `render` draws.", { kind: reference("SlotKind"), path: string() } {
                mount: boolean(), size: boolean(),
            }),
        ),
        ("SlotKind", unit!(SlotKind { Prepend, Append, Before, After, Replace })),
        (
            "SurfaceClaim",
            object!(SurfaceClaim, "A surface of contract 2.0, without its view.", {
                name: string(), place: reference("SurfacePlace"),
            } {
                palette: boolean(), draw: boolean(), notify: array(reference("Notify")), layout: boolean(),
                handler: boolean(), layers: array(reference("Layer")), mounts: boolean(),
            }),
        ),
        (
            "SurfacePlace",
            tagged!(SurfacePlace, "Where a surface shows.", {
                Route { name: string() } { },
                Slot { kind: reference("SlotKind"), path: string() } { },
                Panel { name: string() } { },
                Overlay { name: string() } { },
            }),
        ),
        (
            "Layer",
            object!(Layer, "Keys a plugin takes while its scope holds.", { scope: reference("LayerScope") } {
                priority: int32(), mode: nullable(string()), keys: array(reference("Bind")), any: boolean(),
                paste: boolean(),
            }),
        ),
        ("LayerScope", {
            let _ = |value: &LayerScope| match value {
                LayerScope::Surface | LayerScope::Node(_) | LayerScope::Composer | LayerScope::Global => (),
            };
            described(
                json!({ "oneOf": [
                    strings(&[LayerScope::Surface, LayerScope::Composer, LayerScope::Global]),
                    single("node", string()),
                ] }),
                "Where a layer holds.",
            )
        }),
        (
            "Bind",
            object!(Bind, "One key of a layer.", { key: string(), name: string() } {
                title: nullable(string()), hold: boolean(), command: nullable(string()),
            }),
        ),
        (
            "ClaimEntry",
            object!(ClaimEntry, "A renderer claim, without its view.", { target: reference("ClaimTarget") } {
                palette: boolean(),
            }),
        ),
        ("ClaimTarget", {
            let _ = |value: &ClaimTarget| match value {
                ClaimTarget::Tool(_) | ClaimTarget::Fence(_) => (),
            };
            let target = |tag: &str| object(&[("name", string())], &[], Some(tag), "");
            described(json!({ "oneOf": [target("tool"), target("fence")] }), "What a claim draws.")
        }),
        (
            "Request",
            tagged!(Request, "A request the host sends a plugin's `call`.", {
                Command { name: string() } { input: nullable(string()) },
                Render { claim: uint64(), input: reference("SlotInput"), changed: reference("Changed") } { },
                Event { handler: uint64(), event: api("V2Event") } { },
                RenderRoute { name: string(), changed: reference("Changed") } { },
                Reply { id: reference("RequestId"), result: result() } { },
                Mount { claim: uint64(), input: reference("SlotInput"), mounted: boolean() } { },
                Wake { } { },
                RouteMount { name: string(), mounted: boolean() } { },
                FenceGone { key: uint64() } { },
                Cancelled { id: reference("RequestId") } { },
                Deltas { events: array(api("V2Event")) } { },
                View {
                    surface: uint64(), mount: reference("MountId"), input: reference("SurfaceInput"), next: uint64(),
                } { },
                Draw { surface: uint64(), mount: reference("MountId"), canvas: string(), frame: reference("Frame") } { },
                Claim {
                    claim: uint64(), mount: reference("MountId"), input: reference("SurfaceInput"),
                    part: reference("ClaimPart"), next: uint64(),
                } { },
                Unmount { mount: reference("MountId") } { },
                Message { message: string() } { },
                Layout { surface: uint64(), geometry: reference("Geometry") } { },
                Input { to: reference("InputTo"), event: reference("InputEvent") } { },
                Search { name: string(), query: string(), options: array(reference("SelectOption")) } { },
                Plugins { } { },
            }, newtype {
                RenderFence: reference("RenderFence"),
            }),
        ),
        ("RenderFence", {
            let _ = |value: &RenderFence| {
                let RenderFence { fence: _, index: _ } = value;
            };
            let index = object(&[], &[("index", nullable(uint64()))], None, "");
            described(json!({ "allOf": [reference("Fence"), index] }), "A fence, with the index of its render.")
        }),
        (
            "Fence",
            object!(Fence, "A Markdown code fence.", {
                language: string(), info: string(), code: string(), streaming: boolean(), closed: boolean(),
                key: uint64(),
            } { width: uint16() }),
        ),
        (
            "InputTo",
            tagged!(InputTo, "Whose handler an input request calls.", {
                Surface { surface: uint64() } { mount: nullable(reference("MountId")) },
                Layer { layer: uint64() } { },
            }),
        ),
        (
            "InputEvent",
            tagged!(InputEvent, "An event the host routes to a handler.", {
                Paste { text: string() } { },
                Hover { node: string(), inside: boolean() } { },
                Closed { surface: string() } { },
                Scroll { event: reference("ScrollEvent") } { },
                Change { node: string(), text: string() } { seq: uint64() },
                Submit { node: string(), text: string() } { },
                Mount { mount: reference("MountId"), mounted: boolean() } { slot: nullable(reference("SlotInput")) },
                #[cfg(feature = "next")]
                Later { } { },
            }, newtype {
                Key: reference("Key"),
                Pointer: reference("Pointer"),
            }),
        ),
        ("Key", object!(Key, "A key.", { key: string() } { bind: nullable(string()), text: nullable(string()) })),
        (
            "Pointer",
            object!(Pointer, "A pointer event on a node.", {
                node: string(), kind: reference("PointerKind"), x: int32(), y: int32(), screen_x: uint16(),
                screen_y: uint16(),
            } { button: nullable(reference("Button")), from: nullable(reference("Dragged")) }),
        ),
        ("PointerKind", unit!(PointerKind { Down, Up, Drag, WheelUp, WheelDown, Drop })),
        ("Button", unit!(Button { Left, Middle, Right })),
        ("Dragged", object!(Dragged, "Where a dropped drag started.", { surface: string(), node: string() } { })),
        (
            "ClaimPart",
            tagged!(
                ClaimPart,
                "A claimed part as it is now.",
                {},
                newtype { Tool: reference("ToolPart"), Fence: reference("FencePart") }
            ),
        ),
        (
            "ToolPart",
            object!(ToolPart, "A tool call in an assistant message.", {
                session: string(), message: string(), state: reference("ToolState"), permission: boolean(),
                tool: reference("ClaimTool"),
            } { }),
        ),
        ("ToolState", unit!(ToolState { Pending, Running, Completed, Error })),
        ("ClaimTool", claim_tool()),
        (
            "FencePart",
            object!(FencePart, "A fenced code block the transcript shows.", {
                language: string(), info: string(), code: string(), streaming: boolean(), closed: boolean(),
            } { }),
        ),
        (
            "SelectOption",
            object!(SelectOption, "A row of a select.", { title: string(), value: string() } {
                description: nullable(string()), footer: nullable(string()), category: nullable(string()),
                disabled: boolean(), footer_color: nullable(reference("Color")), gutter: nullable(reference("Gutter")),
                action: nullable(reference("Action")), toggle: nullable(string()), search_text: nullable(string()),
            }),
        ),
        ("Gutter", {
            let _ = |value: &Gutter| match value {
                Gutter::Spinner | Gutter::Span(_) => (),
            };
            described(
                json!({ "oneOf": [strings(&[Gutter::Spinner]), single("span", reference("Span"))] }),
                "What a row shows before its title.",
            )
        }),
        (
            "HostRequest",
            tagged!(HostRequest, "A request a plugin sends the host table's `call`.", {
                Log { level: reference("Level"), message: string() } { },
                Toast { variant: reference("Variant"), message: string() } {
                    title: nullable(string()), session: nullable(string()),
                },
                StorageGet { key: string() } { },
                StorageSet { key: string(), value: string() } { },
                OpenRoute { name: string() } { },
                StorageKey { key: string() } { },
                Color { token: string() } { },
                Session { id: string() } { },
                Family { id: string() } { },
                Messages { id: string() } { },
                Message { session: string(), message: string() } { },
                Models { } { location: nullable(reference("LocationRef")) },
                Model { } { },
                Limits { } { },
                Providers { } { },
                Info { } { },
                McpServers { } { location: nullable(reference("LocationRef")) },
                Integrations { } { location: nullable(reference("LocationRef")) },
                Vcs { } { location: nullable(reference("LocationRef")) },
                Route { } { },
                Dispatch { name: string() } { input: nullable(string()) },
                Navigate { route: reference("Route") } { },
                Dialog { dialog: reference("Dialog") } { },
                Copy { text: string() } { then: nullable(reference("Action")) },
                Interactive { } { },
                Shortcut { name: string() } { },
                DialogOpen { key: string() } { },
                StorageMerge { key: string(), fields: json_object() } { },
                Composer { } { },
                ComposerEdit { edit: reference("ComposerEdit") } { },
                Checkpoint { } { },
                Rollback { mark: uint64() } { },
                Variants { } { },
                SetVariant { } { variant: nullable(string()) },
                SetModel { provider: string(), model: string() } { },
                TabsEnabled { } { },
                Tabs { } { },
                Tab { edit: reference("TabEdit") } { },
                KeymapPending { } { },
                KeymapActive { } { },
                KeymapCommands { } { },
                Shortcuts { name: string() } { },
                Selection { } { },
                ClearSelection { } { },
                Timer { ms: uint64() } { },
                Title { title: string() } { },
                Theme { } { },
                Themes { } { },
                Plugins { } { },
                Setting { name: string() } { },
                ImageSize { bytes: string() } { },
                ImageBounds { } { },
                UtcOffset { at: int64() } { },
                Measure { text: string() } { },
                SetSetting { name: string(), value: any() } { },
                SetTheme { name: string() } { },
                InstallTheme { name: string(), theme: any() } { },
                Scroll { target: reference("Target"), verb: reference("Scroll") } { },
                ScrollState { target: reference("Target") } { },
                Anchors { target: reference("Target"), group: string() } { },
                TopAnchor { target: reference("Target"), group: string() } { inset: uint16() },
                Transcript { } { },
                ClosePanel { surface: string() } { },
                CloseOverlay { surface: string() } { },
                SetEnabled { name: string(), enabled: boolean() } { },
                Focus { node: string() } { },
                Blur { } { },
                SetMode { } { mode: nullable(string()) },
                ReleaseKeys { } { },
                Rect { node: string() } { },
                Focused { } { },
                InputMode { } { },
                Sessions { } { },
                Pending { id: string() } { },
            }, newtype {
                Attention: reference("Attention"),
                Fetch: reference("Fetch"),
                Foreground: reference("Foreground"),
                OpenPanel: reference("OpenPanel"),
                Overlay: reference("Overlay"),
            }),
        ),
        ("Level", unit!(Level { Debug, Info, Warn, Error })),
        ("Variant", unit!(Variant { Info, Success, Warning, Error })),
        (
            "Toast",
            object!(Toast, "A toast.", { variant: reference("Variant"), message: string() } {
                title: nullable(string()), session: nullable(string()),
            }),
        ),
        (
            "Attention",
            object!(Attention, "A notification and a sound.", { message: string() } {
                title: nullable(string()), notify: nullable(reference("When")), sound: nullable(reference("Sound")),
            }),
        ),
        ("When", unit!(When { Always, Focused, Blurred })),
        (
            "Sound",
            object!(Sound, "A sound.", { name: reference("SoundName"), when: reference("When") } {
                volume: nullable(number()),
            }),
        ),
        ("SoundName", unit!(SoundName { Default, Question, Permission, Error, Done, SubagentDone })),
        (
            "Route",
            tagged!(Route, "A route of the TUI.", {
                Home { } { },
                Session { id: string() } { },
                Plugin { id: string(), name: string() } { },
            }),
        ),
        (
            "Fetch",
            object!(Fetch, "A request of the HTTP API, which a `reply` request answers.", {
                method: string(), path: string(),
            } { query: array(pair(string(), string())), body: nullable(any()), bytes: boolean() }),
        ),
        (
            "Dialog",
            tagged!(Dialog, "A dialog the host shows.", flat {
                Prompt(Prompt) { title: string(), action: reference("Action") } {
                    placeholder: nullable(string()), value: nullable(string()), description: nullable(string()),
                },
            }, {
                Close { key: string() } { },
                Dismissable { dialog: reference("Dialog"), dismissed: reference("Action") } { },
            }, newtype {
                Panel: reference("Panel"),
                Select: reference("Select"),
                Confirm: reference("Confirm"),
                Alert: reference("Alert"),
                ErrorDetails: reference("ErrorDetails"),
                Images: reference("Images"),
            }),
        ),
        (
            "Select",
            object!(Select, "A select dialog.", {
                title: string(), options: array(reference("SelectOption")), action: reference("Action"),
            } {
                placeholder: nullable(string()), current: nullable(string()), key: nullable(string()),
                actions: array(reference("SelectAction")), binds: array(reference("PanelBind")),
                search: nullable(string()), size: nullable(reference("PanelSize")), focus: nullable(string()),
                query: nullable(reference("Action")), query_delay: uint16(), filterless: boolean(),
                empty: nullable(reference("Span")), note: nullable(reference("Span")), centered: boolean(),
            }),
        ),
        (
            "SelectAction",
            object!(SelectAction, "A footer action of a select.", { title: string(), action: reference("Action") } {
                key: nullable(string()), hidden: array(string()), primary: nullable(boolean()), rowless: boolean(),
                command: nullable(string()), disabled: boolean(), hidden_all: boolean(),
            }),
        ),
        (
            "Panel",
            object!(Panel, "A panel dialog, whose body is a `RenderNode`.", {
                key: string(), title: array(reference("Span")), body: reference("RenderNode"),
            } {
                size: reference("PanelSize"), subtitle: nullable(string()), actions: array(reference("PanelAction")),
                binds: array(reference("PanelBind")), bleed: boolean(), centered: boolean(), bare: boolean(),
                close: nullable(string()), height: nullable(uint16()),
            }),
        ),
        ("PanelSize", unit!(PanelSize { Medium, Large, XLarge })),
        (
            "PanelAction",
            object!(PanelAction, "A footer action of a panel.", { title: string(), action: reference("Action") } {
                key: nullable(string()), color: nullable(reference("Color")), close: boolean(),
            }),
        ),
        (
            "PanelBind",
            object!(PanelBind, "A key of a panel.", { key: string(), title: string(), action: reference("Action") } {
            }),
        ),
        (
            "Confirm",
            object!(Confirm, "A question with two answers.", {
                title: string(), message: string(), action: reference("Action"),
            } { label: reference("ConfirmLabel"), size: nullable(reference("PanelSize")), centered: boolean() }),
        ),
        (
            "ConfirmLabel",
            object!(ConfirmLabel, "The labels of a confirm's answers.", { } {
                confirm: nullable(string()), cancel: nullable(string()),
            }),
        ),
        (
            "Alert",
            object!(Alert, "A notice.", { title: string(), message: string() } {
                action: nullable(reference("Action")), size: nullable(reference("PanelSize")), centered: boolean(),
            }),
        ),
        (
            "ErrorDetails",
            object!(ErrorDetails, "The host's view of an error.", { title: string(), error: string() } {
                source: nullable(string()), context: nullable(string()), back: nullable(reference("Action")),
                reference: nullable(string()), key: nullable(string()), plugin: nullable(string()),
            }),
        ),
        (
            "Images",
            object!(Images, "Images to look through.", { images: array(reference("Image")) } { index: uint64() }),
        ),
        ("Image", object!(Image, "An image, in base64.", { data: string() } { name: nullable(string()) })),
        (
            "ComposerEdit",
            tagged!(ComposerEdit, "An edit of the composer.", {
                Set { text: string() } { },
                Insert { text: string() } { },
                Submit { } { },
            }),
        ),
        (
            "TabEdit",
            tagged!(TabEdit, "An edit of the session tabs.", {
                Open { session: string() } { },
                Focus { session: string() } { },
                Move { session: string(), index: uint64() } { },
                Close { } { session: nullable(string()) },
            }),
        ),
        (
            "Foreground",
            object!(Foreground, "A program the host runs in the foreground.", { command: string() } {
                args: array(string()), cwd: nullable(string()),
            }),
        ),
        (
            "OpenPanel",
            object!(OpenPanel, "Opens a panel surface.", { surface: string() } {
                session: nullable(string()), fullscreen: boolean(),
            }),
        ),
        (
            "Overlay",
            object!(Overlay, "Opens an overlay surface.", {
                surface: string(), anchor: reference("OverlayAnchor"), width: uint16(), height: uint16(),
            } { }),
        ),
        ("OverlayAnchor", {
            let _ = |value: &OverlayAnchor| match value {
                OverlayAnchor::Point { x: _, y: _ }
                | OverlayAnchor::Node { node: _ }
                | OverlayAnchor::Edge(_)
                | OverlayAnchor::Surface { surface: _, edge: _ } => (),
            };
            let point = object(&[("x", uint16()), ("y", uint16())], &[], None, "");
            let node = object(&[("node", string())], &[], None, "");
            let surface = object(&[("surface", string()), ("edge", reference("ScreenEdge"))], &[], None, "");
            described(
                json!({ "oneOf": [
                    single("point", point), single("node", node), single("edge", reference("ScreenEdge")),
                    single("surface", surface),
                ] }),
                "Where an overlay's top left corner goes.",
            )
        }),
        ("ScreenEdge", unit!(ScreenEdge { Top, Bottom, Left, Right })),
        // The replies.
        (
            "ViewReply",
            object!(ViewReply, "What a `view` request answers.", { node: reference("Node") } {
                content: array(pair(reference("ContentRef"), reference("Blob"))),
                released: array(reference("ContentRef")), memo: uint64(),
            }),
        ),
        (
            "ClaimReply",
            object!(ClaimReply, "What a `claim` request answers; a null node leaves the part to the host.", { } {
                node: nullable(reference("Node")), content: array(pair(reference("ContentRef"), reference("Blob"))),
                released: array(reference("ContentRef")), memo: uint64(),
            }),
        ),
        ("Blob", {
            let _ = |value: &Blob| {
                let Blob(_) = value;
            };
            let bytes = json!({
                "type": "object", "properties": { "base64": string() }, "required": ["base64"],
                "additionalProperties": false,
            });
            described(json!({ "oneOf": [string(), bytes] }), "Content: text when it is UTF-8, else base64.")
        }),
        ("RequestId", {
            let _ = |value: &RequestId| {
                let RequestId(_) = value;
            };
            // 0 names no request (bigboi's last pass).
            described(
                json!({ "type": "integer", "minimum": 1, "maximum": u64::MAX }),
                "What a `fetch` or a `foreground` the host takes answers, which its one reply names; never 0, which \
                 names no request. One the host does not take, as when its queue of effects is full, answers an \
                 error, and no reply comes.",
            )
        }),
        ("Handled", unit!(Handled { Consume, Pass })),
        (
            "Fenced",
            tagged!(Fenced, "What a `render-fence` request answers.", {
                Code { } { },
                Keep { } { },
                Lines { lines: array(reference("Line")) } { fg: nullable(reference("Color")), drag: boolean() },
            }),
        ),
        ("Line", described(array(reference("Span")), "A line of styled text.")),
        ("Render", {
            let _ = |value: &Render| match value {
                Render::Keep | Render::Hide | Render::Show(_) => (),
            };
            described(
                json!({ "oneOf": [
                    object(&[], &[], Some("keep"), ""),
                    object(&[], &[], Some("hide"), ""),
                    object(&[("node", reference("RenderNode"))], &[], Some("show"), ""),
                ] }),
                "What a `render` and a `render-route` request answer.",
            )
        }),
        (
            "RenderNode",
            tagged!(RenderNode, "The node tree a render and a dialog body draw.", {
                Box { } {
                    row: boolean(), gap: uint16(), padding: pair(uint16(), uint16()), justify: reference("Justify"),
                    align: reference("Align"), bg: nullable(reference("Color")), layout: reference("Layout"),
                    on_click: nullable(reference("Click")), children: array(reference("RenderNode")),
                    border: nullable(reference("Border")), padding_sides: nullable(reference("Edges")), wrap: boolean(),
                    overflow: reference("Overflow"),
                },
                Text { spans: array(reference("Span")) } {
                    fg: nullable(reference("Color")), wrap: reference("Wrap"), truncate: boolean(),
                    selectable: boolean(), hover_fg: nullable(reference("Color")), layout: reference("Layout"),
                    on_click: nullable(reference("Click")),
                },
                Slot { path: string() } { },
                Markdown { text: string() } { },
                Spinner { label: string() } { },
            }),
        ),
        // What the host's reads answer.
        (
            "NodeRect",
            object!(NodeRect, "A node's place on the screen.", {
            x: int32(), y: int32(), width: uint32(), height: uint32(),
        } { }),
        ),
        (
            "Focused",
            object!(Focused, "Where the focus is, for the call's mount.", { surface: boolean() } {
                node: nullable(string()),
            }),
        ),
        (
            "PluginEntry",
            object!(PluginEntry, "A TUI plugin, as the host lists it.", {
                key: string(), id: string(), origin: reference("PluginOrigin"), status: reference("PluginStatus"),
            } { target: nullable(string()), active: boolean(), slow: nullable(string()) }),
        ),
        ("PluginOrigin", unit!(PluginOrigin { Builtin, Added, Configured, External })),
        ("PluginStatus", unit!(PluginStatus { Active, Inactive, Skipped, Failed, Pending, Declined })),
        (
            "Composer",
            object!(Composer, "The composer on screen.", { text: string(), cursor: uint64(), focused: boolean() } { }),
        ),
        (
            "Tab",
            object!(Tab, "A session tab.", { session_id: string() } {
                title: nullable(string()), active: boolean(), busy: boolean(), attention: boolean(),
                unread: nullable(reference("Unread")),
            }),
        ),
        ("Unread", unit!(Unread { Activity, Error })),
        (
            "KeymapPending",
            object!(KeymapPending, "A key of a sequence in progress.", { key: string() } { token: nullable(string()) }),
        ),
        (
            "KeymapActive",
            object!(KeymapActive, "A key the sequence in progress may continue with.", { key: string() } {
                title: nullable(string()), description: nullable(string()), group: nullable(string()),
                continues: boolean(),
            }),
        ),
        (
            "KeymapCommand",
            object!(KeymapCommand, "A command of the keymap.", { id: string(), enabled: boolean() } {
                title: nullable(string()), description: nullable(string()), group: nullable(string()),
                palette: boolean(), slash: nullable(reference("KeymapSlash")), suggested: boolean(),
            }),
        ),
        (
            "KeymapSlash",
            object!(KeymapSlash, "A command's slash form.", { name: string() } {
                aliases: array(string()), arguments: boolean(),
            }),
        ),
        (
            "Session",
            object!(Session, "A session and its status.", {
                info: api("Session.Info"), status: reference("SessionStatus"),
            } { }),
        ),
        ("SessionStatus", unit!(SessionStatus { Idle, Running })),
        (
            "Family",
            object!(Family, "A session's family: its subagent sessions.", {
                members: array(reference("Member")), cost: number(),
            } { shells: uint64() }),
        ),
        (
            "Member",
            object!(Member, "A session of a family.", {
                id: string(), status: reference("SessionStatus"), updated: number(),
            } { parent: nullable(string()) }),
        ),
        (
            "Info",
            object!(Info, "The host's version, size and location.", {
                version: string(), size: pair(uint16(), uint16()), location: reference("LocationRef"),
            } { failed_plugins: uint64(), locale: nullable(string()) }),
        ),
        (
            "Measure",
            object!(Measure, "A text as the host's text layout counts it: its cells in a row, and its graphemes.", {
                cells: uint32(), graphemes: uint32(),
            } { }),
        ),
        (
            "ImageBounds",
            object!(ImageBounds, "The bounds of the images a host with `image-bounds` decodes.", {
                bytes: uint64(), side: uint64(),
            } { }),
        ),
        ("DrawList", draw_list()),
    ]
}

/// What each request is answered with, by its type, for each side's `call`: a definition's name, a schema, or null for
/// a request whose answer is `null`. A request of the HTTP API's types names them by their OpenAPI name.
pub(super) fn messages() -> Value {
    let maybe = |name: &str| nullable(reference(name));
    let list = |name: &str| array(reference(name));
    let call = [
        ("render-fence", reference("Fenced")),
        ("render", reference("Render")),
        ("render-route", reference("Render")),
        ("view", reference("ViewReply")),
        ("claim", reference("ClaimReply")),
        ("draw", reference("DrawList")),
        ("layout", reference("LayoutReply")),
        ("input", reference("Handled")),
        // A command that declines the key that ran it answers "pass" (contract ergonomics 2.5).
        ("command", json!({ "enum": [null, "pass"] })),
        ("search", array(string())),
        ("*", json!({ "type": "null" })),
    ];
    let host = [
        ("storage-get", nullable(string())),
        ("color", maybe("Rgba")),
        ("session", maybe("Session")),
        ("sessions", list("Session")),
        ("family", reference("Family")),
        ("pending", array(api("Session.Inbox.Info"))),
        ("messages", array(api("Session.Message.Info"))),
        ("message", nullable(api("Session.Message.Info"))),
        ("models", nullable(array(api("Model.Info")))),
        ("model", nullable(api("Model.Ref"))),
        ("limits", nullable(api("UsageLimits.Info"))),
        ("providers", nullable(array(api("Provider.Info")))),
        ("info", reference("Info")),
        ("mcp-servers", nullable(array(api("Mcp.Server")))),
        ("integrations", nullable(array(api("Integration.Info")))),
        ("vcs", nullable(api("Vcs.Info"))),
        ("route", reference("Route")),
        ("scroll-state", maybe("ScrollState")),
        ("anchors", list("AnchorAt")),
        ("top-anchor", maybe("AnchorAt")),
        ("transcript", maybe("TranscriptView")),
        ("interactive", boolean()),
        ("shortcut", nullable(string())),
        ("dialog-open", boolean()),
        ("composer", maybe("Composer")),
        ("checkpoint", nullable(uint64())),
        ("variants", array(string())),
        ("set-variant", boolean()),
        ("tabs-enabled", boolean()),
        ("tabs", list("Tab")),
        ("tab", boolean()),
        ("keymap-pending", list("KeymapPending")),
        ("keymap-active", list("KeymapActive")),
        ("keymap-commands", list("KeymapCommand")),
        ("shortcuts", array(string())),
        ("selection", nullable(string())),
        ("theme", nullable(string())),
        ("themes", array(string())),
        ("set-theme", boolean()),
        ("rect", maybe("NodeRect")),
        ("focused", reference("Focused")),
        ("input-mode", nullable(string())),
        ("plugins", list("PluginEntry")),
        ("setting", nullable(any())),
        ("image-size", nullable(pair(uint32(), uint32()))),
        ("image-bounds", reference("ImageBounds")),
        ("utc-offset", int32()),
        ("measure", reference("Measure")),
        ("fetch", reference("RequestId")),
        ("foreground", reference("RequestId")),
        ("*", json!({ "type": "null" })),
    ];
    let map = |items: &[(&str, Value)]| -> serde_json::Map<String, Value> {
        items.iter().map(|(name, schema)| ((*name).to_owned(), schema.clone())).collect()
    };
    json!({
        "describe": reference("Metadata"),
        "create": reference("Manifest"),
        "call": map(&call),
        "host": map(&host),
    })
}

/// A claim's tool call: the HTTP API's assistant tool part, but that a completed call's `content`, what it returned,
/// is empty, since a `part-output` source names it and the host reads it (`claim::ToolPart`); an error's is left out,
/// and metadata past 4096 bytes of JSON is empty. The HTTP API requires a completed call's content, so its own
/// definition would refuse every completed claim (bigboi's final pass).
fn claim_tool() -> Value {
    let tool = |pointer: &str| api(&format!("Session.Message.Assistant.Tool/properties/{pointer}"));
    let completed = json!({
        "type": "object",
        "properties": {
            "status": { "type": "string", "enum": ["completed"] },
            "input": { "type": "object" },
            "content": { "type": "array", "maxItems": 0 },
            "metadata": { "type": "object" },
        },
        "required": ["status", "input", "content"],
        "additionalProperties": false,
    });
    json!({
        "description": "A tool call as a claim's view gets it: the HTTP API's assistant tool part without what the \
                        call returned, which its `part-output` source names.",
        "type": "object",
        "properties": {
            "type": tool("type"),
            "id": tool("id"),
            "name": tool("name"),
            "executed": tool("executed"),
            "native": tool("native"),
            "state": { "anyOf": [
                api("Session.Message.ToolState.Streaming"),
                api("Session.Message.ToolState.Running"),
                completed,
                api("Session.Message.ToolState.Error"),
            ] },
            "time": tool("time"),
        },
        "required": ["type", "id", "name", "state", "time"],
        "additionalProperties": false,
    })
}

/// The binary list a `draw` answers (`crate::canvas`): not JSON, so its layout is stated here.
fn draw_list() -> Value {
    let record = |op: u8, name: &str, payload: &str| json!({ "op": op, "name": name, "payload": payload });
    json!({
        "description": "What a `draw` request answers: bytes, not JSON, and none to keep the list the host holds. A \
                        version byte (1), then records: an operation byte, the payload's length as a little-endian \
                        u32, and the payload. Every integer is little-endian; coordinates are cells from the canvas's \
                        top left corner. A color is r, g, b, a bytes. A style is 10 bytes: flags (1 a foreground, 2 a \
                        background), attributes (bold 1, dim 2, italic 4, underline 8, inverse 16, strikethrough 32), \
                        then the foreground and the background colors, each written whether it is set or not. A \
                        border is 0 single, 1 double, 2 rounded, 3 heavy. A reader skips a record of an operation it \
                        does not know, which is how a later 2.x adds one; a list the host cannot read fails the \
                        plugin, and one over a limit shows a placeholder.",
        "contentMediaType": "application/octet-stream",
        "x-version": crate::canvas::VERSION,
        "x-limits": {
            "bytes": crate::canvas::MAX_BYTES,
            "operations": crate::canvas::MAX_OPS,
            "text-bytes": crate::canvas::MAX_TEXT_BYTES,
            "clips": crate::canvas::MAX_CLIPS,
        },
        "x-records": [
            record(1, "fill", "x: i16, y: i16, width: u16, height: u16, color"),
            record(2, "text", "x: i16, y: i16, style, then the text in UTF-8"),
            record(3, "cell", "x: i16, y: i16, style, char: u32"),
            record(4, "cells", "x: i16, y: i16, width: u16, then each cell's style and char: u32, in rows of width"),
            record(5, "rect", "x: i16, y: i16, width: u16, height: u16, border: u8, color, background (alpha 0: none)"),
            record(6, "clip", "x: i16, y: i16, width: u16, height: u16: drawing until its pop is cut to it"),
            record(7, "pop", "nothing"),
        ],
    })
}

/// An object with the one property `name`, as serde writes a variant of an externally tagged enum.
fn single(name: &str, schema: Value) -> Value {
    json!({ "type": "object", "properties": { name: schema }, "required": [name], "additionalProperties": false })
}

/// Where the HTTP API's OpenAPI document is, from `schema/v2.json`: `packages/protocol/openapi.json`.
pub(crate) const OPENAPI: &str = "../../../../protocol/openapi.json";

/// A value of the HTTP API's component `key` (`Session.Info`), a reference into its OpenAPI document. The Rust type of
/// `opencode_api_types` is the key in Pascal case (`SessionInfo`).
fn api(key: &str) -> Value {
    json!({ "$ref": format!("{OPENAPI}#/components/schemas/{key}") })
}

fn any() -> Value {
    json!({})
}

fn json_object() -> Value {
    json!({ "type": "object" })
}

/// A reply's result, as serde writes a `Result`: `{"Ok": value}` or `{"Err": text}`.
fn result() -> Value {
    json!({ "oneOf": [single("Ok", any()), single("Err", string())] })
}
