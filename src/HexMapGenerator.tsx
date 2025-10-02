import { useMemo, useRef, useState } from "react";
// ========================
// Hex Map Generator (SVG)
// - pointy-top
// - axial coords (q, r)
// - 18 types (9 Biomes / 9 Déserts)
// - Contours: Biome = white, Désert = black
// - Liseret interne 2px
// - Labels en italique "Courier New", taille relative
// - Export SVG + seed de génération
// ========================

// ---- Types ----
const CATEGORIES = {
  BIOME: "Biome",
  DESERT: "Désert",
} as const;

type Category = typeof CATEGORIES[keyof typeof CATEGORIES];

interface TileType {
  key: string; // id interne
  label: string; // affichage (avec accents)
  color: string; // couleur de fond (même paire Biome/Désert)
  category: Category; // Biome ou Désert
}

interface TileInstance {
  q: number; // axial q
  r: number; // axial r
  typeKey: string; // référence vers TileType
}

// ---- Palette (couleurs distinctes mais respectant le mapping utilisateur) ----
// Une couleur par paire Biome/Désert. Différenciation par contour (blanc vs noir).
const PALETTE = {
  VERT: "#1e7a3b", // vert lisible
  JAUNE: "#f5c211", // jaune soutenu
  ORANGE: "#f28c28",
  VIOLET: "#8b5cf6",
  NOIR: "#111827", // gris très foncé pour garder lisible les liserets
  ROUGE: "#e73f37",
  CYAN: "#22c9da",
  BLEU: "#3b82f6",
  ROSE: "#ff2f92", // rose vif
};

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
function seededRand(seed: string) {
  // SFC32 simple à partir d'un hash
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h ^ 0x9e3779b9,
    b = a ^ 0x9e3779b9,
    c = b ^ 0x9e3779b9,
    d = c ^ 0x9e3779b9;
  return function () {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

function axialToPixel(q: number, r: number, size: number) {
  // pointy-top
  const x = size * Math.sqrt(3) * (q + r / 2);
  const y = size * (3 / 2) * r;
  return { x, y };
}

function polygonPoints(cx: number, cy: number, size: number) {
  // 6 sommets (pointy-top), angle 30° + k*60°
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push([cx + size * Math.cos(angle), cy + size * Math.sin(angle)]);
  }
  return pts.map((p) => p.join(",")).join(" ");
}

function luminance(hex: string) {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  const a = [r, g, b].map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function textColorFor(bg: string) {
  return luminance(bg) > 0.35 ? "#0b0f19" : "#ffffff"; // sombre/clair
}

function downloadSvg(svgEl: SVGSVGElement, filename = "hexmap.svg") {
  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(svgEl);
  // Ajouter namespace si absent
  if (!source.match(/^<svg[^>]+xmlns=\"http:\/\/www.w3.org\/2000\/svg\"/)) {
    source = source.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- Composant principal ----
export default function HexMapGenerator() {
  // Taille d'une tuile: par défaut ~2/3 d'une tuile Catan (edge ~58px)
  const [size, setSize] = useState<number>(58);
  const [cols, setCols] = useState<number>(10);
  const [rows, setRows] = useState<number>(8);
  const [seed, setSeed] = useState<string>("caerwynn-001");
  const [showLegend, setShowLegend] = useState<boolean>(true);

  const svgRef = useRef<SVGSVGElement | null>(null);

  // Génération: uniforme sur les 18 types
  const tiles: TileInstance[] = useMemo(() => {
    const rnd = seededRand(seed);
    const keys = TILE_TYPES.map((t) => t.key);
    const out: TileInstance[] = [];
    // Grille rectangulaire en axial: r de 0..rows-1, q de 0..cols-1
    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        const typeKey = keys[Math.floor(rnd() * keys.length)];
        out.push({ q, r, typeKey });
      }
    }
    return out;
  }, [cols, rows, seed]);

  // Dimensions du SVG (marges incluses)
  const margin = 24;
  const { width, height } = useMemo(() => {
    if (cols === 0 || rows === 0) return { width: 0, height: 0 };
    const last = axialToPixel(cols - 1, rows - 1, size);
    const w = last.x + size * Math.sqrt(3) / 2 + margin * 2;
    const h = last.y + size + margin * 2;
    return { width: Math.ceil(w), height: Math.ceil(h) };
  }, [cols, rows, size]);

  const handleExport = () => {
    if (svgRef.current) downloadSvg(svgRef.current);
  };

  return (
    <div style={{ fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica, Arial, sans-serif', padding: 16, display: 'grid', gap: 16, gridTemplateColumns: '320px 1fr' }}>
      {/* Panneau de contrôle */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Générateur de carte hexagonale</h1>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Colonnes</div>
            <input type="number" min={1} max={60} value={cols} onChange={(e) => setCols(parseInt(e.target.value || '0', 10))} style={{ width: '100%' }} />
          </label>
          <label>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Lignes</div>
            <input type="number" min={1} max={60} value={rows} onChange={(e) => setRows(parseInt(e.target.value || '0', 10))} style={{ width: '100%' }} />
          </label>
          <label style={{ gridColumn: '1 / span 2' }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Taille de tuile (rayon px)</div>
            <input type="range" min={28} max={92} value={size} onChange={(e) => setSize(parseInt(e.target.value, 10))} style={{ width: '100%' }} />
            <div style={{ fontSize: 12, opacity: 0.6 }}>~ 2/3 Catan par défaut ({size}px)</div>
          </label>
          <label style={{ gridColumn: '1 / span 2' }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Seed</div>
            <input type="text" value={seed} onChange={(e) => setSeed(e.target.value)} style={{ width: '100%' }} />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setSeed(String(Date.now()))}>Nouvelle seed</button>
          <button onClick={handleExport}>Exporter SVG</button>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={showLegend} onChange={(e) => setShowLegend(e.target.checked)} />
            <span>Afficher légende</span>
          </label>
        </div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Biomes = contour <b>blanc</b> · Déserts = contour <b>noir</b> · Liseret interne 2px
        </div>
        {showLegend && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, marginTop: 8, maxHeight: 360, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
            {[CATEGORIES.BIOME, CATEGORIES.DESERT].map((cat) => (
              <div key={cat}>
                <div style={{ fontSize: 12, fontWeight: 700, margin: '6px 0' }}>{cat}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {TILE_TYPES.filter((t) => t.category === cat).map((t) => (
                    <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 16, height: 16, background: t.color, border: `3px solid ${t.category === CATEGORIES.BIOME ? '#ffffff' : '#000000'}`, boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.25)', borderRadius: 2 }} />
                      <div style={{ fontSize: 12 }}>{t.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Zone SVG */}
      <div style={{ overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 12 }}>
        <svg
          ref={svgRef}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ background: '#fafafa' }}
        >
          <g transform={`translate(${24}, ${24})`}>
            {tiles.map((tile, i) => {
              const { x, y } = axialToPixel(tile.q, tile.r, size);
              const cx = x;
              const cy = y;
              const type = TYPE_BY_KEY[tile.typeKey];
              const fill = type.color;
              const outline = type.category === CATEGORIES.BIOME ? "#ffffff" : "#000000";
              const pts = polygonPoints(cx, cy, size);
              const labelColor = textColorFor(fill);
              // Position du label en bas
              const labelY = cy + size * 0.68;
              return (
                <g key={i}>
                  {/* contour principal */}
                  <polygon points={pts} fill={fill} stroke={outline} strokeWidth={4.5} />
                  {/* liseret interne 2px (semi-transparent, pour relief) */}
                  <polygon points={pts} fill="none" stroke={labelColor === '#ffffff' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'} strokeWidth={2} />
                  {/* label */}
                  <text
                    x={cx}
                    y={labelY}
                    textAnchor="middle"
                    style={{ fontFamily: 'Courier New, Courier, monospace', fontStyle: 'italic', fontSize: Math.max(10, Math.round(size * 0.28)) }}
                    fill={labelColor}
                  >
                    {type.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
