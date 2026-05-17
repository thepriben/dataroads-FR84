# Demo Inforoute 084

Site statique de démonstration pour visualiser le réseau routier départemental du Vaucluse.

## Données Overpass

Les appels Overpass principaux sont mis en cache dans `data/osm/*.json`. Le rafraîchissement se fait avec:

```bash
python3 scripts/refresh_overpass_cache.py
```

Le script envoie un `User-Agent` explicite:

```text
demo-inforoute-084/0.1.0 (https://github.com/thepriben/demo-inforoute-084)
```

Le site reste compatible GitHub Pages: le navigateur lit d'abord les caches statiques, puis tente un fallback live seulement si un cache manque. Le fallback navigateur n'ajoute pas de `User-Agent` applicatif, car cet en-tete doit etre gere par le script serveur pour eviter les preflights CORS.

## Publication GitHub Pages

1. Creer le depot `thepriben/demo-inforoute-084`.
2. Pousser cette arborescence sur la branche `main`.
3. Dans GitHub, activer Pages avec la source `GitHub Actions`.
4. L'action `Deploy GitHub Pages` publie automatiquement le site.
5. L'action `Refresh Overpass Cache` peut etre lancee manuellement et tourne aussi chaque lundi.

## Lancement local

```bash
python3 -m http.server 8080
```

Puis ouvrir `http://localhost:8080`.
