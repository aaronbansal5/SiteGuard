#!/bin/sh
# Hosts such as Fly.io and Render mount persistent volumes owned by root.
# Start as root only long enough to make the data directory writable by the
# unprivileged app user, then drop privileges for the actual server process.
set -eu
APP_USER="${APP_USER:-node}"
DATA_DIR="$(dirname "${SQLITE_PATH:-/data/siteguard.sqlite}")"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown "$APP_USER:$APP_USER" "$DATA_DIR"
  chmod 700 "$DATA_DIR"
  # Keep the environment: runtime secrets arrive as env vars from the host.
  export HOME="/home/$APP_USER"
  exec setpriv --reuid="$APP_USER" --regid="$APP_USER" --init-groups -- "$@"
fi
exec "$@"
