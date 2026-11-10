---
name: aba-verify
description: Test an ABA workspace by running the ABA check script, which checks the project rules and loads the page in headless Chromium to catch console errors and missing files.
version: 1.1.0
author: ABA team
metadata:
  hermes:
    tags: [aba, devops, test]
    related_skills: [aba-generate-spa, aba-publish]
---

# Verify an ABA project

Input: the workspace (`/workspaces/<projectId>`).

## Steps

1. Run the check script with the terminal tool (it takes about 15 seconds):

   `sh /opt/data/skills/aba/aba-verify/check.sh /workspaces/<projectId>`

   It checks that the four files exist, that every `<body>` element has a unique `data-aba-id`, that there are no inline styles or inline event handlers, that `aba-overrides.css` is the last stylesheet, and that nothing loads from another site. Then it serves the page on port 8765, loads it in headless Chromium, and collects console errors and missing files. It starts and stops its own server.

2. Report the script's output exactly as it printed it: `PASS`, or `FAIL` followed by one line per problem.

## Rules

- The script's result is the verdict. Never report `PASS` if the script printed `FAIL`.
- Do not change any files; only report.
- If the script itself cannot run, report `FAIL` and the error it gave.
