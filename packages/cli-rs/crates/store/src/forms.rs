//! Pending forms (F.8), keyed by owner: a session ID, or [`GLOBAL`] for MCP elicitations that
//! have no session yet.
use opencode_api::client::Client;
use opencode_api::generated::*;

use crate::location::Location;
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
pub(crate) type Read = (String, Option<Location>);

pub(crate) fn sync_key(owner: &str, location: &Location) -> String {
    let scope = if owner == GLOBAL { location.key() } else { String::new() };
    format!("session.form:{owner}:{scope}")
}

impl State {
    /// Pending forms of a session, or the global forms of `location`. Global forms need a
    /// location; `None` until read or created.
    pub fn forms(&self, owner: &str, location: Option<&Location>) -> Option<Vec<&Form>> {
        let forms = self.forms.get(owner)?;
        if owner != GLOBAL {
            return Some(forms.iter().collect());
        }
        let location = location?;
        Some(forms.iter().filter(|form| form.location.as_ref() == Some(location)).collect())
    }

    /// Sessions with pending forms.
    pub fn form_sessions(&self) -> Vec<&str> {
        self.forms
            .iter()
            .filter(|(owner, forms)| owner.as_str() != GLOBAL && !forms.is_empty())
            .map(|(owner, _)| owner.as_str())
            .collect()
    }

    pub(crate) fn on_form_created(&mut self, form: &FormInfo, location: &Location) {
        // A session the store found missing shows nothing, whatever arrives late (model O9).
        if self.missing.contains(&SessionID(form.session_id.clone())) {
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
        let forms = self.forms.entry(form.session_id.clone()).or_default();
        if forms.iter().any(|item| item.info.id == form.id) {
            return;
        }
        forms.push(item);
        self.log.forms(&form.session_id);
    }

    /// Removes a form; a global form only at `location`, when given. True when one was removed.
    pub(crate) fn remove_form(&mut self, owner: &str, id: &FormID, location: Option<&Location>) -> bool {
        self.record_form(owner, id, location, None);
        let Some(forms) = self.forms.get_mut(owner) else { return false };
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
        self.log.forms(owner);
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

    /// Publishes the forms read `ticket` started, with its overlay applied; a global read only
    /// replaces the forms of `at`, where the server read them. True when the overlay overflowed:
    /// nothing is published and the read is invalidated, so the caller reads again.
    fn publish_forms(&mut self, read: &Read, ticket: u64, started: u64, list: Vec<Form>, at: Option<Location>) -> bool {
        let Some(overlay) = Overlay::take(&mut self.form_reads, read, ticket) else { return false };
        let owner = &read.0;
        if self.deleted_since(&SessionID(owner.clone()), started) {
            return false;
        }
        let Some(mut list) = overlay.apply(list, |form| &form.info.id.0) else {
            let key = sync_key(owner, read.1.as_ref().unwrap_or(&self.default_location));
            self.syncs.invalidate(&key);
            return true;
        };
        let forms = self.forms.entry(owner.clone()).or_default();
        match at {
            Some(at) => {
                // Forms created at another location stay where `on_form_created` put them.
                list.retain(|form| form.location.as_ref() == Some(&at));
                forms.retain(|form| form.location.as_ref() != Some(&at));
                forms.extend(list);
            }
            None => *forms = list,
        }
        self.log.forms(owner);
        false
    }
}

impl Data {
    /// Reads pending forms once per invalidation: a session's, or the global forms of a location
    /// (the default one for `None`). Forms created or settled while the read was in flight win over
    /// the snapshot (model M1, deviation O89-list-snapshots).
    pub fn form_sync(&self, owner: &str, location: Option<&Location>) -> Task<()> {
        let location = location.cloned().unwrap_or_else(|| self.read(|state| state.default_location().clone()));
        let owner = owner.to_owned();
        let key = sync_key(&owner, &location);
        let read: Read = (owner.clone(), (owner == GLOBAL).then(|| location.clone()));
        let begin = read.clone();
        self.sync_start(
            key,
            move |state| {
                let ticket = state.token();
                state.form_reads.insert(begin, Overlay::new(ticket));
                (state.deletion_epoch, ticket)
            },
            move |data, (started, ticket)| async move {
                let response = if owner == GLOBAL {
                    data.client()
                        .form_list(&FormListInput { location: location.query() })
                        .await
                        .map_err(Error::new)
                        .map(|response| {
                            let at = Location::from(&response.location);
                            let list = response
                                .data
                                .into_iter()
                                .filter(|form| form.session_id == GLOBAL)
                                .map(|info| Form { info, location: Some(at.clone()) });
                            (list.collect(), Some(at))
                        })
                } else {
                    data.client()
                        .session_form_list(&SessionFormListInput { session_id: owner.clone() })
                        .await
                        .map_err(|error| evict_missing(&data, error))
                        .map(|list| (list.into_iter().map(|info| Form { info, location: None }).collect(), None))
                };
                let (list, at) = match response {
                    Ok(response) => response,
                    Err(error) => {
                        data.write(|state| Overlay::take(&mut state.form_reads, &read, ticket));
                        return Err(error);
                    }
                };
                if data.write(|state| state.publish_forms(&read, ticket, started, list, at)) {
                    data.refresh(|data| data.form_sync(&owner, Some(&location)));
                }
                Ok(())
            },
        )
    }

    pub fn form_invalidate(&self, owner: &str, location: Option<&Location>) {
        self.write(|state| {
            let location = location.unwrap_or(state.default_location()).clone();
            state.syncs.invalidate(&sync_key(owner, &location));
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
        (GLOBAL, Some(location)) => client.with_header("x-opencode-directory", encode_component(&location.directory)),
        _ => client.clone(),
    }
}

/// `encodeURIComponent`.
fn encode_component(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn encodes_like_encode_uri_component() {
        assert_eq!(super::encode_component("/tmp/a b&c=d/é(x)!"), "%2Ftmp%2Fa%20b%26c%3Dd%2F%C3%A9(x)!");
    }
}
