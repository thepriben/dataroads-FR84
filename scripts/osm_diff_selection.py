#!/usr/bin/env python3
"""Quels jeux une nuit de contributions OSM oblige-t-elle à réextraire.

Onze requêtes lourdes chaque nuit pour redécouvrir que dix d'entre elles
n'avaient rien à rapporter : les cantons et les communes du Vaucluse ne changent pas tous
les jours, et ``overpass-api.de`` est un service public gratuit. Un ``adiff``
unique sur les dernières vingt-quatre heures coûte une requête et dit lesquels
d'entre eux méritent d'être relus.

Le rapprochement se déduit des requêtes de ``update_osm_geojson.py``
elles-mêmes, jamais d'une table recopiée à côté : une table dériverait au
premier jeu dont on retouche le filtre, et la dérive serait muette — on
afficherait des données fausses sans que rien ne le signale. D'où l'analyse
littérale des requêtes, et une règle unique en cas d'hésitation : réextraire.
Une requête de trop ne coûte que du temps machine.
"""

from __future__ import annotations

import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

# Emprise du Vaucluse, reprise de ``update_osm_latest_changes.py`` : l'``adiff``
# n'accepte pas de filtre par zone administrative, il lui faut une boîte
# englobante. Elle déborde sur le Gard, la Drôme et les Bouches-du-Rhône, et ce
# débordement est sans danger : il ne peut que provoquer une réextraction de
# plus, jamais en faire manquer une.
BBOX = (43.67, 4.64, 44.29, 5.76)

# Au-delà, le diff ne sert plus à rien : rattraper une semaine de contributions
# retient de toute façon à peu près tous les jeux, et une fenêtre si large coûte
# à Overpass davantage que les onze extractions qu'elle prétend éviter.
MAX_DIFF_WINDOW = timedelta(days=3)

# Recul ajouté à la fenêtre. Un ``adiff`` se calcule sur la base OSM telle que
# la réplique interrogée la connaît, et cette base traîne volontiers d'une heure
# ou deux : partir exactement de la dernière vérification laisserait passer les
# contributions arrivées dans cet angle mort.
DIFF_WINDOW_MARGIN = timedelta(hours=3)

# Tags qui redessinent un découpage territorial. Une limite communale est
# portée par une relation, mais ses tracés sont des chemins : un chemin qui
# porte ``boundary`` ne ressemble à aucun jeu et redéfinit pourtant celui des
# communes. Les reconnaître ici évite de laisser passer une fusion de communes.
BOUNDARY_TAGS = ("boundary", "admin_level", "ref:INSEE", "political_division")
TERRITORY_DATASETS = ("communes-vaucluse", "cantons-vaucluse")

# Toutes les requêtes sauf celle des cantons s'ancrent sur
# ``area["ISO3166-2"="FR-84"]`` : si la limite départementale elle-même bouge,
# c'est l'aire interrogée qui change et plus aucun jeu n'est au-dessus du
# soupçon.
DEPARTMENT_MARKER = "FR-84"

_STATEMENT = re.compile(
    r"^(node|way|relation|rel|nwr)\s*(?:\(\s*area\s*\.\s*\w+\s*\))?\s*(\[.+\])$",
    re.DOTALL,
)
_FILTER = re.compile(r'\[\s*"([^"]+)"\s*(?:(~|=)\s*"([^"]*)"\s*)?\]')

_TYPES = {
    "node": ("node",),
    "way": ("way",),
    "relation": ("relation",),
    "rel": ("relation",),
    "nwr": ("node", "way", "relation"),
}


class Selector:
    """Un motif « type + filtres de tags » tiré d'une requête de jeu."""

    __slots__ = ("types", "filters")

    def __init__(self, types: tuple[str, ...], filters: tuple[tuple[str, str, str], ...]):
        self.types = types
        self.filters = filters

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Selector) and self.key() == other.key()

    def __hash__(self) -> int:
        return hash(self.key())

    def key(self) -> tuple:
        return (self.types, self.filters)

    def __repr__(self) -> str:
        body = "".join(
            f'["{key}"]' if operator == "" else f'["{key}"{operator}"{value}"]'
            for key, operator, value in self.filters
        )
        return f"{'|'.join(self.types)}{body}"

    def matches(self, osm_type: str, tags: dict[str, str]) -> bool:
        if osm_type not in self.types or not tags:
            return False
        for key, operator, value in self.filters:
            present = tags.get(key)
            if present is None:
                return False
            if operator == "=" and present != value:
                return False
            if operator == "~":
                try:
                    if not re.search(value, present):
                        return False
                except re.error:
                    # Une expression qu'Overpass accepte et que Python refuse ne
                    # doit pas faire taire le rapprochement : on retient le jeu.
                    return True
        return True

    def overpass(self) -> str:
        # ``nwr`` dès que plusieurs types partagent le même filtre : interroger
        # un type de trop ne peut que retenir un jeu que l'on aurait relu de
        # toute façon, quand l'oublier le laisserait faux sans un mot.
        prefix = "nwr" if len(self.types) > 1 else self.types[0]
        body = "".join(
            f'["{key}"]' if operator == "" else f'["{key}"{operator}"{value}"]'
            for key, operator, value in self.filters
        )
        return f"{prefix}{body};"


def split_statements(query: str) -> list[str]:
    """Découpe une requête Overpass sur ses points-virgules de fin d'instruction.

    Un simple ``split`` sur « ; » tronquerait les filtres qui en contiennent un,
    et le dépôt en a : les routes déclassées se reconnaissent sur ``was:ref`` par
    l'expression ``(^|;) *[Dd]``, parce qu'un tronçon peut porter plusieurs
    anciens numéros séparés par des points-virgules. Tronquées, ces deux
    instructions disparaissaient du rapprochement — et les déclassées avec.
    """
    statements: list[str] = []
    current: list[str] = []
    quoted = False
    for character in query:
        if character == '"':
            quoted = not quoted
        if character == ";" and not quoted:
            statements.append("".join(current))
            current = []
            continue
        current.append(character)
    statements.append("".join(current))
    return statements


def parse_selectors(query: str) -> list[Selector]:
    """Les motifs d'objets qu'une requête de jeu interroge.

    Seules les instructions qui désignent des objets par leurs tags sont
    retenues : les ``area``, les ``out`` et la récursion ``>`` décrivent la mise
    en forme, pas le périmètre.
    """
    stripped = "\n".join(
        line for line in query.splitlines() if not line.strip().startswith("#")
    )
    stripped = re.sub(r"\[\s*(out|timeout|adiff|bbox|diff)\s*:[^\]]*\]", "", stripped)
    selectors: list[Selector] = []
    for raw in split_statements(stripped):
        statement = raw.strip().strip("()").strip()
        if not statement:
            continue
        found = _STATEMENT.match(statement)
        if not found:
            continue
        filters = tuple(
            (key, operator or "", value or "")
            for key, operator, value in _FILTER.findall(found.group(2))
        )
        if not filters:
            continue
        selector = Selector(_TYPES[found.group(1)], filters)
        if selector not in selectors:
            selectors.append(selector)
    return selectors


def dataset_selectors(queries: dict[str, str]) -> dict[str, list[Selector]]:
    return {name: parse_selectors(query) for name, query in queries.items()}


def merge_selectors(by_dataset: dict[str, list[Selector]]) -> list[Selector]:
    """Les motifs de tous les jeux, dédoublonnés et fusionnés par type.

    Un même filtre demandé pour un nœud, un chemin et une relation — les aires
    d'arrêt en alignent douze de cette forme — tient en une instruction ``nwr``.
    """
    grouped: dict[tuple, set[str]] = {}
    order: list[tuple] = []
    for selectors in by_dataset.values():
        for selector in selectors:
            if selector.filters not in grouped:
                grouped[selector.filters] = set()
                order.append(selector.filters)
            grouped[selector.filters].update(selector.types)
    merged = []
    for filters in order:
        types = tuple(kind for kind in ("node", "way", "relation") if kind in grouped[filters])
        merged.append(Selector(types, filters))
    return merged


def adiff_query(since: datetime, selectors: Iterable[Selector], timeout: int = 540) -> str:
    """La requête unique qui remplace les onze extractions d'une nuit calme.

    ``out meta`` sans géométrie suffit : le rapprochement se joue sur les tags
    et les identifiants, et demander les tracés ferait payer au serveur un
    volume dont on ne lirait rien.
    """
    south, west, north, east = BBOX
    body = "\n".join(f"  {selector.overpass()}" for selector in selectors)
    return (
        f'[adiff:"{since.strftime("%Y-%m-%dT%H:%M:%SZ")}"]'
        f"[bbox:{south},{west},{north},{east}]"
        f"[out:xml][timeout:{timeout}];\n"
        f"(\n{body}\n);\n"
        f"out meta;\n"
    )


class Change:
    """Un objet touché par le diff, dans ses deux états."""

    __slots__ = ("osm_type", "osm_id", "old_tags", "new_tags", "action")

    def __init__(self, osm_type, osm_id, old_tags, new_tags, action):
        self.osm_type = osm_type
        self.osm_id = str(osm_id)
        self.old_tags = old_tags
        self.new_tags = new_tags
        self.action = action

    @property
    def reference(self) -> str:
        return f"{self.osm_type}/{self.osm_id}"

    def __repr__(self) -> str:
        return f"<{self.action} {self.reference}>"


def _tags(element: ET.Element | None) -> dict[str, str]:
    if element is None:
        return {}
    return {tag.get("k"): tag.get("v") for tag in element.findall("tag") if tag.get("k")}


def _first(parent: ET.Element | None) -> ET.Element | None:
    if parent is None:
        return None
    return next((child for child in parent if child.tag in ("node", "way", "relation")), None)


def parse_adiff(xml_text: str) -> tuple[list[Change], str | None]:
    """Les objets touchés, et jusqu'à quand OSM a été lu.

    La coupure annoncée par le serveur est aussi importante que la liste : c'est
    elle qui autorise à dire d'un jeu épargné qu'il a été vérifié, et jusqu'à
    quelle heure.
    """
    root = ET.fromstring(xml_text)
    remark = root.find("remark")
    if remark is not None and remark.text:
        raise RuntimeError(f"Overpass remark: {remark.text.strip()}")
    meta = root.find("meta")
    osm_base = meta.get("osm_base") if meta is not None else None

    changes: list[Change] = []
    for action in root.findall("action"):
        kind = action.get("type")
        if kind == "create":
            element = _first(action)
            if element is None:
                continue
            changes.append(Change(element.tag, element.get("id"), {}, _tags(element), "create"))
            continue
        if kind not in ("modify", "delete"):
            continue
        # ``or`` est proscrit ici : un Element sans enfant est falsy, et c'est
        # exactement la forme du <new> d'une suppression (``visible="false"``).
        old_element = _first(action.find("old"))
        new_element = _first(action.find("new"))
        if old_element is None:
            continue
        old_tags = _tags(old_element)
        if kind == "delete":
            # L'objet supprimé n'a plus de tags à reconnaître : c'est son dernier
            # état connu qui dit à quels jeux il appartenait, et donc lesquels
            # doivent être relus pour cesser de l'afficher.
            changes.append(Change(old_element.tag, old_element.get("id"), old_tags, {}, "delete"))
            continue
        if new_element is None:
            continue
        changes.append(
            Change(new_element.tag, new_element.get("id"), old_tags, _tags(new_element), "modify")
        )
    return changes, osm_base


def dataset_references(path: Path) -> set[str]:
    """Les objets OSM qu'un jeu affiche aujourd'hui, par ``type/id``.

    Le fichier déjà publié est le seul endroit qui sache qu'un chemin sans tag
    remarquable appartient à une véloroute : la relation le recense, le jeu en a
    gardé la trace. Sans cette lecture, le déplacement d'un sommet sur un
    itinéraire cyclable passerait inaperçu.
    """
    import json

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    references: set[str] = set()
    for feature in data.get("features") or []:
        properties = feature.get("properties") or {}
        reference = properties.get("@id")
        if isinstance(reference, str):
            references.add(reference)
        relation_ids = properties.get("relation_ids") or (
            [properties["relation_id"]] if properties.get("relation_id") else []
        )
        for relation_id in relation_ids:
            references.add(f"relation/{relation_id}")
    return references


def affected_datasets(
    changes: Iterable[Change],
    by_dataset: dict[str, list[Selector]],
    references: dict[str, set[str]] | None = None,
) -> dict[str, str]:
    """Les jeux qu'une liste de changements oblige à relire, et pourquoi.

    Trois voies mènent à la réextraction, et il en faut trois parce qu'un diff
    ne dit pas tout :

    - les tags, lus **avant et après** — sans quoi un objet qui quitte le
      périmètre d'un jeu, ou qui y entre, ne serait reconnu que d'un côté ;
    - l'appartenance : l'objet figure déjà dans le jeu publié, ce qui rattrape
      les retouches invisibles aux tags, tracé déplacé ou membre d'itinéraire
      réédité sans que l'itinéraire le soit ;
    - le territoire, qui redéfinit l'aire interrogée elle-même.
    """
    references = references or {}
    verdict: dict[str, str] = {}

    def retain(name: str, reason: str) -> None:
        verdict.setdefault(name, reason)

    for change in changes:
        tags = {**change.old_tags, **change.new_tags}
        # Le département est l'aire de dix requêtes sur onze : son tracé
        # redéfini, aucun jeu ne peut être dit intact.
        if DEPARTMENT_MARKER in tags.values():
            for name in by_dataset:
                retain(name, f"limite départementale {change.reference}")
            continue

        if any(key in tags for key in BOUNDARY_TAGS):
            for name in TERRITORY_DATASETS:
                if name in by_dataset:
                    retain(name, f"découpage territorial {change.reference}")

        for name, selectors in by_dataset.items():
            if name in verdict:
                continue
            if change.reference in references.get(name, ()):  # appartenance
                retain(name, f"objet publié {change.reference} ({change.action})")
                continue
            for selector in selectors:
                if selector.matches(change.osm_type, change.old_tags) or selector.matches(
                    change.osm_type, change.new_tags
                ):
                    retain(name, f"{change.reference} ({change.action}) ↔ {selector!r}")
                    break

    return verdict


def window_start(verified: dict[str, datetime | None], now: datetime) -> datetime | None:
    """Depuis quand interroger le diff, ou None si l'extraction complète s'impose.

    La fenêtre part de la plus ancienne vérification : si la nuit précédente a
    échoué, elle s'élargit d'elle-même et rattrape ce qu'elle avait manqué. Un
    jeu jamais vérifié, lui, n'a pas de point de départ — on ne peut rien
    affirmer d'un diff sur son compte, et c'est l'extraction complète qui
    tranche.
    """
    stamps = [moment for moment in verified.values() if moment is not None]
    if len(stamps) != len(verified) or not stamps:
        return None
    since = min(stamps) - DIFF_WINDOW_MARGIN
    if now - since > MAX_DIFF_WINDOW:
        return None
    return since
