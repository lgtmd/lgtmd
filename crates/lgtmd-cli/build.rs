use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn collect(root: &Path, path: &Path, files: &mut Vec<(String, PathBuf)>) {
    for entry in fs::read_dir(path).expect("Read prepared frontend assets") {
        let entry = entry.expect("Read frontend entry");
        let kind = entry.file_type().expect("Inspect frontend entry");
        assert!(!kind.is_symlink(), "Frontend assets cannot be symlinks");
        if kind.is_dir() {
            collect(root, &entry.path(), files);
        } else if kind.is_file() {
            let key = entry
                .path()
                .strip_prefix(root)
                .unwrap()
                .to_str()
                .unwrap()
                .replace('\\', "/");
            assert!(
                !key.split('/').any(|part| part.starts_with('.')),
                "Hidden frontend asset"
            );
            files.push((key, entry.path()));
        } else {
            panic!("Unsupported frontend asset");
        }
    }
}
fn main() {
    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("viewer");
    println!("cargo:rerun-if-changed={}", root.display());
    assert!(
        root.join("index.html").is_file() && root.join("manifest.json").is_file(),
        "Prepare bundled frontend before building lgtmd-cli: just docs-prepare (or the standalone web verifier --prepare)"
    );
    let mut files = Vec::new();
    collect(&root, &root, &mut files);
    files.sort();
    let mut source = String::from(
        "fn embedded_viewer_assets() -> lgtmd::lifecycle::Files { let mut files = lgtmd::lifecycle::Files::new();\n",
    );
    for (name, path) in files {
        source.push_str(&format!(
            "files.insert({name:?}.into(), include_bytes!({path:?}).to_vec());\n"
        ));
    }
    source.push_str("files }\n");
    fs::write(
        PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("viewer_assets.rs"),
        source,
    )
    .unwrap();
}
