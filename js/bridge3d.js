/**
 * @file bridge3d.js
 * @description Visionneuse 3D plein écran des ponts pour dataroads-FR84.
 *   Génère à la volée un modèle stylisé d'un pont à partir des tags OSM
 *   (type de structure, matériau, longueur, nombre de piles) et dispose les
 *   photos Panoramax / Mapillary en panneaux (billboards) autour du modèle,
 *   orbitable à la souris (Three.js + OrbitControls).
 *
 *   API publique : window.BridgeViewer3D.open(payload) / .close()
 *   Le payload est construit par app.js (buildBridge3DPayload).
 *
 * @requires THREE (global, three@0.128) et THREE.OrbitControls
 */
(function (window, document) {
    'use strict';

    const HAS_THREE = typeof window.THREE !== 'undefined';

    // ---- Petits utilitaires ----
    function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function el(id) { return document.getElementById(id); }

    // Couleur (hex int) selon le matériau OSM.
    function materialColor(material) {
        const m = String(material || '').toLowerCase();
        if (m.includes('stone') || m.includes('pierre')) return 0xbcab8d;
        if (m.includes('concrete') || m.includes('béton') || m.includes('beton')) return 0xb7bcc1;
        if (m.includes('brick') || m.includes('brique')) return 0xa1604a;
        if (m.includes('steel') || m.includes('metal') || m.includes('iron') || m.includes('acier')) return 0x8e9aa8;
        if (m.includes('wood') || m.includes('bois')) return 0x9c7b4f;
        return 0xb3a78c;
    }

    // Type de structure normalisé pour choisir le générateur.
    function structureKind(payload) {
        const s = String(payload.structure || '').toLowerCase();
        const b = String(payload.bridgeTag || '').toLowerCase();
        const name = String(payload.title || '').toLowerCase();
        // Aqueduc : ouvrage élancé portant un canal d'eau — distinct de l'arche routière.
        if (b === 'aqueduct' || s.includes('aqueduc') || /\baqueduc/.test(name)) return 'aqueduct';
        if (s.includes('suspension') || s.includes('cable')) return 'suspension';
        if (s.includes('truss') || s.includes('treillis')) return 'truss';
        if (s.includes('arch') || s.includes('humpback') || b === 'viaduct') return 'arch';
        if (s.includes('beam') || s.includes('girder') || s.includes('slab')) return 'beam';
        return 'beam';
    }

    // Nombre de travées / arches déduit (Wikidata -> piles -> longueur -> défaut).
    function deriveSpanCount(payload, kind, L) {
        if (payload.spanCountHint && payload.spanCountHint > 0) {
            return clamp(Math.round(payload.spanCountHint), 1, 30);
        }
        if (payload.pillarCount && payload.pillarCount > 0) {
            return clamp(payload.pillarCount + 1, 1, 24);
        }
        const archLike = kind === 'arch' || kind === 'aqueduct';
        const typicalSpan = archLike ? 18 : kind === 'truss' ? 30 : 26;
        const est = Math.round(L / typicalSpan);
        return clamp(est, archLike ? 2 : 1, archLike ? 18 : 8);
    }

    // ================= État du moteur 3D (réutilisé entre ouvertures) =================
    const S = {
        ready: false,
        renderer: null,
        scene: null,
        camera: null,
        controls: null,
        root: null,          // groupe du modèle + photos (recréé à chaque ouverture)
        photoMeshes: [],     // meshes cliquables (plans photo)
        raycaster: null,
        pointer: null,
        hovered: null,
        animId: null,
        resizeObs: null,
        model: null,         // { deckY, L, W }
        focus: null,         // { camFrom, camTo, tgtFrom, tgtTo, t } animation
        payload: null,
        textureCache: new Map(),
        mapillaryThumb: new Map(),
        photoMeta: new Map(),
        wikidataCache: new Map()
    };

    function token() {
        return (window.APP_CONFIG && window.APP_CONFIG.mapillary && window.APP_CONFIG.mapillary.accessToken) || '';
    }

    // ---- Wikidata (enrichit le modèle quand OSM est lacunaire) ----
    // Récupère type de structure (P31), matériau (P186), nombre de travées (P1314),
    // longueur (P2043) et largeur (P2049), avec libellés FR/EN pour interprétation.
    function wikidataBridgeInfo(qid) {
        if (S.wikidataCache.has(qid)) return S.wikidataCache.get(qid);
        const url = `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(qid)}.json`;
        const p = fetch(url, { credentials: 'omit' })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                const ent = data && data.entities && data.entities[qid];
                if (!ent || !ent.claims) return null;
                const claims = ent.claims;
                const getQids = (pid) => (claims[pid] || [])
                    .map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id)
                    .filter(Boolean);
                const getQty = (pid) => {
                    const c = (claims[pid] || [])[0];
                    const v = c && c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
                    if (!v || v.amount == null) return null;
                    const n = parseFloat(v.amount);
                    return Number.isFinite(n) ? n : null;
                };
                const typeQids = getQids('P31');
                const matQids = getQids('P186');
                // Libellé (nom) de l'entité, FR puis EN.
                const labels = ent.labels || {};
                const label = (labels.fr && labels.fr.value) || (labels.en && labels.en.value) || '';
                // Image (P18) -> nom de fichier Commons.
                const imgClaim = (claims.P18 || [])[0];
                const image = (imgClaim && imgClaim.mainsnak && imgClaim.mainsnak.datavalue && imgClaim.mainsnak.datavalue.value) || '';
                // Mise en service / création (P571) -> année.
                let inceptionYear = null;
                const tClaim = (claims.P571 || [])[0];
                const tVal = tClaim && tClaim.mainsnak && tClaim.mainsnak.datavalue && tClaim.mainsnak.datavalue.value;
                if (tVal && tVal.time) {
                    const m = String(tVal.time).match(/^([+-])(\d{1,4})/);
                    if (m) inceptionYear = (m[1] === '-' ? -1 : 1) * parseInt(m[2], 10);
                }
                const base = {
                    spans: getQty('P1314'), length: getQty('P2043'), width: getQty('P2049'),
                    height: getQty('P2048'), label, image, inceptionYear, typeStr: '', matStr: ''
                };
                const need = typeQids.concat(matQids);
                if (!need.length) return base;
                const params = `action=wbgetentities&ids=${encodeURIComponent(need.join('|'))}&props=labels&languages=fr|en&format=json&origin=*`;
                return fetch(`https://www.wikidata.org/w/api.php?${params}`, { credentials: 'omit' })
                    .then(r => r.ok ? r.json() : null)
                    .then(lab => {
                        const labelOf = (q) => {
                            const e = lab && lab.entities && lab.entities[q];
                            const ls = e && e.labels;
                            return (ls && ((ls.fr && ls.fr.value) || (ls.en && ls.en.value))) || '';
                        };
                        base.typeStr = typeQids.map(labelOf).join(' ');
                        base.matStr = matQids.map(labelOf).join(' ');
                        return base;
                    })
                    .catch(() => base);
            })
            .catch(() => null);
        S.wikidataCache.set(qid, p);
        return p;
    }

    // Traduit un libellé de type Wikidata en mot-clé reconnu par structureKind.
    function structureFromLabel(label) {
        const t = String(label || '').toLowerCase();
        if (t.includes('susp') || t.includes('cable') || t.includes('câble') || t.includes('hauban')) return 'suspension';
        if (t.includes('treillis') || t.includes('truss')) return 'truss';
        if (t.includes('aqueduc') || t.includes('aqueduct')) return 'aqueduc';
        if (t.includes('arch') || t.includes('arc') || t.includes('voûte') || t.includes('voute')) return 'arch';
        if (t.includes('poutre') || t.includes('beam') || t.includes('girder') || t.includes('dalle') || t.includes('slab')) return 'beam';
        return '';
    }

    // ---- Textures ----
    function loadTexture(url, onLoad) {
        if (!url) return null;
        if (S.textureCache.has(url)) {
            const t = S.textureCache.get(url);
            if (t && onLoad) onLoad(t);
            return t;
        }
        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin('anonymous');
        const tex = loader.load(
            url,
            (t) => { t.needsUpdate = true; if (onLoad) onLoad(t); },
            undefined,
            () => { /* échec (CORS / 404) : on garde le placeholder coloré */ }
        );
        S.textureCache.set(url, tex);
        return tex;
    }

    // Récupère l'URL d'une vignette Mapillary via la Graph API (jeton requis).
    function mapillaryThumbUrl(id) {
        if (S.mapillaryThumb.has(id)) return Promise.resolve(S.mapillaryThumb.get(id));
        const tk = token();
        if (!tk) return Promise.resolve(null);
        const url = `https://graph.mapillary.com/${encodeURIComponent(id)}?access_token=${encodeURIComponent(tk)}&fields=thumb_1024_url`;
        return fetch(url, { credentials: 'omit' })
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                const u = d && d.thumb_1024_url ? d.thumb_1024_url : null;
                S.mapillaryThumb.set(id, u);
                return u;
            })
            .catch(() => null);
    }

    // ================= Helpers géométrie =================
    function addBox(parent, w, h, d, x, y, z, mat) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.set(x, y, z);
        parent.add(mesh);
        return mesh;
    }

    // Arche en demi-anneau extrudée (pierre).
    function makeArchMesh(spanW, rise, depth, mat) {
        const R = spanW / 2;
        const r = Math.max(R * 0.74, R - Math.min(1.4, R * 0.3));
        const shape = new THREE.Shape();
        shape.moveTo(R, 0);
        shape.absarc(0, 0, R, 0, Math.PI, false);
        shape.lineTo(-r, 0);
        shape.absarc(0, 0, r, Math.PI, 0, true);
        shape.lineTo(R, 0);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: false });
        geo.translate(0, 0, -depth / 2);
        // L'arc monte en +Y ; on l'aplatit légèrement si rise < R.
        const mesh = new THREE.Mesh(geo, mat);
        if (rise && rise !== R) mesh.scale.y = rise / R;
        return mesh;
    }

    // ================= Générateurs de modèles =================
    function buildModel(payload) {
        const root = new THREE.Group();
        const kind = structureKind(payload);
        // L suit la longueur réelle de l'axe (plafond large) pour que le modèle
        // s'aligne sur l'emprise du pont sur la carte 2D, sans décalage longitudinal.
        const L = clamp(payload.axisLengthM || 40, 12, 1500);
        const W = clamp(
            payload.widthM || (kind === 'truss' ? 9 : kind === 'aqueduct' ? 4 : 8),
            kind === 'aqueduct' ? 2.5 : 4,
            22
        );
        const baseColor = materialColor(payload.material);
        const stone = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.9, metalness: 0.04 });
        const metal = new THREE.MeshStandardMaterial({ color: 0x788596, roughness: 0.5, metalness: 0.55 });
        const deckMat = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.85, metalness: 0.05 });

        const deckThickness = clamp(W * 0.14, 0.7, 2.2);
        let deckY;

        if (kind === 'arch') {
            const n = deriveSpanCount(payload, kind, L);
            const spanW = L / n;
            const rise = clamp(spanW * 0.5, 2.5, 16);
            const deckBottom = rise;
            deckY = deckBottom + deckThickness / 2;
            const archDepth = W * 0.7;
            for (let i = 0; i < n; i++) {
                const cx = -L / 2 + spanW * (i + 0.5);
                const arch = makeArchMesh(spanW * 0.96, rise, archDepth, stone);
                arch.position.set(cx, 0, 0);
                root.add(arch);
            }
            // Piles fines entre arches + culées aux extrémités.
            const pierW = clamp(spanW * 0.1, 0.6, 3);
            for (let i = 0; i <= n; i++) {
                const px = -L / 2 + spanW * i;
                const isEnd = (i === 0 || i === n);
                const w = isEnd ? pierW * 2.2 : pierW;
                addBox(root, w, deckBottom, W * 0.72, px, deckBottom / 2, 0, stone);
            }
            addBox(root, L, deckThickness, W, 0, deckY, 0, deckMat);
        } else if (kind === 'aqueduct') {
            // Aqueduc : arches portées en hauteur par des piédroits élancés,
            // surmontées d'un canal d'eau (specus) entre deux parapets.
            const n = deriveSpanCount(payload, 'arch', L);
            const spanW = L / n;
            const rise = clamp(spanW * 0.5, 2.5, 14);
            // Hauteur des piédroits sous les arches (Wikidata P2048 si dispo, sinon élancé).
            const pierBottom = clamp(payload.heightM ? payload.heightM - rise : rise * 2.4, rise + 1.5, 42);
            const archTop = pierBottom + rise;
            deckY = archTop + deckThickness / 2;
            const archDepth = W * 0.85;
            for (let i = 0; i < n; i++) {
                const cx = -L / 2 + spanW * (i + 0.5);
                const arch = makeArchMesh(spanW * 0.96, rise, archDepth, stone);
                arch.position.set(cx, pierBottom, 0);
                root.add(arch);
            }
            // Piédroits hauts entre arches + culées massives aux extrémités.
            const pierW = clamp(spanW * 0.16, 0.8, 4);
            for (let i = 0; i <= n; i++) {
                const px = -L / 2 + spanW * i;
                const isEnd = (i === 0 || i === n);
                const w = isEnd ? pierW * 1.7 : pierW;
                addBox(root, w, archTop, W * 0.8, px, archTop / 2, 0, stone);
            }
            // Plateforme support sous le canal.
            addBox(root, L, deckThickness, W, 0, deckY, 0, stone);
            // Canal d'eau : deux parapets de pierre + lame d'eau bleue.
            const channelW = clamp(W * 0.5, 1.2, 5);
            const wallH = clamp(W * 0.4, 0.9, 2.6);
            const wallT = clamp(W * 0.13, 0.3, 1);
            const wallY = deckY + deckThickness / 2 + wallH / 2;
            const wallZ = channelW / 2 + wallT / 2;
            addBox(root, L, wallH, wallT, 0, wallY, wallZ, stone);
            addBox(root, L, wallH, wallT, 0, wallY, -wallZ, stone);
            const water = new THREE.MeshStandardMaterial({ color: 0x2f7fd0, roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.85 });
            addBox(root, L, 0.22, channelW, 0, deckY + deckThickness / 2 + wallH * 0.45, 0, water);
        } else if (kind === 'suspension') {
            const deckBottom = clamp(L * 0.07, 3, 12);
            deckY = deckBottom + deckThickness / 2;
            addBox(root, L, deckThickness, W, 0, deckY, 0, deckMat);
            const towerX = L * 0.24;
            const towerTopY = deckY + clamp(L * 0.16, 8, 46);
            const legZ = W / 2 - Math.min(0.8, W * 0.08);
            const legW = clamp(W * 0.12, 0.6, 2.2);
            [-towerX, towerX].forEach(tx => {
                [-legZ, legZ].forEach(tz => addBox(root, legW, towerTopY, legW, tx, towerTopY / 2, tz, metal));
                // entretoise en haut
                addBox(root, legW, legW, W, tx, towerTopY, 0, metal);
            });
            // Câbles principaux (caténaire) des extrémités du tablier au sommet des pylônes.
            [-legZ, legZ].forEach(cz => {
                const pts = [
                    new THREE.Vector3(-L / 2, deckY, cz),
                    new THREE.Vector3(-towerX, towerTopY, cz),
                    new THREE.Vector3(0, towerTopY - clamp(L * 0.06, 3, 18), cz),
                    new THREE.Vector3(towerX, towerTopY, cz),
                    new THREE.Vector3(L / 2, deckY, cz)
                ];
                const curve = new THREE.CatmullRomCurve3(pts);
                const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, clamp(W * 0.03, 0.12, 0.45), 8, false), metal);
                root.add(tube);
                // Suspentes verticales.
                const hangers = clamp(Math.round(L / 6), 6, 40);
                for (let i = 1; i < hangers; i++) {
                    const u = i / hangers;
                    const p = curve.getPoint(u);
                    if (p.y <= deckY + 0.5) continue;
                    addBox(root, 0.12, p.y - deckY, 0.12, p.x, (p.y + deckY) / 2, cz, metal);
                }
            });
        } else if (kind === 'truss') {
            const deckBottom = clamp(L * 0.09, 3, 12);
            deckY = deckBottom + deckThickness / 2;
            addBox(root, L, deckThickness, W, 0, deckY, 0, deckMat);
            // Piles
            const nP = deriveSpanCount(payload, 'beam', L) + 1;
            const spanW = L / (nP - 1 || 1);
            for (let i = 0; i < nP; i++) {
                const px = -L / 2 + spanW * i;
                addBox(root, clamp(W * 0.2, 1, 3), deckBottom, W * 0.6, px, deckBottom / 2, 0, stone);
            }
            // Treillis latéraux
            const trussH = clamp(W * 0.7, 2.5, 7);
            const seg = clamp(Math.round(L / (trussH * 1.3)), 4, 36);
            const segW = L / seg;
            const memW = 0.18;
            [-W / 2, W / 2].forEach(tz => {
                // membrures haute et basse
                addBox(root, L, memW * 1.6, memW * 1.6, 0, deckY + trussH, tz, metal);
                addBox(root, L, memW * 1.6, memW * 1.6, 0, deckY + deckThickness / 2, tz, metal);
                for (let i = 0; i < seg; i++) {
                    const x0 = -L / 2 + segW * i;
                    // montant vertical
                    addBox(root, memW, trussH, memW, x0, deckY + trussH / 2, tz, metal);
                    // diagonale (cylindre incliné)
                    const x1 = x0 + segW;
                    const dx = x1 - x0;
                    const len = Math.sqrt(dx * dx + trussH * trussH);
                    const diag = new THREE.Mesh(new THREE.CylinderGeometry(memW * 0.6, memW * 0.6, len, 6), metal);
                    diag.position.set((x0 + x1) / 2, deckY + trussH / 2, tz);
                    diag.rotation.z = (i % 2 === 0 ? 1 : -1) * Math.atan2(dx, trussH);
                    root.add(diag);
                }
                // dernier montant
                addBox(root, memW, trussH, memW, L / 2, deckY + trussH / 2, tz, metal);
            });
        } else {
            // beam / défaut : tablier + piles régulières
            const n = deriveSpanCount(payload, 'beam', L);
            const deckBottom = clamp(L * 0.1, 2.5, 12);
            deckY = deckBottom + deckThickness / 2;
            const nP = n + 1;
            const spanW = L / (nP - 1 || 1);
            for (let i = 0; i < nP; i++) {
                const px = -L / 2 + spanW * i;
                addBox(root, clamp(W * 0.24, 1, 3.2), deckBottom, W * 0.6, px, deckBottom / 2, 0, stone);
            }
            addBox(root, L, deckThickness, W, 0, deckY, 0, deckMat);
        }

        S.model = { deckY, L, W };
        return root;
    }

    // ================= Photos (billboards) =================
    const M_PER_DEG = 111320;

    // Convertit une géoloc (lat,lng) en coordonnées scène nord-haut centrées sur le pont :
    // X = est (m), Z = -nord (m). On borne pour éviter les points GPS aberrants.
    function geoToLocal(lat, lng, payload, L) {
        const latRad = (payload.centerLat || 0) * Math.PI / 180;
        const east = (lng - payload.centerLng) * Math.cos(latRad) * M_PER_DEG;
        const north = (lat - payload.centerLat) * M_PER_DEG;
        const lim = Math.max(L * 1.2, 60);
        return { x: clamp(east, -lim, lim), z: clamp(-north, -lim, lim) };
    }

    function cardinal(deg) {
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
        return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
    }

    // Récupère (avec cache) la géoloc + l'azimut (+ vignette) d'une photo.
    function fetchPhotoMeta(photo) {
        if (S.photoMeta.has(photo.key)) return S.photoMeta.get(photo.key);
        let p;
        if (photo.provider === 'mapillary') {
            const tk = token();
            if (!tk) {
                p = Promise.resolve(null);
            } else {
                const url = `https://graph.mapillary.com/${encodeURIComponent(photo.id)}?access_token=${encodeURIComponent(tk)}&fields=geometry,compass_angle,thumb_1024_url`;
                p = fetch(url, { credentials: 'omit' })
                    .then(r => r.ok ? r.json() : null)
                    .then(d => {
                        if (!d || !d.geometry || !d.geometry.coordinates) return null;
                        const c = d.geometry.coordinates;
                        return {
                            lng: c[0], lat: c[1],
                            azimuth: typeof d.compass_angle === 'number' ? d.compass_angle : null,
                            thumbUrl: d.thumb_1024_url || null
                        };
                    })
                    .catch(() => null);
            }
        } else {
            const url = `https://api.panoramax.xyz/api/search?ids=${encodeURIComponent(photo.id)}&limit=1`;
            p = fetch(url, { credentials: 'omit' })
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                    const f = d && d.features && d.features[0];
                    if (!f || !f.geometry || !f.geometry.coordinates) return null;
                    const c = f.geometry.coordinates;
                    const az = f.properties && f.properties['view:azimuth'];
                    return {
                        lng: c[0], lat: c[1],
                        azimuth: typeof az === 'number' ? az : null,
                        thumbUrl: photo.textureUrl || null
                    };
                })
                .catch(() => null);
        }
        S.photoMeta.set(photo.key, p);
        return p;
    }

    function removePhotoExtras(plane) {
        if (!plane.userData.extras) return;
        plane.userData.extras.forEach(o => {
            S.root.remove(o);
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
        });
        plane.userData.extras = [];
    }

    // Positionne et oriente un panneau photo. La face « image » est tournée vers
    // l'extérieur (visible quand on tourne autour du pont) ; le dos coloré fait
    // face au pont. Ajoute un marqueur au sol (lieu de prise de vue) et un mât.
    function placePhoto(plane, x, y, z, azimuth, payload) {
        plane.position.set(x, y, z);
        // Direction extérieure (du centre du pont vers le lieu de prise de vue).
        let ox = x, oz = z;
        if (ox * ox + oz * oz < 1e-4) { ox = 0; oz = 1; }
        plane.lookAt(x + ox, y, z + oz);
        plane.userData.basePos = new THREE.Vector3(x, y, z);

        removePhotoExtras(plane);
        const col = plane.userData.providerCol;
        const extras = [];
        // Le mât s'arrête sous le bas de la photo et reste légèrement en retrait
        // (vers le pont) pour ne jamais traverser l'image.
        const halfH = plane.userData.halfH || 2;
        const bottom = y - halfH;
        let nx = x, nz = z;
        const len = Math.hypot(nx, nz) || 1; nx /= len; nz /= len;
        const bx = x - nx * 0.35, bz = z - nz * 0.35;
        if (bottom > 0.3) {
            const conn = new THREE.Mesh(
                new THREE.CylinderGeometry(0.06, 0.06, bottom, 6),
                new THREE.MeshBasicMaterial({ color: col })
            );
            conn.position.set(bx, bottom / 2, bz);
            S.root.add(conn);
            extras.push(conn);
        }
        const dot = new THREE.Mesh(
            new THREE.SphereGeometry(0.55, 10, 10),
            new THREE.MeshBasicMaterial({ color: col })
        );
        dot.position.set(x, 0.1, z);
        S.root.add(dot);
        extras.push(dot);
        plane.userData.extras = extras;
    }

    function buildPhotos(payload) {
        S.photoMeshes = [];
        if (!Array.isArray(payload.photos) || !payload.photos.length) return;
        const { deckY, L, W } = S.model;
        // Photos plus petites, posées à hauteur de prise de vue (niveau caméra ~2-3 m).
        const planeW = clamp(L / 10, 2.5, 6);
        const planeH = planeW * 0.72;
        const outZ = W / 2 + clamp(W * 0.9, 5, 12);
        const photoY = Math.max(2.4, planeH * 0.55);
        const hasGeo = payload.centerLat != null && payload.centerLng != null;
        // Vecteurs d'axe (monde) pour aligner le repli OSM sur le cap réel du pont.
        const theta = (payload.axisBearingDeg || 0) * Math.PI / 180;
        const along = { x: Math.sin(theta), z: -Math.cos(theta) };
        const perp = { x: Math.cos(theta), z: Math.sin(theta) };

        // Pour le repli OSM : empilage par (côté, position arrondie).
        const slotCount = new Map();

        payload.photos.forEach((photo, index) => {
            // Couleur du dos (face vers le pont) : vert Mapillary, gris clair Panoramax.
            const providerCol = photo.provider === 'mapillary' ? 0x2e9d57 : 0xd9dee5;

            // La photo n'est visible que sur la face extérieure ; le dos montre le cadre coloré.
            const mat = new THREE.MeshBasicMaterial({ color: 0x223043, side: THREE.FrontSide });
            const plane = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), mat);
            const frame = new THREE.Mesh(
                new THREE.PlaneGeometry(planeW + 0.5, planeH + 0.5),
                new THREE.MeshBasicMaterial({ color: providerCol, side: THREE.DoubleSide })
            );
            frame.position.z = -0.06;
            plane.add(frame);
            // Pastille couleur de rôle (pile, culée, tablier…) au coin de la photo.
            const dotR = planeW * 0.08;
            const roleDot = new THREE.Mesh(
                new THREE.CircleGeometry(dotR, 16),
                new THREE.MeshBasicMaterial({ color: new THREE.Color(photo.roleColor || '#7F8C8D'), side: THREE.DoubleSide })
            );
            roleDot.position.set(planeW / 2 - dotR * 1.5, planeH / 2 - dotR * 1.5, 0.03);
            roleDot.userData.baseR = dotR;
            plane.add(roleDot);
            plane.userData = { photo, index, providerCol, halfH: planeH / 2, basePos: new THREE.Vector3(), roleDot, planeH };
            S.root.add(plane);
            S.photoMeshes.push(plane);

            // Position de repli (OSM) en attendant la géoloc réelle.
            const ft = typeof photo.fallbackT === 'number' ? photo.fallbackT : 0.5;
            const fside = photo.fallbackSide < 0 ? -1 : 1;
            const slotKey = `${fside}|${Math.round(ft * 8)}`;
            const ring = slotCount.get(slotKey) || 0;
            slotCount.set(slotKey, ring + 1);
            const d = (ft - 0.5) * L, off = fside * outZ;
            const fx = along.x * d + perp.x * off;
            const fz = along.z * d + perp.z * off;
            placePhoto(plane, fx, photoY + ring * (planeH + 0.8), fz, null, payload);

            // Texture immédiate pour Panoramax.
            if (photo.provider === 'panoramax' && photo.textureUrl) {
                plane.userData.imageUrl = photo.textureUrl;
                applyTexture(plane, photo.textureUrl, planeW, planeH);
            }

            // Métadonnée réelle : repositionne + oriente selon le lieu/azimut de prise de vue.
            fetchPhotoMeta(photo).then(meta => {
                if (!plane.parent) return; // scène fermée entre-temps
                if (meta && hasGeo && meta.lat != null) {
                    const loc = geoToLocal(meta.lat, meta.lng, payload, L);
                    placePhoto(plane, loc.x, photoY, loc.z, meta.azimuth, payload);
                    plane.userData.meta = meta;
                }
                const turl = meta && meta.thumbUrl ? meta.thumbUrl : photo.textureUrl;
                if (turl) { plane.userData.imageUrl = turl; applyTexture(plane, turl, planeW, planeH); }
            });
        });
    }

    function applyTexture(plane, url, planeW, planeH) {
        loadTexture(url, (tex) => {
            if (!plane.material) return;
            plane.material.map = tex;
            plane.material.color.set(0xffffff);
            plane.material.needsUpdate = true;
            // Ajuste le ratio du plan à l'image si dispo.
            if (tex.image && tex.image.width && tex.image.height) {
                const ar = tex.image.width / tex.image.height;
                const targetH = planeW / ar;
                const sy = targetH / planeH;
                plane.scale.set(1, sy, 1);
                // Compense l'échelle Y du panneau pour que la pastille reste ronde
                // et reste calée dans le coin haut de l'image.
                const rd = plane.userData && plane.userData.roleDot;
                if (rd && sy > 0) {
                    const r = rd.userData.baseR || 0;
                    rd.scale.y = 1 / sy;
                    rd.position.y = planeH / 2 - (r * 1.5) / sy;
                }
            }
        });
    }

    // ================= Scène / moteur =================
    function ensureEngine() {
        if (S.ready) return true;
        if (!HAS_THREE) return false;
        const wrap = el('bridge3dCanvasWrap');
        if (!wrap) return false;

        try {
            S.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        } catch (e) {
            console.warn('BridgeViewer3D: WebGL indisponible', e);
            return false;
        }
        S.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        if ('outputEncoding' in S.renderer) S.renderer.outputEncoding = THREE.sRGBEncoding;
        wrap.appendChild(S.renderer.domElement);

        S.scene = new THREE.Scene();
        S.scene.background = new THREE.Color(0x0c1422);

        S.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 5000);

        S.controls = new THREE.OrbitControls(S.camera, S.renderer.domElement);
        S.controls.enableDamping = true;
        S.controls.dampingFactor = 0.08;
        S.controls.rotateSpeed = 0.7;

        const hemi = new THREE.HemisphereLight(0xdfeaff, 0x2a3142, 0.95);
        S.scene.add(hemi);
        const dir = new THREE.DirectionalLight(0xffffff, 0.85);
        dir.position.set(1, 1.4, 0.8);
        S.scene.add(dir);

        S.raycaster = new THREE.Raycaster();
        S.pointer = new THREE.Vector2();

        const dom = S.renderer.domElement;
        dom.addEventListener('pointermove', onPointerMove);
        dom.addEventListener('click', onClick);

        S.resizeObs = new ResizeObserver(() => resize());
        S.resizeObs.observe(wrap);

        S.ready = true;
        return true;
    }

    function resize() {
        const wrap = el('bridge3dCanvasWrap');
        if (!wrap || !S.renderer || !S.camera) return;
        const w = wrap.clientWidth || 1;
        const h = wrap.clientHeight || 1;
        S.renderer.setSize(w, h, false);
        S.camera.aspect = w / h;
        S.camera.updateProjectionMatrix();
    }

    function disposeObject(obj) {
        obj.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                // Note : on ne dispose pas .map (textures mises en cache et réutilisées
                // entre ouvertures) ; seul le matériau est libéré.
                mats.forEach(m => m.dispose());
            }
        });
    }

    function clearRoot() {
        if (S.root) {
            S.scene.remove(S.root);
            disposeObject(S.root);
            S.root = null;
        }
        if (S.mapTex) { S.mapTex.dispose(); S.mapTex = null; }
        S.mapPlane = null;
        S.photoMeshes = [];
        S.hovered = null;
        S.focus = null;
        S.focusIndex = null;
    }

    // --- Tuiles web-mercator (fond de carte 2D) ---
    function lon2tile(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
    function lat2tile(lat, z) { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z); }
    function tile2lon(x, z) { return x / Math.pow(2, z) * 360 - 180; }
    function tile2lat(y, z) { const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }

    // Fond de carte 2D (CartoDB Voyager) sous le pont : on voit fleuves et voiries.
    // Le plan-carte est ajouté tout de suite et se remplit au fil des tuiles ; les
    // tuiles manquantes restent en beige (fond neutre). Repère nord-haut.
    function buildGroundMap(payload) {
        const root = S.root;
        const { L } = S.model;
        // Plan de sol neutre (beige) large, sous la carte (visible au-delà de l'emprise
        // des tuiles). Nettement plus bas que le plan-carte pour éviter le z-fighting.
        const fallback = new THREE.Mesh(
            new THREE.PlaneGeometry(L * 3.5, L * 3.5),
            new THREE.MeshBasicMaterial({ color: 0xe8e1d3 })
        );
        fallback.rotation.x = -Math.PI / 2;
        fallback.position.y = -2;
        root.add(fallback);

        if (payload.centerLat == null || payload.centerLng == null || typeof document === 'undefined') return;

        const lat = payload.centerLat, lng = payload.centerLng;
        const latRad = lat * Math.PI / 180;
        const half = Math.max(L * 1.6, 140);
        const targetMpp = (half * 2) / 1024;
        let z = Math.round(Math.log2(156543.03392 * Math.cos(latRad) / targetMpp));
        z = clamp(z, 13, 19);
        const worldMpp = 156543.03392 * Math.cos(latRad) / Math.pow(2, z);
        const metersPerTile = worldMpp * 256;
        const halfTiles = half / metersPerTile;
        const cTX = lon2tile(lng, z), cTY = lat2tile(lat, z);
        const minTX = Math.floor(cTX - halfTiles), maxTX = Math.floor(cTX + halfTiles);
        const minTY = Math.floor(cTY - halfTiles), maxTY = Math.floor(cTY + halfTiles);
        const cols = maxTX - minTX + 1, rows = maxTY - minTY + 1;
        if (cols > 8 || rows > 8 || cols < 1 || rows < 1) return;

        const canvas = document.createElement('canvas');
        canvas.width = cols * 256; canvas.height = rows * 256;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#e8e1d3';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const tex = new THREE.CanvasTexture(canvas);

        const leftLng = tile2lon(minTX, z), rightLng = tile2lon(maxTX + 1, z);
        const topLat = tile2lat(minTY, z), botLat = tile2lat(maxTY + 1, z);
        const eastL = (leftLng - lng) * Math.cos(latRad) * M_PER_DEG;
        const eastR = (rightLng - lng) * Math.cos(latRad) * M_PER_DEG;
        const northT = (topLat - lat) * M_PER_DEG;
        const northB = (botLat - lat) * M_PER_DEG;
        const widthM = eastR - eastL, heightM = northT - northB;
        const cx = (eastL + eastR) / 2, cn = (northT + northB) / 2;

        const mapMat = new THREE.MeshBasicMaterial({ map: tex });
        // polygonOffset : pousse légèrement la carte en profondeur pour qu'elle
        // gagne sans hésiter contre l'eau / le sol (anti-scintillement).
        mapMat.polygonOffset = true;
        mapMat.polygonOffsetFactor = -1;
        mapMat.polygonOffsetUnits = -1;
        const mapPlane = new THREE.Mesh(new THREE.PlaneGeometry(widthM, heightM), mapMat);
        mapPlane.rotation.x = -Math.PI / 2;
        mapPlane.position.set(cx, -0.05, -cn);
        mapPlane.renderOrder = -1;
        S.mapPlane = mapPlane;
        S.mapTex = tex;
        // Ajout immédiat : on n'attend pas toutes les tuiles. Les manquantes
        // restent simplement beiges, la carte s'affiche dans tous les cas.
        root.add(mapPlane);

        const subs = ['a', 'b', 'c'];
        for (let ty = minTY; ty <= maxTY; ty++) {
            for (let tx = minTX; tx <= maxTX; tx++) {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                const px = (tx - minTX) * 256, py = (ty - minTY) * 256;
                img.onload = () => {
                    if (root !== S.root) return; // scène reconstruite entre-temps
                    try { ctx.drawImage(img, px, py, 256, 256); tex.needsUpdate = true; } catch (e) { /* tuile contaminée : on garde le beige */ }
                };
                img.onerror = () => { /* 404 : la tuile reste beige */ };
                img.src = `https://${subs[((tx % 3) + (ty % 3)) % 3]}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${tx}/${ty}.png`;
            }
        }
    }

    function buildScene(payload) {
        clearRoot();
        S.root = new THREE.Group();
        const model = buildModel(payload);
        // Oriente le modèle selon le cap réel de l'axe (repère nord-haut du sol).
        const theta = ((payload.axisBearingDeg || 0)) * Math.PI / 180;
        model.rotation.y = Math.PI / 2 - theta;
        S.root.add(model);
        buildPhotos(payload);
        buildGroundMap(payload);

        S.scene.add(S.root);

        const { L } = S.model;

        // Caméra initiale.
        const deckY = S.model.deckY;
        S.controls.target.set(0, deckY * 0.6, 0);
        S.camera.position.set(L * 0.55, Math.max(deckY + L * 0.32, L * 0.42), L * 0.85);
        S.controls.minDistance = L * 0.18;
        S.controls.maxDistance = L * 4;
        // far adapté à la longueur (modèle + carte) pour éviter le clipping.
        S.camera.far = Math.max(5000, L * 9);
        S.camera.updateProjectionMatrix();
        S.controls.update();
        resize();
    }

    function startLoop() {
        if (S.animId) return;
        const tick = () => {
            S.animId = requestAnimationFrame(tick);
            if (S.focus) stepFocus();
            if (S.controls) S.controls.update();
            if (S.renderer && S.scene && S.camera) {
                try {
                    S.renderer.render(S.scene, S.camera);
                } catch (e) {
                    // Garde-fou : si une texture de tuile contamine le canvas (CORS),
                    // on retire le fond de carte et on poursuit le rendu.
                    if (S.mapPlane && S.root) { S.root.remove(S.mapPlane); S.mapPlane = null; }
                }
            }
        };
        tick();
    }

    function stopLoop() {
        if (S.animId) { cancelAnimationFrame(S.animId); S.animId = null; }
    }

    // ---- Interactions ----
    function updatePointer(ev) {
        const rect = S.renderer.domElement.getBoundingClientRect();
        S.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        S.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function pickPhoto(ev) {
        if (!S.photoMeshes.length) return null;
        updatePointer(ev);
        S.raycaster.setFromCamera(S.pointer, S.camera);
        const hits = S.raycaster.intersectObjects(S.photoMeshes, false);
        return hits.length ? hits[0].object : null;
    }

    function onPointerMove(ev) {
        const obj = pickPhoto(ev);
        if (obj !== S.hovered) {
            if (S.hovered) S.hovered.scale.multiplyScalar(1 / 1.06);
            S.hovered = obj;
            if (S.hovered) S.hovered.scale.multiplyScalar(1.06);
            S.renderer.domElement.style.cursor = obj ? 'pointer' : 'grab';
        }
    }

    // Grand aperçu 2D de la photo, superposé à la scène.
    function showPreview(plane) {
        const box = el('bridge3dPreview');
        if (!box || !plane) return;
        const url = plane.userData.imageUrl;
        if (!url) { hidePreview(); return; }
        if (box.dataset.url !== url) {
            const photo = plane.userData.photo || {};
            const meta = plane.userData.meta;
            const az = meta && typeof meta.azimuth === 'number' ? ` · vue vers ${cardinal(meta.azimuth)} (${Math.round(meta.azimuth)}°)` : '';
            const roleDot = photo.roleColor ? `<span class="bridge3d-role-dot" style="background:${escapeHtml(photo.roleColor)}"></span>` : '';
            const roleTxt = photo.roleLabel ? `${roleDot}${escapeHtml(photo.roleLabel)} · ` : '';
            box.dataset.url = url;
            box.innerHTML =
                `<img src="${escapeHtml(url)}" alt="" loading="lazy">`
                + `<div class="bridge3d-preview-cap">${roleTxt}${escapeHtml(photo.providerLabel || photo.provider || 'Photo')}${escapeHtml(az)}</div>`;
        }
        box.style.display = 'block';
    }

    function hidePreview() {
        const box = el('bridge3dPreview');
        if (box) { box.style.display = 'none'; box.dataset.url = ''; }
    }

    function onClick(ev) {
        const obj = pickPhoto(ev);
        if (obj && obj.userData) focusPhoto(obj.userData.index);
        else deselectPhoto();
    }

    // Atténue (et rend non occultantes) les photos autres que celle ciblée, pour
    // qu'une photo voisine ne masque pas celle qu'on veut regarder.
    function setPhotoDim(plane, dim) {
        const mats = [plane.material];
        plane.children.forEach(c => { if (c.material) mats.push(c.material); });
        (plane.userData.extras || []).forEach(e => { if (e.material) mats.push(e.material); });
        mats.forEach(m => { m.transparent = dim; m.opacity = dim ? 0.1 : 1; m.depthWrite = !dim; });
    }

    function dimOtherPhotos(exceptIndex) {
        S.photoMeshes.forEach(p => setPhotoDim(p, p.userData.index !== exceptIndex));
    }

    function restorePhotos() {
        S.photoMeshes.forEach(p => setPhotoDim(p, false));
    }

    function deselectPhoto() {
        restorePhotos();
        highlightThumb(-1);
        S.focusIndex = null;
        hidePreview();
        const sel = el('bridge3dSelected');
        if (sel) { sel.style.display = 'none'; sel.innerHTML = ''; }
    }

    // Recadre la caméra sur un panneau photo et met à jour le bandeau "sélection".
    function focusPhoto(index) {
        const plane = S.photoMeshes.find(p => p.userData.index === index);
        if (!plane) return;
        const center = plane.userData.basePos.clone();
        // Caméra placée devant la face du panneau (sa normale monde).
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(plane.quaternion).normalize();
        const dist = Math.max(S.model.L * 0.22, 14);
        const camTo = center.clone().add(normal.multiplyScalar(dist)).add(new THREE.Vector3(0, 2, 0));
        S.focus = {
            camFrom: S.camera.position.clone(),
            camTo,
            tgtFrom: S.controls.target.clone(),
            tgtTo: center,
            t: 0
        };
        dimOtherPhotos(index);
        S.focusIndex = index;
        showPreview(plane);
        const photo = plane.userData.photo;
        const meta = plane.userData.meta;
        const sel = el('bridge3dSelected');
        if (sel) {
            const az = meta && typeof meta.azimuth === 'number' ? meta.azimuth : null;
            const dirTxt = az != null ? ` · vue vers ${cardinal(az)} (${Math.round(az)}°)` : '';
            const roleDot = photo.roleColor ? `<span class="bridge3d-role-dot" style="background:${escapeHtml(photo.roleColor)}"></span>` : '';
            const roleTxt = photo.roleLabel ? `<div style="margin-bottom:4px;">${roleDot}${escapeHtml(photo.roleLabel)}</div>` : '';
            sel.style.display = 'block';
            sel.innerHTML =
                roleTxt
                + `<div class="bridge3d-selected-title">${escapeHtml(photo.providerLabel || photo.provider)}${escapeHtml(dirTxt)}</div>`
                + (photo.sourceUrl ? `<div style="margin-top:6px;"><a href="${escapeHtml(photo.sourceUrl)}" target="_blank" rel="noopener noreferrer">Ouvrir la source →</a></div>` : '');
        }
        highlightThumb(index);
    }

    function stepFocus() {
        const f = S.focus;
        f.t = Math.min(1, f.t + 0.06);
        const e = f.t * f.t * (3 - 2 * f.t); // smoothstep
        S.camera.position.lerpVectors(f.camFrom, f.camTo, e);
        S.controls.target.lerpVectors(f.tgtFrom, f.tgtTo, e);
        if (f.t >= 1) S.focus = null;
    }

    // ================= Bandeau galerie (DOM) =================
    function buildGallery(payload) {
        const gal = el('bridge3dGallery');
        if (!gal) return;
        gal.innerHTML = '';
        (payload.photos || []).forEach((photo, index) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bridge3d-thumb';
            btn.dataset.index = String(index);
            // Pastille couleur de rôle (pile, culée, tablier…) pour identifier la photo.
            const dot = `<span class="bridge3d-thumb-dot" style="background:${escapeHtml(photo.roleColor || '#7F8C8D')}" title="${escapeHtml(photo.roleLabel || '')}"></span>`;
            if (photo.provider === 'panoramax' && photo.thumbUrl) {
                btn.innerHTML = `<img src="${escapeHtml(photo.thumbUrl)}" alt="" loading="lazy">${dot}`;
            } else {
                btn.innerHTML = `<span class="bridge3d-thumb-placeholder">${escapeHtml(photo.provider)}</span>${dot}`;
                fetchPhotoMeta(photo).then(meta => {
                    const url = meta && meta.thumbUrl;
                    if (url) btn.innerHTML = `<img src="${escapeHtml(url)}" alt="" loading="lazy">${dot}`;
                });
            }
            btn.addEventListener('click', () => {
                if (S.ready) focusPhoto(index);
                else if (photo.sourceUrl) window.open(photo.sourceUrl, '_blank', 'noopener');
            });
            gal.appendChild(btn);
        });
    }

    function highlightThumb(index) {
        const gal = el('bridge3dGallery');
        if (!gal) return;
        gal.querySelectorAll('.bridge3d-thumb').forEach(b => {
            b.classList.toggle('is-active', Number(b.dataset.index) === index);
        });
    }

    // ================= En-tête / méta (DOM) =================
    function buildHeader(payload) {
        const title = el('bridge3dTitle');
        const sub = el('bridge3dSubtitle');
        const meta = el('bridge3dMeta');
        const osm = el('bridge3dOsm');
        if (title) title.textContent = payload.title || 'Pont';
        if (sub) sub.textContent = payload.subtitle || '';
        if (meta) {
            meta.innerHTML = (payload.metaChips || [])
                .map(c => `<span class="bridge3d-meta-chip"><strong>${escapeHtml(c.label)}</strong>${escapeHtml(String(c.value))}</span>`)
                .join('');
        }
        if (osm) {
            if (payload.osmUrl) { osm.href = payload.osmUrl; osm.style.display = ''; }
            else osm.style.display = 'none';
        }
        const sel = el('bridge3dSelected');
        if (sel) { sel.style.display = 'none'; sel.innerHTML = ''; }
    }

    // ================= Repli sans WebGL =================
    function renderFallback(payload) {
        const stage = el('bridge3dStage');
        const wrap = el('bridge3dCanvasWrap');
        if (wrap) wrap.style.display = 'none';
        if (!stage) return;
        let fb = stage.querySelector('.bridge3d-fallback');
        if (!fb) {
            fb = document.createElement('div');
            fb.className = 'bridge3d-fallback';
            stage.appendChild(fb);
        }
        const cards = (payload.photos || []).map(p => {
            if (p.provider === 'panoramax' && p.thumbUrl) {
                return `<a href="${escapeHtml(p.sourceUrl)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(p.thumbUrl)}" alt="" loading="lazy"></a>`;
            }
            return `<a href="${escapeHtml(p.sourceUrl)}" target="_blank" rel="noopener noreferrer" style="display:flex;align-items:center;justify-content:center;height:140px;border:1px solid #24375a;border-radius:8px;color:#9fb1cf;">${escapeHtml(p.provider)}</a>`;
        }).join('');
        fb.innerHTML = `
            <p style="margin:0 0 6px;font-weight:600;">Vue 3D indisponible (WebGL non supporté).</p>
            <p style="margin:0;color:#9fb1cf;font-size:0.82rem;">Photos taguées sur l'ouvrage :</p>
            <div class="bridge3d-fallback-grid">${cards || '<span style="color:#9fb1cf;">Aucune photo.</span>'}</div>
        `;
    }

    // Petit cartouche identité (nom, image, mise en service, matériau, dimensions)
    // + liens cliquables Wikidata / OSM. Affiché dès l'ouverture (infos OSM), puis
    // enrichi par Wikidata. S'efface s'il n'y a rien à montrer.
    function renderInfoCard(payload, wd) {
        const card = el('bridge3dCard');
        if (!card) return;
        const row = (label, value) => `<div class="bridge3d-card-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
        const name = (wd && wd.label) || payload.title || 'Ouvrage';
        const imgUrl = wd && wd.image ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(wd.image)}?width=360` : '';
        // Page du fichier sur Wikimedia Commons (P18).
        const commonsUrl = wd && wd.image ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(wd.image)}` : '';
        const material = payload.material || (wd && wd.matStr) || '';
        const lengthM = (payload.axisLengthM && payload.axisLengthM > 0) ? payload.axisLengthM : (wd && wd.length) || null;
        const height = wd && wd.height ? wd.height : null;
        const inception = wd && wd.inceptionYear ? wd.inceptionYear : null;

        const rows = [];
        if (inception) rows.push(row('Mise en service', inception));
        if (material) rows.push(row('Matériau', material));
        if (lengthM) rows.push(row('Longueur', `${Math.round(lengthM)} m`));
        if (height) rows.push(row('Hauteur', `${Math.round(height)} m`));

        // Le lien Commons est porté par l'image elle-même (cliquable), pas par un lien texte séparé.
        const links = [];
        if (payload.wikidataId) links.push(`<a href="https://www.wikidata.org/wiki/${escapeHtml(payload.wikidataId)}" target="_blank" rel="noopener noreferrer">Wikidata ↗</a>`);
        if (payload.osmUrl) links.push(`<a href="${escapeHtml(payload.osmUrl)}" target="_blank" rel="noopener noreferrer">OSM ↗</a>`);

        if (!rows.length && !links.length && !imgUrl) { card.style.display = 'none'; card.innerHTML = ''; return; }

        card.innerHTML =
            (imgUrl ? `<a href="${escapeHtml(commonsUrl)}" target="_blank" rel="noopener noreferrer" title="Voir sur Wikimedia Commons"><img class="bridge3d-card-img" src="${imgUrl}" alt="" loading="lazy" onerror="this.parentNode.style.display='none'"></a>` : '')
            + '<div class="bridge3d-card-body">'
            + `<div class="bridge3d-card-title">${escapeHtml(name)}</div>`
            + (rows.length ? `<div class="bridge3d-card-rows">${rows.join('')}</div>` : '')
            + (links.length ? `<div class="bridge3d-card-links">${links.join('')}</div>` : '')
            + '</div>';
        card.style.display = 'block';
    }

    // Complète le payload via Wikidata puis reconstruit le modèle si quelque chose
    // d'utile a été ajouté (type de structure, matériau, travées, dimensions).
    function enrichFromWikidata(payload) {
        if (!payload.wikidataId) return;
        wikidataBridgeInfo(payload.wikidataId).then(info => {
            if (!info || S.payload !== payload) return;
            renderInfoCard(payload, info);
            if (!S.ready) return;
            let changed = false;
            if (!payload.structure && info.typeStr) {
                const s = structureFromLabel(info.typeStr);
                if (s) { payload.structure = s; changed = true; }
            }
            if (!payload.material && info.matStr) { payload.material = info.matStr; changed = true; }
            if (info.spans && info.spans > 0 && payload.spanCountHint !== info.spans) { payload.spanCountHint = info.spans; changed = true; }
            if ((!payload.axisLengthM || payload.axisLengthM <= 0) && info.length && info.length > 0) { payload.axisLengthM = info.length; changed = true; }
            if (payload.widthM == null && info.width && info.width > 0) { payload.widthM = info.width; changed = true; }
            if (payload.heightM == null && info.height && info.height > 0) { payload.heightM = info.height; changed = true; }
            if (!changed) return;
            if (!payload.metaChips.some(c => c.label === 'Wikidata')) {
                payload.metaChips.push({ label: 'Wikidata', value: payload.wikidataId });
            }
            buildHeader(payload);
            buildScene(payload);
        });
    }

    // ================= API publique =================
    function open(payload) {
        if (!payload) return;
        S.payload = payload;
        const overlay = el('bridge3dOverlay');
        if (overlay) { overlay.classList.add('active'); overlay.setAttribute('aria-hidden', 'false'); }

        buildHeader(payload);
        buildGallery(payload);
        renderInfoCard(payload, null); // cartouche de base (infos OSM), enrichi ensuite

        if (!ensureEngine()) {
            renderFallback(payload);
            enrichFromWikidata(payload);
            return;
        }
        const wrap = el('bridge3dCanvasWrap');
        if (wrap) wrap.style.display = '';
        const fb = el('bridge3dStage') && el('bridge3dStage').querySelector('.bridge3d-fallback');
        if (fb) fb.remove();

        buildScene(payload);
        startLoop();
        // Resize après affichage (les dimensions du wrap sont disponibles).
        requestAnimationFrame(resize);
        enrichFromWikidata(payload);

        // Focus optionnel sur une photo (clic sur un marqueur photo de la carte).
        if (payload.focusPhotoKey) {
            const idx = (payload.photos || []).findIndex(p => p.key === payload.focusPhotoKey);
            if (idx >= 0) setTimeout(() => focusPhoto(idx), 160);
        }
    }

    function close() {
        const overlay = el('bridge3dOverlay');
        if (overlay) { overlay.classList.remove('active'); overlay.setAttribute('aria-hidden', 'true'); }
        stopLoop();
        hidePreview();
        clearRoot();
    }

    window.BridgeViewer3D = { open, close, hasWebGL: HAS_THREE };

    // Fermeture au clavier (Échap).
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const overlay = el('bridge3dOverlay');
            if (overlay && overlay.classList.contains('active')) {
                if (typeof window.closeBridgeViewer === 'function') window.closeBridgeViewer();
                else close();
            }
        }
    });
})(window, document);
