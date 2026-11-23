//! The messages of the pipe carrier: contract 2.0's own ([`Request`], [`HostRequest`], [`v2::Node`], [`Manifest`]),
//! with what a process boundary needs besides: a sequence number on every host event, which the JS host acknowledges
//! on receipt and answers with [`Up::Done`] once its handler returned; a mount generation, a base and a revision on
//! every tree; a layout epoch, the count of inputs the tree saw; and snapshots the host pushes for the reads the
//! plugin watches, in order before the event that may read them.

use opencode_plugin_abi::{Blob, HostRequest, Level, Manifest, Request, v2};
use serde::{Deserialize, Serialize};

/// The protocol's version, in both hellos.
pub const VERSION: u32 = 1;
/// Handshake marker distinguishing protocol traffic from stray process output.
pub const MAGIC: &str = "opencode-js-host";

/// From the host to the JS host. Each message with a `seq` is acknowledged on receipt ([`Up::Ack`]).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Down {
    /// The first message: the protocol's version, and the sequence the next event follows, as a new JS host takes over
    /// the stream where the last one ended.
    Hello {
        version: u32,
        after: u64,
        /// The theme's mode, `dark` or `light`, which the setup context reads.
        theme_mode: String,
        /// The page theme's colors, which the V2 context's `theme` reads.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        palette: Option<Palette>,
    },
    /// Loads the TUI module of the plugin directory `dir`, the target `target`. With `setup`, runs its setup with
    /// `options`, answered with [`Up::Loaded`]; without, answered with [`Up::Described`], and [`Down::Setup`] runs it
    /// once the host knows the plugin is enabled. Either may answer [`Up::Unsupported`] or [`Up::Done`] with an error.
    Load {
        seq: u64,
        target: String,
        dir: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        options: Option<serde_json::Value>,
        setup: bool,
        /// `dir` is the approved copy of a project's plugin: what its files import must be in it.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        confined: bool,
        /// With `setup`: the reads its setup may make at once, as they are now ([`seed`]).
        #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
        seed: std::collections::BTreeMap<String, serde_json::Value>,
    },
    /// Runs the setup of the module the load `load` described. Answered as a load with `setup`.
    Setup {
        seq: u64,
        load: u64,
        /// The reads its setup may make at once, as they are now ([`seed`]).
        #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
        seed: std::collections::BTreeMap<String, serde_json::Value>,
    },
    /// The host forgot `target`: the JS host drops its plugin, whose ID is free for another target.
    Forget { target: String },
    /// The theme's mode or colors changed.
    Theme {
        mode: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        palette: Option<Palette>,
    },
    /// Runs the cleanups of plugin `id`, which the host disabled or failed: nothing of it is called from now on.
    Deactivate {
        seq: u64,
        id: String,
        /// The load whose setup made the activation; a later one stays.
        activation: u64,
    },
    /// A handler of plugin `id`: a command, an event, a reply.
    Call {
        seq: u64,
        id: String,
        /// The activation it is for: the load whose setup made it. Another one's never answers it.
        activation: u64,
        call: Request,
        /// The route as the call starts, when the plugin does not watch it: a handler reads it at once
        /// (`ui.router.current()`), where a watch it makes then would answer only after the handler ran.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        route: Option<serde_json::Value>,
        /// A reply whose result is the [`Down::Part`]s of its request before it, joined, and not the one it carries.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        parted: bool,
    },
    /// A piece of the JSON of the result of a reply to `request` of activation `activation`, in base64, which is too
    /// large for one frame: its call follows the pieces, in order, and says it is [`Down::Call::parted`].
    Part { activation: u64, request: opencode_plugin_abi::RequestId, data: String },
    /// A surface of plugin `id` mounted, with its first input. Answered with [`Up::Done`] once its view was sent.
    Mount {
        seq: u64,
        id: String,
        /// The activation it is for: the load whose setup made it. Another one's never answers it.
        activation: u64,
        surface: usize,
        mount: v2::MountId,
        input: v2::SurfaceInput,
    },
    /// A mount's input changed: its size or palette. Its `seq` is the mount's new layout epoch.
    Input {
        seq: u64,
        id: String,
        /// The activation it is for: the load whose setup made it. Another one's never answers it.
        activation: u64,
        mount: v2::MountId,
        input: v2::SurfaceInput,
    },
    Unmount {
        seq: u64,
        id: String,
        /// The activation it is for: the load whose setup made it. Another one's never answers it.
        activation: u64,
        mount: v2::MountId,
        /// It ends as a reload of the plugin's registrations mounts it again: the new mount may take its state.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        handover: bool,
        /// Its node that had the focus as it ended: a new mount that takes its state may give it the focus back.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        focused: Option<String>,
    },
    /// A part fence claim `claim` of plugin `id` draws: its first sight, which begins the part's mount, or a newer
    /// revision of it. The JS host answers with a whole revision of the mount ([`Up::Tree`]): its tree, a decline
    /// (a null node), or the renderer's error; then [`Up::Done`]. One is in flight a mount: a part that comes
    /// meanwhile is drawn once that one is adopted. [`Down::Unmount`] ends the mount.
    Claim {
        seq: u64,
        id: String,
        /// The activation it is for: the load whose setup made it. Another one's never answers it.
        activation: u64,
        claim: usize,
        mount: v2::MountId,
        part: opencode_plugin_abi::claim::Part,
    },
    /// The host adopted revision `rev` of `mount`: the next one builds on it.
    Adopted { id: String, mount: v2::MountId, rev: u64 },
    /// The host refused revision `rev` of `mount`; the next one is whole and builds on `adopted`.
    Refused { id: String, mount: v2::MountId, rev: u64, adopted: u64, error: String },
    /// The value of a read plugin `id` watches under `key`, as of now.
    /// A read over the host's bound is not pushed: `value` is null, and `error` says why.
    Snapshot {
        id: String,
        /// The JS host's activation that watches it: a candidate the JS host knows by the plugin's ID before the host
        /// does never takes the running one's, and one that ended takes none.
        #[serde(default)]
        activation: u64,
        key: String,
        value: serde_json::Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
        /// Its value is the [`Down::SnapshotPart`]s of its key before it, joined, and not the one it carries.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        parted: bool,
    },
    /// Base64 fragment of a watched value. The final snapshot follows its fragments in order.
    SnapshotPart { id: String, activation: u64, key: String, data: String },
    /// What the effects of a call (`c<seq>`), a setup (`setup`) or a batch of the plugin's (`b<seq>`) answered, one
    /// value each ([`HostRequest`]'s results).
    Answered {
        id: String,
        /// The JS host's activation whose effects these answer: a candidate set up for a reload, which the JS host
        /// knows by the plugin's ID before the host does, never takes the running one's.
        #[serde(default)]
        activation: u64,
        key: String,
        results: Vec<serde_json::Value>,
        /// Its results are the [`Down::AnsweredPart`]s of its key before it, joined, and not the ones it carries.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        parted: bool,
        /// The results the host could not send, by index, each null here: they did not come, which the JS host tells
        /// apart from a null answer (a key that holds nothing).
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        dropped: Vec<usize>,
    },
    /// A piece of the JSON of the results of an [`Down::Answered`] of `key`, in base64, too large for one frame: its
    /// answer follows the pieces, in order, and says it is [`Down::Answered::parted`].
    AnsweredPart { id: String, activation: u64, key: String, data: String },
    /// The host cancelled `request` of activation `activation`, as the mount that owns it closed: no reply comes, and
    /// the fetch that waits for it rejects with an `AbortError`.
    Cancelled { activation: u64, request: opencode_plugin_abi::RequestId },
    /// Answered with [`Up::Pong`] once everything before it was handled.
    Ping { seq: u64 },
    /// The message of `seq` was over the queue and is not sent; its sequence goes, so the stream has no gap.
    Skipped { seq: u64 },
}

impl Down {
    /// The sequence number the JS host acknowledges.
    pub fn seq(&self) -> Option<u64> {
        match self {
            Down::Load { seq, .. }
            | Down::Setup { seq, .. }
            | Down::Deactivate { seq, .. }
            | Down::Call { seq, .. }
            | Down::Mount { seq, .. }
            | Down::Input { seq, .. }
            | Down::Claim { seq, .. }
            | Down::Unmount { seq, .. }
            | Down::Ping { seq }
            | Down::Skipped { seq } => Some(*seq),
            Down::Hello { .. }
            | Down::Forget { .. }
            | Down::Theme { .. }
            | Down::Adopted { .. }
            | Down::Refused { .. }
            | Down::Snapshot { .. }
            | Down::SnapshotPart { .. }
            | Down::Answered { .. }
            | Down::AnsweredPart { .. }
            | Down::Part { .. }
            | Down::Cancelled { .. } => None,
        }
    }
}

/// The reads a V2 plugin's setup makes before the host could push them: the route and what `info` says (the location,
/// the terminal's size), as they are as the setup starts, under the keys the compatibility layer reads them by. TS's
/// setup reads them from its store at once; a watch made in setup answers only after it returned.
pub(crate) fn seed(
    host: &std::rc::Weak<dyn crate::Host>,
    id: &str,
) -> std::collections::BTreeMap<String, serde_json::Value> {
    let evaluate = |request: &HostRequest| super::evaluate(host, id, Vec::new(), None, request);
    let route = evaluate(&HostRequest::Route);
    // A session's route: the session too, whose location a setup prefers to the default one.
    let session = (route["type"] == "session").then(|| route["id"].as_str().map(str::to_owned)).flatten();
    let mut seed = std::collections::BTreeMap::from([
        ("info".to_owned(), evaluate(&HostRequest::Info)),
        ("route".to_owned(), route),
    ]);
    if let Some(session) = session {
        seed.insert(format!("session:{session}"), evaluate(&HostRequest::Session { id: session }));
    }
    seed
}

/// The page theme as the JS host holds it: its mode, and each token's color as `#rrggbbaa`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Palette {
    pub mode: String,
    pub colors: std::collections::BTreeMap<String, String>,
}

/// A listener of every key on the JS host, by its index in the manifest: a layer of setup's, or a surface's.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Listener {
    Layer(usize),
    Surface(usize),
}

/// From the JS host to the host.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Up {
    Hello {
        magic: String,
        version: u32,
        #[serde(default)]
        pid: u32,
    },
    /// Every message with a sequence up to `seq` was received; their handlers may still run.
    Ack { seq: u64 },
    /// The JS host starts the work of `seq`: a load's setup, a handler, a view. Work it did not start when it ended
    /// never ran.
    Started { seq: u64 },
    /// The setup of load or activation `seq` returned: the plugin's ID, what it registered, the command names whose
    /// keys hold (`hold`), and the effects setup asked for.
    Loaded {
        seq: u64,
        id: String,
        manifest: Manifest,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        holds: Vec<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        effects: Vec<HostRequest>,
    },
    /// The JS host runs plugin `id`'s code for a message without a sequence (a view, a resolver, a cleanup); without
    /// an ID, it returned.
    Entered {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
    },
    /// Load `seq`, without setup, imported plugin `id`.
    Described { seq: u64, id: String },
    /// The target of load `seq` has no TUI module: `reason` is what its resolution said.
    Unsupported {
        seq: u64,
        #[serde(default)]
        reason: String,
    },
    /// The handler of `seq` returned and the views it made due were sent, with the effects it asked for; or it threw,
    /// with nothing. For a mount or an input: its view was sent.
    Done {
        seq: u64,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        effects: Vec<HostRequest>,
        /// Per-effect mount overrides. Apply in order; discard effects whose owner closed.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        mounts: Vec<Option<v2::MountId>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
        /// The command or listener declined its key; resume normal host dispatch.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        declined: bool,
    },
    /// Effects plugin `id` asked for outside any call: a timer, a promise, a reactive update. Answered with
    /// [`Down::Answered`] under `seq`, the plugin's own count.
    Effects {
        id: String,
        /// The JS host's activation that sent it, by the load whose setup made it ([`Down::Load`]); 0 names none.
        #[serde(default)]
        activation: u64,
        seq: u64,
        effects: Vec<HostRequest>,
        /// The mount they are of, which the JS host knows and the call that ran does not: a field's focus is the
        /// mount's whose tree holds the field. They apply to that mount or, once it closed, nowhere.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mount: Option<opencode_plugin_abi::v2::MountId>,
    },
    /// A revision of a mount's tree, in a frame of its own kind.
    Tree(Box<Revision>),
    /// Plugin `id` reads `request` under `key`: the host pushes its value now and each time it changes.
    Watch {
        id: String,
        /// The JS host's activation that sent it, by the load whose setup made it ([`Down::Load`]); 0 names none.
        #[serde(default)]
        activation: u64,
        key: String,
        request: HostRequest,
    },
    Unwatch {
        id: String,
        /// The JS host's activation that sent it, by the load whose setup made it ([`Down::Load`]); 0 names none.
        #[serde(default)]
        activation: u64,
        key: String,
    },
    /// Plugin `id` failed outside a call: a promise rejected, a timer threw.
    Fail {
        id: String,
        /// The JS host's activation that sent it, by the load whose setup made it ([`Down::Load`]); 0 names none.
        #[serde(default)]
        activation: u64,
        error: String,
    },
    /// Plugin `id` registered other commands or surfaces than its setup did: the host takes them as a reload.
    Manifest {
        id: String,
        /// The JS host's activation that sent it, by the load whose setup made it ([`Down::Load`]); 0 names none.
        #[serde(default)]
        activation: u64,
        manifest: Manifest,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        holds: Vec<String>,
    },
    /// Plugin `id`'s listener of every key can take a key now (`on`), or only hears it: a `keypress` listener of
    /// the compat layer, or a field with `onKeyDown` in a surface. The host holds a key for its answer only while
    /// it can take one.
    Taking {
        id: String,
        /// The JS host's activation that sent it, by the load whose setup made it ([`Down::Load`]); 0 names none.
        #[serde(default)]
        activation: u64,
        listener: Listener,
        on: bool,
    },
    /// Everything before ping `seq` was handled; `waiting` when a tree waits for the host to adopt the last one, and
    /// `retiring` when a command a component dropped still lingers, to go a moment later (`UNCOMMAND`).
    Pong {
        seq: u64,
        waiting: bool,
        #[serde(default)]
        retiring: bool,
    },
    Log {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        level: Level,
        message: String,
    },
}

/// A revision of a mount's tree. `base` is the revision it builds on, which its [`v2::Node::Keep`]s name; `epoch` the
/// last [`Down::Mount`] or [`Down::Input`] sequence it saw; `whole` when it keeps nothing. Content handles are the
/// plugin's own, numbered in the mount; the host gives them its own.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Revision {
    pub id: String,
    pub mount: v2::MountId,
    pub rev: u64,
    pub base: u64,
    pub epoch: u64,
    #[serde(default)]
    pub whole: bool,
    /// A [`v2::Node`], read once its content handles are the host's.
    pub node: serde_json::Value,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content: Vec<(v2::ContentRef, Blob)>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub released: Vec<v2::ContentRef>,
    #[serde(default)]
    pub memo: usize,
    /// A claimed part's renderer threw: the part falls back to the host's row for its mount.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
