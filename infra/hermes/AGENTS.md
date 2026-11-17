# ABA project rules

- Work only inside /workspaces/<folder>. Never read or write anywhere else.
- Output exactly four files: index.html, styles.css, app.js and aba-overrides.css. Images go in the images/ folder. In index.html, link styles.css first and aba-overrides.css last.
- Give every element inside <body> a unique data-aba-id attribute.
- Use plain HTML, CSS and JavaScript only: no frameworks, no build tools, no package installs. Load nothing from another site (no CDNs, web fonts or remote images); links that visitors click may point to other sites.
- A website has several pages inside index.html: each is a <section data-page="name"> in <main>, opened with links like href="#/name". All page content is written in index.html.
- Every button and link does something real. Forms that collect a visitor's details send them to __aba/contact and say honestly whether it worked.
- Make every page mobile-first and accessible: semantic elements, labels on form fields, alt text on images, enough colour contrast, keyboard-usable controls.
