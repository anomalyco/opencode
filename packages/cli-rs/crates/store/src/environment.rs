//! The client's environment, uploaded to a session so its shells and tools run with the
//! terminal's variables (G13). Only clients of a local server upload it.

use indexmap::IndexMap;
use opencode_api::client::{Client, RequestOptions};
use opencode_api::generated::{SessionEnvironmentInput, SessionID};

/// Variables that never leave the client: the server password, under both names.
const PRIVATE: [&str; 2] = ["OPENCODE_PASSWORD", "OPENCODE_SERVER_PASSWORD"];

/// `Env.session()`: the process environment without the password variables. Variables whose
/// name or value is not UTF-8 are skipped, as Node's `process.env` cannot hold them either.
pub fn session_environment() -> IndexMap<String, String> {
    filter(std::env::vars_os().filter_map(|(name, value)| Some((name.into_string().ok()?, value.into_string().ok()?))))
}

/// The password filter of [`session_environment`] over any variables.
pub fn filter(variables: impl IntoIterator<Item = (String, String)>) -> IndexMap<String, String> {
    variables.into_iter().filter(|(name, _)| !PRIVATE.contains(&name.as_str())).collect()
}

/// Replaces the session's client environment (`session.environment`).
pub async fn upload(
    client: &Client,
    session: &SessionID,
    variables: IndexMap<String, String>,
) -> Result<(), opencode_api::error::Error> {
    client
        .session_environment(
            &SessionEnvironmentInput { session_id: session.clone(), variables },
            &RequestOptions::default(),
        )
        .await
}

#[cfg(test)]
mod tests {
    #[test]
    fn drops_the_password_variables() {
        let variables = super::filter([
            ("PATH".to_owned(), "/bin".to_owned()),
            ("OPENCODE_PASSWORD".to_owned(), "secret".to_owned()),
            ("OPENCODE_SERVER_PASSWORD".to_owned(), "legacy".to_owned()),
            ("OPENCODE_PASSWORD_HINT".to_owned(), "kept".to_owned()),
        ]);
        assert_eq!(variables.keys().collect::<Vec<_>>(), ["PATH", "OPENCODE_PASSWORD_HINT"]);
    }
}
