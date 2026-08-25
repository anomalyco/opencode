use anyhow::Context;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

/// A built-in capability the agent can invoke.
pub trait Tool {
    fn name(&self) -> &'static str;
    fn description(&self) -> &'static str;
    /// `params` is the JSON object the model produced for this call.
    fn execute(&self, params: &Value) -> anyhow::Result<String>;
}

/// Registry of available tools, keyed by name.
#[derive(Default)]
pub struct Registry {
    tools: BTreeMap<&'static str, Box<dyn Tool>>,
}

impl Registry {
    pub fn new() -> Self {
        let mut registry = Registry::default();
        registry.register(Box::new(ReadTool));
        registry.register(Box::new(WriteTool));
        registry.register(Box::new(BashTool));
        registry
    }

    pub fn register(&mut self, tool: Box<dyn Tool>) {
        self.tools.insert(tool.name(), tool);
    }

    pub fn get(&self, name: &str) -> Option<&dyn Tool> {
        self.tools.get(name).map(|t| t.as_ref())
    }

    pub fn names(&self) -> Vec<&'static str> {
        self.tools.keys().copied().collect()
    }

    pub fn invoke(&self, name: &str, params: &Value) -> anyhow::Result<String> {
        let tool = self
            .get(name)
            .with_context(|| format!("unknown tool {name}"))?;
        tool.execute(params)
    }
}

fn param_str<'a>(params: &'a Value, key: &str) -> anyhow::Result<&'a str> {
    params
        .get(key)
        .and_then(Value::as_str)
        .with_context(|| format!("missing string parameter `{key}`"))
}

struct ReadTool;

impl Tool for ReadTool {
    fn name(&self) -> &'static str {
        "read"
    }

    fn description(&self) -> &'static str {
        "Read a file from disk"
    }

    fn execute(&self, params: &Value) -> anyhow::Result<String> {
        let path = param_str(params, "path")?;
        std::fs::read_to_string(path).with_context(|| format!("reading {path}"))
    }
}

struct WriteTool;

impl Tool for WriteTool {
    fn name(&self) -> &'static str {
        "write"
    }

    fn description(&self) -> &'static str {
        "Write text to a file"
    }

    fn execute(&self, params: &Value) -> anyhow::Result<String> {
        let path = param_str(params, "path")?;
        let content = param_str(params, "content")?;
        if let Some(parent) = Path::new(path).parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::write(path, content)?;
        Ok(format!("wrote {} bytes to {path}", content.len()))
    }
}

struct BashTool;

impl Tool for BashTool {
    fn name(&self) -> &'static str {
        "bash"
    }

    fn description(&self) -> &'static str {
        "Run a shell command and capture combined output"
    }

    fn execute(&self, params: &Value) -> anyhow::Result<String> {
        let command = param_str(params, "command")?;
        #[cfg(windows)]
        let output = std::process::Command::new("pwsh")
            .args(["-NoLogo", "-NoProfile", "-Command", command])
            .output();
        #[cfg(not(windows))]
        let output = std::process::Command::new("sh")
            .args(["-c", command])
            .output();

        let output = output.with_context(|| format!("spawning shell for: {command}"))?;
        let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
        text.push_str(&String::from_utf8_lossy(&output.stderr));
        if !output.status.success() {
            text.push_str(&format!("\n[exit: {}]", output.status.code().unwrap_or(-1)));
        }
        Ok(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn write_then_read_roundtrip() {
        let registry = Registry::new();
        let path = std::env::temp_dir().join("pencode-tool-test.txt");
        let out = registry
            .invoke("write", &json!({"path": path.display().to_string(), "content": "hi"}))
            .unwrap();
        assert!(out.contains("wrote 2 bytes"));

        let out = registry
            .invoke("read", &json!({"path": path.display().to_string()}))
            .unwrap();
        assert_eq!(out, "hi");
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn unknown_tool_errors() {
        let registry = Registry::new();
        assert!(registry.invoke("nope", &json!({})).is_err());
    }
}
