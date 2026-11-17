#!/usr/bin/env python3
"""ABA stock photo helper: saves one free photo into a project's images/ folder.

Usage: python3 get_image.py /workspaces/<folder> <name> <search words...>
Prints "OK images/<name>.jpg <width>x<height>" or "FAILED: <why>".

Photos come from Openverse and are limited to public-domain licences (CC0 / PDM), so they
need no credit. The photo is downloaded, shrunk to at most 1600px wide and saved as a JPEG
inside the workspace, so the published site never links to another site.
"""
import io
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

MAX_STOCK = 16  # stock photos per project (unused ones are removed after each build)
MAX_BYTES = 12 * 1024 * 1024
UA = "aba-poc-stock-helper/1.0"


def fail(why):
    print(f"FAILED: {why}")
    sys.exit(0)  # a missing photo is not an error for the build; the skill falls back to CSS


def get(url, limit=MAX_BYTES, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        data = res.read(limit + 1)
    if len(data) > limit:
        raise ValueError("too large")
    return data


def main():
    if len(sys.argv) < 4:
        fail("usage: get_image.py /workspaces/<folder> <name> <search words>")
    workspace = os.path.realpath(sys.argv[1])
    name = sys.argv[2].lower()
    words = " ".join(sys.argv[3:])[:80]
    if not re.fullmatch(r"/workspaces/[a-z0-9]+(?:-[a-z0-9]+)*", workspace) or not os.path.isdir(workspace):
        fail("the first argument must be the project's /workspaces/<folder>")
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name) or len(name) > 40:
        fail("the name must be lowercase words joined by hyphens, e.g. hero or dish-1")

    try:
        from PIL import Image
    except Exception:
        fail("the image library is missing")

    images = os.path.join(workspace, "images")
    state_dir = os.path.join(workspace, ".aba")
    state_file = os.path.join(state_dir, "stock.json")
    os.makedirs(images, exist_ok=True)
    os.makedirs(state_dir, exist_ok=True)
    try:
        state = json.load(open(state_file, encoding="utf-8"))
    except Exception:
        state = {}
    # state: { "<name>": {"id": ..., "source": ..., "creator": ..., "license": ...} }
    if name not in state and len(state) >= MAX_STOCK:
        fail(f"this project already has {MAX_STOCK} stock photos; reuse one of them")
    used = {v.get("id") for k, v in state.items() if k != name}

    query = urllib.parse.urlencode(
        {"q": words, "license": "cc0,pdm", "category": "photograph", "page_size": 20, "mature": "false"}
    )
    try:
        results = json.loads(get(f"https://api.openverse.org/v1/images/?{query}", 2_000_000)).get("results", [])
    except urllib.error.HTTPError as err:
        if err.code == 429:
            fail("the free photo search has reached its limit for now; use CSS colours instead of more photos")
        fail(f"the photo search answered with an error ({err.code})")
    except Exception as err:
        fail(f"the photo search did not answer ({type(err).__name__})")
    if not results:
        fail("no free photo found for these words; try simpler words")

    for r in results:
        if r.get("id") in used or not r.get("url"):
            continue
        if (r.get("width") or 0) and r["width"] < 800:
            continue
        try:
            img = Image.open(io.BytesIO(get(r["url"])))
            img.load()
        except Exception:
            continue
        if img.width < 800 or img.height < 400:
            continue
        img = img.convert("RGB")
        if img.width > 1600:
            img = img.resize((1600, round(img.height * 1600 / img.width)))
        out = os.path.join(images, f"{name}.jpg")
        img.save(out, "JPEG", quality=80, optimize=True, progressive=True)
        state[name] = {
            "id": r.get("id"),
            "source": r.get("foreign_landing_url"),
            "creator": r.get("creator"),
            "license": r.get("license"),
            "words": words,
        }
        json.dump(state, open(state_file, "w", encoding="utf-8"), indent=1)
        print(f"OK images/{name}.jpg {img.width}x{img.height}")
        return
    fail("no usable photo found for these words; try other words")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as err:  # never crash the build over a photo
        fail(type(err).__name__)
