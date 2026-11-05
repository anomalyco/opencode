//! Loading: the diff for the source, the reported base, and image previews.

use std::rc::Rc;

use opencode_api::client::RequestOptions;
use opencode_api::generated::{FileReadInput, SessionDiffInput, VcsBaseInput, VcsDiffInput};
use opencode_ui::bind;

use super::render::fill_image;
use super::{Base, File, ID, Load, Mode, Preview, VCS_DIFF_CONTEXT_LINES, Viewer, query};
use crate::app::Tui;
use crate::plugins::diffs::tree;

impl Viewer {
    /// `loadBase` for the base dialog: looks the reported base up once, when none is chosen or known.
    pub fn ensure_base(&self) {
        let key = self.base_key();
        if self.chosen_base(&key).is_some() || self.reported_base(&key).is_some() {
            return;
        }
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let client = tui.data.client().clone();
        let input = VcsBaseInput { location: self.location() };
        let weak = self.this.clone();
        tui.app.spawn(async move { client.vcs_base(&input, &RequestOptions::default()).await }, move |_, result| {
            let (Some(viewer), Ok(output)) = (weak.upgrade(), result) else {
                return;
            };
            let base = output.data.map(|base| Base { name: base.name, reference: base.r#ref });
            viewer.state.borrow_mut().reported.insert(key, base);
        });
    }

    pub(super) fn load(&self) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let (generation, mode, location, key) = {
            let mut state = self.state.borrow_mut();
            state.generation += 1;
            state.load = Load::Loading;
            (state.generation, state.mode, state.location.clone(), state.base_key.clone())
        };
        self.reset();
        self.refresh();
        let client = tui.data.client().clone();
        let session = self.session().cloned().filter(|_| mode == Mode::Turn);
        let chosen = self.shared.memory.borrow().bases.get(&key).cloned();
        let known = self.state.borrow().reported.get(&key).cloned();
        let weak = self.this.clone();
        tui.app.spawn(
            async move {
                let options = RequestOptions::default();
                if let Some(session) = session {
                    let input = SessionDiffInput {
                        session_id: session,
                        context: Some(VCS_DIFF_CONTEXT_LINES),
                        ..SessionDiffInput::default()
                    };
                    let files = client.session_diff(&input, &options).await?;
                    return Ok((None, None, files));
                }
                let mut reported = None;
                let base = match (mode.needs_base(), chosen, known) {
                    (false, ..) => None,
                    (true, Some(reference), _) => Some(Base { name: reference.clone(), reference }),
                    (true, None, Some(known)) => known,
                    (true, None, None) => {
                        let input = VcsBaseInput { location: query(&location) };
                        let base = client
                            .vcs_base(&input, &options)
                            .await?
                            .data
                            .map(|base| Base { name: base.name, reference: base.r#ref });
                        reported = Some(base.clone());
                        base
                    }
                };
                if mode == Mode::Committed && base.is_none() {
                    return Ok((reported, None, Vec::new()));
                }
                let input = VcsDiffInput {
                    location: query(&location),
                    mode: mode.vcs(),
                    base: base.as_ref().map(|base| base.reference.clone()),
                    context: Some(VCS_DIFF_CONTEXT_LINES),
                    untracked: None,
                };
                let files = client.vcs_diff(&input, &options).await?.data;
                Ok::<_, opencode_api::error::Error>((reported, base, files))
            },
            bind!(weak, |viewer, _, result| {
                {
                    let mut state = viewer.state.borrow_mut();
                    if state.generation != generation {
                        return;
                    }
                    state.load = match result {
                        Ok((reported, base, files)) => {
                            if let Some(reported) = reported {
                                state.reported.insert(key, reported);
                            }
                            Load::Ready { base, files: files.into_iter().map(File::from).collect() }
                        }
                        Err(error) => {
                            log::warn!("{ID}: {error}");
                            Load::Failed
                        }
                    };
                }
                viewer.reset();
                viewer.refresh();
            }),
        );
    }

    /// New files: the tree opens fully, and the selection and reviewed marks start over.
    pub(super) fn reset(&self) {
        drop(self.menu.take());
        self.previews.borrow_mut().clear();
        let files = self.files();
        let mut state = self.state.borrow_mut();
        state.tree = tree::build(files.iter().map(|file| file.file.as_str()));
        state.expanded = tree::all_expanded(&state.tree);
        state.selected = None;
        state.selected_hunk = None;
        state.reviewed.clear();
        state.exhausted = None;
        state.pending = None;
    }

    /// `sourceDetail`: what the header says after the source's name.
    pub(super) fn source_detail(&self) -> Option<String> {
        let state = self.state.borrow();
        match (&state.load, state.mode) {
            (Load::Failed, Mode::Turn) => Some("Diff unavailable".to_owned()),
            (_, Mode::Turn) => None,
            (_, Mode::Working) => Some("vs HEAD".to_owned()),
            (Load::Failed, _) => Some("Base or diff unavailable".to_owned()),
            (Load::Loading, _) => Some("Resolving diff…".to_owned()),
            (Load::Ready { base: None, .. }, _) => Some("Base not reported".to_owned()),
            (Load::Ready { base: Some(base), .. }, _) => Some(format!("vs {}", base.name)),
        }
    }

    pub(super) fn read_image(&self, tui: &Tui, file: &str) {
        self.previews.borrow_mut().insert(file.to_owned(), Preview::Loading);
        let client = tui.data.client().clone();
        let input = FileReadInput { location: self.location(), path: file.to_owned() };
        let (weak, file, generation) = (self.this.clone(), file.to_owned(), self.state.borrow().generation);
        tui.app.spawn(
            async move { client.file_read(&input, &RequestOptions::default()).await },
            bind!(weak, |viewer, _, result| {
                let Some(tui) = viewer.tui.upgrade() else {
                    return;
                };
                if viewer.state.borrow().generation != generation {
                    return;
                }
                let preview = match result {
                    Ok(bytes) => Preview::Ready(Rc::new(bytes.to_vec())),
                    Err(error) => {
                        log::warn!("{ID}: {file}: {error}");
                        Preview::Failed
                    }
                };
                viewer.previews.borrow_mut().insert(file.clone(), preview.clone());
                let slot =
                    viewer.parts.borrow().images.iter().find(|(shown, _)| *shown == file).map(|(_, slot)| slot.clone());
                if let Some(slot) = slot {
                    let theme = tui.page();
                    let height = (tui.app.size().1 / 4).clamp(3, 8);
                    fill_image(&tui, &theme, &slot, &file, height, &preview);
                    tui.app.request_redraw();
                }
            }),
        );
    }
}
