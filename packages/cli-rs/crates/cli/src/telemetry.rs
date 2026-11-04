//! Log files, `--print-logs`, `--log-level`, and OpenTelemetry log export (`packages/cli/src/index.ts:144-152`,
//! `packages/util/src/observability.ts` and `observability/{logging,otlp}.ts`).
//!
//! Every record goes to the shared log file `<data>/log/opencode-<channel>.log` (`opencode.log` for a
//! release channel) in the TypeScript `key=value` format, to stderr with `OPENCODE_PRINT_LOGS=1`, and to
//! `$OTEL_EXPORTER_OTLP_ENDPOINT/v1/logs` when that is set. Library crates log through the `log` facade.

use std::fs::{File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender};
use std::time::{Duration, Instant, SystemTime};

use log::{Level, LevelFilter, Log, Metadata, Record};
use serde_json::{Value, json};

use crate::args::LogLevel;

/// The build channel; a build without one is `local`, like the TypeScript CLI (`packages/cli/src/version.ts`).
pub const CHANNEL: &str = match option_env!("OPENCODE_CHANNEL") {
    Some(channel) => channel,
    None => "local",
};

/// The log file is compacted once it passes this size, keeping about `LOG_KEEP_BYTES`.
pub const LOG_MAX_BYTES: u64 = 50 * 1024 * 1024;
pub const LOG_KEEP_BYTES: u64 = 25 * 1024 * 1024;
const LOG_TRIM_INTERVAL: Duration = Duration::from_secs(60 * 60);
const LOG_TRIM_LOCK_STALE: Duration = Duration::from_secs(5 * 60);
const LOG_TRIM_CHUNK: usize = 64 * 1024;

const OTLP_QUEUE: usize = 4096;
const OTLP_BATCH: usize = 1000;
const OTLP_INTERVAL: Duration = Duration::from_secs(1);
const OTLP_SHUTDOWN: Duration = Duration::from_secs(3);
const OTLP_DISABLE: Duration = Duration::from_secs(60);

static LOGGER: OnceLock<&'static Logger> = OnceLock::new();

/// What `install` reads from the process: paths, environment, and the `--log-level` flag.
pub struct Options {
    pub level: LevelFilter,
    /// The log directory; `None` when it cannot be resolved (no home directory).
    pub dir: Option<PathBuf>,
    pub channel: String,
    pub print: bool,
    pub endpoint: Option<String>,
    pub headers: Option<String>,
    pub resource: Value,
}

impl Options {
    pub fn from_env(flag: Option<LogLevel>) -> Self {
        let var = |name: &str| std::env::var(name).ok();
        let run = run_id();
        Self {
            level: min_level(flag, var("OPENCODE_LOG_LEVEL").as_deref()),
            dir: opencode_local::paths::Paths::from_env()
                .ok()
                .map(|paths| paths.log),
            channel: CHANNEL.to_owned(),
            print: var("OPENCODE_PRINT_LOGS").as_deref() == Some("1"),
            endpoint: var("OTEL_EXPORTER_OTLP_ENDPOINT").filter(|value| !value.is_empty()),
            headers: var("OTEL_EXPORTER_OTLP_HEADERS").filter(|value| !value.is_empty()),
            resource: resource(
                &crate::env::client(),
                crate::help::VERSION,
                CHANNEL,
                run,
                |name| var(name),
            ),
        }
    }
}

/// Installs the process logger once. Later calls do nothing.
pub fn install(options: Options) {
    if LOGGER.get().is_some() {
        return;
    }
    let logger: &'static Logger = Box::leak(Box::new(Logger::new(options)));
    if log::set_logger(logger).is_err() {
        return;
    }
    log::set_max_level(logger.level);
    let _ = LOGGER.set(logger);
    if let Some(path) = logger.path.clone() {
        let _ = std::thread::Builder::new()
            .name("opencode-log-trim".into())
            .spawn(move || {
                loop {
                    let _ = trim(&path, LOG_MAX_BYTES, LOG_KEEP_BYTES);
                    std::thread::sleep(LOG_TRIM_INTERVAL);
                }
            });
    }
}

/// The log file, once `install` has run and the directory exists.
pub fn file() -> Option<&'static Path> {
    LOGGER.get().and_then(|logger| logger.path.as_deref())
}

/// Sends the queued OpenTelemetry records, waiting at most 3 s. Call it before the process exits.
pub fn flush() {
    if let Some(logger) = LOGGER.get() {
        logger.export();
    }
}

/// `--log-level` wins over `OPENCODE_LOG_LEVEL` (`debug`, `info`, `warn`, `error`, any case), which defaults to
/// info (`observability/logging.ts:159-169`, Effect CLI's `GlobalFlag.LogLevel`). `log` has no fatal level, so
/// `fatal` logs nothing, as no record here is fatal.
pub fn min_level(flag: Option<LogLevel>, env: Option<&str>) -> LevelFilter {
    if let Some(flag) = flag {
        return match flag {
            LogLevel::All | LogLevel::Trace => LevelFilter::Trace,
            LogLevel::Debug => LevelFilter::Debug,
            LogLevel::Info => LevelFilter::Info,
            LogLevel::Warn | LogLevel::Warning => LevelFilter::Warn,
            LogLevel::Error => LevelFilter::Error,
            LogLevel::Fatal | LogLevel::None => LevelFilter::Off,
        };
    }
    match env.map(str::to_ascii_uppercase).as_deref() {
        Some("DEBUG") => LevelFilter::Debug,
        Some("WARN") => LevelFilter::Warn,
        Some("ERROR") => LevelFilter::Error,
        _ => LevelFilter::Info,
    }
}

/// `opencode-<channel>.log` for a local build, `opencode.log` for a release channel (`logging.ts:57-60`).
pub fn file_name(channel: &str) -> String {
    if channel != "local" {
        return "opencode.log".to_owned();
    }
    let safe: String = channel
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '-'
            }
        })
        .collect();
    format!("opencode-{safe}.log")
}

/// The 8-character run ID shared by every record of this process (`observability/shared.ts`).
pub fn run_id() -> &'static str {
    static RUN: OnceLock<String> = OnceLock::new();
    RUN.get_or_init(|| uuid::Uuid::new_v4().simple().to_string()[..8].to_owned())
}

struct Logger {
    level: LevelFilter,
    path: Option<PathBuf>,
    file: Option<File>,
    print: bool,
    otlp: Option<SyncSender<Message>>,
}

impl Logger {
    fn new(options: Options) -> Self {
        let path = options.dir.as_ref().and_then(|dir| {
            std::fs::create_dir_all(dir)
                .ok()
                .map(|()| dir.join(file_name(&options.channel)))
        });
        let file = path
            .as_ref()
            .and_then(|path| OpenOptions::new().create(true).append(true).open(path).ok());
        let otlp = options.endpoint.map(|endpoint| {
            Otlp {
                url: format!("{endpoint}/v1/logs"),
                headers: parse_headers(options.headers.as_deref()),
                resource: options.resource,
            }
            .start()
        });
        Self {
            level: options.level,
            path: file.as_ref().and(path),
            file,
            print: options.print,
            otlp,
        }
    }

    fn export(&self) {
        let Some(otlp) = &self.otlp else { return };
        let (done, wait) = std::sync::mpsc::sync_channel(1);
        if otlp.send(Message::Flush(done)).is_ok() {
            let _ = wait.recv_timeout(OTLP_SHUTDOWN);
        }
    }
}

impl Log for Logger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        // Other crates' debug and trace records (HTTP connections, TLS) would drown the client's own.
        metadata.level() <= self.level
            && (metadata.level() <= Level::Info || metadata.target().starts_with("opencode"))
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let fields = fields(record);
        let message = record.args().to_string();
        let now = SystemTime::now();
        let line = format!(
            "{}\n",
            format_line(now, record.level(), run_id(), &message, &fields)
        );
        // One append per record: lines of concurrent processes do not interleave, and no lock is held, so
        // a panic hook can log too.
        if let Some(mut file) = self.file.as_ref() {
            let _ = file.write_all(line.as_bytes());
        }
        if self.print {
            let _ = io::stderr().write_all(line.as_bytes());
        }
        if let Some(otlp) = &self.otlp {
            // A full queue drops the record rather than block the caller.
            let _ = otlp.try_send(Message::Record(log_record(
                now,
                record.level(),
                &message,
                &fields,
            )));
        }
    }

    fn flush(&self) {}
}

/// A record's key-value pairs, plus the `role=cli` annotation every CLI record carries (`index.ts:132`).
fn fields(record: &Record) -> Vec<(String, Field)> {
    struct Collect(Vec<(String, Field)>);
    impl<'kvs> log::kv::VisitSource<'kvs> for Collect {
        fn visit_pair(
            &mut self,
            key: log::kv::Key<'kvs>,
            value: log::kv::Value<'kvs>,
        ) -> Result<(), log::kv::Error> {
            let field = if let Some(value) = value.to_bool() {
                Field::Bool(value)
            } else if let Some(value) = value.to_i64() {
                Field::Int(value)
            } else if let Some(value) = value.to_f64() {
                Field::Float(value)
            } else {
                Field::Text(value.to_string())
            };
            self.0.push((key.to_string(), field));
            Ok(())
        }
    }
    let mut collect = Collect(Vec::new());
    let _ = record.key_values().visit(&mut collect);
    collect.0.push(("role".into(), Field::Text("cli".into())));
    collect.0
}

#[derive(Clone, Debug, PartialEq)]
pub enum Field {
    Text(String),
    Int(i64),
    Float(f64),
    Bool(bool),
}

impl Field {
    fn text(&self) -> String {
        match self {
            Field::Text(text) => text.clone(),
            Field::Int(value) => value.to_string(),
            Field::Float(value) => value.to_string(),
            Field::Bool(value) => value.to_string(),
        }
    }

    fn otlp(&self) -> Value {
        match self {
            Field::Text(text) => json!({ "stringValue": text }),
            Field::Int(value) => json!({ "intValue": value }),
            Field::Float(value) => json!({ "doubleValue": value }),
            Field::Bool(value) => json!({ "boolValue": value }),
        }
    }
}

/// One line of the TypeScript file format (`logging.ts:16-30`):
/// `timestamp=… level=INFO run=… message=… <fields>`, each value bare or as a JSON string.
pub fn format_line(
    now: SystemTime,
    level: Level,
    run: &str,
    message: &str,
    fields: &[(String, Field)],
) -> String {
    let timestamp = chrono::DateTime::<chrono::Utc>::from(now)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    [
        ("timestamp".to_owned(), timestamp),
        ("level".to_owned(), level.as_str().to_owned()),
        ("run".to_owned(), run.to_owned()),
        ("message".to_owned(), message.to_owned()),
    ]
    .into_iter()
    .chain(
        fields
            .iter()
            .map(|(key, value)| (key.clone(), value.text())),
    )
    .map(|(key, value)| format!("{key}={}", quote(&value)))
    .collect::<Vec<_>>()
    .join(" ")
}

/// Bare when the value matches `^[^\s="\\]+$`, else `JSON.stringify(value)`.
fn quote(value: &str) -> String {
    let bare = !value.is_empty()
        && !value
            .chars()
            .any(|c| c.is_whitespace() || matches!(c, '=' | '"' | '\\'));
    if bare {
        return value.to_owned();
    }
    Value::from(value).to_string()
}

/// Compacts `target` in place once it passes `max` bytes, keeping about `keep` bytes from the first line
/// boundary on (`logging.ts:84-129`). Other processes keep appending through their own `O_APPEND` handles, so
/// it never renames. A `<target>.trim` directory is the cross-process lock; one older than 5 minutes belongs
/// to a dead process and is removed, and the trim waits for the next round.
pub fn trim(target: &Path, max: u64, keep: u64) -> io::Result<()> {
    let lock = PathBuf::from(format!("{}.trim", target.display()));
    match std::fs::create_dir(&lock) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            let stale = std::fs::metadata(&lock)
                .and_then(|meta| meta.modified())
                .ok()
                .and_then(|modified| modified.elapsed().ok())
                .is_some_and(|age| age >= LOG_TRIM_LOCK_STALE);
            if stale {
                let _ = std::fs::remove_dir_all(&lock);
            }
            return Ok(());
        }
        Err(error) => return Err(error),
    }
    let result = compact(target, max, keep);
    let _ = std::fs::remove_dir_all(&lock);
    result
}

fn compact(target: &Path, max: u64, keep: u64) -> io::Result<()> {
    let size = std::fs::metadata(target)?.len();
    if size <= max {
        return Ok(());
    }
    let mut reader = File::open(target)?;
    let start = line_start(&mut reader, size.saturating_sub(keep))?;
    let mut writer = OpenOptions::new().write(true).open(target)?;
    reader.seek(SeekFrom::Start(start))?;
    // Reads run to the current end, so lines appended since the size was taken survive; the write
    // position always trails the read position.
    let mut chunk = vec![0u8; LOG_TRIM_CHUNK];
    let mut written = 0u64;
    loop {
        let read = reader.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        writer.write_all(&chunk[..read])?;
        written += read as u64;
    }
    writer.set_len(written)
}

/// The first byte after the first newline at or after `from`, or the end when the tail has none.
fn line_start(file: &mut File, from: u64) -> io::Result<u64> {
    let mut cursor = from;
    let mut chunk = vec![0u8; LOG_TRIM_CHUNK];
    file.seek(SeekFrom::Start(cursor))?;
    loop {
        let read = file.read(&mut chunk)?;
        if read == 0 {
            return Ok(cursor);
        }
        if let Some(newline) = chunk[..read].iter().position(|byte| *byte == b'\n') {
            return Ok(cursor + newline as u64 + 1);
        }
        cursor += read as u64;
    }
}

/// `OTEL_EXPORTER_OTLP_HEADERS`: `k=v` pairs split on `,`, the value being everything after the first `=`
/// (`otlp.ts:16-27`).
pub fn parse_headers(value: Option<&str>) -> Vec<(String, String)> {
    value
        .into_iter()
        .flat_map(|value| value.split(','))
        .map(|entry| match entry.split_once('=') {
            Some((key, value)) => (key.to_owned(), value.to_owned()),
            None => (entry.to_owned(), String::new()),
        })
        .collect()
}

/// The OTLP resource (`otlp.ts:46-61` with Effect's `OtlpResource.fromConfig`): service name `opencode` (or
/// `OTEL_SERVICE_NAME`), the version, `OTEL_RESOURCE_ATTRIBUTES`, the channel, client, and run ID.
pub fn resource(
    client: &str,
    version: &str,
    channel: &str,
    run: &str,
    var: impl Fn(&str) -> Option<String>,
) -> Value {
    let env = var("OTEL_RESOURCE_ATTRIBUTES").filter(|value| !value.is_empty());
    let decoded = env
        .as_deref()
        .and_then(decode_attributes)
        .unwrap_or_default();
    // Effect reads the variable again, without percent decoding, and lets it win.
    let raw: Vec<(String, String)> = env
        .as_deref()
        .into_iter()
        .flat_map(|value| value.split(','))
        .filter_map(|entry| entry.split_once('='))
        .map(|(key, value)| (key.to_owned(), value.to_owned()))
        .collect();
    let mut attributes: Vec<(String, String)> = Vec::new();
    let mut set = |key: &str, value: &str| match attributes.iter_mut().find(|(k, _)| k == key) {
        Some(entry) => entry.1 = value.to_owned(),
        None => attributes.push((key.to_owned(), value.to_owned())),
    };
    for (key, value) in &decoded {
        set(key, value);
    }
    set("deployment.environment.name", channel);
    set("opencode.client", client);
    set("opencode.run", run);
    set("service.instance.id", run);
    for (key, value) in &raw {
        set(key, value);
    }
    let lookup = |key: &str| {
        attributes
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, value)| value.clone())
    };
    let service_name = var("OTEL_SERVICE_NAME")
        .or_else(|| lookup("service.name"))
        .unwrap_or_else(|| "opencode".to_owned());
    let service_version = var("OTEL_SERVICE_VERSION")
        .or_else(|| lookup("service.version"))
        .unwrap_or_else(|| version.to_owned());
    let mut list: Vec<Value> = attributes
        .iter()
        .filter(|(key, _)| key != "service.name" && key != "service.version")
        .map(|(key, value)| json!({ "key": key, "value": { "stringValue": value } }))
        .collect();
    list.push(json!({ "key": "service.name", "value": { "stringValue": service_name } }));
    if !service_version.is_empty() {
        list.push(json!({ "key": "service.version", "value": { "stringValue": service_version } }));
    }
    json!({ "attributes": list, "droppedAttributesCount": 0 })
}

/// `decodeURIComponent` of each `k=v` entry; any bad entry drops the whole list, as the TS `catch` does.
fn decode_attributes(value: &str) -> Option<Vec<(String, String)>> {
    value
        .split(',')
        .map(|entry| {
            let index = entry.find('=').filter(|index| *index >= 1)?;
            Some((
                percent_decode(&entry[..index])?,
                percent_decode(&entry[index + 1..])?,
            ))
        })
        .collect()
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = text.get(index + 1..index + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
            continue;
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(out).ok()
}

/// One OTLP/JSON log record (Effect's `OtlpLogger.makeLogRecord`). With fields the body is
/// `[message, fields]`, as Effect logs `logInfo(message, fields)`.
pub fn log_record(
    now: SystemTime,
    level: Level,
    message: &str,
    fields: &[(String, Field)],
) -> Value {
    let nanos = now
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos())
        .to_string();
    let (severity, text) = match level {
        Level::Trace => (1, "Trace"),
        Level::Debug => (5, "Debug"),
        Level::Info => (9, "Info"),
        Level::Warn => (13, "Warn"),
        Level::Error => (17, "Error"),
    };
    // The annotation goes with the attributes; the record's own fields go in the body.
    let (annotations, own): (Vec<_>, Vec<_>) = fields.iter().partition(|(key, _)| key == "role");
    let attributes: Vec<Value> = annotations
        .iter()
        .map(|(key, value)| json!({ "key": key, "value": value.otlp() }))
        .collect();
    let body = if own.is_empty() {
        json!({ "stringValue": message })
    } else {
        let object: serde_json::Map<String, Value> = own
            .iter()
            .map(|(key, value)| {
                let value = match value {
                    Field::Text(text) => Value::from(text.as_str()),
                    Field::Int(value) => Value::from(*value),
                    Field::Float(value) => Value::from(*value),
                    Field::Bool(value) => Value::from(*value),
                };
                (key.clone(), value)
            })
            .collect();
        json!({ "arrayValue": { "values": [
            { "stringValue": message },
            { "stringValue": Value::Object(object).to_string() },
        ] } })
    };
    json!({
        "severityNumber": severity,
        "severityText": text,
        "timeUnixNano": nanos,
        "observedTimeUnixNano": nanos,
        "attributes": attributes,
        "body": body,
        "droppedAttributesCount": 0,
    })
}

/// The OTLP/JSON request body for a batch of records.
pub fn logs_body(resource: &Value, records: Vec<Value>) -> Value {
    let name = resource["attributes"]
        .as_array()
        .and_then(|list| {
            list.iter()
                .find(|entry| entry["key"] == "service.name")
                .and_then(|entry| entry["value"]["stringValue"].as_str())
        })
        .unwrap_or("opencode")
        .to_owned();
    json!({ "resourceLogs": [{
        "resource": resource,
        "scopeLogs": [{ "scope": { "name": name }, "logRecords": records }],
    }] })
}

enum Message {
    Record(Value),
    Flush(SyncSender<()>),
}

struct Otlp {
    url: String,
    headers: Vec<(String, String)>,
    resource: Value,
}

impl Otlp {
    /// Starts the exporter thread. It posts a batch every second or at 1000 records. After a failed post it
    /// drops records for 60 s, as Effect's exporter does. The queue is bounded; a full queue drops records.
    fn start(self) -> SyncSender<Message> {
        let (sender, receiver) = std::sync::mpsc::sync_channel(OTLP_QUEUE);
        let _ = std::thread::Builder::new()
            .name("opencode-otlp".into())
            .spawn(move || self.run(receiver));
        sender
    }

    fn run(self, receiver: Receiver<Message>) {
        let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        else {
            return;
        };
        let client = reqwest::Client::new();
        let mut buffer: Vec<Value> = Vec::new();
        let mut disabled_until: Option<Instant> = None;
        let mut next = Instant::now() + OTLP_INTERVAL;
        loop {
            let message = receiver.recv_timeout(next.saturating_duration_since(Instant::now()));
            let flush = match message {
                Ok(Message::Record(record)) => {
                    if disabled_until.is_none_or(|until| Instant::now() >= until) {
                        disabled_until = None;
                        buffer.push(record);
                    }
                    if buffer.len() < OTLP_BATCH {
                        continue;
                    }
                    None
                }
                Ok(Message::Flush(done)) => Some(done),
                Err(RecvTimeoutError::Timeout) => {
                    next = Instant::now() + OTLP_INTERVAL;
                    None
                }
                Err(RecvTimeoutError::Disconnected) => return,
            };
            if !buffer.is_empty() {
                let body = logs_body(&self.resource, std::mem::take(&mut buffer));
                let posted = runtime.block_on(self.post(&client, body));
                if !posted {
                    disabled_until = Some(Instant::now() + OTLP_DISABLE);
                }
            }
            if let Some(done) = flush {
                let _ = done.send(());
            }
        }
    }

    async fn post(&self, client: &reqwest::Client, body: Value) -> bool {
        let mut request = client
            .post(&self.url)
            .header("content-type", "application/json")
            .header(
                "user-agent",
                format!("opencode-rs/{}", crate::help::VERSION),
            )
            .timeout(OTLP_SHUTDOWN)
            .body(body.to_string());
        for (key, value) in &self.headers {
            request = request.header(key.as_str(), value.as_str());
        }
        request
            .send()
            .await
            .is_ok_and(|response| response.status().is_success())
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, SystemTime};

    use log::{Level, LevelFilter};
    use serde_json::json;

    use super::*;

    fn at(millis: u64) -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_millis(millis)
    }

    #[test]
    fn levels_take_the_flag_then_the_environment() {
        let cases = [
            (None, None, LevelFilter::Info),
            (None, Some("debug"), LevelFilter::Debug),
            (None, Some("WARN"), LevelFilter::Warn),
            (None, Some("Error"), LevelFilter::Error),
            (None, Some("trace"), LevelFilter::Info),
            (None, Some("bogus"), LevelFilter::Info),
            (Some(LogLevel::Debug), Some("error"), LevelFilter::Debug),
            (Some(LogLevel::All), None, LevelFilter::Trace),
            (Some(LogLevel::Trace), None, LevelFilter::Trace),
            (Some(LogLevel::Warning), None, LevelFilter::Warn),
            (Some(LogLevel::Fatal), None, LevelFilter::Off),
            (Some(LogLevel::None), Some("debug"), LevelFilter::Off),
        ];
        for (flag, env, expected) in cases {
            assert_eq!(min_level(flag, env), expected, "{flag:?} {env:?}");
        }
    }

    #[test]
    fn file_names_follow_the_channel() {
        assert_eq!(file_name("local"), "opencode-local.log");
        assert_eq!(file_name("latest"), "opencode.log");
        assert_eq!(file_name("oc-x"), "opencode.log");
    }

    #[test]
    fn lines_use_the_typescript_format() {
        let fields = vec![
            ("version".to_owned(), Field::Text("local".into())),
            (
                "args".to_owned(),
                Field::Text(r#"["serve","--port"]"#.into()),
            ),
            ("local".to_owned(), Field::Bool(true)),
            ("durationMs".to_owned(), Field::Int(66)),
            ("empty".to_owned(), Field::Text(String::new())),
            ("role".to_owned(), Field::Text("cli".into())),
        ];
        assert_eq!(
            format_line(
                at(1_793_822_581_271),
                Level::Info,
                "44c56d35",
                "cli starting",
                &fields
            ),
            r#"timestamp=2026-11-04T20:03:01.271Z level=INFO run=44c56d35 message="cli starting" version=local args="[\"serve\",\"--port\"]" local=true durationMs=66 empty="" role=cli"#
        );
        assert_eq!(
            format_line(at(0), Level::Warn, "x", "a=b\nc\\d", &[]),
            r#"timestamp=1970-01-01T00:00:00.000Z level=WARN run=x message="a=b\nc\\d""#
        );
    }

    #[test]
    fn the_logger_writes_records_to_the_channel_file() {
        let dir = tempfile::tempdir().unwrap();
        let logger = Logger::new(Options {
            level: LevelFilter::Info,
            dir: Some(dir.path().join("log")),
            channel: "local".into(),
            print: false,
            endpoint: None,
            headers: None,
            resource: json!({}),
        });
        let record = |level, target, message: &str| {
            logger.log(
                &Record::builder()
                    .level(level)
                    .target(target)
                    .args(format_args!("{message}"))
                    .build(),
            );
        };
        record(Level::Info, "opencode_cli", "kept");
        record(Level::Debug, "opencode_cli", "below the level");
        record(Level::Warn, "hyper", "other crate warning");
        let text = std::fs::read_to_string(dir.path().join("log/opencode-local.log")).unwrap();
        let messages: Vec<&str> = text
            .lines()
            .map(|line| line.split(" message=").nth(1).unwrap())
            .collect();
        assert_eq!(
            messages,
            [r#"kept role=cli"#, r#""other crate warning" role=cli"#]
        );
        assert_eq!(
            logger.path.as_deref(),
            Some(dir.path().join("log/opencode-local.log").as_path())
        );
    }

    #[test]
    fn other_crates_need_info_and_the_client_follows_the_level() {
        let logger = Logger::new(Options {
            level: LevelFilter::Trace,
            dir: None,
            channel: "local".into(),
            print: false,
            endpoint: None,
            headers: None,
            resource: json!({}),
        });
        let enabled = |level, target| {
            logger.enabled(&Metadata::builder().level(level).target(target).build())
        };
        assert!(enabled(Level::Trace, "opencode_service::connect"));
        assert!(!enabled(Level::Debug, "reqwest::connect"));
        assert!(enabled(Level::Info, "reqwest::connect"));
    }

    #[test]
    fn trim_keeps_the_tail_from_a_line_boundary() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("opencode-local.log");
        let lines: String = (0..100).map(|index| format!("line {index:03}\n")).collect();
        std::fs::write(&path, &lines).unwrap();
        // Under the limit: nothing changes.
        trim(&path, lines.len() as u64, 10).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), lines);
        // Over it: the head goes, the cut moves forward to the next line.
        trim(&path, 100, 25).unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "line 098\nline 099\n"
        );
        assert!(!dir.path().join("opencode-local.log.trim").exists());
        // A tail without a newline is dropped whole.
        std::fs::write(&path, "aaaa\nbbbbbbbbbb").unwrap();
        trim(&path, 4, 4).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "");
    }

    #[test]
    fn trim_skips_while_another_process_holds_the_lock() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("opencode.log");
        std::fs::write(&path, "a\nb\nc\n").unwrap();
        let lock = dir.path().join("opencode.log.trim");
        std::fs::create_dir(&lock).unwrap();
        trim(&path, 1, 1).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "a\nb\nc\n");
        // A fresh lock stays; only a stale one is removed.
        assert!(lock.exists());
        let old = SystemTime::now() - Duration::from_secs(6 * 60);
        File::open(&lock).unwrap().set_modified(old).unwrap();
        trim(&path, 1, 1).unwrap();
        assert!(!lock.exists());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "a\nb\nc\n");
        trim(&path, 1, 1).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "");
    }

    #[test]
    fn headers_split_on_the_first_equals_sign() {
        assert_eq!(parse_headers(None), []);
        assert_eq!(
            parse_headers(Some("authorization=Basic a==,x-team=core,flag")),
            [
                ("authorization".to_owned(), "Basic a==".to_owned()),
                ("x-team".to_owned(), "core".to_owned()),
                ("flag".to_owned(), String::new()),
            ]
        );
    }

    #[test]
    fn the_resource_names_the_client_channel_and_run() {
        let attributes = |vars: &[(&str, &str)]| {
            let vars: Vec<(String, String)> = vars
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect();
            let resource = resource("opencode-rs", "1.2.3", "local", "abcd1234", |name| {
                vars.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone())
            });
            resource["attributes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|entry| {
                    format!(
                        "{}={}",
                        entry["key"].as_str().unwrap(),
                        entry["value"]["stringValue"].as_str().unwrap()
                    )
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(
            attributes(&[]),
            [
                "deployment.environment.name=local",
                "opencode.client=opencode-rs",
                "opencode.run=abcd1234",
                "service.instance.id=abcd1234",
                "service.name=opencode",
                "service.version=1.2.3",
            ]
        );
        assert_eq!(
            attributes(&[
                ("OTEL_RESOURCE_ATTRIBUTES", "team=a%20b,service.version=9"),
                ("OTEL_SERVICE_NAME", "custom"),
            ]),
            [
                "team=a%20b",
                "deployment.environment.name=local",
                "opencode.client=opencode-rs",
                "opencode.run=abcd1234",
                "service.instance.id=abcd1234",
                "service.name=custom",
                "service.version=9",
            ]
        );
    }

    #[test]
    fn otlp_records_match_effects_shape() {
        let record = log_record(
            at(1_500),
            Level::Warn,
            "plain",
            &[("role".into(), Field::Text("cli".into()))],
        );
        assert_eq!(
            record,
            json!({
                "severityNumber": 13,
                "severityText": "Warn",
                "timeUnixNano": "1500000000",
                "observedTimeUnixNano": "1500000000",
                "attributes": [{ "key": "role", "value": { "stringValue": "cli" } }],
                "body": { "stringValue": "plain" },
                "droppedAttributesCount": 0,
            })
        );
        let record = log_record(
            at(0),
            Level::Info,
            "cli starting",
            &[
                ("local".into(), Field::Bool(true)),
                ("role".into(), Field::Text("cli".into())),
            ],
        );
        assert_eq!(
            record["body"],
            json!({ "arrayValue": { "values": [
                { "stringValue": "cli starting" },
                { "stringValue": r#"{"local":true}"# },
            ] } })
        );
        let body = logs_body(&resource("c", "v", "local", "r", |_| None), vec![record]);
        assert_eq!(
            body["resourceLogs"][0]["scopeLogs"][0]["scope"]["name"],
            "opencode"
        );
    }

    #[test]
    fn the_exporter_posts_batches_and_flushes_on_request() {
        use std::io::{BufRead, BufReader};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (socket, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            let mut head = Vec::new();
            let mut length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                let lower = line.to_ascii_lowercase();
                if let Some(value) = lower.strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
                head.push(line.trim_end().to_owned());
            }
            let mut body = vec![0u8; length];
            reader.read_exact(&mut body).unwrap();
            let mut socket = socket;
            socket
                .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
                .unwrap();
            (head, String::from_utf8(body).unwrap())
        });
        let logger = Logger::new(Options {
            level: LevelFilter::Info,
            dir: None,
            channel: "local".into(),
            print: false,
            endpoint: Some(format!("http://127.0.0.1:{port}")),
            headers: Some("x-team=core".into()),
            resource: resource("opencode-rs", "local", "local", "r", |_| None),
        });
        logger.log(
            &Record::builder()
                .level(Level::Info)
                .target("opencode_cli")
                .args(format_args!("exported"))
                .build(),
        );
        logger.export();
        let (head, body) = server.join().unwrap();
        assert_eq!(head[0], "POST /v1/logs HTTP/1.1");
        assert!(head.contains(&"x-team: core".to_owned()), "{head:?}");
        let body: Value = serde_json::from_str(&body).unwrap();
        let records = &body["resourceLogs"][0]["scopeLogs"][0]["logRecords"];
        assert_eq!(records[0]["body"]["stringValue"], "exported");
    }
}
