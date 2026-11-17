# NFR1 mini-benchmark results

Run 2026-11-16 20:26 UTC · model google/gemma-4-31b-it via OpenRouter · `aba-generate-spa` 2.0 (multi-page sites with stock photos) · checked with `skills/aba/aba-verify/check.sh <folder> site` (headless Chromium).

| # | Category | Prompt | Run | Passes the check? | Pages | Photos | Time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | business | A landing page for a family bakery in Amman with opening hours, a menu of breads and pastries, and a contact form | completed (v1) | ✅ PASS | home, menu, about, location, contact | 5 | 5m 26s |
| 2 | business | A website for a dental clinic with services, prices, the team, and a form to book an appointment | completed (v1) | ✅ PASS | home, services, prices, team, booking, contact | 7 | 5m 22s |
| 3 | business | A page for a car repair garage listing services, customer reviews, and a button to call or send a message | completed (v1) | ✅ PASS | home, services, about, location, contact | 8 | 6m 5s |
| 4 | shop | An online bookshop page with a grid of books, a search box, and a shopping cart that adds up the total | stopped at the 10-minute limit | ❌ FAIL | home, shop, about, contact | 8 | 10m 0s |
| 5 | shop | A shop page for phone accessories with product cards, filters by type, and an add-to-cart button | completed (v1) | ✅ PASS | home, products, about, contact | 8 | 4m 58s |
| 6 | shop | A flower shop page where customers choose a bouquet, pick a delivery date, and see the price | completed (v1) | ✅ PASS | home, shop, order, about, contact | 8 | 8m 14s |
| 7 | personal | A personal portfolio for a graphic designer with a short bio, a gallery of work, and contact links | completed (v1) | ✅ PASS | home, about, gallery, contact | 8 | 7m 28s |
| 8 | personal | A wedding invitation page with the couple names, date and place, a countdown, and an RSVP form | completed (v1) | ✅ PASS | home, about, details, rsvp, contact | 3 | 7m 50s |
| 9 | educational | A 5-question multiple choice quiz about the solar system that shows the score at the end | completed (v1) | ✅ PASS | home, quiz, results, about | 2 | 4m 24s |
| 10 | educational | A vocabulary flashcard app for learning English words with flip cards and next and previous buttons | completed (v1) | ✅ PASS | home, about, contact | 1 | 4m 44s |

**Result: 9 of 10** (target: at least 7 of 10, NFR1 = 70%).

What the check now covers: the four files exist; every body element has a unique data-aba-id; no inline styles or handlers; nothing loads from another site; every link leads somewhere and every page is linked; every button outside a form is used by app.js; images have alt text; CSS has no `#id` rules that match nothing; the content is written in index.html (not built by app.js); and in headless Chromium the site and every `#/page` open with no console errors or missing files, each showing the right page. It does not judge how good the design looks; that is judged by looking at the preview.

Failure details for #4: the build ran past the 10-minute limit and was stopped, so no version was saved. The files it had written were complete except for two `<br>` elements without a data-aba-id.

Notes:

- Builds are slower than the first benchmark (4 to 8 minutes instead of 1 to 4): each site now has 3 to 6 pages and up to 8 photos, and most builds needed one or two fix rounds to pass the stricter check.
- The benchmark script first reported 0 of 10: since projects' folders are named after the project, it was checking a folder that does not exist (`/workspaces/<project id>`). The script is fixed (it uses the project's folder) and the ten sites it had built were checked again with the same check script; the times above are from that run.
