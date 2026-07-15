pub mod commands;
pub mod config_io;
pub mod db;
pub mod kimi_code_io;
pub mod models;
pub mod pi_io;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::load_agent_config_command,
            commands::save_agent_config_command,
            commands::activate_agent_config_command,
            commands::open_agent_config_dir,
            commands::get_app_version,
            commands::list_provider_models,
            commands::debug_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
