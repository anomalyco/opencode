//! Diff source dialog (E.15b, row DLG47, `openSwitchDiffDialog` in `feature-plugins/system/diff-viewer.tsx`): the
//! sources the viewer offers, then "Base", which opens the base branch dialog. Also the last turn's refetch when a
//! turn ends.

use std::rc::{Rc, Weak};

use opencode_store::SessionStatus;
use opencode_ui::bind;
use opencode_ui::dialog::DialogOptions;
use opencode_ui::select::{self, SelectOption, SelectProps};

use super::viewer::{Mode, Viewer};

/// The width the labels are padded to, so the descriptions line up (`padEnd(11)`).
const LABEL_WIDTH: usize = 11;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Choice {
    Source(Mode),
    Base,
}

/// `diff.switch_source` and a click on the source header (`openSwitchDiffDialog`).
pub fn open(viewer: &Viewer) {
    let Some(tui) = viewer.tui() else { return };
    let base = viewer.source_base().map_or_else(|| "Choose…".to_owned(), |base| base.name);
    let options: Vec<SelectOption<Choice>> = viewer
        .sources()
        .into_iter()
        .map(|mode| {
            SelectOption::new(format!("{:<LABEL_WIDTH$}", mode.label()), Choice::Source(mode))
                .description(mode.description())
        })
        .chain([SelectOption::new(format!("{:<LABEL_WIDTH$}", "Base"), Choice::Base).description(base)])
        .collect();
    let current = Choice::Source(viewer.mode());
    let weak = viewer.weak();
    tui.dialogs.replace(
        move |cx| {
            let mut props = SelectProps::new("Diff source", options);
            props.skip_filter = true;
            props.render_filter = false;
            props.current = Some(current);
            props.on_select = Some(Rc::new(bind!(weak, |viewer, option: &SelectOption<Choice>| {
                let Some(tui) = viewer.tui() else { return };
                let choice = option.value;
                // The select's handler returns before the dialog it runs in closes or is replaced.
                tui.app.defer(bind!(weak, |viewer, _| {
                    match choice {
                        Choice::Source(mode) => {
                            if let Some(tui) = viewer.tui() {
                                tui.dialogs.clear();
                            }
                            viewer.switch_source(mode);
                            observe(&viewer);
                        }
                        Choice::Base => super::base_branch::open(&viewer),
                    }
                }));
            })));
            select::select(cx, props).0
        },
        None,
        DialogOptions::default(),
    );
}

/// Each completed turn replaces the last one: in `turn` mode, the viewer loads again when its session goes from
/// running to idle (the `createEffect` on `session.status`). The watch ends with the viewer.
pub fn watch(viewer: &Rc<Viewer>) {
    let Some(tui) = viewer.tui() else { return };
    if viewer.session().is_none() {
        return;
    }
    observe(viewer);
    next(viewer.weak(), tui.data.subscribe());
}

fn next(viewer: Weak<Viewer>, mut revisions: tokio::sync::watch::Receiver<u64>) {
    let Some(tui) = viewer.upgrade().and_then(|viewer| viewer.tui()) else {
        return;
    };
    tui.app.spawn(async move { revisions.changed().await.is_ok().then_some(revisions) }, move |_, revisions| {
        let (Some(live), Some(revisions)) = (viewer.upgrade(), revisions) else {
            return;
        };
        observe(&live);
        next(viewer, revisions);
    });
}

/// Reads the session's status in `turn` mode and loads again on running to idle; other modes forget it.
fn observe(viewer: &Viewer) {
    let (Some(tui), Some(session)) = (viewer.tui(), viewer.session().cloned()) else {
        return;
    };
    if viewer.mode() != Mode::Turn {
        viewer.turn_status.set(None);
        return;
    }
    let status = tui.data.read(|state| state.status(&session));
    let previous = viewer.turn_status.replace(Some(status));
    if previous == Some(SessionStatus::Running) && status == SessionStatus::Idle {
        viewer.reload();
    }
}
