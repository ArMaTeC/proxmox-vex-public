# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        Dockerfile
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Dockerfile source
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
ARG TARGETARCH
ARG TARGETPLATFORM
FROM python:3.12-alpine AS builder

WORKDIR /app

# Build dependencies for compiled Python wheels. postgresql-dev is required
# for psycopg2; tcl/tcl-dev and sqlcipher are no longer needed because this
# image connects to PostgreSQL instead of SQLite/SQLCipher.
# hadolint ignore=DL3018
RUN apk add --no-cache \
    gcc g++ musl-dev libffi-dev openssl-dev linux-headers \
    make git cmake \
    openblas-dev lapack-dev gfortran \
    postgresql-dev

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.12-alpine

LABEL org.label-schema.name="ProxmoxVEx"
LABEL org.label-schema.description="Modern Multi-Cluster Management for Proxmox VE"
LABEL org.label-schema.vendor="ProxmoxVEx"
LABEL org.label-schema.url="https://proxmoxvex.certrunnerx.com"
LABEL org.label-schema.vcs-url="https://proxmoxvex.local"
LABEL maintainer="armatec0@gmail.com"

# hadolint ignore=DL3018
RUN apk add --no-cache \
    libffi \
    libpq \
    openssh-client \
    sshpass \
    sudo \
    p7zip \
    cdrkit

COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

RUN addgroup -S ProxmoxVEx && adduser -S -G ProxmoxVEx -h /app -s /bin/false ProxmoxVEx

# Allow the web process user to sudo to the configured scan_user without a
# password. The scan_password field in the UI is still accepted but is not
# required when the image is configured for NOPASSWD sudo.
RUN printf '%s\n%s\n' 'Defaults:ProxmoxVEx !targetpw' 'ProxmoxVEx ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/ProxmoxVEx \
    && chmod 0440 /etc/sudoers.d/ProxmoxVEx

WORKDIR /app

COPY --chown=ProxmoxVEx:ProxmoxVEx ProxmoxVEx_multi_cluster.py .
COPY --chown=ProxmoxVEx:ProxmoxVEx ProxmoxVEx/ ProxmoxVEx/
COPY --chown=ProxmoxVEx:ProxmoxVEx qemu_iso/ qemu_iso/
COPY --chown=ProxmoxVEx:ProxmoxVEx web/ web/
COPY --chown=ProxmoxVEx:ProxmoxVEx static/ static/
COPY --chown=ProxmoxVEx:ProxmoxVEx images/ images/
COPY --chown=ProxmoxVEx:ProxmoxVEx plugins/ plugins/
COPY --chown=ProxmoxVEx:ProxmoxVEx version.json .
COPY --chown=ProxmoxVEx:ProxmoxVEx update.sh .

# Rebuild the reduced VirtIO/QEMU Guest Agent ISOs only when the upstream
# source ISOs are present in the build context. Otherwise the prebuilt
# qemu_iso/virtio-win-{legacy,modern}.iso.gz files (or split .part files)
# are used as-is.
# hadolint ignore=SC2086
RUN if [ -f /app/qemu_iso/virtio-win-0.1.109.iso.gz ] && [ -f /app/qemu_iso/virtio-win-0.1.285.iso.gz ]; then \
    python3 /app/qemu_iso/build_iso.py --variant legacy \
    --output-dir /app/qemu_iso \
    --cache-dir /app/qemu_iso/.cache \
    && python3 /app/qemu_iso/build_iso.py --variant modern \
    --output-dir /app/qemu_iso \
    --cache-dir /app/qemu_iso/.cache; \
    else \
    echo "Using prebuilt reduced ISOs"; \
    # Reassemble split .part files if the full .iso.gz is missing
    for base in /app/qemu_iso/virtio-win-*.iso.gz; do \
    if [ ! -f "$base" ] && ls "${base}".*.part >/dev/null 2>&1; then \
    echo "Reassembling $(basename "$base") from parts..."; \
    cat "${base}".*.part > "$base"; \
    rm -f "${base}".*.part; \
    fi; \
    done; \
    fi \
    && chown -R ProxmoxVEx:ProxmoxVEx /app/qemu_iso

RUN mkdir -p /app/config /app/logs /app/backups \
    && chown -R ProxmoxVEx:ProxmoxVEx /app

VOLUME ["/app/config", "/app/logs"]

USER ProxmoxVEx

EXPOSE 5000 5001 5002

# Default the image to the PostgreSQL service defined in docker-compose.yml.
# This keeps the container from falling back to SQLite when run without a .env.
ENV PROXMOXVEX_DATABASE_URL=postgresql://proxmoxvex:proxmoxvex@proxmoxvex-postgres:5432/proxmoxvex

# The image is built for reverse-proxy use (Cloudflare), so default the test
# health check to HTTP and the correct env var name. The .env can still
# override this at runtime via docker-compose env_file.
ENV PROXMOXVEX_BEHIND_PROXY=true
ENV PROXMOXVEX_HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=5 \
    CMD python3 -c "import os, urllib.request, ssl; \
    behind = os.environ.get('PROXMOXVEX_BEHIND_PROXY','').lower() in ('1','true','yes'); \
    unsafe = os.environ.get('PROXMOXVEX_HEALTHCHECK_UNSAFE','').lower() in ('1','true','yes'); \
    cafile = os.environ.get('PROXMOXVEX_SSL_CERT_FILE','/app/config/ssl/cert.pem'); \
    ctx = None if behind else (ssl._create_unverified_context() if unsafe else ssl.create_default_context(cafile=cafile)); \
    urllib.request.urlopen(('http' if behind else 'https')+'://127.0.0.1:5000/api/health', context=ctx, timeout=4)" 2>/dev/null \
    || exit 1

ENTRYPOINT ["python3", "ProxmoxVEx_multi_cluster.py"]
