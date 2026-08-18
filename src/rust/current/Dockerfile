FROM rust:1.95-bookworm AS build-stage

WORKDIR /build

COPY src/rust/current/ current/

WORKDIR /build/current

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/current/target \
    cargo build --release && \
    cp target/release/current /usr/local/bin/current

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1010 appuser

COPY --from=build-stage /usr/local/bin/current /usr/local/bin/current

USER appuser
WORKDIR /app

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/current"]
