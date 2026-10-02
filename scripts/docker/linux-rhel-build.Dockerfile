# Toolchain-only image for building the Senpai app for Red Hat Enterprise
# Linux 8 and 9 (x86_64) — used by ../build-linux.sh when
# SENPAI_LINUX_DISTRO=rhel. Same bind-mount design as linux-build.Dockerfile
# (the repo is never COPYed in).
#
# Why a separate image instead of the Debian one: the Debian build links
# against webkit2gtk-4.1 and glibc 2.36-era symbols (GLIBC_2.34), but RHEL 8
# and 9 only ship webkit2gtk3 — the 4.0 API, libwebkit2gtk-4.0.so.37 — and
# RHEL 8 has glibc 2.28. Building ON Rocky Linux 8 (binary-compatible with
# RHEL 8) links against exactly what RHEL 8 has, and RHEL 9 still provides
# the same webkit2gtk3 soname and a newer glibc, so one binary covers both.
# build-linux.sh's webkit detection finds only webkit2gtk-4.0 here and
# builds without the webkit2_41 tag, as intended. RHEL 10 ships no
# WebKitGTK in its base repositories at all, so it is not covered.
FROM rockylinux:8

RUN dnf -y install dnf-plugins-core \
    && dnf -y module enable nodejs:22 \
    && dnf -y install \
      gcc gcc-c++ make pkgconf-pkg-config git tar xz curl ca-certificates \
      gtk3-devel webkit2gtk3-devel \
      nodejs npm \
    && dnf clean all

ARG GO_VERSION=1.26.8
RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" | tar -C /usr/local -xz
ENV PATH=/usr/local/go/bin:/go/bin:$PATH \
    GOPATH=/go \
    GOBIN=/usr/local/bin
RUN go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0

WORKDIR /workspace
