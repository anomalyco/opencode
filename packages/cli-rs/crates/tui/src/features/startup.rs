//! Resolve the initial route, model, agent, and prompt. An unknown `--session` ID becomes the ID of the first session
//! created from home.

use indexmap::IndexMap;
use opencode_api::generated::{SessionForkInput, SessionListInput, SessionListInputOrder};
use opencode_local::model_pref::Model;

use crate::prelude::*;

#[derive(Clone, Debug)]
pub struct Args {
    pub version: String,
    pub prompt: Option<String>,
    /// `--session` names a session the server does not know: the first new session takes this ID.
    pub new_session_id: Option<SessionID>,
    pub session: Option<SessionID>,
    pub fork: bool,
    pub agent: Option<String>,
    pub model: Option<String>,
    pub local: bool,
    pub managed: bool,
    pub server_executable: Option<std::path::PathBuf>,
    pub auto: bool,
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
            server_executable: None,
            auto: false,
            environment: None,
        }
    }
}

pub struct Startup {
    pub args: Args,
    new_session_id: RefCell<Option<SessionID>>,
    prompt: RefCell<Option<Target>>,
}

/// Destination for `--prompt`: home or the session selected at startup.
#[derive(Clone, Debug, PartialEq)]
enum Target {
    Home,
    Session(SessionID),
    Pending,
}

impl Startup {
    pub fn new(args: Args) -> Self {
        Self { new_session_id: RefCell::new(args.new_session_id.clone()), prompt: RefCell::new(None), args }
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

    /// Parse `--model` as `provider/model`.
    pub fn model(&self) -> Option<(String, String)> {
        parse_model(self.args.model.as_deref()?)
    }
}

/// Decode the initial route from `OPENCODE_ROUTE`, ignoring invalid values.
pub fn env_route(value: &str) -> Option<Route> {
    let value: serde_json::Value =
        serde_json::from_str(value).inspect_err(|error| log::warn!("OPENCODE_ROUTE is not JSON: {error}")).ok()?;
    let text = |key: &str| value.get(key)?.as_str().map(str::to_owned);
    match value.get("type")?.as_str()? {
        "home" => Some(Route::Home),
        "session" => Some(Route::Session { id: SessionID(text("sessionID")?) }),
        "plugin" => Some(Route::Plugin { id: text("id")?, name: text("name")? }),
        _ => None,
    }
}

/// Apply startup arguments after the first route mounts.
pub fn run(tui: &Tui, continue_: bool) {
    if let Some(model) = tui.startup.args.model.as_deref()
        && parse_model(model).is_none()
    {
        tui.toasts.show(
            ToastOptions::new(Variant::Warning, format!("Invalid model format: {model}"))
                .duration(Duration::from_millis(3000)),
        );
    }
    crate::dialogs::model::startup(
        &tui.local,
        tui.startup.args.agent.clone(),
        tui.startup.model().map(|(provider, model)| Model::new(&provider, &model)),
    );
    if continue_ {
        continue_latest(tui, tui.startup.args.fork);
        return;
    }
    if let Some(id) = tui.startup.args.session.clone().filter(|_| tui.startup.args.fork) {
        fork(tui, id);
    }
}

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
    tui.request(async move { client.session_list(&input).await }, move |tui, response| {
        let Some(session) = response.data.into_iter().next() else { return };
        if fork_it {
            return fork(tui, session.id);
        }
        let id = session.id.clone();
        tui.data.remember(session);
        tui.startup.arrive(&id);
        tui.navigate(Route::Session { id });
    });
}

fn fork(tui: &Tui, id: SessionID) {
    let client = tui.data.client().clone();
    tui.request(
        async move { client.session_fork(&SessionForkInput { session_id: id, before: None }).await },
        |tui, session| {
            let id = session.id.clone();
            tui.data.remember(session);
            tui.startup.arrive(&id);
            tui.navigate(Route::Session { id });
        },
    );
}

/// `Model.parse`: the provider before the first `/`, the model after it; both must be present.
fn parse_model(value: &str) -> Option<(String, String)> {
    let (provider, model) = value.split_once('/')?;
    (!provider.is_empty() && !model.is_empty()).then(|| (provider.to_owned(), model.to_owned()))
}
