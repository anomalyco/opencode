//! Classifies a registered service by its response to `/api/info`.

use std::sync::Arc;
use std::time::Duration;

use opencode_api::client::{Auth, Client};
use opencode_api::error::Error;
use opencode_api::transport::{Request, Transport};
use opencode_local::registration::Registration;

pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(2);

/// A server URL and its credentials. `Debug` hides the password.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoint {
    pub url: String,
    pub auth: Option<Auth>,
}

impl Endpoint {
    /// An endpoint with Basic credentials for user `opencode`, or none.
    pub fn new(url: impl Into<String>, password: Option<String>) -> Self {
        Self { url: url.into(), auth: password.map(Auth::password) }
    }

    /// An API client for this endpoint on `transport`.
    pub fn client(&self, transport: Arc<dyn Transport>) -> Result<Client, Error> {
        let client = Client::with_transport(&self.url, transport)?;
        Ok(match &self.auth {
            Some(auth) => client.auth(auth.clone()),
            None => client,
        })
    }
}

/// The probe's view of a service's startup.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Ready,
    Waiting,
    Failed,
}

/// A registered service that answered its probe (`LocalService`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalService {
    pub registration: Registration,
    pub endpoint: Endpoint,
    pub version: Option<String>,
    pub state: State,
    /// False when the server has no `/api/info` (an incompatible health protocol).
    pub compatible: bool,
}

/// The result of one probe. `timed_out` tells an unresponsive service from one that is gone.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Probe {
    pub service: Option<LocalService>,
    pub timed_out: bool,
}

/// What a client does with a service that answered (`decide`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Decision {
    Reuse,
    Wait,
    /// The version does not meet the requirement. `handoff` keeps persistent terminals, which only
    /// a ready service can hand over. `ensure` replaces the service only when its caller required a
    /// version (`docs/architecture.md`).
    Replace {
        handoff: bool,
    },
    Fail(String),
}

/// A version requirement: none, or a predicate on the service version (`DiscoverOptions.version`).
pub type Requirement<'a> = Option<&'a dyn Fn(&str) -> bool>;

pub fn matches_version(version: Option<&str>, required: Requirement<'_>) -> bool {
    match (required, version) {
        (None, _) => true,
        (Some(_), None) => false,
        (Some(required), Some(version)) => required(version),
    }
}

const INCOMPATIBLE: &str =
    "Background service uses an incompatible health protocol. Update this client or explicitly restart the service.";

pub fn decide(service: &LocalService, required: Requirement<'_>) -> Decision {
    if !matches_version(service.version.as_deref(), required) {
        return Decision::Replace { handoff: service.state == State::Ready };
    }
    if !service.compatible {
        return Decision::Fail(INCOMPATIBLE.to_owned());
    }
    match service.state {
        State::Ready => Decision::Reuse,
        State::Failed => Decision::Fail("Background service failed to start".to_owned()),
        State::Waiting => Decision::Wait,
    }
}

/// A missing response or a PID or version inconsistent with the registration counts as no service.
pub async fn probe(transport: &dyn Transport, registration: &Registration, timeout: Duration) -> Probe {
    let endpoint = Endpoint::new(&registration.url, registration.password.clone());
    match tokio::time::timeout(timeout, answer(transport, &endpoint)).await {
        Err(_) => Probe { service: None, timed_out: true },
        Ok(answer) => {
            Probe { service: answer.and_then(|answer| classify(registration, endpoint, answer)), timed_out: false }
        }
    }
}

struct Answer {
    status: u16,
    info: Option<(String, u32)>,
}

async fn answer(transport: &dyn Transport, endpoint: &Endpoint) -> Option<Answer> {
    // `new URL("/api/info", url)`: the absolute path replaces any path on the registered URL.
    let url = opencode_api::js::join_url(&opencode_api::js::parse_url(&endpoint.url).ok()?, "/api/info").ok()?;
    let headers =
        endpoint.auth.iter().map(|auth| ("authorization".to_owned(), format!("Basic {}", auth.token()))).collect();
    let response = transport.send(Request { method: "GET", url, headers, body: None }).await.ok()?;
    let status = response.status;
    if status == 404 {
        return Some(Answer { status, info: None });
    }
    // A body that is not JSON rejects the TypeScript fetch, which counts as no answer.
    let body: serde_json::Value = serde_json::from_slice(&response.bytes().await.ok()?).ok()?;
    Some(Answer { status, info: Some(decode_info(&body)?) })
}

fn classify(registration: &Registration, endpoint: Endpoint, answer: Answer) -> Option<LocalService> {
    // A missing health endpoint identifies protocol incompatibility, not an older version.
    let Some((version, pid)) = answer.info else {
        return Some(LocalService {
            registration: registration.clone(),
            endpoint,
            version: registration.version.clone(),
            state: State::Ready,
            compatible: false,
        });
    };
    if pid != registration.pid {
        return None;
    }
    if registration.version.as_ref().is_some_and(|registered| *registered != version) {
        return None;
    }
    let state = match answer.status {
        200..=299 => State::Ready,
        500 => State::Failed,
        _ => State::Waiting,
    };
    Some(LocalService { registration: registration.clone(), endpoint, version: Some(version), state, compatible: true })
}

// `version` a string and `pid` a non-negative JavaScript integer (`decodeInfo`).
fn decode_info(body: &serde_json::Value) -> Option<(String, u32)> {
    let version = body.get("version")?.as_str()?.to_owned();
    let pid =
        body.get("pid")?.as_f64().filter(|pid| pid.fract() == 0.0 && *pid >= 0.0 && *pid <= f64::from(u32::MAX))?;
    Some((version, pid as u32))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{Reply, Server};

    fn service(version: Option<&str>, state: State, compatible: bool) -> LocalService {
        LocalService {
            registration: Registration {
                id: None,
                version: version.map(str::to_owned),
                url: "http://127.0.0.1:4096".to_owned(),
                pid: 4242,
                password: None,
            },
            endpoint: Endpoint::new("http://127.0.0.1:4096", None),
            version: version.map(str::to_owned),
            state,
            compatible,
        }
    }

    fn exact(expected: &'static str) -> impl Fn(&str) -> bool {
        move |version| version == expected
    }

    #[test]
    fn a_missing_health_endpoint_fails_unless_the_caller_requires_a_different_version() {
        let missing = service(Some("2.0.0"), State::Ready, false);
        let protocol = Decision::Fail(INCOMPATIBLE.to_owned());
        assert_eq!(decide(&missing, None), protocol);
        assert_eq!(decide(&missing, Some(&exact("2.0.0"))), protocol);
        assert_eq!(decide(&missing, Some(&|version: &str| version.starts_with("2."))), protocol);
        assert_eq!(decide(&missing, Some(&exact("3.0.0"))), Decision::Replace { handoff: true });
        assert_eq!(
            decide(&service(None, State::Ready, false), Some(&exact("3.0.0"))),
            Decision::Replace { handoff: true }
        );
    }

    #[test]
    fn a_version_mismatch_replaces_the_service_handing_off_terminals_only_when_it_is_ready() {
        let two = exact("2.0.0");
        for (state, handoff) in [(State::Ready, true), (State::Waiting, false), (State::Failed, false)] {
            assert_eq!(decide(&service(Some("1.0.0"), state, true), Some(&two)), Decision::Replace { handoff });
        }
    }

    fn registration(version: Option<&str>) -> Registration {
        Registration {
            id: None,
            version: version.map(str::to_owned),
            url: "http://127.0.0.1:4096/prefix".to_owned(),
            pid: 7,
            password: Some("secret".to_owned()),
        }
    }

    async fn probed(reply: Reply, version: Option<&str>) -> Probe {
        let server = Server::default().reply("http://127.0.0.1:4096/api/info", reply);
        probe(&server, &registration(version), REQUEST_TIMEOUT).await
    }

    #[tokio::test]
    async fn probe_classifies_answers() {
        let state = |probe: Probe| probe.service.map(|service| (service.state, service.compatible));
        let info = r#"{"version":"1.0.0","pid":7}"#;
        assert_eq!(state(probed(Reply::json(200, info), Some("1.0.0")).await), Some((State::Ready, true)));
        assert_eq!(state(probed(Reply::json(503, info), None).await), Some((State::Waiting, true)));
        assert_eq!(state(probed(Reply::json(500, info), None).await), Some((State::Failed, true)));
        assert_eq!(state(probed(Reply::json(404, "not json"), None).await), Some((State::Ready, false)));
        // Another process, another version, a body without the fields, and no listener.
        for (reply, version) in [
            (Reply::json(200, r#"{"version":"1.0.0","pid":8}"#), None),
            (Reply::json(200, info), Some("2.0.0")),
            (Reply::json(200, r#"{"version":"1.0.0","pid":-1}"#), None),
            (Reply::json(401, r#"{"_tag":"UnauthorizedError"}"#), None),
            (Reply::json(200, "<html>"), None),
            (Reply::Refused, None),
        ] {
            let probe = probed(reply, version).await;
            assert_eq!(probe, Probe { service: None, timed_out: false });
        }
    }

    #[tokio::test]
    async fn probe_sends_basic_auth_and_times_out() {
        let server = Server::default()
            .reply("http://127.0.0.1:4096/api/info", Reply::json(200, r#"{"version":"1.0.0","pid":7}"#));
        probe(&server, &registration(None), REQUEST_TIMEOUT).await;
        assert_eq!(
            server.requests(),
            vec![(
                "http://127.0.0.1:4096/api/info".to_owned(),
                Some(format!("Basic {}", Auth::password("secret").token()))
            )]
        );
        let slow = Server::default().reply("http://127.0.0.1:4096/api/info", Reply::Hang);
        let probe = probe(&slow, &registration(None), Duration::from_millis(10)).await;
        assert_eq!(probe, Probe { service: None, timed_out: true });
    }
}
