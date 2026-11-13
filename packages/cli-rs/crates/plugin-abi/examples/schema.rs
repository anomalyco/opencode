//! Prints the JSON Schema of plugin contract 2.0; `script/gen/plugin-schema.ts` writes it to `schema/v2.json`.

#[cfg(feature = "schema")]
fn main() {
    println!("{}", serde_json::to_string_pretty(&opencode_plugin_abi::v2::schema()).unwrap());
}

#[cfg(not(feature = "schema"))]
fn main() {
    eprintln!("build with --features schema");
    std::process::exit(1);
}
