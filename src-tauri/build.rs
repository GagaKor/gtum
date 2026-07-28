use std::env;
use std::path::Path;

/// Opt-in env var that turns on the Common-Controls v6 manifest for this build.
const TEST_MANIFEST_ENV: &str = "GTUM_WINDOWS_TEST_MANIFEST";

/// Embeds a Common-Controls v6 activation context so Windows test binaries can load.
///
/// `tauri-plugin-dialog` depends on `rfd`, which imports `TaskDialogIndirect` from
/// comctl32.dll. That export exists only in the side-by-side v6 assembly, so a
/// binary whose manifest does not declare the dependency resolves comctl32 to the
/// v5.82 copy in System32, fails to bind the import, and dies at load with
/// 0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND before a single test runs.
///
/// tauri-build embeds an equivalent manifest into the application binary through a
/// Windows resource, which is why `tauri build` produces a working app while
/// `cargo test` does not — cargo's test harnesses get no such resource.
///
/// The flags below are emitted as plain `rustc-link-arg` because that is the only
/// variant that reaches the lib target compiled in test mode; `rustc-link-arg-tests`
/// applies solely to `tests/` integration binaries, and the failing binary is the
/// lib's own unit-test harness. Since that also covers the application binary, where
/// it would collide with tauri-build's resource-embedded manifest, it is gated behind
/// an explicit env var that only the test step sets.
fn embed_windows_test_manifest() {
    println!("cargo:rerun-if-env-changed={TEST_MANIFEST_ENV}");
    if env::var_os(TEST_MANIFEST_ENV).is_none() {
        return;
    }

    // Build scripts run on the host, so branch on the *target*. These are MSVC
    // linker flags and are meaningless to any other linker.
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows")
        || env::var("CARGO_CFG_TARGET_ENV").as_deref() != Ok("msvc")
    {
        return;
    }

    let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") else {
        return;
    };
    let manifest = Path::new(&manifest_dir).join("windows-test-manifest.xml");

    println!("cargo:rerun-if-changed=windows-test-manifest.xml");
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
}

fn main() {
    embed_windows_test_manifest();
    tauri_build::build()
}
