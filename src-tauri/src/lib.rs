// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod migrations;
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePool},
    Pool, Row, Sqlite,
};
use std::{
    collections::{hash_map::DefaultHasher, HashMap},
    env, fs,
    hash::{Hash, Hasher},
    process::Command as StdCommand,
    sync::Mutex as StdMutex,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    path::BaseDirectory,
    Manager, State,
};
use tauri_plugin_opener::OpenerExt;
use log::{info, error};

struct ImageCache(StdMutex<HashMap<String, String>>);

#[derive(Debug, serde::Serialize)]
struct DownloadState {
    id: i32,
    download_id: String,
    download_status: String,
    process_id: Option<i32>,
    status: String,
}

#[tauri::command]
fn get_current_app_path() -> Result<String, String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(exe_path
        .parent()
        .ok_or("Failed to get parent directory")?
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
fn is_flatpak() -> bool {
    std::env::var("FLATPAK").is_ok()
}

#[tauri::command]
fn get_appimage_path() -> Option<String> {
    std::env::var("APPDIR").ok()
}

#[tauri::command]
async fn kill_all_process(pid: i32) -> Result<(), String> {
    #[cfg(unix)]
    {
        println!("Sending INT signal to process with PID: {}", pid);
        let mut kill = StdCommand::new("kill")
            .args(["-s", "SIGINT", &pid.to_string()])
            .spawn()
            .map_err(|e| e.to_string())?;
        kill.wait().map_err(|e| e.to_string())?;
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        println!("Sending taskkill to process with PID: {}", pid);
        let mut kill = StdCommand::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"]) // /T flag kills the process tree
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
        kill.wait().map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
async fn fetch_image(
    app_handle: tauri::AppHandle,
    cache: State<'_, ImageCache>,
    url: String,
) -> Result<String, String> {
    // Check if image is already cached (acquire and release lock quickly)
    let cached_path = {
        let cache_map = cache.0.lock().unwrap();
        cache_map.get(&url).cloned()
    };

    if let Some(local_path) = cached_path {
        return Ok(local_path);
    }

    // Download image (no lock held during network operations)
    let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;

    // Generate path for caching
    let app_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|_| "Failed to get cache dir".to_string())?
        .join("thumbnails");

    fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;

    // Create filename from URL hash
    let mut hasher = DefaultHasher::new();
    url.hash(&mut hasher);
    let hash = hasher.finish();

    let file_name = format!("thumb_{}.jpg", hash);
    let file_path = app_dir.join(&file_name);

    fs::write(&file_path, &bytes).map_err(|e| e.to_string())?;

    // Instead of file://, use a data URI
    let image_data = STANDARD.encode(&bytes);
    let local_path = format!("data:image/jpeg;base64,{}", image_data);

    // Cache the URL to path mapping (acquire lock again briefly)
    {
        let mut cache_map = cache.0.lock().unwrap();
        cache_map.insert(url, local_path.clone());
    }

    Ok(local_path)
}

#[tauri::command]
async fn open_file_with_app(
    app_handle: tauri::AppHandle,
    file_path: String,
    app_name: Option<String>,
) -> Result<(), String> {
    if let Some(name) = &app_name {
        if name == "explorer" {
            info!("Revealing file: {} in explorer", file_path);
            return app_handle
                .opener()
                .reveal_item_in_dir(file_path)
                .map_err(|e| {
                    error!("Failed to reveal file in explorer: {}", e);
                    e.to_string()
                });
        }
        info!("Opening file: {} with app: {}", file_path, name);
    } else {
        info!("Opening file: {} with default app", file_path);
    }

    app_handle
        .opener()
        .open_path(file_path, app_name)
        .map_err(|e| {
            error!("Failed to open file: {}", e);
            e.to_string()
        })
}

#[tauri::command]
async fn open_link_with_app(
    app_handle: tauri::AppHandle,
    url: String,
    app_name: Option<String>,
) -> Result<(), String> {
    if let Some(name) = &app_name {
        info!("Opening link: {} with app: {}", url, name);
    } else {
        info!("Opening link: {} with default app", url);
    }

    app_handle
        .opener()
        .open_url(url, app_name)
        .map_err(|e| {
            error!("Failed to open link: {}", e);
            e.to_string()
        })
}

#[tauri::command]
async fn list_ongoing_downloads(
    state_mutex: State<'_, StdMutex<Pool<Sqlite>>>,
) -> Result<Vec<DownloadState>, String> {
    let pool_clone = {
        let pool = state_mutex.lock().map_err(|e| e.to_string())?;
        pool.clone()
    };

    let qry = "SELECT * FROM downloads WHERE download_status = 'downloading' OR download_status = 'starting' OR download_status = 'queued'";

    match sqlx::query(qry).fetch_all(&pool_clone).await {
        Ok(rows) => {
            let mut downloads = Vec::new();
            for row in rows {
                downloads.push(DownloadState {
                    id: row.get("id"),
                    download_id: row.get("download_id"),
                    download_status: row.get("download_status"),
                    process_id: row.get("process_id"),
                    status: row.get("status"),
                });
            }
            Ok(downloads)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn pause_ongoing_downloads(
    state_mutex: State<'_, StdMutex<Pool<Sqlite>>>,
) -> Result<(), String> {
    // Get database connection
    let pool_clone = {
        let pool = state_mutex.lock().map_err(|e| e.to_string())?;
        pool.clone()
    };

    // Fetch all ongoing downloads
    let qry = "SELECT * FROM downloads WHERE download_status = 'downloading' OR download_status = 'starting' OR download_status = 'queued'";

    let downloads = match sqlx::query(qry).fetch_all(&pool_clone).await {
        Ok(rows) => {
            let mut downloads = Vec::new();
            for row in rows {
                downloads.push(DownloadState {
                    id: row.get("id"),
                    download_id: row.get("download_id"),
                    download_status: row.get("download_status"),
                    process_id: row.get("process_id"),
                    status: row.get("status"),
                });
            }
            downloads
        }
        Err(e) => return Err(e.to_string()),
    };

    println!("Found {} ongoing downloads to pause", downloads.len());

    // Process each download
    for download in downloads {
        println!(
            "Pausing download: {} ({}), Status: {}",
            download.download_id, download.id, download.download_status
        );

        // Kill the process if it exists
        if let Some(pid) = download.process_id {
            println!("Terminating process with PID: {}", pid);
            if let Err(e) = kill_all_process(pid).await {
                println!("Failed to kill process {}: {}", pid, e);
            } else {
                println!("Successfully terminated process {}", pid);
            }
        }

        // Update the download status in the database
        let update_qry = "UPDATE downloads SET download_status = 'paused' WHERE id = ?";
        if let Err(e) = sqlx::query(update_qry)
            .bind(download.id)
            .execute(&pool_clone)
            .await
        {
            println!(
                "Failed to update download status for ID {}: {}",
                download.id, e
            );
        } else {
            println!("Updated download status to 'paused' for ID {}", download.id);
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub async fn run() {
    let _ = fix_path_env::fix();
    let migrations = migrations::get_migrations();

    let args: Vec<String> = env::args().collect();
    let start_hidden = args.contains(&"--hidden".to_string());

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new()
            .level(log::LevelFilter::Info)
            .max_file_size(5_242_880) /* in bytes = 5MB */
            .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus the main window when attempting to launch another instance
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_sql::Builder::default()
            .add_migrations("sqlite:database.db", migrations)
            .build(),
        )
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .manage(ImageCache(StdMutex::new(HashMap::new())))
        .setup(move |app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = fs::create_dir_all(app_handle.path().app_data_dir().unwrap());
                let db_path = app_handle
                    .path()
                    .app_data_dir()
                    .unwrap()
                    .join("database.db");

                let options = SqliteConnectOptions::new()
                    .filename(db_path)
                    .create_if_missing(true);
                let pool = SqlitePool::connect_with(options).await;
                match pool {
                    Ok(db) => {
                        app_handle.manage(StdMutex::new(db.clone()));
                    }
                    Err(e) => {
                        eprintln!("Database connection error: {}", e);
                    }
                }
            });

            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
                .map_err(|e| format!("Failed to create quit menu item: {}", e))?;
            let show = MenuItem::with_id(app, "show", "Show NeoDLP DQ", true, None::<&str>)
                .map_err(|e| format!("Failed to create show menu item: {}", e))?;
            let menu = Menu::with_items(app, &[&show, &quit])
                .map_err(|e| format!("Failed to create menu: {}", e))?;
            let tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("NeoDLP DQ")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state_mutex = app_handle.state::<StdMutex<Pool<Sqlite>>>();
                            if let Err(e) = pause_ongoing_downloads(state_mutex).await {
                                println!("Error pausing downloads: {}", e);
                            }
                            app_handle.exit(0);
                        });
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)
                .map_err(|e| format!("Failed to create tray: {}", e))?;

            // Fix tray icon in sandboxed environments (e.g., Flatpak)
            // libappindicator uses the full path of the icon in dbus messages,
            // so the path needs to be accessible from both the host and the sandbox.
            // The default /tmp path doesn't work across sandbox boundaries.
            if let Ok(local_data_path) = app
                .path()
                .resolve("tray-icon", BaseDirectory::AppLocalData)
            {
                let _ = fs::create_dir_all(&local_data_path);
                let _ = tray.set_temp_dir_path(Some(local_data_path));
                // Re-set the icon so it gets written to the new temp dir path
                let _ = tray.set_icon(Some(app.default_window_icon().unwrap().clone()));
            }

            app.manage(tray);

            let window = app.get_webview_window("main").unwrap();
            if !start_hidden {
                window.show().unwrap();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            kill_all_process,
            fetch_image,
            open_file_with_app,
            open_link_with_app,
            list_ongoing_downloads,
            pause_ongoing_downloads,
            get_current_app_path,
            is_flatpak,
            get_appimage_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
