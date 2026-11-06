import { openDB, request, done } from './db.js';

/**
 * 我的版式（跨项目保存在 IndexedDB 的 presets 表）
 *
 * 记录格式（version 1）：
 *   { id, name, createdAt, updatedAt, version,
 *     layoutId,          基础版式（见 layouts/index.js）
 *     params,            版式参数
 *     adjust,            单张卡片调整 { [位置序号]: { dx, dy, rz, s, lift } }
 *     camera,            视图（缩放 / 平移 / 3D 角度）
 *     aspect | null,     画布比例（可选）
 *     style  | null,     样式（可选，不含背景图本身）
 *     thumb }            缩略图 Blob
 *
 * 以后新增可保存的属性时：加字段并提升 version；套用时缺省字段使用默认值即可兼容旧版式。
 */
export const PRESET_VERSION = 1;
const FILE_FORMAT = 'slidegrid-layouts';

const newId = () => `l_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function store(mode = 'readonly') {
  const db = await openDB();
  const tx = db.transaction('presets', mode);
  return { tx, os: tx.objectStore('presets') };
}

export async function listPresets() {
  const { os } = await store();
  return (await request(os.getAll())).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function putPreset(rec) {
  const { tx, os } = await store('readwrite');
  os.put(rec);
  await done(tx);
  return rec;
}

export function createPresetRecord(data) {
  const now = Date.now();
  return { id: newId(), createdAt: now, updatedAt: now, version: PRESET_VERSION, ...data };
}

export async function deletePreset(id) {
  const { tx, os } = await store('readwrite');
  os.delete(id);
  await done(tx);
}

const blobToDataUrl = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

/** 导出为 JSON 文件（缩略图内嵌为 data URL），方便分享 */
export async function exportPresetsFile(presets) {
  const items = [];
  for (const p of presets) {
    const { thumb, ...rest } = p;
    items.push({ ...rest, thumb: thumb instanceof Blob ? await blobToDataUrl(thumb) : null });
  }
  const json = JSON.stringify({ format: FILE_FORMAT, version: PRESET_VERSION, exportedAt: new Date().toISOString(), layouts: items }, null, 2);
  return new Blob([json], { type: 'application/json' });
}

export const isPresetsFile = f => /\.json$/i.test(f.name);

/** 导入 JSON 版式文件，返回新增的记录（重新分配 id，避免覆盖已有版式） */
export async function importPresetsFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('不是有效的版式文件'); }
  if (data?.format !== FILE_FORMAT || !Array.isArray(data.layouts)) throw new Error('不是 SlideGrid 版式文件');
  const added = [];
  for (const item of data.layouts) {
    if (!item?.layoutId) continue;
    const thumb = typeof item.thumb === 'string' && item.thumb.startsWith('data:image/')
      ? await (await fetch(item.thumb)).blob()
      : null;
    const { id, createdAt, updatedAt, ...rest } = item;
    added.push(await putPreset(createPresetRecord({ ...rest, thumb })));
  }
  return added;
}
