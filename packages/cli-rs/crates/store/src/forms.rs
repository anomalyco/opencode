//! Pending forms are kept in their session's record, or under [`GLOBAL`] for elicitations without a session.
use opencode_api::generated::*;

use crate::core::{Effect, Forms, Ticket};
use crate::location::Location;
use crate::reads::{Read, ReadKey, SessionRead};
use crate::state::{Error, Overlay, State};

/// The owner of global MCP elicitations. They temporarily use "global" instead of a real session
/// ID, so the server cannot recover their location when settling them; the store keeps the event
/// location until MCP elicitations carry session ownership.
pub const GLOBAL: &str = "global";

/// A pending form, with the location of a global elicitation (`FormWithLocation`).
#[derive(Debug, Clone, PartialEq)]
pub struct Form {
    pub info: FormInfo,
    pub location: Option<Location>,
}

/// A form read: its owner, and the location of a global one.
pub(crate) type FormRead = (String, Option<Location>);

/// The keyed read of `owner`'s forms: a session's own, or the global forms of `location`.
pub(crate) fn form_read<'a>(owner: &'a str, location: &'a Location) -> Read<'a> {
    match owner {
        GLOBAL => Read::GlobalForms(location),
        _ => Read::Session(owner, SessionRead::Forms),
    }
}

impl State {
    /// Pending forms of a session, or the global forms of `location`. Global forms need a
    /// location; `None` until read or created.
    pub fn forms(&self, owner: &str, location: Option<&Location>) -> Option<Vec<&Form>> {
        if owner != GLOBAL {
            return Some(self.sessions.get(owner)?.forms.as_ref()?.iter().collect());
        }
        let forms = self.global_forms.as_ref()?;
        let location = location?;
        Some(forms.iter().filter(|form| form.location.as_ref() == Some(location)).collect())
    }

    /// Sessions with pending forms.
    pub fn form_sessions(&self) -> Vec<&str> {
        self.sessions
            .iter()
            .filter(|session| session.forms.as_ref().is_some_and(|forms| !forms.is_empty()))
            .map(|session| session.id.as_str())
            .collect()
    }

    /// The forms of `owner`, created unread when missing.
    fn owner_forms(&mut self, owner: &str) -> &mut Vec<Form> {
        let forms = match owner {
            GLOBAL => &mut self.global_forms,
            _ => &mut self.sessions.get_or_insert(owner).forms,
        };
        forms.get_or_insert_default()
    }

    pub(crate) fn on_form_created(&mut self, form: &FormInfo, location: &Location) {
        // A session the store found missing shows nothing, whatever arrives late (model O9).
        if self.is_missing(&form.session_id) {
            return;
        }
        let item = Form {
            info: FormInfo {
                id: form.id.clone(),
                session_id: form.session_id.clone(),
                title: form.title.clone(),
                metadata: form.metadata.clone(),
                fields: form.fields.clone(),
            },
            location: (form.session_id == GLOBAL).then(|| location.clone()),
        };
        self.record_form(&form.session_id, &form.id, Some(location), Some(&item));
        let forms = self.owner_forms(&form.session_id);
        if forms.iter().any(|item| item.info.id == form.id) {
            return;
        }
        forms.push(item);
        self.touch_forms(&form.session_id);
    }

    /// Removes a form; a global form only at `location`, when given. True when one was removed.
    pub(crate) fn remove_form(&mut self, owner: &str, id: &FormID, location: Option<&Location>) -> bool {
        self.record_form(owner, id, location, None);
        let forms = match owner {
            GLOBAL => self.global_forms.as_mut(),
            _ => self.sessions.get_mut(owner).and_then(|session| session.forms.as_mut()),
        };
        let Some(forms) = forms else { return false };
        let before = forms.len();
        forms.retain(|form| {
            if form.info.id != *id {
                return true;
            }
            let (GLOBAL, Some(location)) = (owner, location) else { return false };
            form.location.as_ref() != Some(location)
        });
        if forms.len() == before {
            return false;
        }
        self.touch_forms(owner);
        true
    }

    /// Adds a create (`Some`) or a settlement to the overlays of the owner's form reads in flight: a
    /// global form's only at `location`, when given.
    fn record_form(&mut self, owner: &str, id: &FormID, location: Option<&Location>, change: Option<&Form>) {
        let reads = self
            .form_reads
            .iter_mut()
            .filter(|((read, at), _)| read == owner && (location.is_none() || at.is_none() || at.as_ref() == location));
        for (_, read) in reads {
            read.record(&id.0, change.cloned());
        }
    }

    /// Begins a read of the forms of `ticket`'s owner, with an overlay of the forms created and settled meanwhile.
    pub(crate) fn begin_forms(&mut self, ticket: Ticket) -> Forms {
        let (owner, location) = match ticket.key {
            ReadKey::Session(key, _) => (self.sessions[key].id.0.clone(), None),
            ReadKey::GlobalForms(at) => (GLOBAL.to_owned(), self.location_at(at).cloned()),
            _ => unreachable!("a form read"),
        };
        let read = self.token();
        let form = (owner, location);
        self.form_reads.insert(form.clone(), Overlay::new(read));
        Forms { ticket, form, read, started: self.deletion_epoch }
    }

    /// Publishes the form read `read` with the forms created and settled during it, unless a newer read or a
    /// deletion of the owner since it began supersedes it. An overflowed overlay reads again instead.
    pub(crate) fn complete_forms(
        &mut self,
        forms: Forms,
        result: Result<(Vec<Form>, Option<Location>), Error>,
        effects: &mut Vec<Effect>,
    ) {
        let overlay = Overlay::take(&mut self.form_reads, &forms.form, forms.read);
        let (owner, location) = forms.form;
        let (list, at) = match result {
            Ok(found) => found,
            Err(error) => {
                if owner != GLOBAL {
                    self.evict_missing(&error);
                }
                return;
            }
        };
        let Some(overlay) = overlay else { return };
        if self.deleted_since(&owner, forms.started) {
            return;
        }
        match overlay.apply(list, |form| &form.info.id.0) {
            Some(list) => self.publish_forms(&owner, list, at),
            None => {
                self.invalidate_key(forms.ticket.key);
                effects.push(Effect::Forms(owner, location));
            }
        }
    }

    /// Drops the form a reply or a cancel settled; the owner's other forms are read again at once.
    pub(crate) fn complete_form_reply(
        &mut self,
        owner: String,
        id: &FormID,
        location: Option<Location>,
        effects: &mut Vec<Effect>,
    ) {
        if !self.remove_form(&owner, id, location.as_ref()) {
            return;
        }
        let at = location.unwrap_or_else(|| self.default_location().clone());
        self.invalidate(form_read(&owner, &at));
        effects.push(Effect::FormsReplied(owner, at));
    }

    /// Publishes a form read; a global read only replaces the forms of `at`, where the server read them.
    fn publish_forms(&mut self, owner: &str, mut list: Vec<Form>, at: Option<Location>) {
        let forms = self.owner_forms(owner);
        match at {
            Some(at) => {
                // Forms created at another location stay where `on_form_created` put them.
                list.retain(|form| form.location.as_ref() == Some(&at));
                forms.retain(|form| form.location.as_ref() != Some(&at));
                forms.extend(list);
            }
            None => *forms = list,
        }
        self.touch_forms(owner);
    }
}
