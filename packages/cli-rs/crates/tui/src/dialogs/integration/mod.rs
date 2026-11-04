//! "Connect an integration" (E.17a, row DLG10): `component/dialog-integration.tsx`.
//!
//! The list of integrations (`/connect`, the model dialog's connect action, the prompt without a model, the
//! sidebar's getting-started link, and the MCP dialog for a server that signs in through an integration), the
//! accounts of a connected integration (activate, rename, remove), the method picker, and the four ways to
//! connect: an API key, OAuth in the browser (an automatic or a pasted code), an external connect, and a command.
//! A method with a form asks its fields first (`form.rs`).
//!
//! Everything reads and refreshes the catalog of [`Local`]. Browsers open through `Local::open_url`, which tests
//! replace.

mod form;

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use std::time::Duration;

use opencode_api::client::RequestOptions;
use opencode_api::error::Error;
use opencode_api::generated::{
    ConnectionCredentialInfo, ConnectionInfo, CredentialActivateInput, CredentialID,
    CredentialRemoveInput, CredentialUpdateInput, FormAnswer, IntegrationAttempt,
    IntegrationAttemptMode, IntegrationAttemptStatus, IntegrationCommandAttemptStatus,
    IntegrationCommandCancelInput, IntegrationCommandConnectInput, IntegrationCommandMethod,
    IntegrationCommandStatusInput, IntegrationConnectExternalInput, IntegrationConnectKeyInput,
    IntegrationExternalMethod, IntegrationID, IntegrationInfo, IntegrationKeyMethod,
    IntegrationListInput, IntegrationMethod, IntegrationOAuthMethod, IntegrationOauthCancelInput,
    IntegrationOauthCompleteInput, IntegrationOauthConnectInput, IntegrationOauthStatusInput,
    LocationQueryInput, ModelInfoStatus, ModelListInput, ProviderListInput,
};
use opencode_ui::dialog::{
    DIALOG_INSET, DIALOG_LIST_INSET, DialogCx, DialogOptions, DialogSize, FooterAction,
    FooterProps, HeaderProps, footer, header, layout_view,
};
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, Slash, TuiCommand};
use opencode_ui::prompt::{PromptProps, prompt};
use opencode_ui::select::{self, Gutter, SelectAction, SelectOption, SelectProps};
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::keymap::{Condition, Disposer};
use opentui::prelude::*;

use crate::app::Tui;
use crate::dialogs::model::{Local, locale_compare};

/// `INTEGRATION_PRIORITY`: these come first, as "Popular".
const PRIORITY: [&str; 6] = [
    "opencode",
    "opencode-go",
    "openai",
    "github-copilot",
    "anthropic",
    "google",
];
const SIGN_IN: &str = "Sign in required →";
const POLL: Duration = Duration::from_millis(500);

/// What runs after a connect, with the provider whose models to show (`onConnected`).
pub type OnConnected = Rc<dyn Fn(&Rc<Local>, Option<String>)>;

/// Registers `provider.connect` (`/connect`, `app.tsx:1019-1032`).
pub fn install(tui: &Rc<Tui>) {
    let local = tui.local.clone();
    let run = Rc::downgrade(&local);
    let suggested = Rc::downgrade(&local);
    let command = TuiCommand::new("provider.connect", move |_, _| {
        if let Some(local) = run.upgrade() {
            show(&local, Some(show_models()));
        }
    })
    .bind(Bind::Off)
    .title("Connect an integration")
    .group("Integration")
    .palette()
    .suggested(Condition::when(move || {
        suggested.upgrade().is_some_and(|local| !local.connected())
    }))
    .slash(Slash {
        name: "connect".to_owned(),
        aliases: Vec::new(),
        arguments: false,
    });
    let layers = [
        KeymapLayer {
            mode: Some(GLOBAL_MODE.to_owned()),
            commands: vec![command],
            ..KeymapLayer::default()
        },
        // `appGlobalBindingCommands`.
        KeymapLayer {
            mode: Some(GLOBAL_MODE.to_owned()),
            bindings: vec!["provider.connect".to_owned()],
            ..KeymapLayer::default()
        },
    ];
    for layer in layers {
        // The layers live as long as the keymap, which the TUI owns.
        if let Err(error) = tui.keymap.layer(layer) {
            log::error!("integration keymap layer: {error}");
        }
    }
}

/// The model dialog of the connected provider, as `/connect` and the model dialog open it.
pub fn show_models() -> OnConnected {
    Rc::new(crate::dialogs::model::show)
}

/// Opens `DialogIntegration`. Without `on_connected`, a connect closes the dialog.
pub fn show(local: &Rc<Local>, on_connected: Option<OnConnected>) {
    open_list(
        Flow {
            local: local.clone(),
            on_connected,
        },
        None,
    );
}

/// `DialogIntegration { integrationID, autoConnect }`, which the MCP dialog (E.17b) opens for a server that needs
/// sign-in: the integration's accounts or methods at once.
pub fn show_auto_connect(tui: &Tui, integration: &IntegrationID) {
    open_list(
        Flow {
            local: tui.local.clone(),
            on_connected: None,
        },
        Some(integration.clone()),
    );
}

#[derive(Clone)]
struct Flow {
    local: Rc<Local>,
    on_connected: Option<OnConnected>,
}

impl Flow {
    fn location(&self) -> Option<LocationQueryInput> {
        Some(LocationQueryInput {
            directory: Some(self.local.directory.clone()),
        })
    }

    /// The integration as the catalog has it now.
    fn latest(&self, id: &IntegrationID) -> Option<IntegrationInfo> {
        self.local
            .integrations()?
            .into_iter()
            .find(|item| item.id == *id)
    }

    fn fail(&self, message: String) {
        self.local
            .toasts
            .show(ToastOptions::new(Variant::Error, message));
        self.local.dialogs.clear();
    }

    fn open(&self, url: &str) -> bool {
        let open = self.local.open_url.borrow().clone();
        open(url).is_ok()
    }

    fn spawn<T: Send + 'static>(
        &self,
        future: impl Future<Output = Result<T, Error>> + Send + 'static,
        done: impl FnOnce(Result<T, Error>) + 'static,
    ) {
        self.local.app.spawn(future, move |_, result| done(result));
    }
}

/// `ConnectMethod`: every method but `env`.
#[derive(Clone, Debug, PartialEq)]
enum Method {
    Oauth(IntegrationOAuthMethod),
    Command(IntegrationCommandMethod),
    Key(IntegrationKeyMethod),
    External(IntegrationExternalMethod),
}

impl Method {
    fn label(&self) -> String {
        match self {
            Self::Key(method) => method.label.clone().unwrap_or_else(|| "API key".into()),
            Self::Oauth(method) => method.label.clone(),
            Self::Command(method) => method.label.clone(),
            Self::External(method) => method.label.clone(),
        }
    }
}

/// `integrationOptions`: popular first, then by name and ID.
fn sorted(mut list: Vec<IntegrationInfo>) -> Vec<IntegrationInfo> {
    let priority =
        |id: &IntegrationID| PRIORITY.iter().position(|name| *name == id.0).unwrap_or(99);
    list.sort_by(|a, b| {
        priority(&a.id)
            .cmp(&priority(&b.id))
            .then_with(|| locale_compare(&a.name, &b.name))
            .then_with(|| locale_compare(&a.id.0, &b.id.0))
    });
    list
}

/// `connectMethods`: the methods a user can pick, API keys last. Methods this client does not know are left out.
fn connect_methods(integration: &IntegrationInfo) -> Vec<Method> {
    let mut methods: Vec<Method> = integration
        .methods
        .iter()
        .filter_map(|method| match method {
            IntegrationMethod::Oauth(method) => Some(Method::Oauth(method.clone())),
            IntegrationMethod::Command(method) => Some(Method::Command(method.clone())),
            IntegrationMethod::Key(method) => Some(Method::Key(method.clone())),
            IntegrationMethod::External(method) => Some(Method::External(method.clone())),
            IntegrationMethod::Env(_) | IntegrationMethod::Unknown(_) => None,
        })
        .collect();
    methods.sort_by_key(|method| matches!(method, Method::Key(_)));
    methods
}

/// `credentialConnections`.
fn credentials(integration: &IntegrationInfo) -> Vec<ConnectionCredentialInfo> {
    integration
        .connections
        .iter()
        .filter_map(|connection| match connection {
            ConnectionInfo::Credential(credential) => Some(credential.clone()),
            _ => None,
        })
        .collect()
}

/// `connectionSummary`: a count keeps several long labels from squeezing the integration name off the row.
fn summary(integration: &IntegrationInfo) -> String {
    let connections = &integration.connections;
    if connections.len() > 1 {
        return format!("{} connections", connections.len());
    }
    match connections.first() {
        Some(ConnectionInfo::Credential(credential)) => credential.label.clone(),
        Some(ConnectionInfo::Env(env)) => format!("${}", env.name),
        _ => String::new(),
    }
}

fn signed_out(connection: &ConnectionInfo) -> bool {
    match connection {
        ConnectionInfo::Credential(credential) => credential.status.is_some(),
        ConnectionInfo::Env(env) => env.status.is_some(),
        ConnectionInfo::Unknown(value) => {
            value.get("status").is_some_and(|status| !status.is_null())
        }
    }
}

fn from_mcp(integration: &IntegrationInfo) -> bool {
    integration
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get("source"))
        .and_then(|source| source.as_str())
        == Some("mcp")
}

/// The integrations the list shows: one for an auto-connect, else all but the MCP servers', which the MCP dialog
/// signs in.
fn listed(local: &Local, only: Option<&IntegrationID>) -> Vec<IntegrationInfo> {
    sorted(local.integrations().unwrap_or_default())
        .into_iter()
        .filter(|integration| match only {
            Some(id) => integration.id == *id,
            None => !from_mcp(integration),
        })
        .collect()
}

// ---------------------------------------------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------------------------------------------

fn open_list(flow: Flow, only: Option<IntegrationID>) {
    let local = flow.local.clone();
    // An auto-connect may name an integration that appeared after the catalog was read.
    if local.integrations().is_none() || only.as_ref().is_some_and(|id| flow.latest(id).is_none()) {
        local.load_integrations();
    }
    local.dialogs.replace(
        move |cx| build_list(cx, flow, only),
        None,
        DialogOptions::default(),
    );
}

fn build_list(cx: &Rc<DialogCx>, flow: Flow, only: Option<IntegrationID>) -> View {
    let theme = cx.theme.clone();
    let options: select::Options<IntegrationID> = {
        let local = Rc::downgrade(&flow.local);
        let only = only.clone();
        Rc::new(move |_| {
            local.upgrade().map_or_else(Vec::new, |local| {
                list_options(&local, only.as_ref(), &theme)
            })
        })
    };
    let mut props = SelectProps::dynamic("Connect an integration", options.clone());
    let message = |text: &'static str| -> Rc<dyn Fn() -> AnyWidget> {
        let app = cx.app.clone();
        let muted = cx.theme.text.muted;
        Rc::new(move || {
            View::new(&app)
                .padding_edge(Edge::Left, DIALOG_LIST_INSET)
                .padding_edge(Edge::Right, DIALOG_LIST_INSET)
                .child(&Text::new(&app, text).fg(muted))
                .as_any()
        })
    };
    props.empty_view = Some(message("No integrations available"));
    props.no_match_view = Some(message("No integrations found"));
    props.on_select = Some({
        let flow = flow.clone();
        Rc::new(move |option: &SelectOption<IntegrationID>| {
            if let Some(integration) = flow.latest(&option.value) {
                pick(&flow, integration);
            }
        })
    });
    let (view, handle) = select::select(cx, props);
    let closed = Rc::new(Cell::new(false));
    {
        let closed = closed.clone();
        cx.on_close(Disposer::new(move || closed.set(true)));
    }
    // An auto-connect goes on once, as soon as the integration is in the catalog.
    let auto = Rc::new({
        let flow = flow.clone();
        let started = Cell::new(false);
        move || {
            let Some(only) = &only else { return };
            if started.get() || closed.get() {
                return;
            }
            let Some(integration) = flow.latest(only) else {
                return;
            };
            started.set(true);
            let flow = flow.clone();
            let closed = closed.clone();
            flow.local.app.clone().defer(move |_| {
                if !closed.get() {
                    pick(&flow, integration);
                }
            });
        }
    });
    auto();
    cx.on_close(flow.local.subscribe(move || {
        handle.set_options(options(&handle.filter()));
        auto();
    }));
    view
}

fn list_options(
    local: &Local,
    only: Option<&IntegrationID>,
    theme: &opencode_ui::theme::Theme,
) -> Vec<SelectOption<IntegrationID>> {
    let success = theme.text.feedback.success.base;
    let warning = theme.text.feedback.warning.base;
    listed(local, only)
        .into_iter()
        .map(|integration| {
            let methods = connect_methods(&integration);
            let status = integration.connections.first().is_some_and(signed_out);
            let mut option = SelectOption::new(integration.name.clone(), integration.id.clone())
                .category(if PRIORITY.contains(&integration.id.0.as_str()) {
                    "Popular"
                } else {
                    "Services"
                });
            if methods.is_empty() {
                option.description = Some("Environment only".into());
            }
            let summary = summary(&integration);
            if status {
                option.footer = Some(SIGN_IN.into());
                option.footer_color = Some(warning);
            } else if !summary.is_empty() {
                option.footer = Some(summary);
            }
            option.disabled = methods.is_empty() && credentials(&integration).is_empty();
            if !integration.connections.is_empty() && !status {
                option.gutter =
                    Some(
                        Rc::new(move |app: &App, _| Text::new(app, "✓").fg(success).as_any())
                            as Gutter,
                    );
            }
            option
        })
        .collect()
}

/// A row's `onSelect`: the accounts of a connected integration, else its methods.
fn pick(flow: &Flow, integration: IntegrationInfo) {
    let methods = connect_methods(&integration);
    if !credentials(&integration).is_empty() {
        manage(flow, integration, methods);
        return;
    }
    select_method(flow, integration, methods);
}

// ---------------------------------------------------------------------------------------------------------------
// Accounts (`manageConnections`)
// ---------------------------------------------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq)]
enum Account {
    Add,
    Credential(CredentialID),
}

struct Manage {
    flow: Flow,
    integration: IntegrationInfo,
    methods: Vec<Method>,
    deleting: RefCell<Option<CredentialID>>,
    select: RefCell<Option<select::Select<Account>>>,
    /// The footer and the marker as built; a change opens the dialog again, since both are fixed at build.
    built: (bool, Option<CredentialID>),
    reopened: Cell<bool>,
    theme: opencode_ui::theme::Theme,
}

fn manage(flow: &Flow, integration: IntegrationInfo, methods: Vec<Method>) {
    let focus = if methods.is_empty() {
        None
    } else {
        Some(Account::Add)
    };
    open_manage(flow.clone(), integration, methods, focus, String::new());
}

fn open_manage(
    flow: Flow,
    integration: IntegrationInfo,
    methods: Vec<Method>,
    focus: Option<Account>,
    filter: String,
) {
    let dialogs = flow.local.dialogs.clone();
    dialogs.replace(
        move |cx| build_manage(cx, flow, integration, methods, focus, &filter),
        None,
        DialogOptions::default(),
    );
}

fn build_manage(
    cx: &Rc<DialogCx>,
    flow: Flow,
    integration: IntegrationInfo,
    methods: Vec<Method>,
    focus: Option<Account>,
    filter: &str,
) -> View {
    let current = flow.latest(&integration.id).unwrap_or(integration.clone());
    let active = credentials(&current).first().map(|item| item.id.clone());
    let selected = focus.clone().or_else(|| {
        if methods.is_empty() {
            sorted_credentials(&current)
                .first()
                .map(|item| Account::Credential(item.id.clone()))
        } else {
            Some(Account::Add)
        }
    });
    let state = Rc::new(Manage {
        flow,
        integration,
        methods,
        deleting: RefCell::new(None),
        select: RefCell::new(None),
        built: (selected == Some(Account::Add), active.clone()),
        reopened: Cell::new(false),
        theme: cx.theme.clone(),
    });
    let options: select::Options<Account> = {
        let state = Rc::downgrade(&state);
        let theme = cx.theme.clone();
        Rc::new(move |_| {
            state
                .upgrade()
                .map_or_else(Vec::new, |state| state.options(&theme))
        })
    };
    let mut props = SelectProps::dynamic(state.integration.name.clone(), options);
    props.current = active.map(Account::Credential);
    props.focus_current = false;
    props.focus_target = focus;
    props.preserve_selection = true;
    props.on_move = Some({
        let state = Rc::downgrade(&state);
        Rc::new(move |option: &SelectOption<Account>| {
            let Some(state) = state.upgrade() else { return };
            let had = state.deleting.borrow_mut().take().is_some();
            if (option.value == Account::Add) != state.built.0 {
                state.reopen(Some(option.value.clone()));
                return;
            }
            if had {
                state.refresh();
            }
        })
    });
    props.on_select = Some({
        let state = Rc::downgrade(&state);
        Rc::new(move |option: &SelectOption<Account>| {
            if let Some(state) = state.upgrade() {
                state.choose(&option.value);
            }
        })
    });
    let account_only: select::ActionDisabled<Account> =
        Rc::new(|option| option.is_none_or(|option| option.value == Account::Add));
    let hidden = state.built.0;
    props.actions = vec![
        SelectAction {
            hidden,
            disabled: Some(account_only.clone()),
            ..SelectAction::new("dialog.integration.rename", "rename", {
                let state = Rc::downgrade(&state);
                move |option| {
                    if let (Some(state), Account::Credential(id)) = (state.upgrade(), &option.value)
                    {
                        state.rename(id);
                    }
                }
            })
        },
        SelectAction {
            hidden,
            disabled: Some(account_only),
            ..SelectAction::new("dialog.integration.delete", "remove account", {
                let state = Rc::downgrade(&state);
                move |option| {
                    if let (Some(state), Account::Credential(id)) = (state.upgrade(), &option.value)
                    {
                        state.remove(id);
                    }
                }
            })
        },
    ];
    let (view, handle) = select::select(cx, props);
    if !filter.is_empty() {
        handle.set_filter(filter);
    }
    *state.select.borrow_mut() = Some(handle);
    let weak = Rc::downgrade(&state);
    cx.on_close(state.flow.local.subscribe(move || {
        let Some(state) = weak.upgrade() else { return };
        let active = credentials(&state.current())
            .first()
            .map(|item| item.id.clone());
        if active != state.built.1 {
            let focus = state.selected();
            state.reopen(focus);
            return;
        }
        state.refresh();
    }));
    // The dialog owns the state through its close handler.
    let owner = state.clone();
    cx.on_close(Disposer::new(move || drop(owner)));
    view
}

fn sorted_credentials(integration: &IntegrationInfo) -> Vec<ConnectionCredentialInfo> {
    let mut list = credentials(integration);
    list.sort_by(|a, b| locale_compare(&a.label, &b.label).then_with(|| a.id.0.cmp(&b.id.0)));
    list
}

impl Manage {
    fn current(&self) -> IntegrationInfo {
        self.flow
            .latest(&self.integration.id)
            .unwrap_or_else(|| self.integration.clone())
    }

    fn selected(&self) -> Option<Account> {
        let select = self.select.borrow().clone();
        select
            .and_then(|select| select.selected())
            .map(|option| option.value)
    }

    fn options(&self, theme: &opencode_ui::theme::Theme) -> Vec<SelectOption<Account>> {
        let delete_key = self
            .flow
            .local
            .dialogs
            .keymap()
            .shortcut("dialog.integration.delete")
            .unwrap_or_default();
        let deleting = self.deleting.borrow().clone();
        let add =
            (!self.methods.is_empty()).then(|| SelectOption::new("Add account", Account::Add));
        add.into_iter()
            .chain(
                sorted_credentials(&self.current())
                    .into_iter()
                    .map(|connection| {
                        let confirming = deleting.as_ref() == Some(&connection.id);
                        let mut option = SelectOption::new(
                            if confirming {
                                format!("Press {delete_key} again to confirm")
                            } else {
                                connection.label.clone()
                            },
                            Account::Credential(connection.id.clone()),
                        )
                        .category("Connected accounts");
                        if connection.status.is_some() {
                            option.footer = Some(SIGN_IN.into());
                            option.footer_color = Some(theme.text.feedback.warning.base);
                        }
                        if confirming {
                            option.bg = Some(theme.background.action.destructive.focused);
                            option.fg = Some(theme.text.action.destructive.focused);
                        }
                        option
                    }),
            )
            .collect()
    }

    fn refresh(&self) {
        let select = self.select.borrow().clone();
        if let Some(select) = select {
            select.set_options(self.options(&self.theme));
            select.refresh_footer();
        }
    }

    fn reopen(self: &Rc<Self>, focus: Option<Account>) {
        if self.reopened.replace(true) {
            return;
        }
        let filter = self
            .select
            .borrow()
            .as_ref()
            .map(|select| select.filter())
            .unwrap_or_default();
        let flow = self.flow.clone();
        let integration = self.integration.clone();
        let methods = self.methods.clone();
        self.flow.local.app.defer(move |_| {
            open_manage(flow, integration, methods, focus, filter);
        });
    }

    fn choose(&self, account: &Account) {
        let current = self.current();
        let Account::Credential(id) = account else {
            select_method(&self.flow, current, self.methods.clone());
            return;
        };
        let list = credentials(&current);
        let Some(connection) = list.iter().find(|item| item.id == *id) else {
            return;
        };
        if let Some(status) = &connection.status {
            if let Some(url) = &status.url {
                if !self.flow.open(url) {
                    self.flow.local.toasts.error("Could not open the browser");
                }
                return;
            }
            select_method(&self.flow, current.clone(), self.methods.clone());
            return;
        }
        if list.first().is_some_and(|first| first.id == *id) {
            return;
        }
        let client = self.flow.local.client.clone();
        let input = CredentialActivateInput {
            credential_id: id.clone(),
        };
        let local = Rc::downgrade(&self.flow.local);
        self.flow.spawn(
            async move {
                client
                    .credential_activate(&input, &RequestOptions::default())
                    .await
            },
            move |result| {
                let Some(local) = local.upgrade() else { return };
                match result {
                    // The active account comes first; the marker follows the reloaded list.
                    Ok(()) => local.load_integrations(),
                    Err(error) => local.toasts.error(error.to_string()),
                }
            },
        );
    }

    fn rename(&self, id: &CredentialID) {
        let label = credentials(&self.current())
            .into_iter()
            .find(|item| item.id == *id)
            .map(|item| item.label);
        let flow = self.flow.clone();
        let integration = self.integration.clone();
        let methods = self.methods.clone();
        let id = id.clone();
        self.flow.local.dialogs.replace(
            move |cx| {
                let on_confirm = Rc::new(move |value: &str| {
                    let label = value.trim().to_owned();
                    if label.is_empty() {
                        return;
                    }
                    let client = flow.local.client.clone();
                    let input = CredentialUpdateInput {
                        credential_id: id.clone(),
                        label,
                    };
                    let (flow, integration, methods) =
                        (flow.clone(), integration.clone(), methods.clone());
                    flow.clone().spawn(
                        async move {
                            client
                                .credential_update(&input, &RequestOptions::default())
                                .await
                        },
                        move |result| match result {
                            Ok(()) => {
                                // The renamed label shows once the catalog is read again.
                                flow.local.load_integrations();
                                manage(&flow, integration, methods);
                            }
                            Err(error) => flow.local.toasts.error(error.to_string()),
                        },
                    );
                });
                prompt(
                    cx,
                    PromptProps {
                        title: "Rename account".into(),
                        placeholder: Some("Account name".into()),
                        value: label,
                        on_confirm: Some(on_confirm),
                        ..PromptProps::default()
                    },
                )
                .0
            },
            None,
            DialogOptions::default(),
        );
    }

    fn remove(self: &Rc<Self>, id: &CredentialID) {
        if self.deleting.borrow().as_ref() != Some(id) {
            *self.deleting.borrow_mut() = Some(id.clone());
            self.refresh();
            return;
        }
        let last = credentials(&self.current()).len() == 1;
        let client = self.flow.local.client.clone();
        let input = CredentialRemoveInput {
            credential_id: id.clone(),
        };
        let name = self.integration.name.clone();
        let local = Rc::downgrade(&self.flow.local);
        let state: Weak<Manage> = Rc::downgrade(self);
        self.flow.spawn(
            async move {
                client
                    .credential_remove(&input, &RequestOptions::default())
                    .await
            },
            move |result| {
                let Some(local) = local.upgrade() else { return };
                if let Some(state) = state.upgrade()
                    && state.deleting.borrow_mut().take().is_some()
                {
                    state.refresh();
                }
                match result {
                    Ok(()) => {
                        local.load_integrations();
                        if !last {
                            return;
                        }
                        local.toasts.show(ToastOptions::new(
                            Variant::Success,
                            format!("Disconnected {name}"),
                        ));
                        local.dialogs.clear();
                    }
                    Err(error) => local.toasts.error(error.to_string()),
                }
            },
        );
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------------------------------------------

/// `selectMethod`: the only method at once, else a picker.
fn select_method(flow: &Flow, integration: IntegrationInfo, methods: Vec<Method>) {
    if methods.len() == 1 {
        open_method(flow, integration, methods[0].clone());
        return;
    }
    let flow = flow.clone();
    let dialogs = flow.local.dialogs.clone();
    dialogs.replace(
        move |cx| {
            let options = methods
                .iter()
                .enumerate()
                .map(|(index, method)| SelectOption::new(method.label(), index))
                .collect();
            let mut props = SelectProps::new(format!("Connect {}", integration.name), options);
            props.render_filter = false;
            props.on_select = Some(Rc::new(move |option: &SelectOption<usize>| {
                open_method(&flow, integration.clone(), methods[option.value].clone());
            }));
            select::select(cx, props).0
        },
        None,
        DialogOptions::default(),
    );
}

fn open_method(flow: &Flow, integration: IntegrationInfo, method: Method) {
    match method {
        Method::Key(method) => {
            let title = method
                .label
                .clone()
                .unwrap_or_else(|| format!("Connect {}", integration.name));
            let flow = flow.clone();
            with_form(&flow.clone(), title.clone(), method.form, move |answer| {
                key_prompt(&flow, integration, title, answer);
            });
        }
        Method::Command(method) => command_starting(flow, integration, method),
        Method::External(method) => {
            let flow = flow.clone();
            with_form(
                &flow.clone(),
                method.label.clone(),
                method.form.clone(),
                move |answer| external_starting(&flow, integration, method, answer),
            );
        }
        Method::Oauth(method) => {
            let flow = flow.clone();
            with_form(
                &flow.clone(),
                method.label.clone(),
                method.form.clone(),
                move |answer| oauth_starting(&flow, integration, method, answer),
            );
        }
    }
}

/// Asks the method's form first, if it has one; a cancelled form ends the connect.
fn with_form(
    flow: &Flow,
    title: String,
    fields: Option<Vec<opencode_api::generated::FormField>>,
    then: impl FnOnce(Option<FormAnswer>) + 'static,
) {
    match fields {
        None => then(None),
        Some(fields) => form::answer(&flow.local, title, fields, move |answer| {
            if let Some(answer) = answer {
                then(Some(answer));
            }
        }),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// API key (`KeyMethod`)
// ---------------------------------------------------------------------------------------------------------------

fn key_prompt(
    flow: &Flow,
    integration: IntegrationInfo,
    title: String,
    answer: Option<FormAnswer>,
) {
    let flow = flow.clone();
    let dialogs = flow.local.dialogs.clone();
    dialogs.replace(
        move |cx| {
            let (slot, set_error) = error_slot(cx, false);
            let on_confirm = Rc::new(move |key: &str| {
                if key.is_empty() {
                    return;
                }
                let client = flow.local.client.clone();
                let input = IntegrationConnectKeyInput {
                    integration_id: integration.id.clone(),
                    location: flow.location(),
                    key: key.to_owned(),
                    answer: answer.clone(),
                    label: None,
                };
                let (flow, integration, set_error) =
                    (flow.clone(), integration.clone(), set_error.clone());
                flow.clone().spawn(
                    async move {
                        client
                            .integration_connect_key(&input, &RequestOptions::default())
                            .await
                    },
                    move |result| match result {
                        Ok(()) => connected(&flow, &integration),
                        Err(error) => set_error(error.to_string()),
                    },
                );
            });
            prompt(
                cx,
                PromptProps {
                    title,
                    placeholder: Some("API key".into()),
                    description: Some(Rc::new(move |_| slot.as_any())),
                    on_confirm: Some(on_confirm),
                    ..PromptProps::default()
                },
            )
            .0
        },
        None,
        DialogOptions::default(),
    );
}

/// An error line that starts empty, and its setter. With `boxed`, the line sits in a `<box gap={1}>` that the
/// layout keeps even while empty, as the TS descriptions that wrap their `<Show>` in a box do.
fn error_slot(cx: &Rc<DialogCx>, boxed: bool) -> (View, Rc<dyn Fn(String)>) {
    let line = Text::new(&cx.app, "")
        .fg(cx.theme.text.feedback.error.base)
        .visible(false);
    let slot = View::new(&cx.app).gap(1).child(&line);
    if !boxed {
        slot.visible(false);
    }
    let shown = slot.clone();
    let app = cx.app.clone();
    let set: Rc<dyn Fn(String)> = Rc::new(move |message: String| {
        line.set_text(message);
        line.visible(true);
        shown.visible(true);
        app.request_redraw();
    });
    (slot, set)
}

// ---------------------------------------------------------------------------------------------------------------
// External (`ExternalStarting`)
// ---------------------------------------------------------------------------------------------------------------

fn external_starting(
    flow: &Flow,
    integration: IntegrationInfo,
    method: IntegrationExternalMethod,
    answer: Option<FormAnswer>,
) {
    let title = method.label.clone();
    flow.local.dialogs.replace(
        move |cx| oauth_view(cx, &title, None, "Connecting…", None),
        None,
        DialogOptions::default(),
    );
    let client = flow.local.client.clone();
    let input = IntegrationConnectExternalInput {
        integration_id: integration.id.clone(),
        location: flow.location(),
        method_id: method.id,
        answer,
        label: None,
    };
    let flow = flow.clone();
    flow.clone().spawn(
        async move {
            client
                .integration_connect_external(&input, &RequestOptions::default())
                .await
        },
        move |result| match result {
            Ok(()) => connected(&flow, &integration),
            Err(error) => flow.fail(error.to_string()),
        },
    );
}

// ---------------------------------------------------------------------------------------------------------------
// OAuth (`OAuthStarting`, `OAuthAuto`, `OAuthCode`)
// ---------------------------------------------------------------------------------------------------------------

fn oauth_starting(
    flow: &Flow,
    integration: IntegrationInfo,
    method: IntegrationOAuthMethod,
    answer: Option<FormAnswer>,
) {
    let closed = Rc::new(Cell::new(false));
    let handed_off = Rc::new(Cell::new(false));
    {
        let title = method.label.clone();
        let (closed, handed_off) = (closed.clone(), handed_off.clone());
        flow.local.dialogs.replace(
            move |cx| {
                cx.on_close(Disposer::new(move || {
                    if !handed_off.get() {
                        closed.set(true);
                    }
                }));
                oauth_view(cx, &title, None, "Starting authorization…", None)
            },
            None,
            DialogOptions::default(),
        );
    }
    let client = flow.local.client.clone();
    let input = IntegrationOauthConnectInput {
        integration_id: integration.id.clone(),
        location: flow.location(),
        method_id: method.id.clone(),
        answer,
        label: None,
    };
    let flow = flow.clone();
    flow.clone().spawn(
        async move {
            client
                .integration_oauth_connect(&input, &RequestOptions::default())
                .await
        },
        move |result| {
            let attempt = match result {
                Ok(output) => output.data,
                Err(_) if closed.get() => return,
                Err(error) => return flow.fail(error.to_string()),
            };
            let oauth = Rc::new(Oauth {
                flow: flow.clone(),
                integration,
                title: method.label,
                attempt,
                settled: Cell::new(false),
                timer: Cell::new(None),
            });
            // Closed while starting: the attempt is not wanted.
            if closed.get() {
                oauth.cancel();
                return;
            }
            handed_off.set(true);
            match oauth.attempt.mode {
                IntegrationAttemptMode::Code => oauth.code(),
                _ => oauth.auto(),
            }
        },
    );
}

struct Oauth {
    flow: Flow,
    integration: IntegrationInfo,
    title: String,
    attempt: IntegrationAttempt,
    settled: Cell<bool>,
    timer: Cell<Option<TimerId>>,
}

impl Oauth {
    fn status_input(&self) -> IntegrationOauthStatusInput {
        IntegrationOauthStatusInput {
            integration_id: self.integration.id.clone(),
            attempt_id: self.attempt.attempt_id.clone(),
            location: self.flow.location(),
        }
    }

    /// `OAuthAuto`: the URL to open, polled until the browser finishes.
    fn auto(self: &Rc<Self>) {
        let me = self.clone();
        self.flow.local.dialogs.replace(
            move |cx| {
                let (open, copy) = (Rc::downgrade(&me), Rc::downgrade(&me));
                let open: Rc<dyn Fn()> = Rc::new(move || {
                    if let Some(me) = open.upgrade() {
                        me.open();
                    }
                });
                let copy: Rc<dyn Fn()> = Rc::new(move || {
                    if let Some(me) = copy.upgrade() {
                        me.copy();
                    }
                });
                cx.layer(KeymapLayer {
                    commands: vec![
                        TuiCommand::inline("return", {
                            let open = open.clone();
                            move |_, _| open()
                        })
                        .title("Open authorization URL")
                        .group("Dialog"),
                        TuiCommand::inline("c", {
                            let copy = copy.clone();
                            move |_, _| copy()
                        })
                        .title("Copy authorization details")
                        .group("Dialog"),
                    ],
                    ..KeymapLayer::default()
                });
                let closing = me.clone();
                cx.on_close(Disposer::new(move || closing.close()));
                oauth_view(
                    cx,
                    &me.title,
                    Some((&me.attempt.url, &me.attempt.instructions)),
                    "Waiting for authorization…",
                    Some((copy, open)),
                )
            },
            None,
            DialogOptions::default(),
        );
        self.poll();
    }

    fn poll(self: &Rc<Self>) {
        let client = self.flow.local.client.clone();
        let input = self.status_input();
        let weak = Rc::downgrade(self);
        self.flow.local.app.spawn(
            async move {
                client
                    .integration_oauth_status(&input, &RequestOptions::default())
                    .await
            },
            move |cx, result| {
                let Some(me) = weak.upgrade() else { return };
                if me.settled.get() {
                    return;
                }
                let status = match result {
                    Ok(output) => output.data,
                    Err(error) => {
                        me.settled.set(true);
                        return me.flow.fail(error.to_string());
                    }
                };
                match status {
                    IntegrationAttemptStatus::Pending(_) => {
                        let weak = Rc::downgrade(&me);
                        me.timer.set(Some(cx.set_timeout(POLL, move |_| {
                            if let Some(me) = weak.upgrade() {
                                me.timer.set(None);
                                me.poll();
                            }
                        })));
                    }
                    IntegrationAttemptStatus::Complete(_) => {
                        me.settled.set(true);
                        connected(&me.flow, &me.integration);
                    }
                    IntegrationAttemptStatus::Failed(failed) => {
                        me.settled.set(true);
                        me.flow.fail(failed.message);
                    }
                    _ => {
                        me.settled.set(true);
                        me.flow.fail("Authorization expired".into());
                    }
                }
            },
        );
    }

    /// `OAuthCode`: the URL to open and a field for the code it shows.
    fn code(self: &Rc<Self>) {
        let me = self.clone();
        self.flow.local.dialogs.replace(
            move |cx| {
                let closing = me.clone();
                cx.on_close(Disposer::new(move || closing.close()));
                let (errors, set_error) = error_slot(cx, false);
                let link = link(cx, &me.attempt.url);
                let description = View::new(&cx.app).gap(1).child(&link).child(&errors);
                let submit = Rc::downgrade(&me);
                let on_confirm = Rc::new(move |code: &str| {
                    let Some(me) = submit.upgrade() else { return };
                    if code.is_empty() {
                        return;
                    }
                    let client = me.flow.local.client.clone();
                    let input = IntegrationOauthCompleteInput {
                        integration_id: me.integration.id.clone(),
                        attempt_id: me.attempt.attempt_id.clone(),
                        location: me.flow.location(),
                        code: Some(code.to_owned()),
                    };
                    let set_error = set_error.clone();
                    me.flow.clone().spawn(
                        async move {
                            client
                                .integration_oauth_complete(&input, &RequestOptions::default())
                                .await
                        },
                        move |result| match result {
                            Ok(()) => {
                                me.settled.set(true);
                                connected(&me.flow, &me.integration);
                            }
                            Err(error) => set_error(error.to_string()),
                        },
                    );
                });
                prompt(
                    cx,
                    PromptProps {
                        title: me.title.clone(),
                        subtitle: Some(me.attempt.instructions.clone()),
                        placeholder: Some("Authorization code".into()),
                        description: Some(Rc::new(move |_| description.as_any())),
                        on_confirm: Some(on_confirm),
                        ..PromptProps::default()
                    },
                )
                .0
            },
            None,
            DialogOptions::default(),
        );
    }

    fn close(&self) {
        if let Some(timer) = self.timer.take() {
            self.flow.local.app.cancel_timer(timer);
        }
        if self.settled.replace(true) {
            return;
        }
        self.cancel();
    }

    fn cancel(&self) {
        let client = self.flow.local.client.clone();
        let input = IntegrationOauthCancelInput {
            integration_id: self.integration.id.clone(),
            attempt_id: self.attempt.attempt_id.clone(),
            location: self.flow.location(),
        };
        self.flow.spawn(
            async move {
                client
                    .integration_oauth_cancel(&input, &RequestOptions::default())
                    .await
            },
            |_| {},
        );
    }

    fn open(&self) {
        if !self.flow.open(&self.attempt.url) {
            self.flow.local.toasts.show(ToastOptions::new(
                Variant::Error,
                "Could not open the browser. Copy the URL and continue manually.",
            ));
        }
    }

    fn copy(&self) {
        let value = oauth_code(&self.attempt.instructions).unwrap_or(self.attempt.url.clone());
        if self.flow.local.app.copy_to_clipboard(&value) {
            self.flow
                .local
                .toasts
                .show(ToastOptions::new(Variant::Info, "Copied to clipboard"));
            return;
        }
        self.flow.local.toasts.error("Failed to copy to clipboard");
    }
}

/// `Link`: the URL in the link color, as a terminal hyperlink.
fn link(cx: &DialogCx, url: &str) -> Text {
    Text::new(
        &cx.app,
        vec![url.fg(cx.theme.markdown.link).link(url.to_owned())],
    )
    .wrap(WrapMode::Word)
}

/// The copy and open actions of [`oauth_view`].
type CopyOpen = (Rc<dyn Fn()>, Rc<dyn Fn()>);

/// `OAuthView`: the title, the URL and instructions once there are any, a status line, and the copy and open
/// actions.
fn oauth_view(
    cx: &Rc<DialogCx>,
    title: &str,
    url: Option<(&str, &str)>,
    message: &str,
    actions: Option<CopyOpen>,
) -> View {
    let app = &cx.app;
    let head = header(
        cx,
        HeaderProps {
            title: title.to_owned(),
            ..HeaderProps::default()
        },
    );
    let body = View::new(app).gap(1);
    if let Some((url, instructions)) = url {
        let details = View::new(app).gap(1).child(&link(cx, url));
        if !instructions.is_empty() {
            details.add(&Text::new(app, instructions).fg(cx.theme.text.muted));
        }
        body.add(&details);
    }
    body.add(&Text::new(app, message).fg(cx.theme.text.muted));
    let primary = match (url, actions) {
        (Some((_, instructions)), Some((copy, open))) => vec![
            FooterAction::new(if oauth_code(instructions).is_some() {
                "copy code"
            } else {
                "copy link"
            })
            .key("c")
            .on_trigger(move || copy()),
            FooterAction::new("open link")
                .key("enter")
                .on_trigger(move || open()),
        ],
        _ => Vec::new(),
    };
    let foot = footer(
        cx,
        FooterProps {
            primary,
            ..FooterProps::default()
        },
    );
    layout_view(cx, &head, &body, Some(&foot), DIALOG_INSET, 1)
}

/// `OAUTH_CODE`, `/[A-Z0-9]{4}-[A-Z0-9]{4,5}/`: a device-flow code such as `R283-GOUEO`, copied instead of the URL.
fn oauth_code(text: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    let code = |c: &char| c.is_ascii_uppercase() || c.is_ascii_digit();
    (0..chars.len()).find_map(|start| {
        let head = chars.get(start..start + 4)?;
        if !head.iter().all(code) || chars.get(start + 4) != Some(&'-') {
            return None;
        }
        let tail = chars[start + 5..]
            .iter()
            .take(5)
            .take_while(|c| code(c))
            .count();
        (tail >= 4).then(|| chars[start..start + 5 + tail].iter().collect())
    })
}

// ---------------------------------------------------------------------------------------------------------------
// Command (`CommandStarting`, `CommandPending`)
// ---------------------------------------------------------------------------------------------------------------

fn command_starting(flow: &Flow, integration: IntegrationInfo, method: IntegrationCommandMethod) {
    let closed = Rc::new(Cell::new(false));
    let handed_off = Rc::new(Cell::new(false));
    {
        let title = method.label.clone();
        let (closed, handed_off) = (closed.clone(), handed_off.clone());
        flow.local.dialogs.replace(
            move |cx| {
                cx.on_close(Disposer::new(move || {
                    if !handed_off.get() {
                        closed.set(true);
                    }
                }));
                command_view(cx, &title, "Starting command…").0
            },
            None,
            DialogOptions {
                size: DialogSize::Large,
                ..DialogOptions::default()
            },
        );
    }
    let client = flow.local.client.clone();
    let input = IntegrationCommandConnectInput {
        integration_id: integration.id.clone(),
        location: flow.location(),
        method_id: method.id.clone(),
        label: None,
    };
    let flow = flow.clone();
    flow.clone().spawn(
        async move {
            client
                .integration_command_connect(&input, &RequestOptions::default())
                .await
        },
        move |result| {
            let attempt = match result {
                Ok(output) => output.data.attempt_id,
                Err(_) if closed.get() => return,
                Err(error) => return flow.fail(error.to_string()),
            };
            let command = Rc::new(Command {
                flow: flow.clone(),
                integration,
                attempt,
                output: RefCell::new(None),
                settled: Cell::new(false),
                timer: Cell::new(None),
            });
            if closed.get() {
                command.cancel();
                return;
            }
            handed_off.set(true);
            command.pending(method.label);
        },
    );
}

struct Command {
    flow: Flow,
    integration: IntegrationInfo,
    attempt: opencode_api::generated::IntegrationAttemptID,
    output: RefCell<Option<Text>>,
    settled: Cell<bool>,
    timer: Cell<Option<TimerId>>,
}

impl Command {
    fn pending(self: &Rc<Self>, title: String) {
        let me = self.clone();
        self.flow.local.dialogs.replace(
            move |cx| {
                let (view, output) = command_view(cx, &title, "Waiting for command to finish…");
                *me.output.borrow_mut() = Some(output);
                let closing = me.clone();
                cx.on_close(Disposer::new(move || closing.close()));
                view
            },
            None,
            DialogOptions {
                size: DialogSize::Large,
                ..DialogOptions::default()
            },
        );
        self.poll();
    }

    fn poll(self: &Rc<Self>) {
        let client = self.flow.local.client.clone();
        let input = IntegrationCommandStatusInput {
            integration_id: self.integration.id.clone(),
            attempt_id: self.attempt.clone(),
            location: self.flow.location(),
        };
        let weak = Rc::downgrade(self);
        self.flow.local.app.spawn(
            async move {
                client
                    .integration_command_status(&input, &RequestOptions::default())
                    .await
            },
            move |cx, result| {
                let Some(me) = weak.upgrade() else { return };
                if me.settled.get() {
                    return;
                }
                let status = match result {
                    Ok(output) => output.data,
                    Err(error) => {
                        me.settled.set(true);
                        return me.flow.fail(error.to_string());
                    }
                };
                match status {
                    IntegrationCommandAttemptStatus::Pending(pending) => {
                        if let Some(output) = me.output.borrow().as_ref() {
                            output.set_text(pending.message.unwrap_or_default().trim().to_owned());
                        }
                        me.flow.local.app.request_redraw();
                        let weak = Rc::downgrade(&me);
                        me.timer.set(Some(cx.set_timeout(POLL, move |_| {
                            if let Some(me) = weak.upgrade() {
                                me.timer.set(None);
                                me.poll();
                            }
                        })));
                    }
                    IntegrationCommandAttemptStatus::Complete(_) => {
                        me.settled.set(true);
                        connected(&me.flow, &me.integration);
                    }
                    IntegrationCommandAttemptStatus::Failed(failed) => {
                        me.settled.set(true);
                        me.flow.fail(failed.message);
                    }
                    _ => {
                        me.settled.set(true);
                        me.flow.fail("Authentication expired".into());
                    }
                }
            },
        );
    }

    fn close(&self) {
        if let Some(timer) = self.timer.take() {
            self.flow.local.app.cancel_timer(timer);
        }
        if self.settled.replace(true) {
            return;
        }
        self.cancel();
    }

    fn cancel(&self) {
        let client = self.flow.local.client.clone();
        let input = IntegrationCommandCancelInput {
            integration_id: self.integration.id.clone(),
            attempt_id: self.attempt.clone(),
            location: self.flow.location(),
        };
        self.flow.spawn(
            async move {
                client
                    .integration_command_cancel(&input, &RequestOptions::default())
                    .await
            },
            |_| {},
        );
    }
}

/// `CommandView`: the command's output on a raised band, and a status line. Returns the output's text.
fn command_view(cx: &Rc<DialogCx>, title: &str, message: &str) -> (View, Text) {
    let app = &cx.app;
    let page = cx.theme.page();
    let head = header(
        cx,
        HeaderProps {
            title: title.to_owned(),
            close_label: Some("esc close".into()),
            ..HeaderProps::default()
        },
    );
    let output = Text::new(app, "").fg(page.text.base);
    // `DialogBleed`: the band reaches the dialog's edges.
    let band = View::new(app).margin_x(-(DIALOG_INSET as i32)).child(
        &View::new(app)
            .bg(page.background.raised.high)
            .padding_x(DIALOG_INSET)
            .padding_edge(Edge::Top, 1)
            .padding_edge(Edge::Bottom, 1)
            .child(&output),
    );
    let body = View::new(app)
        .gap(1)
        .child(&band)
        .child(&Text::new(app, message).fg(cx.theme.text.muted));
    (layout_view(cx, &head, &body, None, DIALOG_INSET, 1), output)
}

// ---------------------------------------------------------------------------------------------------------------
// Connected
// ---------------------------------------------------------------------------------------------------------------

/// `connected`: reads the integrations, models, and providers again, says so, and goes on to `on_connected`, or
/// closes the dialog.
fn connected(flow: &Flow, integration: &IntegrationInfo) {
    let client = flow.local.client.clone();
    let location = flow.location();
    let flow = flow.clone();
    let integration = integration.clone();
    flow.clone().spawn(
        async move {
            let options = RequestOptions::default();
            let integrations = IntegrationListInput {
                location: location.clone(),
            };
            let models = ModelListInput {
                location: location.clone(),
                types: None,
            };
            let providers = ProviderListInput { location };
            let (integrations, models, providers) = futures_util::future::try_join3(
                client.integration_list(&integrations, &options),
                client.model_list(&models, &options),
                client.provider_list(&providers, &options),
            )
            .await?;
            Ok((integrations.data, models.data, providers.data))
        },
        move |result| {
            let local = &flow.local;
            match result {
                Ok((integrations, models, providers)) => {
                    local.set_catalog(integrations, models, providers)
                }
                Err(error) => {
                    log::warn!("integration catalog: {error}");
                    local.toasts.error(error.to_string());
                    return;
                }
            }
            local.toasts.show(ToastOptions::new(
                Variant::Success,
                format!("Connected {}", integration.name),
            ));
            match &flow.on_connected {
                Some(on_connected) => on_connected(local, provider_id(local, &integration.id)),
                None => local.dialogs.clear(),
            }
        },
    );
}

/// `providerID`: the integration's provider that has a model in use, else its first.
fn provider_id(local: &Local, integration: &IntegrationID) -> Option<String> {
    let models = local.models();
    let matches: Vec<_> = local
        .providers()
        .into_iter()
        .filter(|provider| {
            provider.integration_id.as_ref() == Some(integration) || provider.id.0 == integration.0
        })
        .collect();
    matches
        .iter()
        .find(|provider| {
            models.iter().any(|model| {
                model.provider_id == provider.id
                    && !matches!(model.status, ModelInfoStatus::Deprecated)
            })
        })
        .or(matches.first())
        .map(|provider| provider.id.0.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn integration(value: serde_json::Value) -> IntegrationInfo {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn sorts_popular_first_then_by_name() {
        let list = ["zed", "anthropic", "acme", "opencode", "Beta"]
            .into_iter()
            .map(|id| {
                integration(json!({ "id": id, "name": id, "methods": [], "connections": [] }))
            })
            .collect();
        let ids: Vec<String> = sorted(list).into_iter().map(|item| item.id.0).collect();
        assert_eq!(ids, ["opencode", "anthropic", "acme", "Beta", "zed"]);
    }

    #[test]
    fn methods_drop_env_and_put_keys_last() {
        let item = integration(json!({
            "id": "x", "name": "X", "connections": [],
            "methods": [
                { "type": "key" },
                { "type": "env", "names": ["X_KEY"] },
                { "type": "oauth", "id": "browser", "label": "Browser" },
                { "type": "command", "id": "cli", "label": "CLI", "command": ["x", "login"] },
            ],
        }));
        let labels: Vec<String> = connect_methods(&item).iter().map(Method::label).collect();
        assert_eq!(labels, ["Browser", "CLI", "API key"]);
    }

    #[test]
    fn summarizes_connections() {
        let with = |connections: serde_json::Value| {
            summary(&integration(
                json!({ "id": "x", "name": "X", "methods": [], "connections": connections }),
            ))
        };
        assert_eq!(with(json!([])), "");
        assert_eq!(
            with(json!([{ "type": "credential", "id": "c1", "label": "work", "method": "key" }])),
            "work"
        );
        assert_eq!(with(json!([{ "type": "env", "name": "X_KEY" }])), "$X_KEY");
        assert_eq!(
            with(json!([{ "type": "env", "name": "A" }, { "type": "env", "name": "B" }])),
            "2 connections"
        );
    }

    #[test]
    fn finds_the_device_code() {
        assert_eq!(
            oauth_code("Enter code ABCD-1234 at the page").as_deref(),
            Some("ABCD-1234")
        );
        assert_eq!(
            oauth_code("code WXYZ-12345!").as_deref(),
            Some("WXYZ-12345")
        );
        assert_eq!(oauth_code("abcd-1234"), None);
    }
}
