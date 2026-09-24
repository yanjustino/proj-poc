# Toolchain-only image for building the Senpai app for linux/amd64 from a
# non-Linux host (macOS/Windows) — used by ../build-linux.sh, which
# delegates to Docker when `go env GOHOSTOS` isn't "linux" (Wails' GTK/
# WebKitGTK bindings need to be built ON Linux; Docker Desktop's Linux VM
# satisfies that for real, this isn't cross-compilation).
#
# Deliberately does NOT COPY the repo in — build-linux.sh bind-mounts it at
# `docker run` time instead, so editing source never needs an image
# rebuild; only touching this Dockerfile (a toolchain/dependency change)
# does.
#
# If `golang:1.26-bookworm` isn't published yet on your Docker Hub mirror
# (go.mod currently requires go 1.26.0), pin a specific patch tag instead,
# e.g. `golang:1.26.0-bookworm`.
FROM golang:1.26-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      pkg-config \
      git \
      ca-certificates \
      curl \
      libgtk-3-dev \
      libwebkit2gtk-4.1-dev \
    && rm -rf /var/lib/apt/lists/*

# bookworm's own apt Node is too old for Vite 7 (needs Node 20.19+/22.12+) —
# NodeSource's own setup script is the simplest reliable way to get a
# current LTS instead of hand-rolling the apt repo pin ourselves.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# GOBIN=/usr/local/bin (not the default $GOPATH/bin) just to keep `wails`
# somewhere unambiguous on PATH regardless of $HOME/$GOPATH at run time.
ENV GOBIN=/usr/local/bin
RUN go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0

WORKDIR /workspace
