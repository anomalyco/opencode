// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod workspace_runner;
mod fs_utils;
mod deploy;

use tauri::Manager;
use workspace_runner::WorkspaceRunner;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Agent Foundry Build Studio.", name)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Initialize workspace runner
            app.manage(WorkspaceRunner::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            workspace_runner::open_workspace_dialog,
            workspace_runner::workspace_dev_start,
            workspace_runner::workspace_dev_stop,
            workspace_runner::workspace_run_build,
            workspace_runner::get_dev_server_status,
            workspace_runner::request_dev_permission,
            fs_utils::read_directory,
            fs_utils::read_file_content,
            fs_utils::write_file_content,
            fs_utils::get_file_info,
            fs_utils::create_file,
            fs_utils::delete_file,
            deploy::deploy_build_workspace,
            deploy::bundle_dist,
            deploy::upload_to_oss,
            deploy::get_bundle_size,
            deploy::cleanup_bundle,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
