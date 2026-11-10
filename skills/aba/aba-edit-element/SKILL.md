---
name: aba-edit-element
description: Rewrite one element of an ABA page, found by its data-aba-id, and return only JSON with the new HTML and CSS.
version: 1.0.0
author: ABA team
metadata:
  hermes:
    tags: [aba, devops, build]
    related_skills: [aba-generate-spa]
---

# Edit one element

Inputs: the element's current HTML (one root element with a `data-aba-id`), the project's `styles.css` if given, and the user's change request.

## Rules

- Change only that element and its children. Do not touch or mention anything else on the page.
- Keep exactly one root element, and keep its `data-aba-id` unchanged.
- Every child element keeps its `data-aba-id`; new child elements get new unique ones (lowercase words joined by hyphens).
- No inline styles (`style="..."`) and no inline event handlers. Put styling in the `css` field, using selectors like `[data-aba-id="the-id"]` so it only affects this element.
- Keep it accessible: labels, alt text, contrast, keyboard use.
- Do not write any files; the ABA app applies your answer.

## Output

Your whole reply is one raw JSON object. A program parses it directly, so anything else breaks it.

- The first character of your reply is `{` and the last is `}`.
- Do not wrap it in a code block: never write ``` or ```json.
- No text before or after it: no explanation, no "Here is".
- Use exactly two keys, `html` and `css`, both strings. Escape double quotes inside them as `\"`.

Correct reply (the whole reply, nothing around it):

{"html": "<button class=\"btn\" data-aba-id=\"order-btn\">Order now</button>", "css": "[data-aba-id=\"order-btn\"] { background: #1e7d32; color: #fff; border-radius: 12px; }"}

Wrong reply (has a code fence):

```json
{"html": "...", "css": "..."}
```
