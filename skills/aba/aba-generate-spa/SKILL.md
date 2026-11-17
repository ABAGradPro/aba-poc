---
name: aba-generate-spa
description: Build a polished multi-page website (one index.html with several pages) for a non-technical ABA user inside their workspace, with working buttons, real images and a contact form; verify it, fix it, and report in plain words.
version: 2.0.0
author: ABA team
metadata:
  hermes:
    tags: [aba, devops, build]
    related_skills: [aba-verify, aba-edit-element]
---

# Generate an ABA website

Inputs: the workspace (`/workspaces/<folder>`), the user's request in plain words, and sometimes a list of the user's own images.

The result must look like the work of a professional web designer, not a beginner's exercise: several pages, real photos, a clear visual style, and every button doing something.

## Rules (from /workspaces/AGENTS.md, plus these)

- Work only inside the given workspace. Never read or write anywhere else.
- Write files with the `write_file` tool. Do not create or edit files through the terminal. Before you overwrite a file that already exists, `read_file` it first.
- Output exactly four files: `index.html`, `styles.css`, `app.js`, `aba-overrides.css`. Images go in the `images/` folder; nothing else is added.
- In `index.html`, link `styles.css` first and `aba-overrides.css` last, and load `app.js` with `<script src="app.js" defer></script>`.
- Every element inside `<body>` gets a unique `data-aba-id` (lowercase words joined by hyphens, e.g. `hero-title`), including containers, list items and `<script>`.
- No inline styles: never use a `style="..."` attribute. All CSS goes in `styles.css`. Leave `aba-overrides.css` empty (a one-line comment is fine).
- Style with classes. `data-aba-id` is not an `id`: a CSS rule `#main-header` does nothing for `<header data-aba-id="main-header">`. Give every element you style a `class` (`<header data-aba-id="main-header" class="site-header">`) and write `.site-header { ... }`. Every class used in `index.html` has rules in `styles.css`.
- No inline event handlers (`onclick="..."`); attach events in `app.js`. In `app.js`, check that an element exists before using it (`if (el) { ... }`).
- Plain HTML, CSS and JavaScript only: no frameworks, no build tools, no package installs.
- Nothing is loaded from another site: no CDNs, no web fonts, no remote images, scripts or styles. Links the visitor clicks (`<a href="https://...">` for a map or social page, `tel:`, `mailto:`) are fine.
- Mobile-first: base styles for small screens, `@media (min-width: ...)` for larger ones. Include the viewport meta tag.
- Accessible: semantic elements (`header`, `main`, `nav`, `section`, `footer`), a `<label>` for every form field, `alt` on every image, enough colour contrast, keyboard-usable controls. If you put `aria-label` on a non-interactive element, also give it a `role`.
- Write in the language of the request (for Arabic, add `lang="ar" dir="rtl"` on `<html>`). Use realistic content that fits the request: real-sounding names, prices, opening hours, reviews. Never "lorem ipsum".

## Pages

The website is one `index.html` that contains several pages. Each page is a section directly inside `<main>`:

    <section data-aba-id="page-about" class="page" data-page="about" hidden> ... </section>

- For a business, a shop or a person: always build `home`, `about` and `contact`, and add the pages the request needs (for example `menu`, `services`, `products`, `gallery`, `booking`).
- For a small tool (a quiz, a calculator, a game, flashcards): one `home` page with the tool is enough; add an `about` page only if it helps. The rules below still apply.
- Add a `location` page only if the user gave an address or a place: the address, opening hours, how to get there, and a link `https://www.google.com/maps/search/?api=1&query=<address>` that opens in a new tab.
- Never draw a fake map or any "placeholder" box. Beside the address, show a real photo or nothing.
- Only `home` has no `hidden` attribute. Home is a real landing page: hero, highlights of the other pages with buttons that lead to them, reviews or facts, and a call to action.
- All the content of every page is written as HTML in `index.html`: every product card, menu item, quiz question and review, each element with its own `data-aba-id`. The user edits the site by clicking on these elements, so `app.js` must not create them (no product arrays rendered with `innerHTML` or `createElement` when the site loads). `app.js` works on what is already there: it shows, hides and filters elements with the `hidden` attribute, reads prices and names from `data-*` attributes, and changes text. Only things that appear after a visitor's action (a row in the cart, a result message) may be created by `app.js`.
- Links to a page are `href="#/about"`. The header has the name or logo (linking to `#/home`), a nav link to every page, and on small screens a menu button that opens and closes the nav. The footer repeats the links and the contact details.
- Add `[hidden] { display: none !important; }` to `styles.css`.
- Put this block at the top of `app.js`, unchanged:

      // --- ABA pages (keep this block) ---
      function showPage() {
        let name = location.hash.startsWith('#/') ? location.hash.slice(2) : 'home';
        if (!document.querySelector('[data-page="' + name + '"]')) name = 'home';
        document.querySelectorAll('[data-page]').forEach((p) => { p.hidden = p.dataset.page !== name; });
        document.querySelectorAll('a[href^="#/"]').forEach((a) => {
          a.classList.toggle('active', a.getAttribute('href') === '#/' + name);
        });
        window.scrollTo(0, 0);
      }
      window.addEventListener('hashchange', showPage);
      showPage();

  Style `a.active` in the nav so the visitor sees which page is open. Close the mobile menu when a nav link is clicked.

## Every button works

A button or link that does nothing is a bug. Before you finish, go through every `<a>` and `<button>`:

- A call-to-action leads somewhere real: a page (`#/menu`, `#/contact`), `tel:`, `mailto:`, or the map link. Never `href="#"` and never an empty `href`.
- A button that is not inside a form has code in `app.js` that finds it (by its `data-aba-id`) and does something the visitor can see: add to a cart and update the total, filter a list, open or close something, switch a tab, go to the next step.
- Carts, filters, searches, quizzes and counters really work, with the result shown on the page.
- Forms check their fields and always tell the visitor what happened.

## Contact and booking forms

Any form that collects a visitor's details (contact, booking, order, RSVP, newsletter) sends them with the block below. Give the fields `name` attributes: use `name`, `email`, `phone` and `message` where they apply, and clear names for anything else (`date`, `guests`). Put an empty `<p role="status">` under the form for the result.

      // --- ABA contact form (keep this block) ---
      function abaForm(form, status) {
        if (!form || !status) return;
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!form.reportValidity()) return;
          const data = Object.fromEntries(new FormData(form).entries());
          status.textContent = 'Sending…';
          try {
            const res = await fetch('__aba/contact', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            });
            if (!res.ok) throw new Error('not saved');
            form.reset();
            status.textContent = 'Thank you! Your message was sent.';
          } catch {
            status.textContent = 'Sorry, this could not be sent right now. Please call or email us instead.';
          }
        });
      }

Call it for each such form, e.g. `abaForm(document.querySelector('[data-aba-id="contact-form"]'), document.querySelector('[data-aba-id="contact-status"]'));`. Translate the three messages to the page's language. Never show a thank-you unless the request succeeded.

## Images

Use real photos, not emojis, for the hero, the about page and for cards (dishes, products, services, team, gallery). Emojis are only for small icons.

1. If the request lists "User images", use those files first, exactly at the paths given, where their description fits best (a logo in the header, a shop photo in the hero or about page).
2. For every other photo, fetch a free stock photo into the workspace, at most 8 per build:

       python3 /opt/data/skills/aba/aba-generate-spa/get_image.py /workspaces/<folder> <name> <one to three search words>

   Example: `... get_image.py /workspaces/cafe-1a2b3c4d hero coffee shop`. It prints `OK images/hero.jpg <width>x<height>` or `FAILED`. Search for the main thing to be seen, in simple English: `bakery`, `fresh bread`, `croissant`, `dentist`, `car mechanic`. Short, common words find better photos than long descriptions.
3. Only use image files that exist: the user's, and the ones that printed `OK`. If a photo `FAILED`, use a CSS gradient or a coloured panel there instead. Never invent a file name and never link to an image on another site.
4. Plan the photos before fetching: one for the hero, one for the about page, the rest for cards. In a group of cards, either every card has a photo or none has: never leave empty boxes or grey placeholders where a photo is missing. If there are more cards than photos, show photos on the few featured cards of the home page and make the long list (a full menu or price list) a clean text list with no image boxes.
5. Write images as `<img src="images/hero.jpg" alt="..." width="..." height="..." loading="lazy">` (no `loading="lazy"` on the hero), with a real description in `alt`. In CSS give them `width: 100%; height: auto; object-fit: cover;` and a fixed `aspect-ratio` in cards so the grid stays even.
6. Text on top of a photo must stay readable whatever the photo shows: put a dark layer over the photo (for example `linear-gradient(rgba(0,0,0,.55), rgba(0,0,0,.55))` above it) and make the text white.

## Design quality

Decide a style that fits the business before you write (elegant, playful, modern, traditional) and keep it on every page.

- Colours: CSS variables in `:root` for one main colour, one accent, a text colour, a muted text colour, a background and a surface colour. Use only these.
- Type: a system font stack; a clear scale (large hero heading with `clamp()`, section headings, body text of 16px or more with line-height about 1.6). Headings and body text look different.
- Space: generous and regular. Sections have large vertical padding; content sits in a centred container with a max width (about 1100px); a spacing scale in variables.
- Layout: CSS grid or flexbox; cards in 1 column on phones, 2 to 3 on wider screens. No horizontal scrolling at any width.
- Header: a bar with padding and a background, the name on one side and the nav links in a row on the other (flexbox), links spaced apart and without underlines. On phones the links are hidden behind the menu button; on wide screens the menu button is hidden.
- Components: a sticky header; a hero with a heading, one sentence, and one or two buttons; cards with an image, a title, text and a price or an action; a footer with links, contact details and the year.
- Details: rounded corners and soft shadows used the same way everywhere; `:hover` and `:focus-visible` states on every link and button; short transitions (150–250ms); primary and secondary button styles.
- Content: each page has enough real content to be worth opening: at least six items on a menu or product page, three reviews, a real "about" story, full contact details and opening hours.

## Steps

1. Read `/workspaces/AGENTS.md` and list the workspace (and `images/`). If files already exist, read them and keep what still fits the request.
2. Decide the pages and the style. Fetch the stock photos you need.
3. Write the four files with `write_file`.
4. Check your work with the terminal tool (about 15 seconds; it changes nothing):

       sh /opt/data/skills/aba/aba-verify/check.sh /workspaces/<folder> site

   It prints `PASS`, or `FAIL` and one line per problem.
5. If it prints `FAIL`, fix exactly those problems and run the check again. When you rewrite a file to fix it, keep everything else in it as it was: the `<script src="app.js" defer></script>` line before `</body>`, both stylesheet links, every page and every `data-aba-id`. Stop after two fix rounds.
6. Reply to the user in one or two plain sentences: what you built (which pages), and anything that still does not work. Do not show code or file contents unless asked.
