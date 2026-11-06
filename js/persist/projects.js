import { openDB, request, done } from './db.js';
import { createZip, readZip } from './zip.js';

/**
 * 项目存储（IndexedDB）
 *   projects：{ id, name, createdAt, updatedAt, settings, order, slideCount, thumb }
 *             order 中图片为 slideId 字符串，示例空位为 { id, placeholder: true }
 *   files：   { id, projectId, name, path, file }                 —— 幻灯片原图
 *             { id, projectId, name, file, kind: 'asset' }        —— 素材（背景图）
 * 所有写操作串行执行，避免事务交错。
 */

let queue = Promise.resolve();
const serial = fn => {
  const p = queue.then(fn);
  queue = p.catch(() => {});
  return p;
};

const newProjectId = () => `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const newSlideId = () => `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const newAssetId = () => `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

async function filesOf(db, projectId) {
  return request(db.transaction('files').objectStore('files').index('projectId').getAll(projectId));
}

export async function listProjects() {
  const db = await openDB();
  const all = await request(db.transaction('projects').objectStore('projects').getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id) {
  if (!id) return null;
  const db = await openDB();
  return (await request(db.transaction('projects').objectStore('projects').get(id))) || null;
}

/** 读取项目的幻灯片：[{ id, name, path, file } | { id, placeholder: true }] */
export async function loadProjectSlides(record) {
  const db = await openDB();
  const byId = new Map((await filesOf(db, record.id)).filter(f => f.kind !== 'asset').map(f => [f.id, f]));
  return (record.order || [])
    .map(entry => (typeof entry === 'object' && entry?.placeholder ? entry : byId.get(entry)))
    .filter(Boolean);
}

/** 读取项目的素材：[{ id, name, file }] */
export async function loadProjectAssets(record) {
  const db = await openDB();
  return (await filesOf(db, record.id)).filter(f => f.kind === 'asset');
}

export const createProject = ({ name, settings }) => serial(async () => {
  const db = await openDB();
  const now = Date.now();
  const rec = { id: newProjectId(), name, createdAt: now, updatedAt: now, settings, order: [], slideCount: 0, thumb: null };
  const tx = db.transaction('projects', 'readwrite');
  tx.objectStore('projects').put(rec);
  await done(tx);
  return rec;
});

/** 增量保存：只写入新增的图片、删除移除的图片，再更新项目记录 */
export const saveProject = ({ id, name, settings, slides, assets = [] }) => serial(async () => {
  const db = await openDB();
  const rec = await getProject(id);
  if (!rec) return;
  const images = slides.filter(s => s.source instanceof Blob);
  const existing = new Set(await request(db.transaction('files').objectStore('files').index('projectId').getAllKeys(id)));
  const keep = new Set([...images.map(s => s.id), ...assets.map(a => a.id)]);

  const tx = db.transaction(['files', 'projects'], 'readwrite');
  const files = tx.objectStore('files');
  for (const s of images) {
    if (!existing.has(s.id)) files.put({ id: s.id, projectId: id, name: s.name, path: s.path, file: s.source });
  }
  for (const a of assets) {
    if (!existing.has(a.id)) files.put({ id: a.id, projectId: id, name: a.name, file: a.file, kind: 'asset' });
  }
  for (const key of existing) if (!keep.has(key)) files.delete(key);
  const order = images.length ? slides.map(s => (s.placeholder ? { id: s.id, placeholder: true } : s.id)) : [];
  tx.objectStore('projects').put({ ...rec, name, settings, order, slideCount: images.length, updatedAt: Date.now() });
  await done(tx);
});

const patchProject = (id, patch) => serial(async () => {
  const db = await openDB();
  const rec = await getProject(id);
  if (!rec) return null;
  const next = { ...rec, ...patch };
  const tx = db.transaction('projects', 'readwrite');
  tx.objectStore('projects').put(next);
  await done(tx);
  return next;
});

export const renameProject = (id, name) => patchProject(id, { name, updatedAt: Date.now() });
export const setProjectThumb = (id, thumb) => patchProject(id, { thumb }); // 缩略图不算修改，不更新时间

export const deleteProject = id => serial(async () => {
  const db = await openDB();
  const keys = await request(db.transaction('files').objectStore('files').index('projectId').getAllKeys(id));
  const tx = db.transaction(['files', 'projects'], 'readwrite');
  for (const k of keys) tx.objectStore('files').delete(k);
  tx.objectStore('projects').delete(id);
  await done(tx);
});

// 写入一个完整的新项目（复制 / 导入共用）。素材会换新 id，并同步更新设置里的引用。
async function insertProject({ name, settings, slides, assets = [], thumb = null }) {
  const db = await openDB();
  const now = Date.now();
  const id = newProjectId();
  const tx = db.transaction(['files', 'projects'], 'readwrite');
  const assetIds = new Map();
  for (const a of assets) {
    const aid = newAssetId();
    assetIds.set(a.id, aid);
    tx.objectStore('files').put({ id: aid, projectId: id, name: a.name, file: a.file, kind: 'asset' });
  }
  // 背景图引用在每个画板的样式里（旧数据在顶层 style）
  const remap = st => (st?.bgImageId ? { ...st, bgImageId: assetIds.get(st.bgImageId) || null } : st);
  if (settings?.style) settings = { ...settings, style: remap(settings.style) };
  const remapLayers = layers => (Array.isArray(layers)
    ? layers.map(l => (l.type === 'image' && l.assetId ? { ...l, assetId: assetIds.get(l.assetId) || null } : l))
    : layers);
  if (Array.isArray(settings?.artboards)) {
    settings = {
      ...settings,
      artboards: settings.artboards.map(b => ({ ...b, settings: { ...b.settings, style: remap(b.settings?.style), layers: remapLayers(b.settings?.layers) } })),
    };
  }
  const order = [];
  const slideIds = new Map(); // 旧 id → 新 id
  for (const s of slides) {
    if (s.placeholder) { order.push({ id: s.id, placeholder: true }); continue; }
    const sid = newSlideId();
    if (s.id) slideIds.set(s.id, sid);
    tx.objectStore('files').put({ id: sid, projectId: id, name: s.name, path: s.path || s.name, file: s.file });
    order.push(sid);
  }
  // 每个画板的图片顺序（slideIds）换成新 id；找不到对应关系时（旧文件）让画板使用全部图片
  if (Array.isArray(settings?.artboards)) {
    settings = {
      ...settings,
      artboards: settings.artboards.map(b => {
        const ids = b.settings?.slideIds;
        if (!Array.isArray(ids)) return b;
        const ok = ids.every(x => slideIds.has(x) || slides.some(s => s.placeholder && s.id === x));
        const { slideIds: _, ...rest } = b.settings;
        return { ...b, settings: ok ? { ...rest, slideIds: ids.map(x => slideIds.get(x) || x) } : rest };
      }),
    };
  }
  // 共用图片列表（sharedIds）同样换成新 id
  if (Array.isArray(settings?.sharedIds)) {
    const known = x => slideIds.has(x) || slides.some(s => s.placeholder && s.id === x);
    settings = settings.sharedIds.every(known)
      ? { ...settings, sharedIds: settings.sharedIds.map(x => slideIds.get(x) || x) }
      : (({ sharedIds: _, ...rest }) => rest)(settings);
  }
  const rec = {
    id, name, createdAt: now, updatedAt: now, settings,
    order: order.some(x => typeof x === 'string') ? order : [],
    slideCount: order.filter(x => typeof x === 'string').length,
    thumb,
  };
  tx.objectStore('projects').put(rec);
  await done(tx);
  return rec;
}

export const duplicateProject = (id, name) => serial(async () => {
  const rec = await getProject(id);
  if (!rec) throw new Error('项目不存在');
  const slides = await loadProjectSlides(rec);
  const assets = await loadProjectAssets(rec);
  return insertProject({ name, settings: rec.settings, slides, assets, thumb: rec.thumb });
});

/* ---------------- 项目文件（.slidegrid，内部为 ZIP） ---------------- */

const FORMAT = 'slidegrid-project';
const safeName = s => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80);
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml' };
const mimeOf = name => MIME[(name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

export async function exportProjectFile(id) {
  const rec = await getProject(id);
  if (!rec) throw new Error('项目不存在');
  const slides = await loadProjectSlides(rec);
  const entries = [];
  const manifestSlides = slides.map((s, i) => {
    if (s.placeholder) return { type: 'placeholder', id: s.id };
    const file = `images/${String(i + 1).padStart(3, '0')}-${safeName(s.name)}`;
    entries.push({ name: file, data: s.file });
    return { type: 'image', id: s.id, file, name: s.name, path: s.path };
  });
  const manifestAssets = (await loadProjectAssets(rec)).map(a => {
    const file = `assets/${a.id}-${safeName(a.name)}`;
    entries.push({ name: file, data: a.file });
    return { id: a.id, file, name: a.name };
  });
  const manifest = {
    format: FORMAT, version: 1, app: 'SlideGrid',
    name: rec.name, exportedAt: new Date().toISOString(),
    settings: rec.settings, slides: manifestSlides, assets: manifestAssets,
  };
  return createZip([{ name: 'project.json', data: JSON.stringify(manifest, null, 2) }, ...entries]);
}

export const importProjectFile = file => serial(async () => {
  const zip = await readZip(file);
  let manifest;
  try { manifest = JSON.parse(await zip.text('project.json')); } catch { throw new Error('不是 SlideGrid 项目文件'); }
  if (manifest.format !== FORMAT) throw new Error('不是 SlideGrid 项目文件');
  const slides = [];
  for (const s of manifest.slides || []) {
    if (s.type === 'placeholder') { slides.push({ id: s.id, placeholder: true }); continue; }
    const bytes = await zip.bytes(s.file);
    slides.push({ id: s.id, name: s.name, path: s.path, file: new File([bytes], s.name, { type: mimeOf(s.name) }) });
  }
  const assets = [];
  for (const a of manifest.assets || []) {
    const bytes = await zip.bytes(a.file);
    assets.push({ id: a.id, name: a.name, file: new File([bytes], a.name, { type: mimeOf(a.name) }) });
  }
  const base = manifest.name || file.name.replace(/\.slidegrid$/i, '');
  return insertProject({ name: base, settings: manifest.settings || {}, slides, assets });
});
