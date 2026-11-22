//! Pending forms are kept in their session's record, or under [`GLOBAL`] for elicitations without a session.
use opencode_api::client::Client;
use opencode_api::generated::*;

use crate::location::Location;
use crate::reads::{Read, SessionRead};
use crate::state::{Data, Error, Overlay, State, Task, evict_missing};

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
fn form_read<'a>(owner: &'a str, location: &'a Location) -> Read<'a> {
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

impl Data {
    /// Reads pending forms for a session or location. Forms created or settled during the read take precedence over
    /// its snapshot.
    pub fn form_sync(&self, owner: &str, location: Option<&Location>) -> Task<()> {
        let location = location.cloned().unwrap_or_else(|| self.read(|state| state.default_location().clone()));
        let owner = owner.to_owned();
        let read: FormRead = (owner.clone(), (owner == GLOBAL).then(|| location.clone()));
        let again = (owner.clone(), location.clone());
        self.overlay_sync(
            self.keyed(form_read(&owner, &location)),
            SessionID(owner.clone()),
            read,
            |state, read, overlay| {
                state.form_reads.insert(read.clone(), overlay);
            },
            |state, read, ticket| Overlay::take(&mut state.form_reads, read, ticket),
            |form| &form.info.id.0,
            move |data| async move {
                if owner == GLOBAL {
                    let response = data
                        .client()
                        .form_list(&FormListInput { location: location.query() })
                        .await
                        .map_err(Error::new)?;
                    let at = Location::from(&response.location);
                    let list = response
                        .data
                        .into_iter()
                        .filter(|form| form.session_id == GLOBAL)
                        .map(|info| Form { info, location: Some(at.clone()) });
                    return Ok((list.collect(), Some(at)));
                }
                let list = data
                    .client()
                    .session_form_list(&SessionFormListInput { session_id: owner.clone() })
                    .await
                    .map_err(|error| evict_missing(&data, error))?;
                Ok((list.into_iter().map(|info| Form { info, location: None }).collect(), None))
            },
            |state, read, list, at| state.publish_forms(&read.0, list, at),
            move |data| data.form_sync(&again.0, Some(&again.1)),
        )
    }

    pub fn form_invalidate(&self, owner: &str, location: Option<&Location>) {
        self.write(|state| {
            let location = location.unwrap_or(state.default_location()).clone();
            state.invalidate(form_read(owner, &location));
        });
    }

    /// Answers a form and drops it. A form that is already settled counts as answered. A global
    /// form needs its location, which the request names in a header.
    pub async fn form_reply(&self, input: SessionFormReplyInput, location: Option<&Location>) -> Result<(), Error> {
        let result = form_client(self.client(), &input.session_id, location).session_form_reply(&input).await;
        self.settle_form(&input.session_id, &input.form_id, location, result)
    }

    /// Cancels a form and drops it; see [`Data::form_reply`].
    pub async fn form_cancel(&self, input: SessionFormCancelInput, location: Option<&Location>) -> Result<(), Error> {
        let result = form_client(self.client(), &input.session_id, location).session_form_cancel(&input).await;
        self.settle_form(&input.session_id, &input.form_id, location, result)
    }

    fn settle_form(
        &self,
        owner: &str,
        id: &FormID,
        location: Option<&Location>,
        result: Result<(), opencode_api::error::Error>,
    ) -> Result<(), Error> {
        if let Err(error) = result {
            let settled = error.declared().is_some_and(|declared| {
                matches!(declared.tag.as_deref(), Some("FormNotFoundError" | "FormAlreadySettledError"))
                    && declared.body.get("id").and_then(serde_json::Value::as_str) == Some(id.0.as_str())
            });
            if !settled {
                return Err(Error::new(error));
            }
        }
        if !self.write(|state| state.remove_form(owner, id, location)) {
            return Ok(());
        }
        // The form may have been one of several; read the rest again.
        self.form_invalidate(owner, location);
        drop(self.form_sync(owner, location));
        Ok(())
    }
}

/// Global forms name their location in a header (`formRequestOptions`).
fn form_client(client: &Client, owner: &str, location: Option<&Location>) -> Client {
    match (owner, location) {
        (GLOBAL, Some(location)) => {
            client.with_header("x-opencode-directory", opencode_api::js::encode_component(&location.directory))
        }
        _ => client.clone(),
    }
}
