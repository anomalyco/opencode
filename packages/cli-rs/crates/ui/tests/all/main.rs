//! The UI kit's integration tests, one module per area, linked into one binary so a suite run links the static
//! OpenTUI and tree-sitter set once. Select an area with `cargo test -p opencode-ui --test all <module>::`.

mod content;
mod dialogs;
mod grammars;
mod link;
mod motion_frames;
mod motion_oracle;
mod theme_oracle;
mod tool_info_oracle;
