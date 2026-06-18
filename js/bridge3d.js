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
        if (s.includes('suspension') || s.includes('cable')) return 'suspension';
        if (s.includes('truss') || s.includes('treillis')) return 'truss';
        if (s.includes('arch') || s.includes('humpback') || b === 'aqueduct' || b === 'viaduct') return 'arch';
        if (s.includes('beam') || s.includes('girder') || s.includes('slab')) return 'beam';
        return 'beam';
    }

    // Nombre de travées / arches déduit (piles -> longueur -> défaut).
    function deriveSpanCount(payload, kind, L) {
        if (payload.pillarCount && payload.pillarCount > 0) {
            return clamp(payload.pillarCount + 1, 1, 24);
        }
        const typicalSpan = kind === 'arch' ? 18 : kind === 'truss' ? 30 : 26;
        const est = Math.round(L / typicalSpan);
        return clamp(est, kind === 'arch' ? 2 : 1, kind === 'arch' ? 16 : 8);
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
        photoMeta: new Map()
    };

    function token() {
        return (window.APP_CONFIG && window.APP_CONFIG.mapillary && window.APP_CONFIG.mapillary.accessToken) || '';
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
        const L = clamp(payload.axisLengthM || 40, 16, 360);
        const W = clamp(payload.widthM || (kind === 'truss' ? 9 : 8), 4, 22);
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

    // Positionne et oriente un panneau photo. Si azimuth connu, le plan « regarde »
    // dans la direction de prise de vue ; sinon il fait face vers l'extérieur.
    // Ajoute un marqueur au sol (lieu de prise de vue) et un mât vertical.
    function placePhoto(plane, x, y, z, azimuth, payload) {
        plane.position.set(x, y, z);
        if (typeof azimuth === 'number') {
            const azr = azimuth * Math.PI / 180;
            // direction de visée en repère nord-haut : est = sin(az), nord = cos(az) -> z = -nord
            plane.lookAt(x + Math.sin(azr), y, z - Math.cos(azr));
        } else {
            plane.lookAt(x, y, z + (z >= 0 ? 1 : -1));
        }
        plane.userData.basePos = new THREE.Vector3(x, y, z);

        removePhotoExtras(plane);
        const col = plane.userData.providerCol;
        const extras = [];
        if (y > 0.2) {
            const conn = new THREE.Mesh(
                new THREE.CylinderGeometry(0.06, 0.06, y, 6),
                new THREE.MeshBasicMaterial({ color: col })
            );
            conn.position.set(x, y / 2, z);
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
        const planeW = clamp(L / 5, 5, 14);
        const planeH = planeW * 0.72;
        const outZ = W / 2 + clamp(W * 0.9, 5, 12);
        const photoY = deckY + planeH * 0.55;
        const hasGeo = payload.centerLat != null && payload.centerLng != null;
        // Vecteurs d'axe (monde) pour aligner le repli OSM sur le cap réel du pont.
        const theta = (payload.axisBearingDeg || 0) * Math.PI / 180;
        const along = { x: Math.sin(theta), z: -Math.cos(theta) };
        const perp = { x: Math.cos(theta), z: Math.sin(theta) };

        // Pour le repli OSM : empilage par (côté, position arrondie).
        const slotCount = new Map();

        payload.photos.forEach((photo, index) => {
            const providerCol = photo.provider === 'panoramax' ? 0x1f9e5a : 0x2575c2;

            const mat = new THREE.MeshBasicMaterial({ color: 0x223043, side: THREE.DoubleSide });
            const plane = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), mat);
            const frame = new THREE.Mesh(
                new THREE.PlaneGeometry(planeW + 0.5, planeH + 0.5),
                new THREE.MeshBasicMaterial({ color: providerCol, side: THREE.DoubleSide })
            );
            frame.position.z = -0.06;
            plane.add(frame);
            plane.userData = { photo, index, providerCol, basePos: new THREE.Vector3() };
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
                if (turl) applyTexture(plane, turl, planeW, planeH);
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
                plane.scale.set(1, targetH / planeH, 1);
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

        S.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);

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
    }

    // --- Tuiles web-mercator (fond de carte 2D) ---
    function lon2tile(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
    function lat2tile(lat, z) { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z); }
    function tile2lon(x, z) { return x / Math.pow(2, z) * 360 - 180; }
    function tile2lat(y, z) { const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }

    // Fond de carte 2D (CartoDB Positron) sous le pont : on voit fleuves et voiries.
    // Repli sur un plan d'eau uni si les tuiles échouent. Repère nord-haut.
    function buildGroundMap(payload) {
        const { L } = S.model;
        const fallback = new THREE.Mesh(
            new THREE.PlaneGeometry(L * 3.5, L * 3.5),
            new THREE.MeshBasicMaterial({ color: 0x16314a })
        );
        fallback.rotation.x = -Math.PI / 2;
        fallback.position.y = -0.06;
        S.root.add(fallback);

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
        if (cols > 6 || rows > 6 || cols < 1 || rows < 1) return;

        const canvas = document.createElement('canvas');
        canvas.width = cols * 256; canvas.height = rows * 256;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#dfe3e8';
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

        const mapPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(widthM, heightM),
            new THREE.MeshBasicMaterial({ map: tex })
        );
        mapPlane.rotation.x = -Math.PI / 2;
        mapPlane.position.set(cx, -0.04, -cn);
        S.mapPlane = mapPlane;
        S.mapTex = tex;

        let loaded = 0; const total = cols * rows; let failed = false;
        const subs = ['a', 'b', 'c'];
        for (let ty = minTY; ty <= maxTY; ty++) {
            for (let tx = minTX; tx <= maxTX; tx++) {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                const px = (tx - minTX) * 256, py = (ty - minTY) * 256;
                img.onload = () => {
                    try { ctx.drawImage(img, px, py, 256, 256); } catch (e) { failed = true; }
                    loaded++; tex.needsUpdate = true;
                    if (loaded === total && !failed && S.root) {
                        S.root.remove(fallback);
                        S.root.add(mapPlane);
                    }
                };
                img.onerror = () => { failed = true; loaded++; };
                img.src = `https://${subs[(tx + ty) % 3]}.basemaps.cartocdn.com/light_all/${z}/${tx}/${ty}.png`;
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

    function onClick(ev) {
        const obj = pickPhoto(ev);
        if (obj && obj.userData) focusPhoto(obj.userData.index);
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
        const photo = plane.userData.photo;
        const meta = plane.userData.meta;
        const sel = el('bridge3dSelected');
        if (sel) {
            const az = meta && typeof meta.azimuth === 'number' ? meta.azimuth : null;
            const dirTxt = az != null ? ` · vue vers ${cardinal(az)} (${Math.round(az)}°)` : '';
            sel.style.display = 'block';
            sel.innerHTML =
                `<div class="bridge3d-selected-title">${escapeHtml(photo.providerLabel || photo.provider)}${escapeHtml(dirTxt)}</div>`
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
            if (photo.provider === 'panoramax' && photo.thumbUrl) {
                btn.innerHTML = `<img src="${escapeHtml(photo.thumbUrl)}" alt="" loading="lazy">`;
            } else {
                btn.innerHTML = `<span class="bridge3d-thumb-placeholder">${escapeHtml(photo.provider)}</span>`;
                fetchPhotoMeta(photo).then(meta => {
                    const url = meta && meta.thumbUrl;
                    if (url) btn.innerHTML = `<img src="${escapeHtml(url)}" alt="" loading="lazy">`;
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

    // ================= API publique =================
    function open(payload) {
        if (!payload) return;
        S.payload = payload;
        const overlay = el('bridge3dOverlay');
        if (overlay) { overlay.classList.add('active'); overlay.setAttribute('aria-hidden', 'false'); }

        buildHeader(payload);
        buildGallery(payload);

        if (!ensureEngine()) {
            renderFallback(payload);
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
