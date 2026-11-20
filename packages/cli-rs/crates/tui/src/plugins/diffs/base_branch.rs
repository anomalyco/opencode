//! Choose a local or remote comparison branch.

use opencode_api::client::Client;
use opencode_api::generated::{LocationQueryInput, VcsBranchListInput, VcsBranchListOutput};
use opencode_plugin::abi::{Action, Dialog, Host, Select, SelectOption, Span};

use super::load::Asked;
use super::viewer::{Base, Viewer};
use super::{Diffs, PICK_BASE, QUERY_BASE};
use crate::plugins::fetch::fetch_of;

pub const KEY: &str = "base";
const SEARCH_DEBOUNCE_MS: u16 = 150;
const LIMIT: i64 = 100;

#[derive(Clone, Default)]
enum Branches {
    #[default]
    Loading,
    Failed,
    Ready(Vec<String>),
}

#[derive(Default)]
pub struct Picker {
    key: String,
    location: Option<LocationQueryInput>,
    current: Option<String>,
    branches: Branches,
    search: Option<String>,
    request: u64,
}

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

pub fn reported(host: &dyn Host, diffs: &Diffs, key: &str, base: Option<&Base>) {
    let mut picker = diffs.picker.borrow_mut();
    let chosen = diffs.memory.borrow().bases.contains_key(key);
    let Some(base) = base.filter(|_| picker.key == key && picker.current.is_none() && !chosen) else { return };
    picker.current = Some(short(&base.reference).to_owned());
    if host.dialog_open(KEY) {
        host.dialog(Dialog::Select(select(&picker)));
    }
}

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
    Select::new("Base branch", options, Action::command(PICK_BASE))
        .key(KEY)
        .placeholder("Search local and remote branches")
        .maybe(picker.current.clone(), Select::current)
        .query(Action::command(QUERY_BASE))
        .query_delay(SEARCH_DEBOUNCE_MS)
        .empty(empty)
        .note(Span::new("Remembered until the TUI exits").fg("text.muted"))
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
    if let Err((_, error)) = diffs.fetch(host, fetch_of(call), Asked::Branches { request }) {
        reply(host, diffs, request, Err(error));
    }
}

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

pub fn key(diffs: &Diffs) -> String {
    diffs.picker.borrow().key.clone()
}

fn short(reference: &str) -> &str {
    reference.strip_prefix("refs/heads/").or_else(|| reference.strip_prefix("refs/remotes/")).unwrap_or(reference)
}
