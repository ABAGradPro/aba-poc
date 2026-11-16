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
- Extra (before Step 9) — Project folders named after the project (`coffee-shop-d5de03ae`: safe name + 8 id characters), migration `project_folder` + `pnpm --filter api folders:rename --apply` for existing folders; rename (PATCH) and delete (DELETE, folder moved to ~/aba-data/trash) in the API and on the dashboard and project page; 409 during a build, 404 for others (2026-11-16).
- Step 9 — Click-to-edit and drag-and-drop: packages/edit-mode (esbuild IIFE, postMessage only with the GUI origin); prompt edits via aba-edit-element with the answer checked (one root, same data-aba-id, no scripts) and only that element replaced; drag = move (refuses drops into itself), Alt-drag = one offset rule per element in aba-overrides.css; every change is a version. Checked in the browser: moves persist after reload, 6 Alt-drags left one updated rule, drags created no Run rows and no OpenRouter usage, prompt edits changed only that element (2026-11-16).
- Step 10 — Versions and undo: Version.number (migration `version_number`), only the newest 3 rows kept per project while git keeps every commit; POST /api/projects/:id/versions/:versionId/restore runs `git restore --source=<sha> --staged --worktree -- .` and commits `restore: <sha>` as a new, undoable version; History panel with Restore. Checked in the browser: the panel shows exactly 3; three restores on Amman coffee each identical to the restored version (git diff empty); git log still lists all 29 commits (2026-11-16).
- Step 11 — Publish and roll back: Project.slug/liveUrl/publishedAt (migration `project_publish`); POST /api/projects/:id/publish and /rollback start Hermes runs of aba-publish / aba-rollback over ssh as `publish` (key with `restrict`: no shell, no sudo); a publish only counts when the live page is byte-identical to the local index.html; releases live in /var/www/releases/<slug>/<YYYYMMDDHHMMSS>, newest 3 kept, chosen by folder name (folder dates are all the workspace's date, which broke `ls -t`; fixed in both skills). Checked: live pages open on desktop and phone, a second publish showed the edit, Roll back returned كافيه صح النوم to version 1 in about 10 s while the working copy stayed on version 2, a page failing aba-verify was not published, no site has more than 3 releases (2026-11-16).

## NFR1 mini-benchmark (Step 8)

**Result: 10 of 10** prompts render without console errors (target: at least 7 of 10). Full table and prompts: [benchmark-results.md](benchmark-results.md). Re-run with `node scripts/benchmark.mjs`.

What it checks: the four files exist, every body element has a unique data-aba-id, no inline styles or handlers, aba-overrides.css linked last, nothing external, and the page loads in headless Chromium with no console errors or missing files. It does not check that every requested feature works; that is judged by looking at the preview.
