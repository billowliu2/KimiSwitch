# Build Kimi Switch Linux packages (deb / AppImage / rpm) inside a clean
# Ubuntu 22.04 container. Used both locally (`docker compose run`) and as a
# reference for GH Actions' ubuntu-latest job.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV CARGO_TERM_COLOR=always
ENV RUSTUP_HOME=/usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo
ENV PATH=/usr/local/cargo/bin:$PATH

RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    build-essential \
    pkg-config \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libwebkit2gtk-4.1-dev \
    libsoup-3.0-dev \
    libjavascriptcoregtk-4.1-dev \
    patchelf \
    file \
    nodejs \
    npm \
    python3 \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal

RUN cargo install tauri-cli --version "^2.0" --locked

WORKDIR /workspace

CMD ["/bin/bash"]
