//! Loading, as fetches of the host's client: the diff for the source, the reported base, and image previews. Each
//! reply names the viewer and the load it is for; one of an earlier viewer or load changes nothing.

use opencode_api::client::Client;
use opencode_api::generated::{
    FileDiffInfo, FileReadInput, SessionDiffInput, SessionID, VcsBaseInput, VcsBaseOutput, VcsDiffInput, VcsDiffOutput,
};
use opencode_plugin::abi::{self, Host, RequestId};

use super::Diffs;
use super::viewer::{Base, File, Load, Mode, Preview, Viewer, is_image};
use crate::plugins::fetch::{data, fetch_of};

const VCS_DIFF_CONTEXT_LINES: i64 = 12;

/// A request in flight, with the viewer and the load it is for.
pub enum Asked {
    /// The base of a load's location, before its diff.
    Base { viewer: u64, load: u64, key: String },
    /// A load's diff, compared with `base`.
    Diff { viewer: u64, load: u64, base: Option<Base> },
    /// The base the base dialog shows, looked up once (`loadBase`).
    Reported { viewer: u64, key: String },
    /// An image card's working-tree bytes.
    Image { viewer: u64, load: u64, file: String },
    /// The base dialog's branches for its search `request`.
    Branches { request: u64 },
}

impl Viewer {
    pub fn load(&mut self, host: &dyn Host, diffs: &Diffs) {
        self.loads += 1;
        self.load = Load::Loading;
        self.reset(host);
        let (viewer, load, key) = (self.id, self.loads, self.base_key.clone());
        if let (Mode::Turn, Some(session)) = (self.mode, self.session()) {
            let input = SessionDiffInput {
                session_id: SessionID(session.to_owned()),
                context: Some(VCS_DIFF_CONTEXT_LINES),
                ..SessionDiffInput::default()
            };
            let call = Client::session_diff_call(&input).expect("the diff input encodes");
            return diffs.fetch(host, fetch_of(call), Asked::Diff { viewer, load, base: None });
        }
        let chosen = diffs.memory.borrow().bases.get(&key).cloned();
        match (self.mode.needs_base(), chosen, self.reported.get(&key).cloned()) {
            (false, ..) => self.fetch_diff(host, diffs, None),
            (true, Some(reference), _) => {
                self.fetch_diff(host, diffs, Some(Base { name: reference.clone(), reference }))
            }
            (true, None, Some(known)) => self.fetch_diff(host, diffs, known),
            (true, None, None) => {
                let call = Client::vcs_base_call(&VcsBaseInput { location: self.location_query() });
                diffs.fetch(host, fetch_of(call.expect("the base input encodes")), Asked::Base { viewer, load, key });
            }
        }
    }

    /// The diff against `base`; the committed source without one has nothing to compare.
    fn fetch_diff(&mut self, host: &dyn Host, diffs: &Diffs, base: Option<Base>) {
        if self.mode == Mode::Committed && base.is_none() {
            self.loaded(host, diffs, Ok((None, Vec::new())));
            return;
        }
        let input = VcsDiffInput {
            location: self.location_query(),
            mode: self.mode.vcs(),
            base: base.as_ref().map(|base| base.reference.clone()),
            context: Some(VCS_DIFF_CONTEXT_LINES),
            untracked: None,
        };
        let call = Client::vcs_diff_call(&input).expect("the diff input encodes");
        diffs.fetch(host, fetch_of(call), Asked::Diff { viewer: self.id, load: self.loads, base });
    }

    /// The diff arrived, or failed.
    fn loaded(&mut self, host: &dyn Host, diffs: &Diffs, result: Result<(Option<Base>, Vec<FileDiffInfo>), String>) {
        self.load = match result {
            Ok((base, files)) => Load::Ready { base, files: files.into_iter().map(File::from).collect() },
            Err(error) => {
                log::warn!("{}: {error}", super::ID);
                Load::Failed
            }
        };
        self.reset(host);
        // `DiffViewerImage`: each image card reads its working-tree bytes once per file list.
        let images: Vec<String> = match self.mode {
            Mode::Committed => Vec::new(),
            _ => self
                .files()
                .iter()
                .filter(|file| is_image(&file.file) && file.status != super::tree::Status::Deleted)
                .map(|file| file.file.clone())
                .collect(),
        };
        for file in images {
            self.previews.insert(file.clone(), Preview::Loading);
            let input = FileReadInput { location: self.location_query(), path: file.clone() };
            let call = Client::file_read_call(&input).expect("the read input encodes");
            let fetch = abi::Fetch { bytes: true, ..fetch_of(call) };
            diffs.fetch(host, fetch, Asked::Image { viewer: self.id, load: self.loads, file });
        }
    }

    /// `loadBase` for the base dialog: looks the reported base up once, when none is chosen or known.
    pub fn ensure_base(&self, host: &dyn Host, diffs: &Diffs) {
        let key = self.base_key.clone();
        if diffs.memory.borrow().bases.contains_key(&key) || self.reported.contains_key(&key) {
            return;
        }
        let call = Client::vcs_base_call(&VcsBaseInput { location: self.location_query() });
        diffs.fetch(host, fetch_of(call.expect("the base input encodes")), Asked::Reported { viewer: self.id, key });
    }

    /// A reply for this viewer.
    pub fn reply(&mut self, host: &dyn Host, diffs: &Diffs, asked: Asked, reply: Result<serde_json::Value, String>) {
        let base_of = |reply: Result<serde_json::Value, String>| -> Result<Option<Base>, String> {
            let output: VcsBaseOutput = serde_json::from_value(reply?).map_err(|error| error.to_string())?;
            Ok(output.data.map(|base| Base { name: base.name, reference: base.r#ref }))
        };
        match asked {
            Asked::Base { load, key, .. } if load == self.loads => match base_of(reply) {
                Ok(base) => {
                    self.reported.insert(key, base.clone());
                    self.fetch_diff(host, diffs, base);
                }
                Err(error) => self.loaded(host, diffs, Err(error)),
            },
            Asked::Diff { load, base, .. } if load == self.loads => {
                let files = match self.mode {
                    Mode::Turn if self.session().is_some() => data::<Vec<FileDiffInfo>>(reply),
                    _ => reply.and_then(|value| {
                        serde_json::from_value::<VcsDiffOutput>(value)
                            .map(|output| output.data)
                            .map_err(|error| error.to_string())
                    }),
                };
                self.loaded(host, diffs, files.map(|files| (base, files)));
            }
            Asked::Reported { key, .. } => {
                if let Ok(base) = base_of(reply) {
                    self.reported.insert(key, base);
                }
            }
            Asked::Image { load, file, .. } if load == self.loads => {
                let preview = match reply.and_then(|value| {
                    value.as_str().and_then(abi::base64::decode).ok_or_else(|| "not base64".to_owned())
                }) {
                    Ok(bytes) => match host.image_size(&bytes) {
                        Some(size) => Preview::Ready(bytes.into(), size),
                        None => Preview::Undecodable,
                    },
                    Err(error) => {
                        log::warn!("{}: {file}: {error}", super::ID);
                        Preview::Failed
                    }
                };
                self.previews.insert(file, preview);
            }
            Asked::Base { .. } | Asked::Diff { .. } | Asked::Image { .. } | Asked::Branches { .. } => {}
        }
    }
}

impl Asked {
    /// The viewer the request is for; `None` for the base dialog's.
    pub fn viewer(&self) -> Option<u64> {
        match self {
            Asked::Base { viewer, .. }
            | Asked::Diff { viewer, .. }
            | Asked::Reported { viewer, .. }
            | Asked::Image { viewer, .. } => Some(*viewer),
            Asked::Branches { .. } => None,
        }
    }
}

impl Diffs {
    pub fn fetch(&self, host: &dyn Host, fetch: abi::Fetch, asked: Asked) {
        self.requests.borrow_mut().insert(host.fetch(fetch), asked);
    }

    /// Takes the request `id` stood for, if it is still asked for.
    pub fn answered(&self, id: RequestId) -> Option<Asked> {
        self.requests.borrow_mut().remove(&id)
    }
}
