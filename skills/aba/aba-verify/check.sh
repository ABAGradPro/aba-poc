#!/bin/sh
# ABA page check: static rules + load every page in headless Chromium and report console errors.
# Usage: sh check.sh /workspaces/<folder> [site]
#   "site" (used right after a build) also fails when the site has no pages (data-page).
# Prints PASS, or FAIL followed by one line per problem. Always stops its own server.
DIR="${1:?usage: check.sh /workspaces/<folder> [site]}"
MODE="${2:-}"
# Its own port per run, so two checks at the same time (two projects) do not collide.
PORT=$((20000 + $$ % 20000))
CHROME=/opt/hermes/tools/chromium-1208/chrome-linux64/chrome
TMP=$(mktemp -d)
PROBLEMS=""
add() { PROBLEMS="${PROBLEMS}- $1
"; }

for f in index.html styles.css app.js aba-overrides.css; do
  [ -f "$DIR/$f" ] || add "$f is missing"
done

if [ -f "$DIR/index.html" ]; then
  # Static rules. Problems go to static.txt, the page names (data-page) to pages.txt.
  python3 - "$DIR" "$TMP" "$MODE" <<'EOF'
import os, re, sys
from html.parser import HTMLParser
d, tmp, mode = sys.argv[1], sys.argv[2], sys.argv[3]
def read(name):
    try: return open(os.path.join(d, name), encoding="utf-8").read()
    except OSError: return ""
js, css = read("app.js"), read("styles.css") + read("aba-overrides.css")
remote = ("http://", "https://", "//")
VOID = {"area","base","br","col","embed","hr","img","input","link","meta","source","track","wbr"}
class P(HTMLParser):
    def __init__(s):
        super().__init__()
        s.body = False; s.ids = []; s.out = []; s.css = []; s.pages = []; s.anchors = set()
        s.links = []; s.buttons = []; s.stack = []; s.noalt = []; s.loads_app = False
    def handle_starttag(s, tag, attrs):
        a = dict(attrs)
        if tag == "body": s.body = True; return
        if tag == "link" and a.get("rel") == "stylesheet": s.css.append(a.get("href"))
        if tag == "script" and (a.get("src") or "").split("?")[0] in ("app.js", "./app.js"): s.loads_app = True
        # Nothing may be loaded from another site. Links the visitor clicks (<a href>) are fine.
        if tag != "a":
            for k in ("src", "href", "srcset", "poster"):
                v = (a.get(k) or "").strip()
                if v.startswith(remote): s.out.append(f"index.html: <{tag}> loads from another site: {v[:80]}")
        if not s.body: return
        i = a.get("data-aba-id")
        if not i: s.out.append(f"index.html: <{tag}> has no data-aba-id")
        else: s.ids.append(i)
        if "style" in a: s.out.append(f"index.html: <{tag} data-aba-id=\"{i}\"> has an inline style attribute")
        for k in a:
            if k.startswith("on"): s.out.append(f"index.html: <{tag} data-aba-id=\"{i}\"> has an inline {k} handler")
        if a.get("id"): s.anchors.add(a["id"])
        if a.get("data-page"): s.pages.append(a["data-page"])
        if tag == "img" and "alt" not in a: s.noalt.append(i)
        if tag == "a": s.links.append((i, a.get("href")))
        if tag == "button":
            in_form = "form" in s.stack or "label" in s.stack or "summary" in s.stack
            s.buttons.append((i, a, in_form))
        if tag not in VOID: s.stack.append(tag)
    def handle_endtag(s, tag):
        if tag == "body": s.body = False
        if tag in s.stack:
            while s.stack and s.stack.pop() != tag: pass
p = P(); p.feed(read("index.html"))
for dup in sorted({i for i in p.ids if p.ids.count(i) > 1}): p.out.append(f"index.html: data-aba-id \"{dup}\" is used more than once")
if not p.css or p.css[0] != "styles.css" or p.css[-1] != "aba-overrides.css":
    p.out.append(f"index.html: stylesheets must be styles.css first and aba-overrides.css last (found {p.css})")
for dup in sorted({n for n in p.pages if p.pages.count(n) > 1}): p.out.append(f"index.html: page \"{dup}\" (data-page) exists more than once")
if p.pages and "home" not in p.pages: p.out.append("index.html: there is no home page (data-page=\"home\")")
if mode == "site" and not p.pages:
    p.out.append("index.html has no pages: put each page in <section class=\"page\" data-page=\"name\"> inside <main> (at least data-page=\"home\") and add the pages block to app.js")
# The stricter rules below apply to websites with pages (built with the current skill).
# Older single-page projects keep passing as before, so they can still be published.
if p.pages:
    for i in p.noalt: p.out.append(f"index.html: <img data-aba-id=\"{i}\"> has no alt text")
    # Every link leads somewhere.
    linked = set()
    for i, href in p.links:
        h = (href or "").strip()
        if h in ("", "#") or h.lower().startswith("javascript:"):
            p.out.append(f"index.html: link data-aba-id=\"{i}\" goes nowhere (href=\"{h}\"); point it at a page such as #/contact")
        elif h.startswith("#/"):
            linked.add(h[2:])
            if p.pages and h[2:] not in p.pages: p.out.append(f"index.html: link data-aba-id=\"{i}\" points to page \"{h[2:]}\", which does not exist")
        elif h.startswith("#") and h[1:] not in p.anchors:
            p.out.append(f"index.html: link data-aba-id=\"{i}\" points to #{h[1:]}, but no element has that id")
    for n in p.pages:
        if n != "home" and n not in linked: p.out.append(f"index.html: no link leads to page \"{n}\" (add href=\"#/{n}\" to the menu)")
    # Every button outside a form is used by app.js (found by its data-aba-id, id, class or data-* attribute).
    for i, a, in_form in p.buttons:
        if in_form or a.get("type") in ("submit", "reset"): continue
        keys = [i, a.get("id")] + (a.get("class") or "").split() + [k for k in a if k.startswith("data-") and k != "data-aba-id"]
        if not any(k and k in js for k in keys):
            p.out.append(f"index.html: button data-aba-id=\"{i}\" does nothing; app.js never uses it")
    for m in re.finditer(r"url\(\s*['\"]?\s*((?:https?:)?//[^'\")\s]+)|@import\s+['\"]((?:https?:)?//[^'\"]+)", css):
        p.out.append(f"styles.css loads from another site: {(m.group(1) or m.group(2))[:80]}")
    # CSS that targets an id no element has (a common mistake: data-aba-id is not an id).
    sel_text = re.sub(r"/\*.*?\*/", "", read("styles.css"), flags=re.S)
    sel_text = " ".join(re.findall(r"(?:^|[{}])([^{}]*)\{", sel_text))
    missing_ids = sorted({m for m in re.findall(r"#([A-Za-z_][\w-]*)", sel_text) if m not in p.anchors})
    if missing_ids:
        names = ", ".join("#" + m for m in missing_ids[:8])
        p.out.append(f"styles.css: rules for {names} match nothing, because no element has that id (data-aba-id is not an id). Give the elements a class and style the class")
if p.pages and "hashchange" not in js: p.out.append("app.js: the pages block (showPage with hashchange) is missing")
if p.pages and not p.loads_app: p.out.append("index.html does not load app.js: add <script src=\"app.js\" defer></script> right before </body>")
open(os.path.join(tmp, "static.txt"), "w").write("".join(line + "\n" for line in p.out))
open(os.path.join(tmp, "pages.txt"), "w").write("".join(line + "\n" for line in p.pages[:8]))
EOF
  while IFS= read -r line; do [ -n "$line" ] && add "$line"; done < "$TMP/static.txt"

  # A small web server for the check: the workspace, plus one extra page (/__aba_check.html,
  # never written to the workspace) that opens every page of the site and reports what it sees.
  cat > "$TMP/aba_check_server.py" <<'EOF'
import functools, http.server, json, sys
port, d, pages_file = int(sys.argv[1]), sys.argv[2], sys.argv[3]
pages = [l.strip() for l in open(pages_file, encoding="utf-8") if l.strip()]
CHECK = """<!doctype html><meta charset="utf-8"><title>ABA check</title><body><script>
const pages = %s;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(hash) {
  const f = document.createElement('iframe');
  f.width = 1200; f.height = 800;
  f.src = 'index.html' + hash;
  document.body.appendChild(f);
  await new Promise((r) => { f.onload = r; setTimeout(r, 4000); });
  await wait(300);
  return f;
}
(async () => {
  // Elements that exist after loading but are not in index.html were built by app.js.
  const home = await open('');
  const made = [...home.contentDocument.body.querySelectorAll('*')].filter(
    (e) => !e.hasAttribute('data-aba-id') && !['SCRIPT', 'STYLE', 'BR'].includes(e.tagName));
  if (made.length) {
    const e = made[0];
    console.log('ABA-NOID ' + made.length + ' ' + e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : ''));
  }
  home.remove();
  for (const name of pages) {
    const f = await open('#/' + name);
    const shown = [...f.contentDocument.querySelectorAll('[data-page]')]
      .filter((p) => !p.hidden && f.contentWindow.getComputedStyle(p).display !== 'none')
      .map((p) => p.dataset.page);
    console.log('ABA-ROUTE ' + name + ' ' + (shown.join(',') || 'nothing'));
    f.remove();
  }
  console.log('ABA-DONE');
})();
</script></body>""" % json.dumps(pages)
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] == "/__aba_check.html":
            body = CHECK.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()
http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(H, directory=d)).serve_forever()
EOF
  timeout 40 python3 "$TMP/aba_check_server.py" $PORT "$DIR" "$TMP/pages.txt" > "$TMP/http.log" 2>&1 &
  SERVER=$!
  sleep 1
  # Chromium in this container loads the page and logs console messages but does not exit
  # by itself, so give it 10 seconds and then read what it logged. Fresh profile = no cache.
  load() {
    PROFILE=$(mktemp -d)
    timeout 10 "$CHROME" --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
      --no-first-run --user-data-dir="$PROFILE" --enable-logging=stderr --v=0 \
      "http://127.0.0.1:$PORT/$1" > /dev/null 2> "$TMP/chrome-$2.log"
    rm -rf "$PROFILE"
  }
  # The site itself, and (for a site with pages) the check page that opens every page.
  load "" site &
  PIDS=$!
  if [ -s "$TMP/pages.txt" ]; then
    load "__aba_check.html" pages &
    PIDS="$PIDS $!"
  fi
  wait $PIDS 2>/dev/null
  kill $SERVER 2>/dev/null

  cat "$TMP"/chrome-*.log | grep -E 'CONSOLE|Uncaught' | grep -v -i 'favicon' | grep -v 'ABA-' | \
    sed -E 's/^\[[^]]*\] *//' | sed -E 's/__aba_check\.html/the site/' | sort -u | \
    while IFS= read -r line; do echo "console: $line"; done > "$TMP/console.txt"
  while IFS= read -r line; do add "$line"; done < "$TMP/console.txt"
  grep -E '" 404 ' "$TMP/http.log" | grep -v favicon | sed -E 's/.*"GET ([^ ]+).*/missing file requested by the page: \1/' | sort -u > "$TMP/404.txt"
  while IFS= read -r line; do add "$line"; done < "$TMP/404.txt"

  if [ -s "$TMP/pages.txt" ]; then
    LOG="$TMP/chrome-pages.log"
    if grep -q 'ABA-DONE' "$LOG"; then
      grep -o 'ABA-ROUTE [^"]*' "$LOG" | sort -u > "$TMP/routes.txt"
      while read -r _ name shown; do
        [ "$shown" = "$name" ] || add "opening #/$name shows \"$shown\" instead of the \"$name\" page. Check that index.html loads app.js (<script src=\"app.js\" defer></script> before </body>) and that the pages block in app.js is unchanged"
      done < "$TMP/routes.txt"
      NOID=$(grep -o 'ABA-NOID [^"]*' "$LOG" | head -n 1)
      if [ -n "$NOID" ]; then
        set -- $NOID
        add "app.js creates $2 elements when the site loads (for example <$3>) that are not written in index.html, so the user cannot click and edit them. Write that content as HTML in index.html, each element with a data-aba-id, and let app.js only show, hide or filter it"
      fi
    else
      add "the pages could not be opened to check them (the site did not finish loading within 10 seconds)"
    fi
  fi
fi

rm -rf "$TMP"
if [ -z "$PROBLEMS" ]; then echo "PASS"; else printf 'FAIL\n%s' "$PROBLEMS"; fi
