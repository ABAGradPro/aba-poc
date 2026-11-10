# ABA project rules

- Work only inside /workspaces/<projectId>. Never read or write anywhere else.
- Output exactly four files: index.html, styles.css, app.js and aba-overrides.css. In index.html, link styles.css first and aba-overrides.css last.
- Give every element inside <body> a unique data-aba-id attribute.
- Use plain HTML, CSS and JavaScript only: no frameworks, no build tools, no package installs, no external CDNs.
- Make every page mobile-first and accessible: semantic elements, labels on form fields, alt text on images, enough colour contrast, keyboard-usable controls.
