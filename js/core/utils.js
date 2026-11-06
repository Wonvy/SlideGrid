export const DEG = Math.PI / 180;

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// 从控件 schema 中取默认值
export function schemaDefaults(schema) {
  const out = {};
  for (const def of schema) if (def.key) out[def.key] = def.default;
  return out;
}

// 可复现的伪随机数
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex) {
  let h = String(hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export const nextFrame = () => new Promise(r => setTimeout(r, 0));
