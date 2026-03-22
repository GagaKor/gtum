#[derive(serde::Serialize)]
struct RuntimeInfo {
  app_name: String,
  platform: String,
  mode: String,
}

#[tauri::command]
fn get_runtime_info(app: tauri::AppHandle) -> RuntimeInfo {
  RuntimeInfo {
    app_name: app.package_info().name.clone(),
    platform: std::env::consts::OS.to_string(),
    mode: if cfg!(debug_assertions) {
      "debug".into()
    } else {
      "release".into()
    },
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![get_runtime_info])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
