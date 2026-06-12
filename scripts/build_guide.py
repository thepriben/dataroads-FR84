#!/usr/bin/env python3
"""Build guide.html from docs/guide.wiki (stdlib only, MediaWiki-style syntax)."""

from __future__ import annotations

import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "guide.wiki"
OUTPUT = ROOT / "guide.html"

H2_RE = re.compile(r"^== (.+?) \{#([^}]+)\} ==\s*$", re.MULTILINE)
FAMILY_RE = re.compile(r"^=== \[family:([^\]]+)\] (.+?) ===\s*$", re.MULTILINE)
LAYER_RE = re.compile(r"^==== \[layer:([^\]]+)\] (.+?) ====\s*$", re.MULTILINE)
INCLUDE_RE = re.compile(r"^\{\{include:([^|]+)\|(.+?)\}\}\s*$", re.MULTILINE)
HINT_RE = re.compile(r"^\{\{hint\|(.+?)\}\}\s*$", re.MULTILINE)
HTML_COMMENT_RE = re.compile(r"<!--.*?-->\s*", re.DOTALL)
HTML_BLOCK_RE = re.compile(r"(<[^>]+>.*?</[^>]+>|<[^>]+/>)", re.DOTALL)
WIKI_CODE_RE = re.compile(r"\{\{\{([^}]+)\}\}\}")
WIKI_BOLD_RE = re.compile(r"'''([^']+)'''")
WIKI_ITALIC_RE = re.compile(r"''([^']+)''")


def parse_front_matter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, text

    end = text.find("\n---\n", 4)
    if end == -1:
        return {}, text

    block = text[4:end]
    body = text[end + 5 :].lstrip("\n")
    meta: dict[str, str] = {}
    for line in block.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip()
    return meta, body


def inline_format(text: str) -> str:
    parts = HTML_BLOCK_RE.split(text)
    out: list[str] = []
    for part in parts:
        if not part:
            continue
        if part.startswith("<"):
            out.append(part)
            continue
        chunk = html.escape(part, quote=False)
        chunk = WIKI_CODE_RE.sub(r"<code>\1</code>", chunk)
        chunk = WIKI_BOLD_RE.sub(r"<strong>\1</strong>", chunk)
        chunk = WIKI_ITALIC_RE.sub(r"<em>\1</em>", chunk)
        out.append(chunk)
    return "".join(out)


def expand_macros(fragment: str) -> str:
    def include_replace(match: re.Match[str]) -> str:
        rel_path, caption = match.group(1).strip(), match.group(2).strip()
        asset = ROOT / rel_path
        if not asset.is_file():
            raise FileNotFoundError(f"Include introuvable : {rel_path}")
        if asset.suffix.lower() == ".svg":
            svg = asset.read_text(encoding="utf-8").strip()
            return (
                f'<figure class="guide-figure">\n{svg}\n'
                f"<figcaption>{inline_format(caption)}</figcaption>\n</figure>"
            )
        raise ValueError(f"Type d'inclusion non géré : {rel_path}")

    def hint_replace(match: re.Match[str]) -> str:
        return f'<p class="guide-hint">{inline_format(match.group(1).strip())}</p>'

    fragment = INCLUDE_RE.sub(include_replace, fragment)
    return HINT_RE.sub(hint_replace, fragment)


def wiki_to_html(fragment: str) -> str:
    fragment = HTML_COMMENT_RE.sub("", fragment).strip()
    if not fragment:
        return ""

    fragment = expand_macros(fragment)
    blocks = re.split(r"\n\s*\n", fragment)
    html_parts: list[str] = []

    for block in blocks:
        block = block.strip()
        if not block:
            continue

        if block.startswith("<"):
            html_parts.append(block)
            continue

        lines = block.splitlines()
        if all(re.match(r"^\*\s+", line) for line in lines):
            items = "\n".join(
                f"<li>{inline_format(re.sub(r'^\*\s+', '', line).strip())}</li>"
                for line in lines
            )
            html_parts.append(f"<ul>\n{items}\n</ul>")
            continue

        paragraph = " ".join(line.strip() for line in lines)
        html_parts.append(f"<p>{inline_format(paragraph)}</p>")

    return "\n".join(html_parts)


def wrap_lead(body: str) -> str:
    first_h2 = re.search(r"\n== ", body)
    if not first_h2:
        return ""
    lead = HTML_COMMENT_RE.sub("", body[: first_h2.start()]).strip()
    if not lead:
        return ""
    paragraph = " ".join(line.strip() for line in lead.splitlines())
    return f'<p class="guide-lead">{inline_format(paragraph)}</p>'


def build_families_section(content: str) -> str:
    parts = FAMILY_RE.split(content)
    if len(parts) < 3:
        return wiki_to_html(content)

    html_parts: list[str] = []
    intro = parts[0].strip()
    if intro:
        html_parts.append(wiki_to_html(intro))

    index = 1
    while index + 2 <= len(parts):
        family_id = parts[index].strip()
        family_title = parts[index + 1].strip()
        family_body = parts[index + 2]
        index += 3

        layer_parts = LAYER_RE.split(family_body)
        family_intro = layer_parts[0].strip()
        family_intro_html = wiki_to_html(family_intro)

        layers_html: list[str] = []
        layer_index = 1
        while layer_index + 2 <= len(layer_parts):
            layer_id = layer_parts[layer_index].strip()
            layer_title = layer_parts[layer_index + 1].strip()
            layer_body = layer_parts[layer_index + 2].strip()
            layer_index += 3
            layer_html = wiki_to_html(layer_body)
            layers_html.append(
                f'<div class="guide-layer" id="{layer_id}">\n'
                f"<h4>{html.escape(layer_title)}</h4>\n{layer_html}\n</div>"
            )

        html_parts.append(
            f'<article class="guide-family" data-family="{family_id}" id="{family_id}">\n'
            f"<h3>{html.escape(family_title)}</h3>\n{family_intro_html}\n"
            f"{''.join(layers_html)}\n</article>"
        )

    return "\n".join(html_parts)


def build_sections(body: str) -> tuple[list[tuple[str, str, str]], str]:
    matches = list(H2_RE.finditer(body))
    if not matches:
        raise ValueError("Aucune section == … {#id} == trouvée dans docs/guide.wiki")

    lead_html = wrap_lead(body)
    sections: list[tuple[str, str, str]] = []

    for index, match in enumerate(matches):
        title = match.group(1).strip()
        section_id = match.group(2).strip()
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        content = body[start:end].strip()

        if section_id == "familles":
            inner = build_families_section(content)
        else:
            inner = wiki_to_html(content)

        sections.append((section_id, title, inner))

    return sections, lead_html


def build_toc(sections: list[tuple[str, str, str]]) -> str:
    title_by_id = {sid: title for sid, title, _ in sections}
    title_by_id["factual"] = "Cartographie factuelle"
    title_by_id["stats"] = "Données statistiques"
    title_by_id["realtime"] = "Temps réel"
    title_by_id["incubator"] = "Incubateur"
    title_by_id["tools"] = "Outils & méta"

    ordered_ids = [
        "interface",
        "navigation",
        "controles",
        "factual",
        "stats",
        "realtime",
        "incubator",
        "toolbar",
        "header",
        "tools",
        "url",
        "fraicheur",
    ]

    items = "\n".join(
        f'                <li><a href="#{section_id}">{title_by_id[section_id]}</a></li>'
        for section_id in ordered_ids
        if section_id in title_by_id
    )

    return (
        '        <nav class="guide-toc" aria-label="Sommaire">\n'
        "            <h2>Sommaire</h2>\n"
        "            <ol>\n"
        f"{items}\n"
        "            </ol>\n"
        "        </nav>"
    )


def render_page(meta: dict[str, str], sections: list[tuple[str, str, str]], lead_html: str) -> str:
    css_version = meta.get("css_version", "1")
    description = meta.get(
        "description",
        "Guide d'utilisation de la carte interactive du réseau routier départemental du Vaucluse (CD84).",
    )
    repo_url = meta.get("repo_url", "https://github.com/thepriben/dataroads-FR84")

    toc_html = build_toc(sections)

    section_html = []
    for section_id, section_title, inner in sections:
        section_html.append(
            f'        <section class="guide-section" id="{section_id}">\n'
            f"            <h2>{html.escape(section_title)}</h2>\n{inner}\n        </section>"
        )

    page_title = meta.get("title", "Guide utilisateur — dataroads-FR84")

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{html.escape(page_title)}</title>
    <meta name="description" content="{html.escape(description)}">
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="css/guide.css?v={html.escape(css_version)}">
</head>
<body>
    <div class="guide-wrap">
        <header class="guide-top">
            <a href="./">← Retour à la carte</a>
            <span class="guide-top-meta">dataroads-FR84</span>
        </header>

        <h1>Guide utilisateur</h1>
        {lead_html}

{toc_html}

{chr(10).join(section_html)}

        <footer class="guide-foot">
            dataroads-FR84 — prototype CD84 · <a href="{html.escape(repo_url)}" style="color:#3498db;">dépôt GitHub</a>
        </footer>
    </div>
</body>
</html>
"""


def main() -> int:
    if not SOURCE.is_file():
        print(f"Fichier source introuvable : {SOURCE}", file=sys.stderr)
        return 1

    raw = SOURCE.read_text(encoding="utf-8")
    meta, body = parse_front_matter(raw)
    body = HTML_COMMENT_RE.sub("", body).strip()
    sections, lead_html = build_sections(body)
    page = render_page(meta, sections, lead_html)
    OUTPUT.write_text(page, encoding="utf-8")
    print(f"Écrit {OUTPUT.relative_to(ROOT)} ({len(page)} octets)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
