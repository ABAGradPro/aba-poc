# Build log

One entry per step: date, who, what was done, and whether its check passed.

## Prerequisites

- P1 — OpenRouter key: `google/gemma-4-31b-it` replied "OK" (2026-11-07).
- P2 — Management droplet: SSH access works.
- P3 — Repo: created at github.com/ABAGradPro/aba-poc; members invited.
- P4 — Laptop tools: WSL Ubuntu 24.04, node v24.22.2, pnpm 12.18.0, Docker 29.1.3, uid 1000 (2026-11-07).

## Steps

- Step 1 — Droplet hardened: eyad sudo user, root and password login off, ufw 22/80, fail2ban, 1 GB swap; survives reboot (2026-11-07).
- Step 2 — Publish target: Nginx serves /var/www/apps; test page published and removed (2026-11-08).
- Step 3 — Repo scaffolded: React web, NestJS api, compose.yml, CI green (PR #1, 2026-11-08).
- Step 4 — Hermes on google/gemma-4-31b-it via OpenRouter, sandboxed in Docker; answers as ABA with AGENTS.md rules via CLI and API; /etc/x write denied; /home empty; /health ok, no-key requests get 401 (2026-11-09).
- Step 5 — Five Hermes skills (aba-generate-spa, aba-edit-element, aba-verify, aba-publish, aba-rollback) installed; bakery page generated with unique data-aba-id on all 72 body elements and no inline styles; aba-verify (check.sh, headless Chromium) reports "Uncaught Error: x"; aba-edit-element returns raw JSON keeping the data-aba-id (2026-11-10).
- Step 6 — Accounts: Prisma 7.10.1 + PostgreSQL (User, Project, Version, Run), Argon2id password hashes, httpOnly SameSite=Lax JWT cookie, guard on every route, 5 logins/minute (6th = 429); login, register and dashboard pages; unit + e2e tests pass; checked in the browser (2026-11-10).
- Step 7 — Projects as git folders (first commit "init"), owner-only (404 for others), Hermes Runs API bridge: POST /api/projects/:id/runs answers 202 in 0.03 s, 409 when busy, live SSE progress, approvals denied, 10-minute limit, friendly failure when Hermes is down; project list and live progress page; unit + e2e tests (fake Hermes) pass; real run checked in the browser (2026-11-10).
- Step 8 — Prompt to app: Hermes runs aba-generate-spa; the API adds missing data-aba-id, links aba-overrides.css last, commits "generate: <prompt>" and saves a Version; sandboxed preview on 127.0.0.1:4000 (no dotfiles, edit-mode script injected); coffee shop shown as version 1; .git/config 404; window.parent.document → SecurityError (2026-11-16).

## NFR1 mini-benchmark (Step 8)

**Result: 10 of 10** prompts render without console errors (target: at least 7 of 10). Full table and prompts: [benchmark-results.md](benchmark-results.md). Re-run with `node scripts/benchmark.mjs`.

What it checks: the four files exist, every body element has a unique data-aba-id, no inline styles or handlers, aba-overrides.css linked last, nothing external, and the page loads in headless Chromium with no console errors or missing files. It does not check that every requested feature works; that is judged by looking at the preview.
