#!/usr/bin/env bash
# Start the A·BASAR QR Studio dev server.
#
#   ./scripts/serve.sh
#
# Ctrl-C stops it.
#
# The app itself has no build step — index.html runs from plain script tags and
# everything it needs is vendored. This server exists for the two things
# file:// cannot do: reach the page from a phone, and reload reliably.
#
# Port 9060 is fixed and cannot be overridden. The address gets bookmarked and
# left open on a phone; a "just this once" different port is tomorrow's dead
# bookmark.
#
# Bound to 0.0.0.0, not localhost, so a phone on the same Wi-Fi can open the
# UI. That is the only honest way to test a QR code: a real camera reading a
# real screen. Anyone on this network can reach it while it runs.
#
# The inline handler is not decoration. python3 -m http.server sends
# Last-Modified and answers If-Modified-Since with 304, so after editing
# core.js the browser happily re-runs the OLD file and the change appears to
# have done nothing. Stripping the conditional headers and sending no-store is
# what stops that silent failure.
set -u
cd "$(dirname "$0")/.." || exit 1

port=9060

if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $port is already in use:"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN | tail -n +2
  echo
  echo "If that's QR Studio, it's already running — open http://localhost:$port"
  echo "If not, free the port:  kill \$(lsof -nP -ti TCP:$port -sTCP:LISTEN)"
  exit 1
fi

command -v python3 >/dev/null || { echo "python3 not found in PATH"; exit 1; }

echo "A·BASAR QR Studio → http://localhost:$port"
for iface in en0 en1 en5 en6; do
  ip=$(ipconfig getifaddr "$iface" 2>/dev/null) || continue
  [ -n "$ip" ] && echo "  phone / LAN ($iface) → http://$ip:$port"
done
echo "  visual board          → http://localhost:$port/test/preview.html"
echo

exec python3 -c '
import sys, http.server

class Handler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        # Drop conditional-request headers: a 304 here would serve the file the
        # browser already has, i.e. the version from before the last edit.
        for header in ("If-Modified-Since", "If-None-Match"):
            if header in self.headers:
                del self.headers[header]
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

host, port = sys.argv[1], int(sys.argv[2])
with http.server.ThreadingHTTPServer((host, port), Handler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
' 0.0.0.0 "$port"
