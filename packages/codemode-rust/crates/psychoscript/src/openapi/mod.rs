//! OpenAPI tools, the counterpart of the reference's `OpenAPI.fromSpec`: one tool per representable OpenAPI 3.x
//! operation, with dotted `operationId`s as namespaces. Authentication is resolved by the host and never shown to the
//! model, and requests go through an [`HttpClient`] the host implements. Operations that cannot be represented are
//! reported in [`Generated::skipped`] with the reference's reasons.

mod invoke;
mod normalize;
mod project;
mod spec;

use std::collections::HashSet;
use std::sync::Arc;

use crate::Json;
use crate::schema::Schema;
use crate::tool::{BoxFuture, Tool, ToolError};

pub use invoke::{HttpClient, HttpRequest, HttpResponse};

/// The operation identity handed to auth resolution and errors.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Operation {
    pub operation_id: Option<String>,
    pub method: String,
    pub path: String,
    pub summary: Option<String>,
    pub description: Option<String>,
}

/// A resolved security scheme from `components.securitySchemes`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SecurityScheme {
    ApiKey {
        name: String,
        location: ApiKeyLocation,
    },
    Http {
        scheme: String,
    },
    OAuth2,
    OpenIdConnect,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApiKeyLocation {
    Header,
    Query,
    Cookie,
}

/// Credential material from the host's resolver. `ApiKey` uses its scheme's carrier; `Header` supports nonstandard
/// schemes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Credential {
    Bearer { token: String },
    Basic { username: String, password: String },
    ApiKey { value: String },
    Header { name: String, value: String },
}

/// What a credential is resolved for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthContext {
    pub name: String,
    pub definition: SecurityScheme,
    pub scopes: Vec<String>,
    pub operation: Operation,
}

/// Resolves credentials at call time. `Ok(None)` tries the next alternative requirement; an error aborts the call.
pub type AuthResolver = Arc<
    dyn Fn(&AuthContext) -> BoxFuture<'static, Result<Option<Credential>, ToolError>> + Send + Sync,
>;

/// The counterpart of the reference's `OpenAPI.Options`, with the HTTP client the generated tools call.
#[derive(Clone)]
pub struct Options {
    /// A parsed OpenAPI 3.x document.
    pub spec: Json,
    /// Overrides every document, path and operation `servers`. Needed when no absolute server URL applies.
    pub base_url: Option<String>,
    pub auth: Option<AuthResolver>,
    /// Static headers on every request. Not model-visible; declared header parameters may override them, and
    /// authentication always wins.
    pub headers: Vec<(String, String)>,
    pub client: Arc<dyn HttpClient>,
}

impl Options {
    pub fn new(spec: Json, client: Arc<dyn HttpClient>) -> Self {
        Self {
            spec,
            base_url: None,
            auth: None,
            headers: Vec::new(),
            client,
        }
    }

    pub fn base_url(mut self, url: impl Into<String>) -> Self {
        self.base_url = Some(url.into());
        self
    }

    /// Credentials resolved by a function that decides at once.
    pub fn auth(
        self,
        resolve: impl Fn(&AuthContext) -> Result<Option<Credential>, ToolError> + Send + Sync + 'static,
    ) -> Self {
        self.auth_async(move |ctx| std::future::ready(resolve(ctx)))
    }

    pub fn auth_async<F>(
        mut self,
        resolve: impl Fn(&AuthContext) -> F + Send + Sync + 'static,
    ) -> Self
    where
        F: std::future::Future<Output = Result<Option<Credential>, ToolError>> + Send + 'static,
    {
        self.auth = Some(Arc::new(move |ctx| Box::pin(resolve(ctx))));
        self
    }

    pub fn header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }
}

/// An operation that could not be represented as a tool, and why.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Skipped {
    pub method: String,
    pub path: String,
    pub reason: String,
}

/// The generated tools by dotted path, for the host to register under a namespace of its choice, and what was
/// skipped.
pub struct Generated {
    pub tools: Vec<(String, Tool)>,
    pub skipped: Vec<Skipped>,
}

const METHODS: [&str; 8] = [
    "get", "put", "post", "delete", "options", "head", "patch", "trace",
];

/// A document the reference refuses as a whole: it throws from `OpenAPI.fromSpec` with this message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpecError(pub String);

impl std::fmt::Display for SpecError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for SpecError {}

/// Builds one tool per representable operation of an OpenAPI 3.x document. Fails, as the reference throws, when
/// an OpenAPI 3.0 schema uses a keyword that only JSON Schema 2020-12 defines.
pub fn from_spec(mut options: Options) -> Result<Generated, SpecError> {
    options.spec = crate::schema::js_key_order(std::mem::take(&mut options.spec));
    let doc = &options.spec;
    let mut projector = project::Projector::new(doc);
    let schemes = spec::security_schemes(doc);
    let default_security = spec::security_requirements(doc.get("security"));
    let request_definitions =
        spec::component_definitions(&mut projector, project::Direction::Request);
    let response_definitions = if projector.directional() {
        spec::component_definitions(&mut projector, project::Direction::Response)
    } else {
        request_definitions.clone()
    };
    let mut used: HashSet<String> = HashSet::new();
    let mut namespaces: HashSet<String> = HashSet::new();
    let mut skipped = Vec::new();
    let mut tools: Vec<(String, Tool)> = Vec::new();
    let empty = serde_json::Map::new();
    let paths = doc.get("paths").and_then(Json::as_object).unwrap_or(&empty);
    let headers: Arc<Vec<(String, String)>> = Arc::new(
        options
            .headers
            .iter()
            .map(|(k, v)| (k.to_ascii_lowercase(), v.clone()))
            .collect(),
    );
    for (path, path_value) in paths {
        let Some(path_item) = path_value.as_object() else {
            continue;
        };
        for (method, operation_value) in path_item {
            if !METHODS.contains(&method.as_str()) {
                continue;
            }
            let Some(operation_object) = operation_value.as_object() else {
                continue;
            };
            let operation = Operation {
                operation_id: spec::non_empty(operation_object.get("operationId"))
                    .map(str::to_owned),
                method: method.to_uppercase(),
                path: path.clone(),
                summary: spec::non_empty(operation_object.get("summary")).map(str::to_owned),
                description: spec::non_empty(operation_object.get("description"))
                    .map(str::to_owned),
            };
            let mut skip = |reason: String| {
                skipped.push(Skipped {
                    method: operation.method.clone(),
                    path: path.clone(),
                    reason,
                })
            };
            let output = match spec::operation_output(
                &mut projector,
                operation_value,
                &response_definitions,
            ) {
                Ok(o) => o,
                Err(reason) => {
                    skip(reason);
                    continue;
                }
            };
            let base_url = match &options.base_url {
                Some(url) => spec::validate_base_url(url),
                None if operation_object.contains_key("servers") => {
                    spec::spec_server_url(operation_value)
                }
                None if path_item.contains_key("servers") => spec::spec_server_url(path_value),
                None => spec::spec_server_url(doc),
            };
            let base_url = match base_url {
                Ok(u) => u,
                Err(reason) => {
                    skip(reason);
                    continue;
                }
            };
            let input = match spec::operation_input(&mut projector, path_value, operation_value) {
                Ok(i) => i,
                Err(reason) => {
                    skip(reason);
                    continue;
                }
            };
            let security = match spec::operation_security_requirements(
                operation_object.get("security"),
                &default_security,
                &schemes,
            ) {
                Ok(s) => s,
                Err(reason) => {
                    skip(reason);
                    continue;
                }
            };
            let input_schema = spec::input_schema(&input.fields, &request_definitions);
            let plan = Arc::new(invoke::Plan {
                url: format!("{}{path}", base_url.trim_end_matches('/')),
                operation: operation.clone(),
                fields: input.fields,
                body: input.body,
                security,
                schemes: schemes.clone(),
                auth: options.auth.clone(),
                headers: headers.clone(),
            });
            let segments = spec::operation_path(method, path, operation_value, &used, &namespaces);
            used.insert(segments.join("."));
            for i in 0..segments.len().saturating_sub(1) {
                namespaces.insert(segments[..=i].join("."));
            }
            let description = operation
                .description
                .clone()
                .or_else(|| operation.summary.clone())
                .unwrap_or_else(|| format!("{} {path}", operation.method));
            let client = options.client.clone();
            let mut tool = Tool::new_async(description, move |input, _| {
                let plan = plan.clone();
                let client = client.clone();
                async move { invoke::invoke(&plan, client.as_ref(), input).await }
            })
            .input(Schema::render_only(input_schema));
            if let Some(output) = output {
                tool = tool.output(Schema::render_only(output));
            }
            tools.push((segments.join("."), tool));
        }
    }
    match projector.error {
        Some(message) => Err(SpecError(message)),
        None => Ok(Generated { tools, skipped }),
    }
}
