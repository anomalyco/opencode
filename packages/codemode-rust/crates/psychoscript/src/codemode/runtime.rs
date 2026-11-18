//! The runtime a host makes, the counterpart of the reference's `CodeMode.make`: its tools, extensions, hooks and
//! limits, and the outcome of a run.

use crate::{
    ConfigError, Diagnostic, Extension, Hooks, Interrupted, Json, Limits, Program, Schema,
    Snapshot, SnapshotError, Tool, ToolDescription, ToolError, from_bytes, host, run, search, tool,
};

/// A host tool: plain data in, plain data out. A failure is thrown into the program as an error.
pub type ToolFn = Box<dyn Fn(&Json) -> Result<Json, String> + Send + Sync>;

#[derive(Clone, Debug)]
pub struct ToolCall {
    pub path: String,
    pub input: Json,
}

#[derive(Clone, Debug)]
pub struct Outcome {
    /// `Ok(value)` is JSON-safe; `undefined` becomes `null`.
    pub result: Result<Json, Diagnostic>,
    /// Non-fatal diagnostics.
    pub warnings: Vec<Diagnostic>,
    pub logs: Vec<String>,
    /// Whether `max_output_bytes` cut the retained result or logs.
    pub truncated: bool,
    pub tool_calls: Vec<ToolCall>,
}

/// Options for one run of a runtime's program: [`Runtime::execute_with`], [`Runtime::program_with`] and
/// [`Runtime::resume_with`], the reference's `RunOptions`.
#[derive(Clone, Debug, Default)]
pub struct RunOptions {
    extensions: Option<Vec<String>>,
}

impl RunOptions {
    pub fn new() -> Self {
        Self::default()
    }

    /// Which of the runtime's extensions this run gets as globals, by name; all of them by default. Each must be one
    /// the runtime was made with. They apply in the order the runtime has them, so the same extensions picked in any
    /// order give the same globals, and resume alike. A resumed run needs the ones it started with.
    pub fn extensions<S: Into<String>>(mut self, names: impl IntoIterator<Item = S>) -> Self {
        self.extensions = Some(names.into_iter().map(Into::into).collect());
        self
    }
}

/// What a runtime shares with every run it starts.
pub(crate) struct Setup {
    pub registry: tool::Registry,
    pub hooks: Hooks,
    pub extensions: Vec<Extension>,
    pub limits: Limits,
}

impl Setup {
    /// The extensions a run gets: those `options` picks, in the runtime's order, or all of them.
    ///
    /// # Panics
    ///
    /// When `options` picks an extension the runtime wasn't made with, as the reference throws a `TypeError`.
    pub(crate) fn pick(&self, options: &RunOptions) -> std::rc::Rc<[&Extension]> {
        self.check(options);
        match &options.extensions {
            None => self.extensions.iter().collect(),
            Some(names) => self
                .extensions
                .iter()
                .filter(|e| names.iter().any(|n| n == e.name()))
                .collect(),
        }
    }

    /// Panics, as [`Setup::pick`] does, when `options` picks an extension the runtime wasn't made with.
    pub(crate) fn check(&self, options: &RunOptions) {
        let unknown = options
            .extensions
            .iter()
            .flatten()
            .find(|n| !self.extensions.iter().any(|e| e.name() == n.as_str()));
        if let Some(name) = unknown {
            panic!("Extension \"{name}\" isn't one this runtime was made with.");
        }
    }
}

/// Reusable runtime: tools, extensions, hooks and limits are fixed, each `execute` is an independent run.
pub struct Runtime {
    setup: Setup,
}

impl Runtime {
    pub fn new() -> Self {
        Self {
            setup: Setup {
                registry: tool::Registry::default(),
                hooks: Hooks::default(),
                extensions: Vec::new(),
                limits: Limits::default(),
            },
        }
    }

    /// Registers a tool at a dotted path, callable as `tools.<path>(input)`; `"git.status"` is `tools.git.status`.
    /// Its schemas accept anything, so its signature is `(unknown): Promise<unknown>`.
    ///
    /// # Panics
    ///
    /// When the path has an empty segment.
    pub fn tool(
        self,
        path: &str,
        f: impl Fn(&Json) -> Result<Json, String> + Send + Sync + 'static,
    ) -> Self {
        self.with_tool(
            path,
            Tool::new("", move |input, _| f(&input).map_err(ToolError::from))
                .output(Schema::render_only(Json::Object(Default::default()))),
        )
    }

    /// Registers a schema-described tool at a dotted path. A later tool at the same canonical path replaces it.
    ///
    /// # Panics
    ///
    /// When the path has an empty segment, as the reference throws from `CodeMode.make`.
    pub fn with_tool(self, path: &str, tool: Tool) -> Self {
        self.try_with_tool(path, tool)
            .unwrap_or_else(|e| panic!("{e}"))
    }

    pub fn try_with_tool(mut self, path: &str, tool: Tool) -> Result<Self, ConfigError> {
        tool::check_path(path)?;
        self.setup.registry.insert(path, tool);
        Ok(self)
    }

    /// Describes the namespace at a dotted path, like the reference's `Namespace.make`. The description is
    /// model-visible through search: it matches every tool under the namespace.
    ///
    /// # Panics
    ///
    /// When the path has an empty segment.
    pub fn namespace(mut self, path: &str, description: &str) -> Self {
        if let Err(e) = tool::check_path(path) {
            panic!("{e}");
        }
        self.setup.registry.namespace(path, description);
        self
    }

    /// Adds host globals. See [`Extension`].
    ///
    /// # Panics
    ///
    /// When a global shadows a built-in or another extension's global.
    pub fn extension(self, extension: Extension) -> Self {
        self.try_extension(extension)
            .unwrap_or_else(|e| panic!("{e}"))
    }

    pub fn try_extension(mut self, extension: Extension) -> Result<Self, ConfigError> {
        for (name, _) in extension.globals() {
            let taken = host::BUILTIN_GLOBALS.contains(&name.as_str())
                || self
                    .setup
                    .extensions
                    .iter()
                    .any(|e| e.globals().iter().any(|(n, _)| n == name));
            if taken {
                return Err(ConfigError(format!(
                    "Extension \"{}\" global \"{name}\" is already defined.",
                    extension.name()
                )));
            }
        }
        self.setup.extensions.push(extension);
        Ok(self)
    }

    pub fn hooks(mut self, hooks: Hooks) -> Self {
        self.setup.hooks = hooks;
        self
    }

    /// # Panics
    ///
    /// When `timeout_ms` is `Some(0)`, which the reference refuses with a `RangeError`.
    pub fn limits(mut self, limits: Limits) -> Self {
        assert!(
            limits.timeout_ms != Some(0),
            "timeoutMs must be a safe integer greater than or equal to 1."
        );
        self.setup.limits = limits;
        self
    }

    /// Every tool with its exact path, description and generated TypeScript signature, sorted by path.
    pub fn catalog(&self) -> Vec<ToolDescription> {
        self.setup
            .registry
            .entries()
            .iter()
            .map(tool::Entry::describe)
            .collect()
    }

    /// Parses, compiles and runs `code` on the calling thread, blocking on asynchronous host work. `bindings` become
    /// top-level constants. An interrupted run ends with an `ExecutionFailure` saying so; [`Program::run`] tells the
    /// two apart.
    pub fn execute(&self, code: &str, bindings: &serde_json::Map<String, Json>) -> Outcome {
        run::execute(self, code, bindings, &RunOptions::default())
    }

    /// [`Runtime::execute`] with [`RunOptions`], such as only some of the runtime's extensions.
    ///
    /// # Panics
    ///
    /// When `options` picks an extension this runtime wasn't made with.
    pub fn execute_with(
        &self,
        code: &str,
        bindings: &serde_json::Map<String, Json>,
        options: &RunOptions,
    ) -> Outcome {
        run::execute(self, code, bindings, options)
    }

    /// Runs `code` as a future on any executor. Dropping it interrupts the run and every host call in flight; a tool
    /// can interrupt it too, and then it ends with [`Interrupted`].
    pub async fn execute_async(
        &self,
        code: &str,
        bindings: &serde_json::Map<String, Json>,
    ) -> Result<Outcome, Interrupted> {
        self.program(code, bindings, None).run_async().await
    }

    /// A program ready to run once; nothing runs until [`Program::run`] or [`Program::run_async`]. Host calls get the keys `<run_id>:<callId>`; a random run id by default.
    pub fn program<'a>(
        &'a self,
        code: &'a str,
        bindings: &serde_json::Map<String, Json>,
        run_id: Option<&str>,
    ) -> Program<'a> {
        Program::new(self, code, bindings, run_id, &RunOptions::default())
    }

    /// [`Runtime::program`] with [`RunOptions`], such as only some of the runtime's extensions.
    ///
    /// # Panics
    ///
    /// When `options` picks an extension this runtime wasn't made with.
    pub fn program_with<'a>(
        &'a self,
        code: &'a str,
        bindings: &serde_json::Map<String, Json>,
        run_id: Option<&str>,
        options: &RunOptions,
    ) -> Program<'a> {
        Program::new(self, code, bindings, run_id, options)
    }

    /// A program continuing a suspended run, from its state or from [`to_bytes`]. It keeps the limits it was saved
    /// with. Fails with a [`SnapshotError`] when the state was saved by another build, with other extensions, from a
    /// source that no longer compiles the same, or is malformed.
    pub fn resume(&self, state: &Snapshot) -> Result<Program<'_>, SnapshotError> {
        Program::resume(self, state, &RunOptions::default())
    }

    /// [`Runtime::resume`] with [`RunOptions`]. A run started with only some of the runtime's extensions resumes only
    /// with the same ones, picked in any order.
    ///
    /// # Panics
    ///
    /// When `options` picks an extension this runtime wasn't made with.
    pub fn resume_with(
        &self,
        state: &Snapshot,
        options: &RunOptions,
    ) -> Result<Program<'_>, SnapshotError> {
        Program::resume(self, state, options)
    }

    /// [`Runtime::resume`] from bytes.
    pub fn resume_bytes(&self, bytes: &[u8]) -> Result<Program<'_>, SnapshotError> {
        let state = from_bytes(bytes)?;
        Program::resume(self, &state, &RunOptions::default())
    }

    pub(crate) fn setup(&self) -> &Setup {
        &self.setup
    }
}

impl Default for Runtime {
    fn default() -> Self {
        Self::new()
    }
}

/// The exact callable signature of the built-in `search(...)`, for host-owned instructions.
pub fn search_signature() -> String {
    search::search_signature()
}
