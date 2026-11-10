#!/bin/sh
# ABA page check: static rules + load in headless Chromium and report console errors.
# Usage: sh check.sh /workspaces/<projectId>
# Prints PASS, or FAIL followed by one line per problem. Always stops its own server.
DIR="${1:?usage: check.sh /workspaces/<projectId>}"
PORT=8765
CHROME=/opt/hermes/tools/chromium-1208/chrome-linux64/chrome
PROBLEMS=""
add() { PROBLEMS="${PROBLEMS}- $1
"; }

for f in index.html styles.css app.js aba-overrides.css; do
  [ -f "$DIR/$f" ] || add "$f is missing"
done

if [ -f "$DIR/index.html" ]; then
  python3 - "$DIR/index.html" <<'EOF' > /tmp/aba-static.txt
import sys
from html.parser import HTMLParser
class P(HTMLParser):
    def __init__(s):
        super().__init__(); s.body=False; s.ids=[]; s.out=[]; s.css=[]
    def handle_starttag(s, tag, attrs):
        a = dict(attrs)
        if tag == "body": s.body = True; return
        if tag == "link" and a.get("rel") == "stylesheet": s.css.append(a.get("href"))
        for k in ("src", "href"):
            v = a.get(k) or ""
            if v.startswith(("http://", "https://", "//")): s.out.append(f"index.html loads from another site: {v}")
        if s.body:
            i = a.get("data-aba-id")
            if not i: s.out.append(f"index.html: <{tag}> has no data-aba-id")
            else: s.ids.append(i)
            if "style" in a: s.out.append(f"index.html: <{tag} data-aba-id=\"{i}\"> has an inline style attribute")
            for k in a:
                if k.startswith("on"): s.out.append(f"index.html: <{tag} data-aba-id=\"{i}\"> has an inline {k} handler")
    def handle_endtag(s, tag):
        if tag == "body": s.body = False
p = P(); p.feed(open(sys.argv[1], encoding="utf-8").read())
for d in sorted({i for i in p.ids if p.ids.count(i) > 1}): p.out.append(f"index.html: data-aba-id \"{d}\" is used more than once")
if not p.css or p.css[0] != "styles.css" or p.css[-1] != "aba-overrides.css":
    p.out.append(f"index.html: stylesheets must be styles.css first and aba-overrides.css last (found {p.css})")
print("\n".join(p.out))
EOF
  while IFS= read -r line; do [ -n "$line" ] && add "$line"; done < /tmp/aba-static.txt

  pkill -f "[h]ttp.server $PORT" 2>/dev/null
  timeout 30 python3 -m http.server $PORT --bind 127.0.0.1 --directory "$DIR" > /tmp/aba-http.log 2>&1 &
  SERVER=$!
  sleep 1
  # Chromium in this container loads the page and logs console messages but does not exit
  # by itself, so give it 10 seconds and then read what it logged. Fresh profile = no cache.
  PROFILE=$(mktemp -d)
  timeout 10 "$CHROME" --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
    --no-first-run --user-data-dir="$PROFILE" --enable-logging=stderr --v=0 \
    "http://127.0.0.1:$PORT/" > /dev/null 2> /tmp/aba-chrome.log
  rm -rf "$PROFILE"
  kill $SERVER 2>/dev/null; pkill -f "[h]ttp.server $PORT" 2>/dev/null

  grep -E 'CONSOLE|Uncaught' /tmp/aba-chrome.log | grep -v -i 'favicon' | \
    sed -E 's/^\[[^]]*\] *//' | sort -u | while IFS= read -r line; do echo "console: $line"; done > /tmp/aba-console.txt
  while IFS= read -r line; do add "$line"; done < /tmp/aba-console.txt
  grep -E '" 404 ' /tmp/aba-http.log | grep -v favicon | sed -E 's/.*"GET ([^ ]+).*/missing file requested by the page: \1/' | sort -u > /tmp/aba-404.txt
  while IFS= read -r line; do add "$line"; done < /tmp/aba-404.txt
fi

if [ -z "$PROBLEMS" ]; then echo "PASS"; else printf 'FAIL\n%s' "$PROBLEMS"; fi
