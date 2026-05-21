use std::net::SocketAddr;

use clap::Parser;
use perplex_edge::ws::{serve_ws, Hub, WsConfig};
use perplex_edge::{build_router, AppState};
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(name = "perplex-edge", about = "Perplex edge API server")]
struct Args {
    /// Address to bind REST, e.g. 127.0.0.1:8080.
    #[arg(long, env = "PERPLEX_EDGE_BIND", default_value = "127.0.0.1:8080")]
    bind: String,

    /// Address to bind WebSocket, e.g. 127.0.0.1:8081.
    #[arg(long, env = "PERPLEX_EDGE_WS_BIND", default_value = "127.0.0.1:8081")]
    ws_bind: String,

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
    let hub = Hub::new();
    let app = build_router(state.clone());

    let ws_addr: SocketAddr = args.ws_bind.parse()?;
    let _ws_handle = serve_ws(state, hub, WsConfig { bind: ws_addr }).await?;

    let addr: SocketAddr = args.bind.parse()?;
    tracing::info!(%addr, ws = %ws_addr, "perplex-edge listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}
