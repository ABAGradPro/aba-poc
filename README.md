# aba-poc

Proof of concept for ABA: a logged-in user describes an app, Hermes builds it with its DevOps skills while thinking with Gemma 4 through OpenRouter, the user edits it by clicking and dragging, every change is versioned, and one button publishes it to the management droplet.

## Layout

| Folder | What it holds |
| --- | --- |
| `apps/web` | React GUI |
| `apps/api` | NestJS API and preview server |
| `skills/` | The Hermes DevOps skills (`aba-generate-spa`, `aba-edit-element`, `aba-verify`, `aba-publish`, `aba-rollback`) |
| `infra/` | `compose.yml`, Hermes identity files (SOUL.md, USER.md, AGENTS.md), droplet config |
| `docs/` | `build-log.md`, demo notes |

## Rules

- This repo is public. Never commit keys, passwords or `.env` files.
- Work on a branch and open a pull request; don't push straight to `main`.
- Clone and work inside WSL (`~/aba-poc`), never under `C:\`.
