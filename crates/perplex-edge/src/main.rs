use std::net::SocketAddr;

use clap::Parser;
use perplex_edge::{build_router, AppState};
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(name = "perplex-edge", about = "Perplex edge API server")]
struct Args {
    /// Address to bind, e.g. 127.0.0.1:8080.
    #[arg(long, env = "PERPLEX_EDGE_BIND", default_value = "127.0.0.1:8080")]
    bind: String,

    /// JWT signing secret. In dev a generated ULID is fine; production MUST inject from a secret store.
    #[arg(long, env = "PERPLEX_JWT_SECRET")]
    jwt_secret: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .json()
        .init();

    let args = Args::parse();
    let secret = args
        .jwt_secret
        .unwrap_or_else(|| ulid::Ulid::new().to_string())
        .into_bytes();
    let state = AppState::new(secret);
    let app = build_router(state);

    let addr: SocketAddr = args.bind.parse()?;
    tracing::info!(%addr, "perplex-edge listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
