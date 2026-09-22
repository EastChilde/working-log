fn main() {
    // 图标变更时自动重嵌入资源（tauri-build 默认不监听 icons 目录）
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
