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

## NFR1 mini-benchmark (Step 8)

| # | Prompt | Renders without console errors? |
| --- | --- | --- |
| 1 | | |

Result: _ of 10 (target: at least 7).
