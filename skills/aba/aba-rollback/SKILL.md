---
name: aba-rollback
description: Point an ABA project's live link on the management droplet back at its previous release, and check it.
version: 1.1.0
author: ABA team
metadata:
  hermes:
    tags: [aba, devops, operate]
    related_skills: [aba-publish]
---

# Roll back an ABA project

Input: the slug (lowercase letters, digits, hyphens).
Target: publish@157.230.117.76 with the key in ~/.ssh/id_ed25519.

1. Roll back (replace SLUG). Run this command exactly as written; do not change it:
   ssh publish@157.230.117.76 'set -e; cd /var/www/releases/SLUG; C=$(basename "$(readlink /var/www/apps/SLUG)"); P=$(ls -1 | sort | grep -B1 -x "$C" | head -n 1); if [ -z "$P" ] || [ "$P" = "$C" ]; then echo "no previous release"; exit 1; fi; ln -sfn "/var/www/releases/SLUG/$P" /var/www/apps/SLUG; echo "now live: $P (was $C)"'
   It picks the release whose folder name comes just before the one that is live now.
   If it prints "no previous release", stop and say so.
2. Check: curl -sf http://157.230.117.76/SLUG/ must return the page.
3. Report in one sentence that the previous version is live at http://157.230.117.76/SLUG/, or what went wrong.

## Pitfalls

- Release folders are named by time (YYYYMMDDHHMMSS). Always choose releases by their name, never by their date (`ls -t`): tar copies the workspace's date onto every release, so their dates are all the same.
