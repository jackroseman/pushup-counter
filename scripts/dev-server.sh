#!/usr/bin/env bash
# (Re)start the Metro dev server for the "Pushup Dev" dev client, reachable over the internet
# through an Expo tunnel (ngrok, *.exp.direct), and print the URLs to open on the phone.
#
#   scripts/dev-server.sh          restart and print the URL
#   scripts/dev-server.sh url      just print the URL of the running server
#   scripts/dev-server.sh stop     stop it
#
# Logs: .expo/dev-server.log. Expo's tunnel gives a https://<id>.on.expo.app (or older
# *.exp.direct) URL; re-run this script and use the printed URL after every restart.
set -euo pipefail
cd "$(dirname "$0")/.."
LOG=.expo/dev-server.log
PIDFILE=.expo/dev-server.pid
SLUG=push-up-counter

stop() {
  if [[ -f $PIDFILE ]]; then
    kill -- -"$(cat "$PIDFILE")" 2>/dev/null || true
    rm -f "$PIDFILE"
  fi
  pkill -f "expo start --dev-client" 2>/dev/null || true
  pkill -f "ngrok" 2>/dev/null || true
  sleep 1
}

url() {
  local host
  host=$(grep -oE '[a-z0-9-]+\.(on\.expo\.app|exp\.direct)' "$LOG" 2>/dev/null | tail -1 || true)
  if [[ -z $host ]]; then
    host=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | grep -oE '[a-z0-9-]+\.exp\.direct' | head -1 || true)
  fi
  if [[ -z $host ]]; then
    echo "Tunnel URL not found yet; see $LOG" >&2
    return 1
  fi
  local https="https://$host"
  local enc
  enc=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$https")
  echo "Tunnel (paste into the dev client's 'Enter URL manually'): $https"
  echo "Deep link (open on the iPhone with Pushup Dev installed):   exp+$SLUG://expo-development-client/?url=$enc"
}

case "${1:-start}" in
  stop) stop; echo stopped ;;
  url) url ;;
  start)
    stop
    mkdir -p .expo
    : > "$LOG"
    APP_VARIANT=development setsid nohup npx expo start --dev-client --tunnel --port 8081 >"$LOG" 2>&1 < /dev/null &
    echo $! > "$PIDFILE"
    for _ in $(seq 1 60); do
      sleep 2
      if url >/dev/null 2>&1 && curl -s -o /dev/null http://127.0.0.1:8081/status; then break; fi
    done
    url
    ;;
esac
