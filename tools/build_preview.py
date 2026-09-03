#!/usr/bin/env python3
"""Build a separately-installable Tampermonkey preview copy of a userscript.

The production source remains the canonical file. This tool rewrites only the
preview build's metadata. When --preview-hash is supplied, it also ensures the
canonical source contains a tiny runtime router so production and preview
copies can coexist on a URL whose only distinction is the hash fragment.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

HEADER_END = "// ==/UserScript=="
CHANNEL_MARKER_PRODUCTION = (
    'const UserscriptBuildChannel = "production"; // PREVIEW_CHANNEL_MARKER'
)
CHANNEL_MARKER_PREVIEW = (
    'const UserscriptBuildChannel = "preview"; // PREVIEW_CHANNEL_MARKER'
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--preview-url", required=True)
    parser.add_argument("--build-number", required=True)
    parser.add_argument(
        "--preview-hash",
        default=None,
        help="Optional hash fragment, e.g. #lbc-preview, used to route preview traffic.",
    )
    return parser.parse_args()


def read_meta(text: str, key: str) -> str:
    match = re.search(
        rf"^// @{re.escape(key)}\s+(.+?)\s*$",
        text,
        flags=re.MULTILINE,
    )
    if not match:
        raise ValueError(f"Missing required userscript metadata @{key}.")
    return match.group(1)


def set_meta(text: str, key: str, value: str) -> str:
    pattern = re.compile(
        rf"^// @{re.escape(key)}\s+.*$",
        flags=re.MULTILINE,
    )
    if not pattern.search(text):
        raise ValueError(f"Missing required userscript metadata @{key}.")
    return pattern.sub(f"// @{key:<13}{value}", text, count=1)


def remove_meta(text: str, key: str) -> str:
    return re.sub(
        rf"^// @{re.escape(key)}\s+.*\n?",
        "",
        text,
        flags=re.MULTILINE,
    )


def derive_preview_namespace(namespace: str) -> str:
    base = namespace.rstrip("/")
    return f"{base}/preview/"


def ensure_hash_router(text: str, preview_hash: str) -> str:
    if not preview_hash.startswith("#"):
        preview_hash = f"#{preview_hash}"

    if "PREVIEW_CHANNEL_MARKER" in text:
        return text

    strict_match = re.search(
        r"^(?P<indent>\s*)(?P<quote>['\"])use strict(?P=quote);\s*$",
        text,
        flags=re.MULTILINE,
    )
    if not strict_match:
        raise ValueError(
            "Cannot install hash preview router: no 'use strict' statement was found."
        )

    indent = strict_match.group("indent")
    insertion_point = strict_match.end()

    block = f'''

{indent}// PREVIEW_CHANNEL_ROUTING
{indent}// Tampermonkey's URL matcher ignores hash fragments, so both installed
{indent}// copies match the page. This runtime gate makes exactly one copy active
{indent}// and reloads when the preview hash is toggled.
{indent}{CHANNEL_MARKER_PRODUCTION}
{indent}const UserscriptPreviewHash = "{preview_hash.lower()}";
{indent}const UserscriptPreviewRequested =
{indent}    location.hash.toLowerCase() === UserscriptPreviewHash;

{indent}window.addEventListener("hashchange", () => {{
{indent}    const PreviewRequestedNow =
{indent}        location.hash.toLowerCase() === UserscriptPreviewHash;

{indent}    if (PreviewRequestedNow !== UserscriptPreviewRequested) {{
{indent}        location.reload();
{indent}    }}
{indent}}});

{indent}if (
{indent}    (UserscriptBuildChannel === "preview") !==
{indent}    UserscriptPreviewRequested
{indent}) {{
{indent}    return;
{indent}}}
'''

    return text[:insertion_point] + block + text[insertion_point:]


def add_preview_metadata(
    text: str,
    *,
    preview_url: str,
    build_number: str,
) -> str:
    name = read_meta(text, "name")
    namespace = read_meta(text, "namespace")
    base_version = read_meta(text, "version")
    preview_version = f"{base_version}.{build_number}"

    text = set_meta(text, "name", f"{name} [PREVIEW]")
    text = set_meta(text, "namespace", derive_preview_namespace(namespace))
    text = set_meta(text, "version", preview_version)

    # A GitHub-hosted preview should always update from the fixed preview branch,
    # never inherit production distribution metadata.
    text = remove_meta(text, "updateURL")
    text = remove_meta(text, "downloadURL")

    metadata = (
        f"// @updateURL    {preview_url}\n"
        f"// @downloadURL  {preview_url}\n"
        f"// @tag          preview\n"
    )

    if HEADER_END not in text:
        raise ValueError("Userscript metadata block is missing its closing marker.")

    text = text.replace(HEADER_END, metadata + HEADER_END, 1)

    # If the script keeps an internal VERSION constant that mirrors @version,
    # keep the preview copy truthful without changing canonical source.
    text = re.sub(
        rf"(\bconst\s+VERSION\s*=\s*['\"]){re.escape(base_version)}(['\"]\s*;)",
        rf"\g<1>{preview_version}\g<2>",
        text,
        count=1,
    )

    return text


def main() -> None:
    args = parse_args()

    source_text = args.source.read_text(encoding="utf-8")

    if args.preview_hash:
        routed_source = ensure_hash_router(source_text, args.preview_hash)
        if routed_source != source_text:
            args.source.write_text(routed_source, encoding="utf-8")
            source_text = routed_source
            print(f"Installed hash preview router in {args.source}.")

    preview_text = add_preview_metadata(
        source_text,
        preview_url=args.preview_url,
        build_number=args.build_number,
    )

    if args.preview_hash:
        if CHANNEL_MARKER_PRODUCTION not in preview_text:
            raise ValueError("Hash-routed source is missing the build-channel marker.")
        preview_text = preview_text.replace(
            CHANNEL_MARKER_PRODUCTION,
            CHANNEL_MARKER_PREVIEW,
            1,
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(preview_text, encoding="utf-8")

    print(f"Wrote preview build to {args.output}.")
    print(f"Preview version: {read_meta(preview_text, 'version')}")


if __name__ == "__main__":
    main()
