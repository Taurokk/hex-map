import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

// ========================
// Hex Map Generator (v2.2)
// — Pointy-top, axial (q,r)
// — Démarrage 1 tuile, génération par déplacement (2 anneaux)
// — Déplacement par clic sur 6 voisines + boutons
// — "Nouvelle seed" reroll UNIQUEMENT le dernier déplacement
// — Légende triée: Biomes (ordre des couleurs) puis Déserts (même ordre)
// — Culling visuel: on n'affiche pas les tuiles à distance > 10 du pion (mais on les garde en mémoire)
// — Contour intérieur, fond noir, police Times New Roman
// ========================

// ---- Types ----
const CATEGORIES = {
  BIOME: "Biome",
  DESERT: "Désert",
} as const;

type Category = typeof CATEGORIES[keyof typeof CATEGORIES];

interface TileType {
  key: string;
  label: string;
  color: string;
  category: Category;
}

interface TileInstance {
  q: number;
  r: number;
  typeKey: string;
  genMoveId: number; // id du déplacement lors duquel la tuile a été générée
}

// ---- Palette ----
const PALETTE = {
  VERT: "#1e7a3b",
  JAUNE: "#f5c211",
  ORANGE: "#f28c28",
  VIOLET: "#8b5cf6",
  NOIR: "#111827",
  ROUGE: "#e73f37",
  CYAN: "#22c9da",
  BLEU: "#3b82f6",
  ROSE: "#ff2f92",
} as const;

// Tri des couleurs : ordre visuel voulu
const COLOR_ORDER = [PALETTE.VERT, PALETTE.JAUNE, PALETTE.ORANGE, PALETTE.VIOLET, PALETTE.NOIR, PALETTE.ROUGE, PALETTE.CYAN, PALETTE.BLEU, PALETTE.ROSE];
const COLOR_INDEX: Record<string, number> = Object.fromEntries(COLOR_ORDER.map((c, i) => [c, i]));

// 18 types
const TILE_TYPES: TileType[] = [
  // Biomes
  { key: "foret", label: "Forêt", color: PALETTE.VERT, category: CATEGORIES.BIOME },
  { key: "jungle", label: "Jungle", color: PALETTE.JAUNE, category: CATEGORIES.BIOME },
  { key: "plaine", label: "Plaine", color: PALETTE.ORANGE, category: CATEGORIES.BIOME },
  { key: "marais", label: "Marais", color: PALETTE.VIOLET, category: CATEGORIES.BIOME },
  { key: "mont", label: "Mont", color: PALETTE.NOIR, category: CATEGORIES.BIOME },
  { key: "sable", label: "Sable", color: PALETTE.ROUGE, category: CATEGORIES.BIOME },
  { key: "riviere", label: "Rivière", color: PALETTE.CYAN, category: CATEGORIES.BIOME },
  { key: "lac", label: "Lac", color: PALETTE.BLEU, category: CATEGORIES.BIOME },
  { key: "oasis", label: "Oasis", color: PALETTE.ROSE, category: CATEGORIES.BIOME },
  // Déserts
  { key: "foret_petrifiee", label: "Forêt Pétrifiée", color: PALETTE.VERT, category: CATEGORIES.DESERT },
  { key: "terres_fongales", label: "Terres Fongales", color: PALETTE.JAUNE, category: CATEGORIES.DESERT },
  { key: "cite_fantome", label: "Cité Fantôme", color: PALETTE.ORANGE, category: CATEGORIES.DESERT },
  { key: "tourbiere_assechee", label: "Tourbière Asséchée", color: PALETTE.VIOLET, category: CATEGORIES.DESERT },
  { key: "mont_noir", label: "Mont Noir", color: PALETTE.NOIR, category: CATEGORIES.DESERT },
  { key: "saliniere", label: "Salinière", color: PALETTE.ROUGE, category: CATEGORIES.DESERT },
  { key: "canyon_plat", label: "Canyon Plat", color: PALETTE.CYAN, category: CATEGORIES.DESERT },
  { key: "mer_d_ombre", label: "Mer d'ombre", color: PALETTE.BLEU, category: CATEGORIES.DESERT },
  { key: "nuage_toxique", label: "Nuage Toxique", color: PALETTE.ROSE, category: CATEGORIES.DESERT },
];

const TYPE_BY_KEY: Record<string, TileType> = Object.fromEntries(
  TILE_TYPES.map((t) => [t.key, t])
);

// ---- Utilitaires ----
const DIRS: [number, number][] = [
  // 6 directions axial (pointy-top)
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

function axialToPixel(q: number, r: number, size: number) {
  const x = size * Math.sqrt(3) * (q + r / 2);
  const y = size * (3 / 2) * r;
  return { x, y };
}

function polygonPoints(cx: number, cy: number, size: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push([cx + size * Math.cos(angle), cy + size * Math.sin(angle)]);
  }
  return pts.map((p) => p.join(",")).join(" ");
}

function keyOf(q: number, r: number) { return `${q},${r}`; }

// Distance hex (axial)
function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }) {
  const ax = a.q, az = a.r, ay = -ax - az;
  const bx = b.q, bz = b.r, by = -bx - bz;
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
}

// PRNG simple déterministe
function hashRand(seed: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}

function luminance(hex: string) {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  const a = [r, g, b].map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function textColorFor(bg: string) { return luminance(bg) > 0.35 ? "#0b0f19" : "#ffffff"; }

function downloadSvg(svgEl: SVGSVGElement, filename = "hexmap.svg") {
  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(svgEl);
  if (!source.match(/^<svg[^>]+xmlns=\"http:\/\/www.w3.org\/2000\/svg\"/)) {
    source = source.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

// Ajuste dynamiquement la taille de police pour ne pas dépasser la largeur utile du bas de l'hex
function fitLabel(label: string, size: number) {
  const base = Math.max(10, Math.round(size * 0.26));
  const charW = base * 0.6; // approximation
  const maxW = size * 1.55; // largeur utile
  const need = label.length * charW;
  if (need <= maxW) return base;
  const scale = maxW / need;
  return Math.max(9, Math.floor(base * scale));
}

// ---- Composant principal ----
export default function HexMapGenerator() {
  const [size, setSize] = useState<number>(58);
  const [seedBase, setSeedBase] = useState<string>('caerwynn-001');
  const [moveId, setMoveId] = useState<number>(0);
  const [rerollNonce, setRerollNonce] = useState<number>(0);
  const [pos, setPos] = useState<{ q: number; r: number }>({ q: 0, r: 0 });

  const [tiles, setTiles] = useState<Map<string, TileInstance>>(() => {
    const m = new Map<string, TileInstance>();
    const t = generateTile(0, 0, seedBase, 0, 0);
    m.set(keyOf(0, 0), { ...t, genMoveId: 0 });
    return m;
  });

  function pickType(rnd: () => number): string {
    const keys = TILE_TYPES.map((t) => t.key);
    return keys[Math.floor(rnd() * keys.length)];
  }
  function generateTile(q: number, r: number, seed: string, mId: number, rr: number) {
    const rnd = hashRand(`${seed}|move:${mId}|rr:${rr}|@${q},${r}`);
    const typeKey = pickType(rnd);
    return { q, r, typeKey } as TileInstance;
  }

  function ensureGeneratedAround(center: { q: number; r: number }, rad: number, mId: number, rr: number) {
    setTiles((prev) => {
      const next = new Map(prev);
      for (let dq = -rad; dq <= rad; dq++) {
        for (let dr = Math.max(-rad, -dq - rad); dr <= Math.min(rad, -dq + rad); dr++) {
          const q = center.q + dq;
          const r = center.r + dr;
          const k = keyOf(q, r);
          if (!next.has(k)) {
            const t = generateTile(q, r, seedBase, mId, rr);
            next.set(k, { ...t, genMoveId: mId });
          }
        }
      }
      return next;
    });
  }

  function rerollLastRing() {
    setTiles((prev) => {
      const next = new Map(prev);
      for (const [k, v] of next) {
        if (v.genMoveId === moveId) {
          const t = generateTile(v.q, v.r, seedBase, moveId, rerollNonce + 1);
          next.set(k, { ...t, genMoveId: moveId });
        }
      }
      return next;
    });
    setRerollNonce((x) => x + 1);
  }

  function move(dirIdx: number) {
    const [dq, dr] = DIRS[dirIdx % 6];
    const np = { q: pos.q + dq, r: pos.r + dr };
    const nextMove = moveId + 1;
    setPos(np);
    setMoveId(nextMove);
    setRerollNonce(0);
    ensureGeneratedAround(np, 2, nextMove, 0);
  }

  // Biomes découvert·es triés par groupe/couleur
  const { discoveredBiomes, discoveredDeserts } = useMemo(() => {
    const discovered = new Map<string, TileType>();
    for (const v of tiles.values()) {
      const t = TYPE_BY_KEY[v.typeKey];
      discovered.set(t.key, t);
    }
    const all = Array.from(discovered.values());
    const biomes = all.filter(t => t.category === CATEGORIES.BIOME).sort((a,b) => COLOR_INDEX[a.color] - COLOR_INDEX[b.color]);
    const deserts = all.filter(t => t.category === CATEGORIES.DESERT).sort((a,b) => COLOR_INDEX[a.color] - COLOR_INDEX[b.color]);
    return { discoveredBiomes: biomes, discoveredDeserts: deserts };
  }, [tiles]);

  // Dimensions SVG adaptées aux tuiles visibles (distance <= 10)
  const VISIBLE_RADIUS = 10;
  const margin = 32;
  const dims = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const v of tiles.values()) {
      if (hexDistance({q:v.q, r:v.r}, pos) > VISIBLE_RADIUS) continue; // culling visuel
      const { x, y } = axialToPixel(v.q, v.r, size);
      minX = Math.min(minX, x - size * Math.sqrt(3) / 2);
      maxX = Math.max(maxX, x + size * Math.sqrt(3) / 2);
      minY = Math.min(minY, y - size);
      maxY = Math.max(maxY, y + size);
    }
    if (minX === Infinity) { return { width: 300, height: 300, offsetX: margin, offsetY: margin }; }
    const width = Math.ceil(maxX - minX + margin * 2);
    const height = Math.ceil(maxY - minY + margin * 2);
    const offsetX = Math.ceil(margin - minX);
    const offsetY = Math.ceil(margin - minY);
    return { width, height, offsetX, offsetY };
  }, [tiles, size, pos]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const handleExport = () => { if (svgRef.current) downloadSvg(svgRef.current); };

  const uiFont = { fontFamily: 'Times New Roman, Times, serif' } as const;

  return (
    <div style={{ background: '#000', color: '#e5e7eb', minHeight: '100vh', padding: 16, display: 'grid', gap: 16, gridTemplateColumns: '320px 1fr' }}>
      {/* Panneau gauche */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h1 style={{ ...(uiFont as any), fontSize: 24, letterSpacing: 0.5 }}>Générateur / Explorateur d'Hex</h1>

        {/* Contrôles du pion */}
        <div style={{ border: '1px solid #333', borderRadius: 12, padding: 12 }}>
          <div style={{ marginBottom: 8, fontSize: 12, opacity: 0.8 }}>Pion caravane — position (q:{pos.q} r:{pos.r})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, placeItems: 'center' }}>
            <button onClick={() => move(2)} style={btn()}>↖︎</button>
            <button onClick={() => move(1)} style={btn()}>↑</button>
            <button onClick={() => move(0)} style={btn()}>↗︎</button>
            <button onClick={() => move(3)} style={btn()}>←</button>
            <button disabled style={{ ...btn(), opacity: 0.4 }}>•</button>
            <button onClick={() => move(5)} style={btn()}>→</button>
            <button onClick={() => move(4)} style={btn()}>↙︎</button>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: 12, opacity: 0.8 }}>Taille tuile</label>
            <input type="range" min={36} max={92} value={size} onChange={(e) => setSize(parseInt(e.target.value, 10))} />
            <button onClick={handleExport} style={btn()}>Exporter SVG</button>
            <button onClick={() => rerollLastRing()} style={btnStrong()}>Nouvelle seed</button>
          </div>
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>"Nouvelle seed" ne reroll que les tuiles générées au dernier déplacement.</div>
        </div>

        {/* Légende triée */}
        <div style={{ border: '1px solid #333', borderRadius: 12, padding: 12 }}>
          <div style={{ ...(uiFont as any), fontSize: 16, marginBottom: 8 }}>Biomes découverts</div>
          <LegendList items={discoveredBiomes} />
          <div style={{ ...(uiFont as any), fontSize: 16, marginTop: 12, marginBottom: 8 }}>Déserts découverts</div>
          <LegendList items={discoveredDeserts} />
        </div>

        {/* Paramètres seed de base */}
        <div style={{ border: '1px solid #333', borderRadius: 12, padding: 12, display: 'grid', gap: 6 }}>
          <label style={{ fontSize: 12, opacity: 0.8 }}>Seed de base</label>
          <input value={seedBase} onChange={(e) => setSeedBase(e.target.value)} style={{ background: '#0b0f19', color: '#e5e7eb', border: '1px solid #333', borderRadius: 8, padding: '6px 8px' }} />
        </div>
      </div>

      {/* Zone SVG */}
      <div style={{ overflow: 'auto', border: '1px solid #222', borderRadius: 12, background: '#0b0f19' }}>
        <svg ref={svgRef} width={dims.width} height={dims.height} viewBox={`0 0 ${dims.width} ${dims.height}`}>
          <g transform={`translate(${dims.offsetX}, ${dims.offsetY})`}>
            {/* Tuiles visibles seulement (<= 10) */}
            {Array.from(tiles.values()).map((tile) => {
              if (hexDistance({q: tile.q, r: tile.r}, pos) > VISIBLE_RADIUS) return null;
              const { x, y } = axialToPixel(tile.q, tile.r, size);
              const type = TYPE_BY_KEY[tile.typeKey];
              const fill = type.color;
              const outline = type.category === CATEGORIES.BIOME ? "#ffffff" : "#000000";
              const ptsOuter = polygonPoints(x, y, size);
              const ptsInner = polygonPoints(x, y, Math.max(6, size - 4)); // contour intérieur
              const labelColor = textColorFor(fill);
              const labelY = y + size * 0.62;
              const fitted = fitLabel(type.label, size);
              return (
                <g key={`${tile.q},${tile.r}`}>
                  <polygon points={ptsOuter} fill={fill} />
                  <polygon points={ptsInner} fill="none" stroke={outline} strokeWidth={3} />
                  <polygon points={ptsOuter} fill="none" stroke={labelColor === '#ffffff' ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)'} strokeWidth={1.5} />
                  <text x={x} y={labelY} textAnchor="middle" style={{ fontFamily: 'Times New Roman, Times, serif', fontStyle: 'italic', fontSize: fitted }} fill={labelColor}>{type.label}</text>
                </g>
              );
            })}

            {/* Pion caravane — plus visible, groupe rudimentaire */}
            {(() => {
              const { x, y } = axialToPixel(pos.q, pos.r, size);
              const rHead = Math.max(3, size * 0.12);
              const bodyH = rHead * 2.2;
              const gap = rHead * 1.8;
              const baseY = y + rHead * 0.4;
              return (
                <g>
                  {[ -gap, 0, gap ].map((dx, idx) => (
                    <g key={idx}>
                      <circle cx={x + dx} cy={baseY - bodyH} r={rHead} fill="#ffe680" stroke="#000" strokeWidth={1.5} />
                      <rect x={x + dx - rHead * 0.6} y={baseY - bodyH + rHead * 0.6} width={rHead * 1.2} height={bodyH} rx={rHead * 0.3} fill="#ffd166" stroke="#000" strokeWidth={1.5} />
                    </g>
                  ))}
                  <ellipse cx={x} cy={baseY + bodyH + 2} rx={gap + rHead} ry={rHead * 0.6} fill="rgba(0,0,0,0.35)" />
                </g>
              );
            })()}

            {/* Cases cliquables pour se déplacer (6 voisines) */}
            {DIRS.map(([dq, dr], i) => {
              const nq = pos.q + dq, nr = pos.r + dr;
              const { x, y } = axialToPixel(nq, nr, size);
              const pts = polygonPoints(x, y, size * 0.98);
              return (
                <polygon key={`click-${i}`} points={pts} fill="rgba(255,255,255,0.01)" stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" style={{ cursor: 'pointer' }} onClick={() => move(i)} />
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}

function btn(): CSSProperties {
  return { background: '#111827', color: '#e5e7eb', border: '1px solid #333', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' } as CSSProperties;
}
function btnStrong(): CSSProperties {
  return { background: '#1f2937', color: '#e5e7eb', border: '1px solid #555', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontWeight: 700 } as CSSProperties;
}

// ---- Légende composant ----
function LegendList({ items }: { items: TileType[] }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
      {items.length === 0 ? (
        <li style={{ opacity: 0.7 }}>Aucun.</li>
      ) : (
        items.map((t) => {
          const border = t.category === CATEGORIES.BIOME ? '#ffffff' : '#000000';
          return (
            <li key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'inline-block', width: 16, height: 16, background: t.color, border: `3px solid ${border}`, boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.25)', borderRadius: 2 }} />
              <span style={{ fontFamily: 'Times New Roman, Times, serif' }}>{t.label}</span>
            </li>
          );
        })
      )}
    </ul>
  );
}
