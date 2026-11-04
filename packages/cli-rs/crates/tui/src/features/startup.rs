//! Startup flows (E.1, rows T02, T14b and T27): `--continue`, `--session` with and without `--fork`,
//! `--prompt`, a new session ID taken from `--session`, `--agent` and `--model`, and `OPENCODE_ROUTE`
//! (`app.tsx:664-726`, `context/args.tsx`, `context/route.tsx:48-69`). C.13 adds where `--prompt` goes.
//!
//! `app::mount` mounts the initial route, then calls [`run`]. The root command resolves `--session`
//! first: an ID the server knows opens that session; any other becomes [`Startup::take_new_session_id`],
//! the ID of the first session the home prompt creates.

use std::cell::RefCell;
use std::time::Duration;

use indexmap::IndexMap;

use opencode_api::client::RequestOptions;
use opencode_api::generated::{
    SessionForkInput, SessionID, SessionListInput, SessionListInputOrder,
};
use opencode_ui::toast::{ToastOptions, Variant};

use crate::app::Tui;
use crate::routes::Route;

/// The TUI's startup arguments (TS `Args` and `TuiInput.app`).
#[derive(Clone, Debug)]
pub struct Args {
    /// The client version, shown on home (`app.version`).
    pub version: String,
    pub prompt: Option<String>,
    /// `--session` names a session the server does not know: the first new session takes this ID.
    pub new_session_id: Option<SessionID>,
    /// `--session` when it is forked rather than opened.
    pub session: Option<SessionID>,
    /// Fork the `--session` or `--continue` session and open the fork.
    pub fork: bool,
    pub agent: Option<String>,
    pub model: Option<String>,
    /// The server runs on this machine (TS `server.local`).
    pub local: bool,
    /// The server is the background service (TS `client.restart`), which the reconnecting overlay names.
    pub managed: bool,
    /// `--auto`: permissions that are not denied are accepted (`context/permission.tsx`).
    pub auto: bool,
    /// The terminal's variables, uploaded to each session on a local server (TS `environment`, G13).
    pub environment: Option<IndexMap<String, String>>,
}

impl Default for Args {
    fn default() -> Self {
        Self {
            version: "local".to_owned(),
            prompt: None,
            new_session_id: None,
            session: None,
            fork: false,
            agent: None,
            model: None,
            local: false,
            managed: false,
            auto: false,
            environment: None,
        }
    }
}

/// What later features read from the startup arguments.
pub struct Startup {
    pub args: Args,
    new_session_id: RefCell<Option<SessionID>>,
    prompt: RefCell<Option<Target>>,
}

/// Which prompt receives `--prompt`: TS hands it to the first home, or through `route.prompt` to the
/// session that startup opens.
#[derive(Clone, Debug, PartialEq)]
enum Target {
    Home,
    Session(SessionID),
    /// `--continue` or `--fork` has not opened its session yet.
    Pending,
}

impl Startup {
    pub fn new(args: Args) -> Self {
        Self {
            new_session_id: RefCell::new(args.new_session_id.clone()),
            prompt: RefCell::new(None),
            args,
        }
    }

    /// Picks the prompt `--prompt` goes to, before the first route mounts.
    pub fn aim(&self, route: &Route, continue_: bool) {
        if self.args.prompt.is_none() {
            return;
        }
        let forked = self.args.fork && self.args.session.is_some();
        *self.prompt.borrow_mut() = match route {
            _ if continue_ || forked => Some(Target::Pending),
            Route::Home => Some(Target::Home),
            Route::Session { id } => Some(Target::Session(id.clone())),
            Route::Plugin { .. } => None,
        };
    }

    /// The startup prompt, once, for the prompt of `session` (`None` on home).
    pub fn take_prompt(&self, session: Option<&SessionID>) -> Option<String> {
        let mut target = self.prompt.borrow_mut();
        let matches = match (target.as_ref()?, session) {
            (Target::Home, None) => true,
            (Target::Session(id), Some(session)) => id == session,
            _ => false,
        };
        if !matches {
            return None;
        }
        *target = None;
        self.args.prompt.clone()
    }

    /// `--continue` or `--fork` opens `id`, so the pending startup prompt goes there.
    fn arrive(&self, id: &SessionID) {
        let mut target = self.prompt.borrow_mut();
        if *target == Some(Target::Pending) {
            *target = Some(Target::Session(id.clone()));
        }
    }

    /// `takeNewSessionID`: the first new session created from home takes this ID; later ones mint their own.
    pub fn take_new_session_id(&self) -> Option<SessionID> {
        self.new_session_id.borrow_mut().take()
    }

    /// `restoreNewSessionID`: gives the ID back when creating the session failed.
    pub fn restore_new_session_id(&self, id: SessionID) {
        self.new_session_id.borrow_mut().get_or_insert(id);
    }

    /// `--model` as `provider/model`, once it parsed (`util/model.ts` `parse`).
    pub fn model(&self) -> Option<(String, String)> {
        parse_model(self.args.model.as_deref()?)
    }
}

/// `OPENCODE_ROUTE`: a JSON route for the first screen (`context/route.tsx` `initialRoute`). Anything that is
/// not a route reads as none.
pub fn env_route(value: &str) -> Option<Route> {
    let value: serde_json::Value = serde_json::from_str(value)
        .inspect_err(|error| log::warn!("OPENCODE_ROUTE is not JSON: {error}"))
        .ok()?;
    let text = |key: &str| value.get(key)?.as_str().map(str::to_owned);
    match value.get("type")?.as_str()? {
        "home" => Some(Route::Home),
        "session" => Some(Route::Session {
            id: SessionID(text("sessionID")?),
        }),
        "plugin" => Some(Route::Plugin {
            id: text("id")?,
            name: text("name")?,
        }),
        _ => None,
    }
}

/// Runs once after the first route mounted (`app.tsx` `onMount` and the `--continue` and `--fork` effects).
pub fn run(tui: &Tui, continue_: bool) {
    if let Some(model) = tui.startup.args.model.as_deref()
        && parse_model(model).is_none()
    {
        tui.toasts.show(
            ToastOptions::new(Variant::Warning, format!("Invalid model format: {model}"))
                .duration(Duration::from_millis(3000)),
        );
    }
    if continue_ {
        continue_latest(tui, tui.startup.args.fork);
        return;
    }
    if let Some(id) = tui
        .startup
        .args
        .session
        .clone()
        .filter(|_| tui.startup.args.fork)
    {
        fork(tui, id);
    }
}

/// `--continue`: the newest root session of the default location, forked with `--fork`.
fn continue_latest(tui: &Tui, fork_it: bool) {
    let client = tui.data.client().clone();
    let input = SessionListInput {
        limit: Some(1),
        order: Some(SessionListInputOrder::Desc),
        parent_id: Some(None),
        archived: Some(false),
        directory: Some(tui.directory.clone().into()),
        ..SessionListInput::default()
    };
    let weak = tui.weak();
    tui.app.spawn(
        async move {
            client
                .session_list(&input, &RequestOptions::default())
                .await
        },
        move |_, result| {
            let Some(tui) = weak.upgrade() else { return };
            match result {
                Ok(response) => {
                    let Some(session) = response.data.into_iter().next() else {
                        return;
                    };
                    if fork_it {
                        fork(&tui, session.id);
                        return;
                    }
                    let id = session.id.clone();
                    tui.data.remember(session);
                    tui.startup.arrive(&id);
                    tui.navigate(Route::Session { id });
                }
                Err(error) => tui.toasts.error(error.to_string()),
            }
        },
    );
}

/// `session.fork`, then opens the fork.
fn fork(tui: &Tui, id: SessionID) {
    let client = tui.data.client().clone();
    let weak = tui.weak();
    tui.app.spawn(
        async move {
            client
                .session_fork(
                    &SessionForkInput {
                        session_id: id,
                        before: None,
                    },
                    &RequestOptions::default(),
                )
                .await
        },
        move |_, result| {
            let Some(tui) = weak.upgrade() else { return };
            match result {
                Ok(session) => {
                    let id = session.id.clone();
                    tui.data.remember(session);
                    tui.startup.arrive(&id);
                    tui.navigate(Route::Session { id });
                }
                Err(error) => tui.toasts.error(error.to_string()),
            }
        },
    );
}

/// `Model.parse`: the provider before the first `/`, the model after it; both must be present.
fn parse_model(value: &str) -> Option<(String, String)> {
    let (provider, model) = value.split_once('/')?;
    (!provider.is_empty() && !model.is_empty()).then(|| (provider.to_owned(), model.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_models_as_the_tui_does() {
        assert_eq!(
            parse_model("openai/gpt-5/mini"),
            Some(("openai".into(), "gpt-5/mini".into()))
        );
        assert_eq!(parse_model("gpt-5"), None);
        assert_eq!(parse_model("/gpt-5"), None);
        assert_eq!(parse_model("openai/"), None);
    }

    #[test]
    fn the_startup_prompt_goes_to_one_prompt_once() {
        let id = |value: &str| SessionID(value.into());
        let startup = |args: Args, route: Route, continue_: bool| {
            let startup = Startup::new(Args {
                prompt: Some("hello".into()),
                ..args
            });
            startup.aim(&route, continue_);
            startup
        };
        let home = startup(Args::default(), Route::Home, false);
        assert_eq!(home.take_prompt(Some(&id("ses_a"))), None);
        assert_eq!(home.take_prompt(None).as_deref(), Some("hello"));
        assert_eq!(home.take_prompt(None), None);

        let session = startup(Args::default(), Route::Session { id: id("ses_b") }, false);
        assert_eq!(session.take_prompt(None), None);
        assert_eq!(session.take_prompt(Some(&id("ses_a"))), None);
        assert_eq!(
            session.take_prompt(Some(&id("ses_b"))).as_deref(),
            Some("hello")
        );

        // `--continue` and `--fork` wait for the session they open; home does not take it meanwhile.
        let forked = Args {
            fork: true,
            session: Some(id("ses_b")),
            ..Args::default()
        };
        for pending in [
            startup(Args::default(), Route::Home, true),
            startup(forked, Route::Home, false),
        ] {
            assert_eq!(pending.take_prompt(None), None);
            pending.arrive(&id("ses_c"));
            assert_eq!(
                pending.take_prompt(Some(&id("ses_c"))).as_deref(),
                Some("hello")
            );
        }

        let none = Startup::new(Args::default());
        none.aim(&Route::Home, false);
        assert_eq!(none.take_prompt(None), None);
    }

    #[test]
    fn reads_opencode_route() {
        assert_eq!(env_route(r#"{"type":"home"}"#), Some(Route::Home));
        assert_eq!(
            env_route(r#"{"type":"session","sessionID":"ses_a"}"#),
            Some(Route::Session {
                id: SessionID("ses_a".into())
            })
        );
        assert_eq!(
            env_route(r#"{"type":"plugin","id":"x","name":"y","data":{}}"#),
            Some(Route::Plugin {
                id: "x".into(),
                name: "y".into()
            })
        );
        assert_eq!(env_route(r#"{"type":"session"}"#), None);
        assert_eq!(env_route("not json"), None);
    }
}
