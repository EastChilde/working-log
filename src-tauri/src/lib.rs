use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_sql::{Migration, MigrationKind};

/// 切换窗口显示/隐藏
/// 注意：is_visible() 对最小化窗口也返回 true，必须结合 is_minimized() 判断，
/// 否则最小化后点「显示」会走 hide 分支（表现为点了没反应）；
/// 且 Windows 上 show() 不会还原最小化窗口，必须先 unminimize()。
fn toggle_window(app: &tauri::AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let visible = w.is_visible().unwrap_or(false);
        let minimized = w.is_minimized().unwrap_or(false);
        if visible && !minimized {
            let _ = w.hide();
        } else {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "init schema",
        sql: "
            CREATE TABLE IF NOT EXISTS task (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                parent_id TEXT,
                status TEXT NOT NULL DEFAULT 'todo',
                priority TEXT,
                tag TEXT,
                deadline TEXT,
                created_at TEXT NOT NULL,
                completed_at TEXT,
                sort INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_task_created ON task(created_at);
            CREATE INDEX IF NOT EXISTS idx_task_parent ON task(parent_id);
            CREATE TABLE IF NOT EXISTS recycle (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                deleted_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS setting (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        ",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 2,
        description: "tags: tag_def 表 + task.tags JSON 列",
        sql: "
            CREATE TABLE IF NOT EXISTS tag_def (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL DEFAULT 'blue',
                sort INTEGER NOT NULL DEFAULT 0
            );
            ALTER TABLE task ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
        ",
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 已有实例运行时：唤起已有主窗口
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:workinglog.db", migrations)
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        use tauri_plugin_global_shortcut::{Code, Modifiers};
                        if shortcut.mods == Modifiers::ALT && shortcut.key == Code::KeyS {
                            toggle_window(app, "sticky");
                        } else if shortcut.mods == Modifiers::ALT && shortcut.key == Code::KeyW {
                            toggle_window(app, "main");
                        }
                    }
                })
                .build(),
        )
        .on_window_event(|window, event| {
            // 点 X 关闭主窗口时不销毁窗口、只隐藏：
            // 默认关闭会 destroy 窗口对象，托盘 toggle 拿不到句柄，
            // 导致「显示/隐藏主界面」永远无法再次唤起窗口。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            // ---- 托盘 ----
            let mi_main = MenuItem::with_id(app, "main", "显示/隐藏主界面", true, None::<&str>)?;
            let mi_sticky = MenuItem::with_id(app, "sticky", "显示/隐藏便签", true, None::<&str>)?;
            let mi_quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&mi_main, &mi_sticky, &mi_quit])?;

            // 菜单事件统一注册在 App 级别（托盘 Builder 上的 on_menu_event
            // 在 Windows 上存在事件不派发的已知问题）
            app.on_menu_event(|app, event| match event.id().as_ref() {
                "main" => toggle_window(app, "main"),
                "sticky" => toggle_window(app, "sticky"),
                "quit" => app.exit(0),
                _ => {}
            });

            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("工作清单助手\n左键：显示/隐藏主界面\n右键：菜单")
                .menu(&menu)
                // 左键单击直接切换主界面（不弹菜单），右键弹菜单
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle(), "main");
                    }
                })
                .build(app)?;

            // ---- 全局快捷键：Alt+S 便签，Alt+W 主界面 ----
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            app.global_shortcut().register("Alt+S")?;
            app.global_shortcut().register("Alt+W")?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
