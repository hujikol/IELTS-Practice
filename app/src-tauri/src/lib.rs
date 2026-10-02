use tauri::Manager;

pub mod backup;
pub mod commands;
pub mod lifecycle;
pub mod store;

pub use commands::{commit_import_inner, create_attempt_inner, issue_request_inner, CommandError};
pub use lifecycle::{LifecycleRecord, PATCH_KEYS};
pub use store::{
    Attempt, AttemptLifecycle, AttemptSummary, ImportRef, JobRequest, Store, StoreError, TimerState,
};

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
            commands::issue_request,
            commands::commit_import,
            // P3-01 lifecycle
            lifecycle::start_attempt,
            lifecycle::pause_attempt,
            lifecycle::resume_attempt,
            lifecycle::finish_attempt,
            lifecycle::save_patch,
            lifecycle::delete_attempt,
            // P1-07 / P3-06 export and restore
            backup::export_attempt,
            backup::backup_store,
            backup::restore_archive,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
