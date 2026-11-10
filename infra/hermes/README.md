# Hermes setup (Step 4)

Copies of the Hermes identity files (FR8). The live copies are outside the repo:

| File here | Live copy (WSL) | Hermes sees it as |
| --- | --- | --- |
| `SOUL.md` | `~/aba-data/hermes/SOUL.md` | `/opt/data/SOUL.md` |
| `USER.md` | `~/aba-data/hermes/memories/USER.md` | `/opt/data/memories/USER.md` |
| `AGENTS.md` | `~/aba-data/workspaces/AGENTS.md` | `/workspaces/AGENTS.md` |

After changing one here, copy it to its live path and run `docker compose -f infra/compose.yml restart hermes`.

## Settings each member makes on their own laptop (never commit these)

1. Run the setup wizard, choose **OpenRouter**, paste your own key, and set the model to `google/gemma-4-31b-it` (use "Enter custom model name"):
   `docker run -it --rm -e PUID=1000 -e PGID=1000 -v ~/aba-data/hermes:/opt/data nousresearch/hermes-agent setup`
2. Add to `~/aba-data/hermes/config.yaml`:
   ```yaml
   provider_routing:
     require_parameters: true
   ```
   and set `terminal.cwd` to `/workspaces`:
   `docker exec -u 1000 hermes hermes config set terminal.cwd /workspaces`
3. In `~/aba-data/hermes/.env`: `API_SERVER_ENABLED=true`, `API_SERVER_HOST=0.0.0.0`, and `API_SERVER_KEY=<openssl rand -hex 32>` (the wizard may already have set one).
4. Copy the three files above to their live paths, then `docker compose -f infra/compose.yml up -d hermes`.

## Talking to Hermes

Start the CLI from `/workspaces` so it loads `AGENTS.md`:

```bash
docker exec -it -u 1000 -w /workspaces hermes hermes
```

Health check: `curl -s http://localhost:8642/health` should return `{"status": "ok", ...}`.
