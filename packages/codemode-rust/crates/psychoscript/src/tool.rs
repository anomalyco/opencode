//! Tools: their declaration, the namespace tree a runtime indexes them in, and the catalog it describes them with.

use std::collections::BTreeMap;
use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, OnceLock};

use crate::Json;
use crate::schema::{self, Schema};

/// A boxed future a host hands the runtime. `Send`, so a run can move between threads.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// What a tool call knows about itself: its stable idempotency key, `<runId>:<callId>`.
#[derive(Clone, Debug)]
pub struct ToolContext {
    run_id: RunId,
    pub(crate) call: u64,
}

/// A run's id, shared by its calls and made the first time a key is read, when the host gave none.
pub(crate) type RunId = Arc<OnceLock<String>>;

impl ToolContext {
    pub(crate) fn new(run_id: RunId, call: u64) -> Self {
        Self { run_id, call }
    }

    /// `<runId>:<callId>`, the same at every hook.
    pub fn key(&self) -> String {
        format!(
            "{}:{}",
            self.run_id.get_or_init(crate::run::random_run_id),
            self.call
        )
    }
}

/// A tool's refusal or failure, reported as `ToolFailure` and thrown into the program as an `Error`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolError {
    pub message: String,
}

impl ToolError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for ToolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ToolError {}

impl From<String> for ToolError {
    fn from(message: String) -> Self {
        Self { message }
    }
}

impl From<&str> for ToolError {
    fn from(message: &str) -> Self {
        Self::new(message)
    }
}

pub type SyncExecute = dyn Fn(Json, &ToolContext) -> Result<Json, ToolError> + Send + Sync;
pub type AsyncExecute =
    dyn Fn(Json, ToolContext) -> BoxFuture<'static, Result<Json, ToolError>> + Send + Sync;

#[derive(Clone)]
pub enum Execute {
    /// Runs to completion when the program calls it.
    Sync(Arc<SyncExecute>),
    /// Starts when the program calls it; the program holds a promise until the future completes.
    Async(Arc<AsyncExecute>),
}

/// One schema-described tool, the counterpart of the reference's `Tool.make`.
#[derive(Clone)]
pub struct Tool {
    pub description: String,
    pub input: Schema,
    /// `None` renders `Promise<void>` and hands the program `undefined`, whatever the tool returns.
    pub output: Option<Schema>,
    /// The input is one required string field that programs may pass directly: `tools.patch("...")`.
    pub freeform: bool,
    pub execute: Execute,
}

impl Tool {
    /// A tool with a synchronous body. Like the reference, a tool without an output schema renders `Promise<void>`
    /// and hands the program `undefined`; the input defaults to a render-only schema that accepts anything.
    pub fn new(
        description: impl Into<String>,
        execute: impl Fn(Json, &ToolContext) -> Result<Json, ToolError> + Send + Sync + 'static,
    ) -> Self {
        Self::with(description, Execute::Sync(Arc::new(execute)))
    }

    /// A tool whose body is a future; it runs on whatever executor drives the program.
    pub fn new_async<F>(
        description: impl Into<String>,
        execute: impl Fn(Json, ToolContext) -> F + Send + Sync + 'static,
    ) -> Self
    where
        F: Future<Output = Result<Json, ToolError>> + Send + 'static,
    {
        Self::with(
            description,
            Execute::Async(Arc::new(move |input, ctx| Box::pin(execute(input, ctx)))),
        )
    }

    fn with(description: impl Into<String>, execute: Execute) -> Self {
        Self {
            description: description.into(),
            input: Schema::render_only(Json::Object(Default::default())),
            output: None,
            freeform: false,
            execute,
        }
    }

    pub fn input(mut self, schema: Schema) -> Self {
        self.input = schema;
        self
    }

    pub fn output(mut self, schema: Schema) -> Self {
        self.output = Some(schema);
        self
    }

    pub fn freeform(mut self) -> Self {
        self.freeform = true;
        self
    }
}

/// A tool as the catalog and search describe it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolDescription {
    /// The canonical dotted path, such as `orders.lookup`.
    pub path: String,
    pub description: String,
    /// The generated TypeScript call signature, such as `tools.orders.lookup({ ... }): Promise<...>`.
    pub signature: String,
}

/// The expression that calls a tool: `tools.a.b`, with bracket notation for segments that are not identifiers.
pub fn tool_expression(path: &str) -> String {
    let mut out = String::from("tools");
    for segment in path.split('.') {
        if schema::is_identifier(segment) {
            out.push('.');
            out.push_str(segment);
        } else {
            out.push('[');
            out.push_str(&schema::js_stringify(&Json::String(segment.to_owned())));
            out.push(']');
        }
    }
    out
}

/// A registered tool with its rendering done once, on first use.
pub struct Entry {
    pub path: String,
    pub tool: Tool,
    /// Descriptions of the namespaces enclosing it, outermost first.
    pub namespaces: Vec<String>,
    signature: OnceLock<String>,
}

impl Entry {
    pub fn new(path: String, tool: Tool, namespaces: Vec<String>) -> Self {
        Self {
            path,
            tool,
            namespaces,
            signature: OnceLock::new(),
        }
    }

    pub fn signature(&self) -> &str {
        self.signature
            .get_or_init(|| signature(&self.path, &self.tool))
    }

    pub fn describe(&self) -> ToolDescription {
        ToolDescription {
            path: self.path.clone(),
            description: self.tool.description.clone(),
            signature: self.signature().to_owned(),
        }
    }
}

fn signature(path: &str, tool: &Tool) -> String {
    let params = tool
        .freeform
        .then(|| schema::string_parameter(tool.input.document()))
        .flatten()
        .map(|(_, sig)| sig)
        .unwrap_or_else(|| {
            if schema::is_empty_input(&tool.input) {
                "()".into()
            } else {
                format!("({})", schema::to_typescript(tool.input.document(), true))
            }
        });
    let output = match &tool.output {
        None => "void".into(),
        Some(s) => schema::to_typescript(s.document(), true),
    };
    format!("{}{params}: Promise<{output}>", tool_expression(path))
}

/// A configuration mistake the reference reports by throwing from `CodeMode.make`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigError(pub String);

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ConfigError {}

/// Checks a dotted tool or namespace path; empty segments are refused like the reference refuses them.
pub fn check_path(path: &str) -> Result<(), ConfigError> {
    if path.split('.').any(str::is_empty) {
        return Err(ConfigError(format!(
            "Tool name '{path}' contains an empty segment."
        )));
    }
    Ok(())
}

/// Every tool of a runtime, by canonical dotted path, and the namespace descriptions around them.
#[derive(Default)]
pub struct Registry {
    pub tools: BTreeMap<String, Arc<Tool>>,
    pub namespaces: BTreeMap<String, String>,
    /// Paths in first-insertion order, which is the order namespaces enumerate their children in.
    order: Vec<String>,
    entries: OnceLock<Vec<Entry>>,
    index: OnceLock<crate::search::WordIndex>,
}

impl Registry {
    pub fn insert(&mut self, path: &str, tool: Tool) {
        if self.tools.insert(path.to_owned(), Arc::new(tool)).is_none() {
            self.order.push(path.to_owned());
        }
        self.entries = OnceLock::new();
        self.index = OnceLock::new();
    }

    /// The search word index over [`Registry::entries`], built on the first query.
    pub fn word_index(&self) -> &crate::search::WordIndex {
        self.index
            .get_or_init(|| crate::search::WordIndex::build(self.entries()))
    }

    pub fn namespace(&mut self, path: &str, description: &str) {
        self.namespaces
            .insert(path.to_owned(), description.to_owned());
        self.entries = OnceLock::new();
        self.index = OnceLock::new();
    }

    /// Tools in path order (by UTF-16 code units, as the reference sorts), for the catalog and search.
    pub fn entries(&self) -> &[Entry] {
        self.entries.get_or_init(|| {
            let mut entries: Vec<Entry> = self
                .tools
                .iter()
                .map(|(path, tool)| {
                    let mut namespaces = Vec::new();
                    let mut prefix = String::new();
                    for (i, segment) in path.split('.').enumerate() {
                        if i > 0 {
                            prefix.push('.');
                        }
                        prefix.push_str(segment);
                        if let Some(d) = self.namespaces.get(&prefix) {
                            namespaces.push(d.clone());
                        }
                    }
                    Entry::new(path.clone(), (**tool).clone(), namespaces)
                })
                .collect();
            entries.sort_by(|a, b| compare_text(&a.path, &b.path));
            entries
        })
    }

    pub fn get(&self, path: &str) -> Option<&Arc<Tool>> {
        self.tools.get(path)
    }

    /// Whether some tool lives under `path`, which makes it a namespace.
    pub fn is_namespace(&self, path: &str) -> bool {
        if path.is_empty() {
            return true;
        }
        let under = format!("{path}.");
        self.tools
            .range(under.clone()..)
            .next()
            .is_some_and(|(k, _)| k.starts_with(&under))
    }

    /// Whether `path` names a tool or a namespace.
    pub fn exists(&self, path: &str) -> bool {
        self.tools.contains_key(path) || self.is_namespace(path)
    }

    /// The child segments under a namespace, in the order the reference's trie holds them: first insertion.
    pub fn children(&self, path: &str) -> Vec<String> {
        let under = if path.is_empty() {
            String::new()
        } else {
            format!("{path}.")
        };
        let mut out: Vec<String> = Vec::new();
        for k in &self.order {
            if let Some(rest) = k.strip_prefix(&under) {
                let child = rest.split('.').next().unwrap_or(rest);
                if !out.iter().any(|c| c == child) {
                    out.push(child.to_owned());
                }
            }
        }
        out
    }
}

/// String order by UTF-16 code units, like JavaScript's `<`.
pub fn compare_text(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}
