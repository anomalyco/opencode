//! Base branch dialog (E.15b, row DLG46, `DiffBaseDialog` in `feature-plugins/system/diff-viewer.tsx`): the
//! location's local and remote branches, searched on the server as the user types (the host's query, after 150 ms).
//! The chosen branch is remembered per location and branch while the plugin is active.

use opencode_api::client::Client;
use opencode_api::generated::{LocationQueryInput, VcsBranchListInput, VcsBranchListOutput};
use opencode_plugin::abi::{Action, Dialog, Host, Select, SelectOption, Span};

use super::load::Asked;
use super::viewer::{Base, Viewer};
use super::{Diffs, PICK_BASE, QUERY_BASE};
use crate::plugins::fetch::fetch_of;

/// The select's key, which shows again in place as branches arrive.
pub const KEY: &str = "base";
/// `createDebouncedSignal("", 150)`.
const SEARCH_DEBOUNCE_MS: u16 = 150;
const LIMIT: i64 = 100;

#[derive(Clone, Default)]
enum Branches {
    #[default]
    Loading,
    Failed,
    Ready(Vec<String>),
}

/// The open picker.
#[derive(Default)]
pub struct Picker {
    /// The viewer's base key it chooses for, and its location.
    key: String,
    location: Option<LocationQueryInput>,
    current: Option<String>,
    branches: Branches,
    search: Option<String>,
    /// The searches so far: a reply to an earlier one changes nothing.
    request: u64,
}

/// "Base" in the source dialog (`onChooseBase`): replaces it with the branch picker.
pub fn open(host: &dyn Host, viewer: &Viewer, diffs: &Diffs) {
    let key = viewer.base_key.clone();
    viewer.ensure_base(host, diffs);
    let chosen = diffs.memory.borrow().bases.get(&key).cloned();
    let current = chosen
        .or_else(|| viewer.reported.get(&key).cloned().flatten().map(|base| base.reference))
        .map(|reference| short(&reference).to_owned());
    let request = diffs.picker.borrow().request;
    *diffs.picker.borrow_mut() =
        Picker { key, location: viewer.location_query(), current, request, ..Picker::default() };
    host.dialog(Dialog::Select(select(&diffs.picker.borrow())));
    query(host, diffs, String::new());
}

/// The base the server reported for `key` arrived: an open picker for it with no branch chosen marks it its current
/// one, as TS's `reportedBases()` does (carbon's review of P6c, 6).
pub fn reported(host: &dyn Host, diffs: &Diffs, key: &str, base: Option<&Base>) {
    let mut picker = diffs.picker.borrow_mut();
    let chosen = diffs.memory.borrow().bases.contains_key(key);
    let Some(base) = base.filter(|_| picker.key == key && picker.current.is_none() && !chosen) else { return };
    picker.current = Some(short(&base.reference).to_owned());
    if host.dialog_open(KEY) {
        host.dialog(Dialog::Select(select(&picker)));
    }
}

/// The picker's select, as it stands.
fn select(picker: &Picker) -> Select {
    let options = match &picker.branches {
        Branches::Ready(names) => names.iter().map(|name| SelectOption::new(name.clone(), name.clone())).collect(),
        _ => Vec::new(),
    };
    let empty = match picker.branches {
        Branches::Loading => Span::new("Loading branches…").fg("text.muted"),
        Branches::Failed => {
            Span::new("Could not load branches. Reopen the picker to try again.").fg("text.feedback.error.base")
        }
        Branches::Ready(_) => Span::new("No branches found").fg("text.muted"),
    };
    Select::new("Base branch", options, Action::Command { name: PICK_BASE.to_owned(), input: None })
        .with_key(Some(KEY.to_owned()))
        .with_placeholder(Some("Search local and remote branches".to_owned()))
        .with_current(picker.current.clone())
        .with_query(Some(Action::Command { name: QUERY_BASE.to_owned(), input: None }))
        .with_query_delay(SEARCH_DEBOUNCE_MS)
        .with_empty(Some(empty))
        .with_note(Some(Span::new("Remembered until the TUI exits").fg("text.muted")))
}

/// `branches`: a resource of the debounced search, read again only when the search changes.
pub fn query(host: &dyn Host, diffs: &Diffs, search: String) {
    let mut picker = diffs.picker.borrow_mut();
    if picker.search.as_ref() == Some(&search) {
        return;
    }
    picker.search = Some(search.clone());
    picker.request += 1;
    picker.branches = Branches::Loading;
    if host.dialog_open(KEY) {
        host.dialog(Dialog::Select(select(&picker)));
    }
    let input = VcsBranchListInput { location: picker.location.clone(), search: Some(search), limit: Some(LIMIT) };
    let call = Client::vcs_branch_list_call(&input).expect("the branch input encodes");
    let request = picker.request;
    drop(picker);
    diffs.fetch(host, fetch_of(call), Asked::Branches { request });
}

/// The branches of search `request` arrived, or did not.
pub fn reply(host: &dyn Host, diffs: &Diffs, request: u64, reply: Result<serde_json::Value, String>) {
    let mut picker = diffs.picker.borrow_mut();
    if picker.request != request {
        return;
    }
    let branches = reply.and_then(|value| {
        serde_json::from_value::<VcsBranchListOutput>(value)
            .map(|output| output.data)
            .map_err(|error| error.to_string())
    });
    picker.branches = match branches {
        Ok(names) => Branches::Ready(names),
        Err(error) => {
            log::warn!("diff base branches: {error}");
            Branches::Failed
        }
    };
    if host.dialog_open(KEY) {
        host.dialog(Dialog::Select(select(&picker)));
    }
}

/// The base key the open picker chooses for.
pub fn key(diffs: &Diffs) -> String {
    diffs.picker.borrow().key.clone()
}

/// The branch name of a ref, as the list shows it.
fn short(reference: &str) -> &str {
    reference.strip_prefix("refs/heads/").or_else(|| reference.strip_prefix("refs/remotes/")).unwrap_or(reference)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refs_show_as_branch_names() {
        assert_eq!(short("refs/heads/main"), "main");
        assert_eq!(short("refs/remotes/origin/dev"), "origin/dev");
        assert_eq!(short("main"), "main");
    }
}
