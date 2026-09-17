#!/bin/zsh

set -e

cd "$(dirname "$0")"

PORT="${PORT:-8000}"
LOCAL_HOST_NAME="$(scutil --get LocalHostName 2>/dev/null || hostname -s)"
MAC_URL="http://localhost:${PORT}/"
PHONE_URL="http://${LOCAL_HOST_NAME}.local:${PORT}/"

echo ""
echo "Pokémon Shiny Tool"
echo "Mac:    ${MAC_URL}"
echo "iPhone: ${PHONE_URL}"
echo ""
echo "Keep this window open while using the tool."
echo "Press Control-C here to stop the server."
echo ""

EXISTING_PAGE="$(curl --fail --silent --show-error --max-time 1 "${MAC_URL}" 2>/dev/null || true)"

if [[ "${EXISTING_PAGE}" == *"<title>Pokémon Toolset</title>"* ]]; then
  echo "The tracker is already running. Opening it now."
  open "${MAC_URL}"
  exit 0
fi

if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port ${PORT} is already being used by another app."
  echo "Close that app or start this tracker with another port, for example:"
  echo "PORT=8001 ./run-local-server.command"
  exit 1
fi

open "${MAC_URL}"
exec python3 -m http.server "${PORT}" --bind 0.0.0.0
