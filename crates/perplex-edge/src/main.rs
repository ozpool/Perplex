use std::net::SocketAddr;

use clap::Parser;
use perplex_edge::ws::{serve_ws, Hub, WsConfig};
use perplex_edge::{build_router, build_router_with_dev_token, AppState};
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

    /// Expose `GET /__dev/token/:address` for local E2E (mints a JWT without a wallet
    /// signature). Defaults to on in debug builds, off in release. Override with
    /// `--dev-routes=true|false` or `PERPLEX_DEV_ROUTES=1|0`.
    #[arg(long, env = "PERPLEX_DEV_ROUTES", default_value_t = cfg!(debug_assertions))]
    dev_routes: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Default to a useful info-level filter when RUST_LOG is unset; the previous
    // `from_default_env()` silently fell back to ERROR-only and made the server
    // look hung on first boot. See #94.
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,perplex_edge=info,tower_http=info")),
        )
        .json()
        .init();

    let args = Args::parse();
    let secret = args
        .jwt_secret
        .unwrap_or_else(|| ulid::Ulid::new().to_string())
        .into_bytes();
    let state = AppState::new(secret);
    let hub = Hub::new();
    let app = if args.dev_routes {
        tracing::warn!("dev routes enabled: GET /__dev/token/:address is exposed");
        build_router_with_dev_token(state.clone())
    } else {
        build_router(state.clone())
    };

    let ws_addr: SocketAddr = args.ws_bind.parse()?;
    let _ws_handle = serve_ws(state, hub, WsConfig { bind: ws_addr }).await?;

    let addr: SocketAddr = args.bind.parse()?;
    tracing::info!(%addr, ws = %ws_addr, dev_routes = args.dev_routes, "perplex-edge listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}
