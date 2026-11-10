---
name: aba-rollback
description: Point an ABA project's live link on the management droplet back at its previous release, and check it.
version: 1.0.0
author: ABA team
metadata:
  hermes:
    tags: [aba, devops, operate]
    related_skills: [aba-publish]
---

# Roll back an ABA project

Input: the slug (lowercase letters, digits, hyphens).
Target: publish@157.230.117.76 with the key in ~/.ssh/id_ed25519.

1. Roll back (replace SLUG):
   ssh publish@157.230.117.76 'set -e; P=$(ls -1dt /var/www/releases/SLUG/* | sed -n 2p); test -n "$P"; ln -sfn "$P" /var/www/apps/SLUG'
   If this fails because there is no previous release, stop and say so.
2. Check: curl -sf http://157.230.117.76/SLUG/ must return the page.
3. Report in one sentence that the previous version is live at http://157.230.117.76/SLUG/, or what went wrong.
