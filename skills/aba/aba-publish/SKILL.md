---
name: aba-publish
description: Publish an ABA project to the management droplet as a new release, check it, and roll back automatically if the check fails.
version: 1.1.0
author: ABA team
metadata:
  hermes:
    tags: [aba, devops, deploy]
    related_skills: [aba-verify, aba-rollback]
---

# Publish an ABA project

Inputs: the workspace (/workspaces/<projectId>) and a slug (lowercase letters, digits, hyphens).
Target: publish@157.230.117.76 with the key in ~/.ssh/id_ed25519.

1. Test: run aba-verify. If it fails, stop and report why.
2. Release (replace SLUG and the workspace path). Run this command exactly as written; do not change it:
   tar -C /workspaces/<projectId> --exclude=.git --exclude=.aba -czf - . | ssh publish@157.230.117.76 'set -e; R=/var/www/releases/SLUG/$(date +%Y%m%d%H%M%S); mkdir -p "$R"; tar -xzf - -C "$R"; ln -sfn "$R" /var/www/apps/SLUG; ls -1d /var/www/releases/SLUG/* | sort -r | tail -n +4 | xargs -r rm -rf'
   It keeps the newest 3 releases (by folder name) and deletes older ones.
3. Check: curl -sf http://157.230.117.76/SLUG/ must return the page. If not, run aba-rollback.
4. Report the live URL in one sentence.

## Pitfalls

- Release folders are named by time (YYYYMMDDHHMMSS). Always choose releases by their name, never by their date (`ls -t`): tar copies the workspace's date onto every release, so their dates are all the same, and sorting by date can delete the release that was just published.
