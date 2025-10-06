import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

// ========================
// Hex Map Generator (v3.0)
// — Pointy-top, axial (q,r)
// — Génération incrémentale (2 anneaux à chaque pas)
// — Brouillard de guerre + vision (1..3) + Mont/Mont Noir visibles à vision+2
// — Ratio global guidé: 35% Biomes / 65% Déserts (fenêtre 30–40% / 60–70%)
// — Difficultés: Débutant, Normal, Sans limites (contraintes locales)
// — Contrainte Oasis isolée, Cité Fantôme ≤3 contigus, Lacs 1–5, Mer d'ombre 1–5
// — Rivières: sources (40% Mont, 40% Mont Noir, 20% autre éligible), chemin sur (Rivière/Lac/Canyon plat),
//    fin dans Mer d'ombre possible. Courbes (Bezier), 10px bleu marine, triangle (début) & disque (fin)
// — Trail 6 cases, Export SVG/PNG, contours internes, fond noir, police Times
// ========================

// ---- Types ----
const CATEGORIES = { BIOME: "Biome", DESERT: "Désert" } as const;

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
  genMoveId: number;
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

const TYPE_BY_KEY: Record<string, TileType> = Object.fromEntries(TILE_TYPES.map((t) => [t.key, t]));

// ---- Utilitaires ----
const DIRS: [number, number][] = [ [1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1] ];

function axialToPixel(q: number, r: number, size: number) {
  const x = size * Math.sqrt(3) * (q + r / 2);
  const y = size * (3 / 2) * r; return { x, y };
}
function polygonPoints(cx: number, cy: number, size: number) {
  const pts: [number, number][] = []; for (let i=0;i<6;i++){ const a=(Math.PI/180)*(60*i-30); pts.push([cx+size*Math.cos(a), cy+size*Math.sin(a)]);} return pts.map(p=>p.join(',')).join(' ');
}
function keyOf(q: number, r: number) { return `${q},${r}`; }
function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }) {
  const ax=a.q, az=a.r, ay=-ax-az; const bx=b.q, bz=b.r, by=-bx-bz; return Math.max(Math.abs(ax-bx), Math.abs(ay-by), Math.abs(az-bz));
}
function hashRand(seed: string){ let h=2166136261>>>0; for(let i=0;i<seed.length;i++){ h^=seed.charCodeAt(i); h=Math.imul(h,16777619);} return ()=>((h=Math.imul(h^(h>>>15),2246822507)^Math.imul(h^(h>>>13),3266489909))>>>0)/4294967296; }
function luminance(hex:string){ const c=hex.replace('#',''); const r=parseInt(c.substring(0,2),16)/255; const g=parseInt(c.substring(2,4),16)/255; const b=parseInt(c.substring(4,6),16)/255; const a=[r,g,b].map(v=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)); return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2]; }
function textColorFor(bg:string){ return luminance(bg)>0.35?'#0b0f19':'#ffffff'; }

// ---- Export helpers ----
function downloadSvg(svgEl: SVGSVGElement, filename = "hexmap.svg") {
  const serializer = new XMLSerializer(); let source = serializer.serializeToString(svgEl);
  if(!source.match(/^<svg[^>]+xmlns=\"http:\/\/www.w3.org\/2000\/svg\"/)){ source = source.replace('<svg','<svg xmlns="http://www.w3.org/2000/svg"'); }
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' }); const url = URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
function exportPngFromSvg(svgEl: SVGSVGElement, filename='hexmap.png', scale=2){ const serializer=new XMLSerializer(); let source=serializer.serializeToString(svgEl); if(!source.match(/^<svg[^>]+xmlns=\"http:\/\/www.w3.org\/2000\/svg\"/)){ source=source.replace('<svg','<svg xmlns="http://www.w3.org/2000/svg"'); } const svgBlob=new Blob([source],{type:'image/svg+xml;charset=utf-8'}); const url=URL.createObjectURL(svgBlob); const img=new Image(); img.onload=()=>{ const canvas=document.createElement('canvas'); canvas.width=img.width*scale; canvas.height=img.height*scale; const ctx=canvas.getContext('2d')!; ctx.setTransform(scale,0,0,scale,0,0); ctx.drawImage(img,0,0); URL.revokeObjectURL(url); canvas.toBlob((blob)=>{ if(!blob) return; const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); },'image/png'); }; img.src=url; }

// ---- Rivers ----
interface River { nodes: {q:number;r:number}[]; finished:boolean; }

// Ajuste taille label pour ne pas dépasser
function fitLabel(label: string, size: number) {
  const base = Math.max(10, Math.round(size * 0.26)); const charW = base * 0.6; const maxW = size * 1.55; const need = label.length * charW; if (need <= maxW) return base; const scale = maxW / need; return Math.max(9, Math.floor(base * scale));
}

// ---- Difficultés ----
const DIFFS = {
  DEBUTANT: 'debutant',
  NORMAL: 'normal',
  SANS: 'sans_limites',
} as const;

type Diff = typeof DIFFS[keyof typeof DIFFS];

function getLimits(diff: Diff){
  switch(diff){
    case DIFFS.DEBUTANT: return { maxDesertGap: 2, maxDesertBlob: 10, maxBiomeBlob: 5, oasisIsolated: true };
    case DIFFS.NORMAL: return { maxDesertGap: 3, maxDesertBlob: 20, maxBiomeBlob: 4, oasisIsolated: true, oasisSurrounded: true };
    default: return { maxDesertGap: Infinity, maxDesertBlob: Infinity, maxBiomeBlob: Infinity, oasisIsolated: false };
  }
}

// ---- Composant principal ----
export default function HexMapGenerator(){
  const [size, setSize] = useState<number>(58);
  const [seedBase, setSeedBase] = useState<string>('caerwynn-001');
  const [moveId, setMoveId] = useState<number>(0);
  const [rerollNonce, setRerollNonce] = useState<number>(0);
  const [pos, setPos] = useState<{q:number;r:number}>({q:0,r:0});

  // Fog
  const [fogOn, setFogOn] = useState<boolean>(true);
  const [visionRadius, setVisionRadius] = useState<number>(2); // 1..3

  // Trail (6 dernières)
  const [trail, setTrail] = useState<{q:number;r:number}[]>([]);

  // Rivers
  const [rivers, setRivers] = useState<River[]>([]);

  // Difficulty
  const [diff, setDiff] = useState<Diff>(DIFFS.NORMAL);

  // Ratio tracking
  const [countBiome, setCountBiome] = useState<number>(0);
  const [countDesert, setCountDesert] = useState<number>(0);

  // Tiles
  const [tiles, setTiles] = useState<Map<string, TileInstance>>(()=>{
    const m=new Map<string,TileInstance>();
    const t = { q:0, r:0, typeKey: 'foret', genMoveId: 0 } as TileInstance; // seed centre Biome
    m.set(keyOf(0,0), t); setTimeout(()=>{ setCountBiome(1); }, 0);
    return m;
  });

  const limits = getLimits(diff);

  // --- Génération centrale ---
  function pickCategoryGuided(){
    const total = countBiome + countDesert; const biomeRatio = total>0 ? (countBiome/total) : 0.35;
    // cible 0.35 (fenêtre 0.30-0.40)
    let pBiome = 0.35;
    if (biomeRatio < 0.30) pBiome = 0.55; // corriger vers le haut
    else if (biomeRatio < 0.35) pBiome = 0.45;
    else if (biomeRatio > 0.40) pBiome = 0.20; // corriger vers le bas
    else if (biomeRatio > 0.35) pBiome = 0.30;
    // Sans limites : on garde la même guidage ratio (demandé)
    return Math.random() < pBiome ? CATEGORIES.BIOME : CATEGORIES.DESERT;
  }

  function pickTypeInCategory(cat: Category, q:number, r:number): string {
    // pondération simple + contraintes locales
    const candidates = TILE_TYPES.filter(t=>t.category===cat);
    // Appliquer règles locales spécifiques
    const shuffle = [...candidates].sort(()=>Math.random()-0.5);
    for (const t of shuffle){
      if (!violatesLocalRules(t.key, q, r)) return t.key;
    }
    // Si tout viole, on relâche
    return shuffle[0].key;
  }

  function violatesLocalRules(typeKey:string, q:number, r:number): boolean {
    // Cluster constraints
    const aroundSame = countContiguousSame(typeKey, q, r);
    if (typeKey==='lac' && aroundSame >= 5) return true; // Lacs <=5
    if (typeKey==='mer_d_ombre' && aroundSame >= 5) return true; // Mer d'ombre <=5
    if (typeKey==='cite_fantome' && aroundSame >= 3) return true; // Cité fantôme <=3

    // Biome contiguous cap (global par groupe Biome)
    if (TYPE_BY_KEY[typeKey].category===CATEGORIES.BIOME && limits.maxBiomeBlob !== Infinity){
      const biomeContig = countContiguousGroup(q, r, (k)=>TYPE_BY_KEY[k].category===CATEGORIES.BIOME);
      if (biomeContig >= limits.maxBiomeBlob) return true;
    }
    // Desert blob cap (par groupe Désert) — i.e. n'importe quel désert
    if (TYPE_BY_KEY[typeKey].category===CATEGORIES.DESERT && limits.maxDesertBlob !== Infinity){
      const desertContig = countContiguousGroup(q, r, (k)=>TYPE_BY_KEY[k].category===CATEGORIES.DESERT);
      if (desertContig >= limits.maxDesertBlob) return true;
    }

    // Oasis isolé : si oasis, ses voisins devront être déserts (on laisse passer ici; enforcement plus tard)
    return false;
  }

  function countContiguousSame(typeKey:string, q:number, r:number): number {
    // compte dans le voisinage immédiat du même type (approx locale)
    let n=0; for(const [dq,dr] of DIRS){ const k=keyOf(q+dq,r+dr); const t=tiles.get(k); if(t?.typeKey===typeKey) n++; } return n;
  }
  function countContiguousGroup(q:number,r:number, pred:(k:string)=>boolean): number {
    let n=0; for(const [dq,dr] of DIRS){ const k=keyOf(q+dq,r+dr); const t=tiles.get(k); if(t && pred(t.typeKey)) n++; } return n;
  }

  function nearestBiomeDistance(q:number,r:number): number{
    // petite recherche locale jusqu'à rayon 6
    for(let d=0; d<=6; d++){
      for(const [aq,ar] of ringCoords({q,r}, d)){ const t=tiles.get(keyOf(aq,ar)); if(t && TYPE_BY_KEY[t.typeKey].category===CATEGORIES.BIOME) return d; }
    }
    return Infinity;
  }

  function *ringCoords(center:{q:number;r:number}, rad:number){
    if (rad===0){ yield [center.q, center.r] as [number,number]; return; }
    let q=center.q + DIRS[4][0]*rad; let r=center.r + DIRS[4][1]*rad; // start at direction 4
    for(let side=0; side<6; side++){
      const [dq,dr]=DIRS[side]; for(let i=0;i<rad;i++){ yield [q,r] as [number,number]; q+=dq; r+=dr; }
    }
  }

  function generateTile(q:number, r:number, seed:string, mId:number, rr:number){
    // Choix guidé par ratio + contraintes de difficulté
    let cat = pickCategoryGuided();
    if (limits.maxDesertGap!==Infinity){
      const dToBiome = nearestBiomeDistance(q,r);
      if (dToBiome>limits.maxDesertGap){ cat = CATEGORIES.BIOME; }
    }
    let typeKey = pickTypeInCategory(cat, q, r);

    // Oasis isolé : si choisi et option active, on marquera ses voisins en désert à la génération future
    return { q, r, typeKey } as TileInstance;
  }

  function ensureGeneratedAround(center:{q:number;r:number}, rad:number, mId:number, rr:number){
    setTiles(prev=>{
      const next=new Map(prev);
      for(let dq=-rad; dq<=rad; dq++){
        for(let dr=Math.max(-rad, -dq-rad); dr<=Math.min(rad, -dq+rad); dr++){
          const q=center.q + dq; const r=center.r + dr; const k=keyOf(q,r);
          if (!next.has(k)){
            let t = generateTile(q, r, seedBase, mId, rr);
            // Enforcement Oasis: si oasis et difficulté demande isolation, on forcera les voisins en désert au moment où ils apparaîtront
            next.set(k, { ...t, genMoveId: mId });
            // Comptage ratio
            const cat = TYPE_BY_KEY[t.typeKey].category; if (cat===CATEGORIES.BIOME) setCountBiome(x=>x+1); else setCountDesert(x=>x+1);
          }
        }
      }
      // Post-traitements locaux : si une oasis vient d'apparaître, marquer voisins comme "préférer désert"
      return next;
    });
  }

  function rerollLastRing(){
    setTiles(prev=>{
      const next=new Map(prev);
      for(const [k,v] of next){ if(v.genMoveId===moveId){ const t=generateTile(v.q,v.r,seedBase,moveId,rerollNonce+1); next.set(k,{...t,genMoveId:moveId}); } }
      return next;
    });
    setRerollNonce(x=>x+1);
  }

  function move(dirIdx:number){
    const [dq,dr]=DIRS[dirIdx%6];
    const np={ q: pos.q + dq, r: pos.r + dr };
    const nextMove=moveId+1; setTrail(t=>[{...pos},...t].slice(0,6)); setPos(np); setMoveId(nextMove); setRerollNonce(0);
    ensureGeneratedAround(np, 2, nextMove, 0);
    // Tentative de rivière
    maybeStartOrExtendRiver(np, nextMove);
  }

  // --- Rivers logic (simple heuristique) ---
  const riverEligible = new Set<string>(['riviere','lac','canyon_plat','mer_d_ombre']);
  const isRiverPassable = (typeKey:string)=> typeKey==='riviere'||typeKey==='lac'||typeKey==='canyon_plat';

  function maybeStartOrExtendRiver(center:{q:number;r:number}, mId:number){
    // 50% de tenter quelque chose par déplacement
    if (Math.random()<0.5){
      setRivers(prev=>{
        const next=[...prev];
        // 60% essayer d'étendre une rivière existante, sinon en démarrer une
        if (prev.length>0 && Math.random()<0.6){
          const idx = Math.floor(Math.random()*prev.length); const rv=next[idx];
          if (!rv.finished){ const head = rv.nodes[0]; const n = pickNextRiverStep(head.q, head.r); if (n){ rv.nodes.unshift(n); if (TYPE_BY_KEY[tiles.get(keyOf(n.q,n.r))?.typeKey||'']?.key==='mer_d_ombre'){ rv.finished=true; } } else { rv.finished=true; } }
        } else {
          const start = pickRiverSourceNear(center);
          if (start){ next.push({ nodes:[start], finished:false }); }
        }
        return next;
      });
    }
  }

  function pickRiverSourceNear(center:{q:number;r:number}): {q:number;r:number}|null{
    // collect candidates in radius 4
    const candMont: {q:number;r:number}[]=[]; const candNoir: {q:number;r:number}[]=[]; const candOther: {q:number;r:number}[]=[];
    for(let d=0; d<=4; d++){
      for(const [q,r] of ringCoords(center,d)){
        const t=tiles.get(keyOf(q,r)); if(!t) continue; const k=t.typeKey;
        if (k==='mont') candMont.push({q,r}); else if (k==='mont_noir') candNoir.push({q,r}); else if (isRiverPassable(k)) candOther.push({q,r});
      }
    }
    const r=Math.random();
    const bag = r<0.4?candMont: r<0.8?candNoir: candOther;
    if (bag.length===0) return null; return bag[Math.floor(Math.random()*bag.length)];
  }

  function pickNextRiverStep(q:number,r:number): {q:number;r:number}|null{
    // choisir un voisin passable; si Canyon Plat, ajouter du bruit (géré au rendu)
    const opts: {q:number;r:number}[]=[]; for(const [dq,dr] of DIRS){ const k=keyOf(q+dq,r+dr); const t=tiles.get(k); if(!t) continue; if (isRiverPassable(t.typeKey) || t.typeKey==='mer_d_ombre'){ opts.push({q:q+dq,r:r+dr}); } }
    if (opts.length===0) return null; return opts[Math.floor(Math.random()*opts.length)];
  }

  // --- Découvertes triées pour légende ---
  const { discoveredBiomes, discoveredDeserts } = useMemo(()=>{
    const discovered=new Map<string,TileType>(); for(const v of tiles.values()){ discovered.set(v.typeKey, TYPE_BY_KEY[v.typeKey]); }
    const all=Array.from(discovered.values());
    const biomes=all.filter(t=>t.category===CATEGORIES.BIOME).sort((a,b)=>COLOR_INDEX[a.color]-COLOR_INDEX[b.color]);
    const deserts=all.filter(t=>t.category===CATEGORIES.DESERT).sort((a,b)=>COLOR_INDEX[a.color]-COLOR_INDEX[b.color]);
    return { discoveredBiomes:biomes, discoveredDeserts:deserts };
  },[tiles]);

  // --- Dimensions & culling visuel ---
  const VISIBLE_RADIUS = 10; const margin=32;
  const dims = useMemo(()=>{
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity; for(const v of tiles.values()){ if(hexDistance({q:v.q,r:v.r}, pos)>VISIBLE_RADIUS) continue; const {x,y}=axialToPixel(v.q,v.r,size); minX=Math.min(minX,x-size*Math.sqrt(3)/2); maxX=Math.max(maxX,x+size*Math.sqrt(3)/2); minY=Math.min(minY,y-size); maxY=Math.max(maxY,y+size); }
    if(minX===Infinity) return {width:300,height:300,offsetX:margin,offsetY:margin}; const width=Math.ceil(maxX-minX+margin*2); const height=Math.ceil(maxY-minY+margin*2); const offsetX=Math.ceil(margin-minX); const offsetY=Math.ceil(margin-minY); return {width,height,offsetX,offsetY};
  },[tiles,size,pos]);

  const svgRef=useRef<SVGSVGElement|null>(null);
  const handleExportSvg=()=>{ if(svgRef.current) downloadSvg(svgRef.current); };
  const handleExportPng=()=>{ if(svgRef.current) exportPngFromSvg(svgRef.current); };

  const uiFont = { fontFamily: 'Times New Roman, Times, serif' } as const;

  // Seed globale
  function rerollGlobal(){ const base = `${Date.now()}`; setSeedBase(base); setRerollNonce(0); setMoveId(0); setCountBiome(0); setCountDesert(0); setRivers([]); setTrail([]); setTiles(new Map([[keyOf(pos.q,pos.r), { q:pos.q, r:pos.r, typeKey:'foret', genMoveId:0 }]])); setCountBiome(1); }

  // --- Rendering helpers ---
  function isVisibleTile(t:TileInstance){
    const d = hexDistance({q:t.q,r:t.r}, pos);
    if (!fogOn) return true;
    const baseVisible = d <= visionRadius;
    if (baseVisible) return true;
    // Mont/Mont Noir visibles à +2
    if ((t.typeKey==='mont'||t.typeKey==='mont_noir') && d <= visionRadius+2) return true;
    return false;
  }

  function riverPathD(nodes:{q:number;r:number}[], canyonNoise=false){
    const pts = nodes.map(n=>axialToPixel(n.q,n.r,size)); if (pts.length===0) return '';
    const jitter = (i:number)=> (canyonNoise? 10 : 5) * (Math.sin(i*1.7)+Math.cos(i*1.3));
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i=1;i<pts.length;i++){
      const a=pts[i-1], b=pts[i]; const mx=(a.x+b.x)/2 + jitter(i); const my=(a.y+b.y)/2 - jitter(i);
      d += ` Q ${mx} ${my} ${b.x} ${b.y}`;
    }
    return d;
  }

  return (
    <div style={{ background:'#000', color:'#e5e7eb', minHeight:'100vh', padding:16, display:'grid', gap:16, gridTemplateColumns:'360px 1fr' }}>
      {/* Panneau gauche */}
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <h1 style={{ ...(uiFont as any), fontSize:24 }}>Générateur / Explorateur d'Hex</h1>

        {/* Contrôles mouvement & export */}
        <div style={{ border:'1px solid #333', borderRadius:12, padding:12 }}>
          <div style={{ marginBottom:8, fontSize:12, opacity:0.8 }}>Caravane (q:{pos.q} r:{pos.r})</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6, placeItems:'center' }}>
            <button onClick={()=>move(2)} style={btn()}>↖︎</button>
            <button onClick={()=>move(1)} style={btn()}>↑</button>
            <button onClick={()=>move(0)} style={btn()}>↗︎</button>
            <button onClick={()=>move(3)} style={btn()}>←</button>
            <button disabled style={{ ...btn(), opacity:0.4 }}>•</button>
            <button onClick={()=>move(5)} style={btn()}>→</button>
            <button onClick={()=>move(4)} style={btn()}>↙︎</button>
          </div>
          <div style={{ marginTop:10, display:'grid', gap:8 }}>
            <label style={{ fontSize:12, opacity:0.8 }}>Taille tuile</label>
            <input type="range" min={36} max={92} value={size} onChange={e=>setSize(parseInt(e.target.value,10))} />
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <button onClick={handleExportSvg} style={btn()}>Exporter SVG</button>
              <button onClick={handleExportPng} style={btn()}>Exporter PNG</button>
              <button onClick={()=>rerollLastRing()} style={btnStrong()}>Nouvelle seed (dernier déplacement)</button>
            </div>
          </div>
        </div>

        {/* Brouillard & Difficulté */}
        <div style={{ border:'1px solid #333', borderRadius:12, padding:12, display:'grid', gap:8 }}>
          <div style={{ ...(uiFont as any), fontSize:16 }}>Brouillard de guerre</div>
          <label style={{ display:'flex', alignItems:'center', gap:8 }}>
            <input type="checkbox" checked={fogOn} onChange={e=>setFogOn(e.target.checked)} /> Activer le brouillard
          </label>
          <label>
            <div style={{ fontSize:12, opacity:0.8 }}>Champ de vision: {visionRadius}</div>
            <input type="range" min={1} max={3} value={visionRadius} onChange={e=>setVisionRadius(parseInt(e.target.value,10))} />
          </label>
          <div style={{ ...(uiFont as any), fontSize:16, marginTop:8 }}>Difficulté</div>
          <select value={diff} onChange={e=>setDiff(e.target.value as Diff)} style={{ background:'#0b0f19', color:'#e5e7eb', border:'1px solid #333', borderRadius:8, padding:'6px 8px' }}>
            <option value={DIFFS.DEBUTANT}>Débutant</option>
            <option value={DIFFS.NORMAL}>Normal</option>
            <option value={DIFFS.SANS}>Sans limites</option>
          </select>
        </div>

        {/* Légende triée */}
        <div style={{ border:'1px solid #333', borderRadius:12, padding:12 }}>
          <div style={{ ...(uiFont as any), fontSize:16, marginBottom:8 }}>Biomes découverts</div>
          <LegendList items={discoveredBiomes} />
          <div style={{ ...(uiFont as any), fontSize:16, marginTop:12, marginBottom:8 }}>Déserts découverts</div>
          <LegendList items={discoveredDeserts} />
        </div>

        {/* Seed globale */}
        <div style={{ border:'1px solid #333', borderRadius:12, padding:12, display:'grid', gap:6 }}>
          <button onClick={rerollGlobal} style={btnStrong()}>Nouvelle seed GLOBALE</button>
          <label style={{ fontSize:12, opacity:0.8 }}>Seed de base</label>
          <input value={seedBase} onChange={e=>setSeedBase(e.target.value)} style={{ background:'#0b0f19', color:'#e5e7eb', border:'1px solid #333', borderRadius:8, padding:'6px 8px' }} />
        </div>
      </div>

      {/* Zone SVG */}
      <div style={{ overflow:'auto', border:'1px solid #222', borderRadius:12, background:'#0b0f19' }}>
        <svg ref={svgRef} width={dims.width} height={dims.height} viewBox={`0 0 ${dims.width} ${dims.height}`}>
          <g transform={`translate(${dims.offsetX}, ${dims.offsetY})`}>
            {/* Tuiles visibles seulement (<= 10) */}
            {Array.from(tiles.values()).map((tile)=>{
              if (hexDistance({q:tile.q,r:tile.r}, pos)>VISIBLE_RADIUS) return null;
              const {x,y}=axialToPixel(tile.q,tile.r,size); const type=TYPE_BY_KEY[tile.typeKey];
              const visible = isVisibleTile(tile); const adjToVision = fogOn && !visible && hexDistance({q:tile.q,r:tile.r},pos)===visionRadius+1;
              const fill = visible ? type.color : (adjToVision ? (type.category===CATEGORIES.BIOME?'#9ca3af55':'#111827aa') : '#0b0f1955');
              const outline = visible ? (type.category===CATEGORIES.BIOME?'#ffffff':'#000000') : (adjToVision ? (type.category===CATEGORIES.BIOME?'#ffffff88':'#00000088') : '#00000033');
              const ptsOuter = polygonPoints(x,y,size); const ptsInner = polygonPoints(x,y,Math.max(6,size-4));
              const labelColor = textColorFor(type.color); const labelY = y + size*0.62; const fitted = fitLabel(type.label,size);
              return (
                <g key={`${tile.q},${tile.r}`}>
                  <polygon points={ptsOuter} fill={fill} />
                  <polygon points={ptsInner} fill="none" stroke={outline} strokeWidth={3} />
                  <polygon points={ptsOuter} fill="none" stroke={visible ? (labelColor==='#ffffff'?'rgba(255,255,255,0.22)':'rgba(0,0,0,0.22)') : 'rgba(255,255,255,0.08)'} strokeWidth={1.5} />
                  {visible && (<text x={x} y={labelY} textAnchor="middle" style={{ fontFamily:'Times New Roman, Times, serif', fontStyle:'italic', fontSize:fitted }} fill={labelColor}>{type.label}</text>)}
                </g>
              );
            })}

            {/* Rivières */}
            {rivers.map((rv,idx)=>{
              if (rv.nodes.length<2) return null;
              // Déterminer si plus bruit (canyon) selon présence d'un canyon dans le chemin
              const hasCanyon = rv.nodes.some(n=> tiles.get(keyOf(n.q,n.r))?.typeKey==='canyon_plat');
              const d = riverPathD(rv.nodes, hasCanyon);
              const start = axialToPixel(rv.nodes[rv.nodes.length-1].q, rv.nodes[rv.nodes.length-1].r, size);
              const end = axialToPixel(rv.nodes[0].q, rv.nodes[0].r, size);
              const tri = `${start.x-15},${start.y-26} ${start.x+15},${start.y-26} ${start.x},${start.y-0}`;
              return (
                <g key={`river-${idx}`}>
                  {/* début triangle */}
                  <polygon points={tri} fill="#0a2a66" />
                  {/* cours */}
                  <path d={d} fill="none" stroke="#0a2a66" strokeWidth={10} strokeLinejoin="round" strokeLinecap="round" />
                  {/* fin disque si terminé */}
                  {rv.finished && <circle cx={end.x} cy={end.y} r={15} fill="#0a2a66" />}
                </g>
              );
            })}

            {/* Pion caravane */}
            {(()=>{ const {x,y}=axialToPixel(pos.q,pos.r,size); const rHead=Math.max(3,size*0.12); const bodyH=rHead*2.2; const gap=rHead*1.8; const baseY=y+rHead*0.4; return (
              <g>
                {[-gap,0,gap].map((dx,idx)=>(<g key={idx}><circle cx={x+dx} cy={baseY-bodyH} r={rHead} fill="#ffe680" stroke="#000" strokeWidth={1.5}/><rect x={x+dx-rHead*0.6} y={baseY-bodyH+rHead*0.6} width={rHead*1.2} height={bodyH} rx={rHead*0.3} fill="#ffd166" stroke="#000" strokeWidth={1.5}/></g>))}
                <ellipse cx={x} cy={baseY+bodyH+2} rx={gap+rHead} ry={rHead*0.6} fill="rgba(0,0,0,0.35)" />
              </g>
            ); })()}

            {/* Trail au-dessus */}
            {trail.length>0 && (
              <polyline points={[{q:pos.q,r:pos.r},...trail].map(p=>{const {x,y}=axialToPixel(p.q,p.r,size); return `${x},${y}`;}).join(' ')} fill="none" stroke="#fff" strokeOpacity={0.8} strokeWidth={Math.max(2,size*0.08)} strokeDasharray="6 6" />
            )}

            {/* Cases cliquables (6 voisines) */}
            {DIRS.map(([dq,dr],i)=>{ const nq=pos.q+dq,nr=pos.r+dr; const {x,y}=axialToPixel(nq,nr,size); const pts=polygonPoints(x,y,size*0.98); return (<polygon key={`click-${i}`} points={pts} fill="rgba(255,255,255,0.01)" stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" style={{cursor:'pointer'}} onClick={()=>move(i)} />); })}
          </g>
        </svg>
      </div>
    </div>
  );
}

function btn(): CSSProperties { return { background:'#111827', color:'#e5e7eb', border:'1px solid #333', borderRadius:8, padding:'6px 10px', cursor:'pointer' } as CSSProperties; }
function btnStrong(): CSSProperties { return { background:'#1f2937', color:'#e5e7eb', border:'1px solid #555', borderRadius:8, padding:'6px 10px', cursor:'pointer', fontWeight:700 } as CSSProperties; }

function LegendList({ items }: { items: TileType[] }){
  return (
    <ul style={{ margin:0, paddingLeft:0, listStyle:'none', display:'grid', gap:6 }}>
      {items.length===0 ? (<li style={{ opacity:0.7 }}>Aucun.</li>) : items.map((t)=>{ const border=t.category===CATEGORIES.BIOME?'#ffffff':'#000000'; return (
        <li key={t.key} style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ display:'inline-block', width:16, height:16, background:t.color, border:`3px solid ${border}`, boxShadow:'inset 0 0 0 2px rgba(0,0,0,0.25)', borderRadius:2 }} />
          <span style={{ fontFamily:'Times New Roman, Times, serif' }}>{t.label}</span>
        </li>
      ); })}
    </ul>
  );
}