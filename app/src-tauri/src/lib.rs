use tauri::Manager;

pub mod commands;
pub mod store;

pub use commands::{commit_import_inner, create_attempt_inner, issue_request_inner};
pub use store::{Attempt, AttemptSummary, ImportRef, JobRequest, Store, StoreError};

/// Prevents a second launch from racing the first for the same store file (§8.2).
fn single_instance() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_single_instance::init(|_app, _argv, _cwd| {})
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(single_instance())
        .setup(|app| {
            // §8.1 the per-user app data dir is resolved by the OS, never hardcoded.
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir).ok();
            app.manage(commands::AppState {
                store: std::sync::Arc::new(Store::new(dir)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_attempt,
            commands::list_attempts,
            commands::load_attempt,
            commands::delete_attempt,
            commands::issue_request,
            commands::commit_import,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
