#!/bin/zsh

set -u

GAME_DIR="${0:A:h}"
GAME_PORT="${PORT:-4173}"
GAME_URL="http://127.0.0.1:${GAME_PORT}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to run CLEARWATER offline."
  echo "Install the current Node.js LTS release, then try again."
  read -r "?Press Return to close."
  exit 1
fi

game_is_ready() {
  /usr/bin/curl -fsS "${GAME_URL}/assets/manifest.json" 2>/dev/null |
    /usr/bin/grep -q '"project": "CLEARWATER"'
}

if game_is_ready; then
  /usr/bin/open "${GAME_URL}"
  exit 0
fi

cd "${GAME_DIR}" || exit 1
PORT="${GAME_PORT}" /usr/bin/env node server.mjs &
SERVER_PID=$!

cleanup() {
  kill "${SERVER_PID}" 2>/dev/null
}
trap cleanup INT TERM EXIT

for attempt in {1..80}; do
  if game_is_ready; then
    /usr/bin/open "${GAME_URL}"
    echo "OPERATION CLEARWATER opened in your default browser."
    echo "Keep this window open while playing; close it to stop the game server."
    wait "${SERVER_PID}"
    exit $?
  fi
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    wait "${SERVER_PID}"
    echo "CLEARWATER could not start on ${GAME_URL}."
    read -r "?Press Return to close."
    exit 1
  fi
  sleep 0.1
done

echo "CLEARWATER did not become ready at ${GAME_URL}."
read -r "?Press Return to close."
exit 1
