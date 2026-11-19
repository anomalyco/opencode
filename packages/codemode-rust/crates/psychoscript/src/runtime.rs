//! The runtime a host makes, the counterpart of the reference's `Runtime.make`: the host globals every run gets, its
//! modules, limits and translation, and the outcome of a run.

use std::sync::{Arc, Mutex};

use crate::host::RunId;
use crate::{
    Diagnostic, HostValue, Interrupted, Json, Limits, Program, Snapshot, SnapshotError, from_bytes,
};

/// How a run ended: its value or failure, with what it logged and its metadata.
#[derive(Clone, Debug)]
pub struct Outcome {
    /// `Ok(value)` is JSON-safe; `undefined` becomes `null`.
    pub result: Result<Json, Diagnostic>,
    /// Non-fatal diagnostics.
    pub warnings: Vec<Diagnostic>,
    pub logs: Vec<String>,
    /// Whether `max_output_bytes` cut the retained result or logs.
    pub truncated: bool,
    /// The run's metadata as its host functions left it (see [`Run::set_metadata`]); `null` when none was set.
    pub metadata: Json,
}

/// The run a runtime's globals are made for, the reference's `Run`: its id, and metadata its host functions may keep
/// across a suspend. A clone is the same run.
#[derive(Clone)]
pub struct Run {
    pub(crate) id: RunId,
    metadata: Arc<Mutex<Json>>,
}

impl Run {
    pub(crate) fn new(id: Option<String>, metadata: Json) -> Self {
        Self {
            id: Arc::new(id.map(std::sync::OnceLock::from).unwrap_or_default()),
            metadata: Arc::new(Mutex::new(metadata)),
        }
    }

    /// The run's id, the first part of its calls' keys: the one [`ProgramOptions::run_id`] gave, or a random UUID.
    pub fn id(&self) -> &str {
        self.id.get_or_init(crate::host::random_run_id)
    }

    /// The run's metadata: JSON data its host functions keep, which a saved run keeps in its state and the outcome
    /// reports. `null` until set.
    pub fn metadata(&self) -> Json {
        self.lock().clone()
    }

    pub fn set_metadata(&self, metadata: Json) {
        *self.lock() = metadata;
    }

    /// Changes the metadata in place.
    pub fn update_metadata<T>(&self, f: impl FnOnce(&mut Json) -> T) -> T {
        f(&mut self.lock())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Json> {
        self.metadata.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl std::fmt::Debug for Run {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Run")
            .field("id", &self.id.get())
            .field("metadata", &*self.lock())
            .finish()
    }
}

/// How a host call's arguments carry program values the host can't hold, the reference's `Translate`. Every host
/// function in the runtime gets its arguments this way; results are not affected.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Translate {
    pub functions: TranslateFunctions,
    pub promises: TranslatePromises,
}

/// A program function inside an argument.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TranslateFunctions {
    /// Fails the call.
    #[default]
    Error,
    /// Leaves it out, as `JSON.stringify` does: an object's key is left out, an array's item is `null`, and an
    /// argument is `undefined`.
    Drop,
}

/// A program promise inside an argument.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TranslatePromises {
    /// Fails the call.
    #[default]
    Error,
    /// Makes the call wait for it to settle and use its value. A rejection fails the call with its reason.
    Await,
}

/// Options for one program: [`Runtime::program`], [`Runtime::execute_with`], the reference's `ProgramOptions`.
#[derive(Clone, Debug, Default)]
pub struct ProgramOptions {
    pub(crate) bindings: serde_json::Map<String, Json>,
    pub(crate) run_id: Option<String>,
}

impl ProgramOptions {
    pub fn new() -> Self {
        Self::default()
    }

    /// Read-only JSON values bound in the program's outer scope, shadowable by top-level declarations. A host
    /// global of the same name wins.
    pub fn bindings(mut self, bindings: serde_json::Map<String, Json>) -> Self {
        self.bindings = bindings;
        self
    }

    /// Names this run's host calls (`<run_id>:<callId>`); a random UUID by default.
    pub fn run_id(mut self, run_id: impl Into<String>) -> Self {
        self.run_id = Some(run_id.into());
        self
    }
}

type GlobalsFn = dyn Fn(&Run) -> Vec<(String, HostValue)> + Send + Sync;

/// What a runtime shares with every run it starts.
#[derive(Default)]
pub(crate) struct Setup {
    pub globals: Option<Box<GlobalsFn>>,
    pub modules: Vec<(String, String)>,
    pub limits: Limits,
    pub translate: Translate,
}

impl Setup {
    /// The host globals for a run, made when it starts or resumes.
    pub(crate) fn globals_for(&self, run: &Run) -> crate::host::Globals {
        match &self.globals {
            Some(globals) => globals(run).into(),
            None => std::rc::Rc::from([]),
        }
    }
}

/// A reusable confined runtime over host globals: each run of a program is independent.
#[derive(Default)]
pub struct Runtime {
    setup: Setup,
}

impl Runtime {
    /// A runtime with no host globals, no limits, and the default translation; the reference's `Runtime.make()`.
    pub fn make() -> Self {
        Self::default()
    }

    /// The globals a program reaches, made for each run when it starts and again when it resumes, so they can keep
    /// the run's own state in its metadata: [`HostFunction`](crate::HostFunction)s,
    /// [`DurableFunction`](crate::DurableFunction)s, [`Namespace`](crate::Namespace)s, and plain values of them. A
    /// host global wins over a built-in of the same name.
    pub fn globals<F, I, K, V>(mut self, globals: F) -> Self
    where
        F: Fn(&Run) -> I + Send + Sync + 'static,
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<HostValue>,
    {
        self.setup.globals = Some(Box::new(move |run| {
            globals(run)
                .into_iter()
                .map(|(k, v)| (k.into(), v.into()))
                .collect()
        }));
        self
    }

    /// Module names that load a global, beyond its own name: `("bun", "Bun")` makes `import "bun"` load `Bun`.
    pub fn modules<K: Into<String>, V: Into<String>>(
        mut self,
        modules: impl IntoIterator<Item = (K, V)>,
    ) -> Self {
        self.setup.modules = modules
            .into_iter()
            .map(|(k, v)| (k.into(), v.into()))
            .collect();
        self
    }

    /// Budgets enforced on each run. Time counts active time only, across every resume of a run.
    ///
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

    /// How host calls' arguments carry functions and promises; see [`Translate`].
    pub fn translate(mut self, translate: Translate) -> Self {
        self.setup.translate = translate;
        self
    }

    /// Parses, compiles and runs `code` on the calling thread, blocking on asynchronous host work. An interrupted
    /// run ends with an `ExecutionFailure` saying so; [`Program::run`] tells the two apart.
    pub fn execute(&self, code: &str) -> Outcome {
        crate::run::execute(self, code, &ProgramOptions::default())
    }

    /// [`Runtime::execute`] with [`ProgramOptions`]: bindings, a run id.
    pub fn execute_with(&self, code: &str, options: &ProgramOptions) -> Outcome {
        crate::run::execute(self, code, options)
    }

    /// Runs `code` as a future on any executor. Dropping it interrupts the run and every host call in flight; a host
    /// call can interrupt it too, and then it ends with [`Interrupted`].
    pub async fn execute_async(
        &self,
        code: &str,
        options: &ProgramOptions,
    ) -> Result<Outcome, Interrupted> {
        self.program(code, options).run_async().await
    }

    /// A program ready to run once; nothing runs until [`Program::run`] or [`Program::run_async`].
    pub fn program<'a>(&'a self, code: &'a str, options: &ProgramOptions) -> Program<'a> {
        Program::new(self, code, options)
    }

    /// A program continuing a suspended run, from its state. It keeps the limits it was saved with, and its globals
    /// are made again for the run with its saved id and metadata. Fails with a [`SnapshotError`] when the state was
    /// saved by another build, with other host globals, from a source that no longer compiles the same, or is
    /// malformed.
    pub fn resume(&self, state: &Snapshot) -> Result<Program<'_>, SnapshotError> {
        Program::resume(self, state)
    }

    /// [`Runtime::resume`] from [`to_bytes`](crate::to_bytes).
    pub fn resume_bytes(&self, bytes: &[u8]) -> Result<Program<'_>, SnapshotError> {
        let state = from_bytes(bytes)?;
        Program::resume(self, &state)
    }

    pub(crate) fn setup(&self) -> &Setup {
        &self.setup
    }
}
