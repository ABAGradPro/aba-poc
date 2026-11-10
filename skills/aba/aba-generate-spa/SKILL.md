---
name: aba-generate-spa
description: Build a small single-page web app for a non-technical ABA user inside their workspace, verify it, fix it, and report in plain words.
version: 1.0.0
author: ABA team
metadata:
  hermes:
    tags: [aba, devops, build]
    related_skills: [aba-verify, aba-edit-element]
---

# Generate an ABA single-page app

Inputs: the workspace (`/workspaces/<projectId>`) and the user's request in plain words.

## Rules (from /workspaces/AGENTS.md, plus these)

- Work only inside the given workspace. Never read or write anywhere else.
- Write files with the `write_file` tool. Do not create or edit files through the terminal.
- Output exactly four files: `index.html`, `styles.css`, `app.js`, `aba-overrides.css`.
- In `index.html`, link `styles.css` first and `aba-overrides.css` last, and load `app.js` with `<script src="app.js" defer></script>`.
- Every element inside `<body>` gets a unique `data-aba-id` (lowercase words joined by hyphens, e.g. `hero-title`), including `<script>`.
- No inline styles: never use a `style="..."` attribute. All CSS goes in `styles.css`. Leave `aba-overrides.css` empty (a one-line comment is fine).
- No inline event handlers (`onclick="..."`); attach events in `app.js`.
- Plain HTML, CSS and JavaScript only: no frameworks, no build tools, no package installs, no external CDNs or web fonts.
- Mobile-first: base styles for small screens, `@media (min-width: ...)` for larger ones. Include the viewport meta tag.
- Accessible: semantic elements (`header`, `main`, `nav`, `section`, `footer`), a `<label>` for every form field, `alt` on every image, enough colour contrast, keyboard-usable controls. If you put `aria-label` on a non-interactive element, also give it a `role` (e.g. `role="img"`).
- Use realistic placeholder content that fits the request, not "lorem ipsum".

## Steps

1. Read `/workspaces/AGENTS.md` and list the workspace. If files already exist, read them and keep what still fits the request.
2. Write the four files with `write_file`.
3. Run the `aba-verify` skill on the workspace.
4. If it reports problems, fix them and verify again. Stop after two fix rounds.
5. Reply to the user in one or two plain sentences: what you built, and anything that still does not work. Do not show code or file contents unless asked.
