//! Emits `docs/openapi.json` + `docs/postman.json` from the live utoipa derive. Run via
//! `cargo run -p perplex-edge --bin perplex-edge-export-openapi -- <repo-root>`.

use std::env;
use std::fs;
use std::path::PathBuf;

use perplex_edge::openapi;
use utoipa::OpenApi;

fn main() -> anyhow::Result<()> {
    let target_dir = env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("docs"));
    fs::create_dir_all(&target_dir)?;

    let doc = openapi::ApiDoc::openapi();
    let openapi_path = target_dir.join("openapi.json");
    let postman_path = target_dir.join("postman.json");
    fs::write(&openapi_path, serde_json::to_string_pretty(&doc)?)?;
    let postman = openapi::openapi_to_postman(&doc);
    fs::write(&postman_path, serde_json::to_string_pretty(&postman)?)?;
    println!(
        "wrote {} ({} paths)",
        openapi_path.display(),
        doc.paths.paths.len()
    );
    println!("wrote {}", postman_path.display());
    Ok(())
}
