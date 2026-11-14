//! The messages of the pipe carrier: contract 2.0's own ([`Request`], [`HostRequest`], [`v2::Node`], [`Manifest`]),
//! with what a process boundary needs besides (synthesis 3.7, 4.3): a sequence number on every host event, which the JS
//! host acknowledges on receipt and answers with [`Up::Done`] once its handler returned; a mount generation, a base and
//! a revision on every tree; a layout epoch, the count of inputs the tree saw; and snapshots the host pushes for the
//! reads the plugin watches, in order before the event that may read them.

use opencode_plugin_abi::{Blob, HostRequest, Level, Manifest, Request, v2};
use serde::{Deserialize, Serialize};

/// The protocol's version, in both hellos.
pub const VERSION: u32 = 1;
/// The JS host's first message names it, so a stray print before it is not taken for the protocol (review F4).
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
        /// P8: the page theme's colors, which the V2 context's `theme` reads.
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
    },
    /// Runs the setup of the module the load `load` described. Answered as a load with `setup`.
    Setup { seq: u64, load: u64 },
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
    },
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
    },
    /// The host adopted revision `rev` of `mount`: the next one builds on it.
    Adopted { id: String, mount: v2::MountId, rev: u64 },
    /// The host refused revision `rev` of `mount`; the next one is whole and builds on `adopted`.
    Refused { id: String, mount: v2::MountId, rev: u64, adopted: u64, error: String },
    /// The value of a read plugin `id` watches under `key`, as of now.
    /// A read over the host's bound is not pushed: `value` is null, and `error` says why.
    Snapshot {
        id: String,
        key: String,
        value: serde_json::Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    /// What the effects of a call (`c<seq>`), a setup (`setup`) or a batch of the plugin's (`b<seq>`) answered, one
    /// value each ([`HostRequest`]'s results).
    Answered { id: String, key: String, results: Vec<serde_json::Value> },
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
            | Down::Unmount { seq, .. }
            | Down::Ping { seq }
            | Down::Skipped { seq } => Some(*seq),
            Down::Hello { .. }
            | Down::Forget { .. }
            | Down::Theme { .. }
            | Down::Adopted { .. }
            | Down::Refused { .. }
            | Down::Snapshot { .. }
            | Down::Answered { .. } => None,
        }
    }
}

/// The page theme as the JS host holds it (P8): its mode, and each token's color as `#rrggbbaa`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Palette {
    pub mode: String,
    pub colors: std::collections::BTreeMap<String, String>,
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
    Ack {
        seq: u64,
    },
    /// The JS host starts the work of `seq`: a load's setup, a handler, a view. Work it did not start when it ended
    /// never ran.
    Started {
        seq: u64,
    },
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
    Described {
        seq: u64,
        id: String,
    },
    /// The target of load `seq` has no TUI module.
    Unsupported {
        seq: u64,
    },
    /// The handler of `seq` returned and the views it made due were sent, with the effects it asked for; or it threw,
    /// with nothing. For a mount or an input: its view was sent.
    Done {
        seq: u64,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        effects: Vec<HostRequest>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    /// Effects plugin `id` asked for outside any call: a timer, a promise, a reactive update. Answered with
    /// [`Down::Answered`] under `seq`, the plugin's own count.
    Effects {
        id: String,
        seq: u64,
        effects: Vec<HostRequest>,
    },
    /// A revision of a mount's tree, in a frame of its own kind.
    Tree(Box<Revision>),
    /// Plugin `id` reads `request` under `key`: the host pushes its value now and each time it changes.
    Watch {
        id: String,
        key: String,
        request: HostRequest,
    },
    Unwatch {
        id: String,
        key: String,
    },
    /// Plugin `id` failed outside a call: a promise rejected, a timer threw.
    Fail {
        id: String,
        error: String,
    },
    /// Plugin `id` registered other commands or surfaces than its setup did: the host takes them as a reload.
    Manifest {
        id: String,
        manifest: Manifest,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        holds: Vec<String>,
    },
    /// Everything before ping `seq` was handled; `waiting` when a tree waits for the host to adopt the last one.
    Pong {
        seq: u64,
        waiting: bool,
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
}
