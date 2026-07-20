#!/usr/bin/env sh

set -eu

GAME_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
GAME_PORT=${PORT:-4173}
GAME_URL="http://127.0.0.1:${GAME_PORT}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to run CLEARWATER offline."
  echo "Install the current Node.js LTS release, then try again."
  exit 1
fi

cd "$GAME_DIR"
PORT="$GAME_PORT" node server.mjs &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 1
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  wait "$SERVER_PID"
  exit 1
fi

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$GAME_URL" >/dev/null 2>&1 || true
else
  echo "Open $GAME_URL in your browser."
fi

echo "OPERATION CLEARWATER is running at $GAME_URL"
echo "Press Ctrl+C to stop the local server."
wait "$SERVER_PID"
