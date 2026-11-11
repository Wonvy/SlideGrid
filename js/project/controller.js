import { settingsOf, defaultSettings, libraryOf, usedAssetIds } from '../state.js';
import { CURRENT_PROJECT_KEY } from '../persist/db.js';
import {
  listProjects, getProject, loadProjectSlides, loadProjectAssets, createProject, saveProject,
  renameProject, setProjectThumb, deleteProject, duplicateProject,
  exportProjectFile, importProjectFile, storageUsage, deleteFiles, markProjectExported,
} from '../persist/projects.js';
import { createZip } from '../persist/zip.js';
import { createSlides, createAsset } from '../slides/slideFactory.js';

/**
 * 项目控制器：负责当前项目的加载、自动保存、切换，以及新建/复制/删除/导入/导出。
 * onStatus(text) 用于在界面上显示保存状态。
 */
export function createProjectController({ store, actions, placeholders, snapshot, onStatus = () => {}, onChange = () => {} }) {
  let loading = true;
  let dirty = false;
  let saveTimer = 0, thumbTimer = 0;

  const current = () => store.get().project;
  const remember = id => { try { localStorage.setItem(CURRENT_PROJECT_KEY, id); } catch { /* 忽略 */ } };
  const status = text => onStatus(text);

  async function uniqueName(base) {
    const names = new Set((await listProjects()).map(p => p.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  }

  /* ---------- 保存 ---------- */

  async function save() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    const p = current();
    if (!p || loading || !dirty) return;
    dirty = false;
    status('保存中…');
    const s = store.get();
    try {
      await saveProject({ id: p.id, name: p.name, settings: settingsOf(s), slides: libraryOf(s), assets: Object.values(s.assets).filter(a => usedAssetIds(s).has(a.id)) });
      status(dirty ? '未保存' : '已保存');
      onChange();
    } catch (err) {
      console.error(err);
      dirty = true;
      status('保存失败');
    }
  }

  async function saveThumb() {
    const p = current();
    if (!p || loading) return;
    try {
      const blob = await snapshot(360);
      if (blob && current()?.id === p.id) {
        await setProjectThumb(p.id, blob);
        onChange();
      }
    } catch (err) {
      console.warn('生成项目缩略图失败：', err);
    }
  }

  // 设置或图片有变化时调用：0.5 秒后保存，1.5 秒后更新缩略图
  function markDirty() {
    if (loading || !current()) return;
    dirty = true;
    status('未保存');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 500);
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(saveThumb, 1500);
  }

  const flush = () => save();

  /* ---------- 打开 / 切换 ---------- */

  async function open(id) {
    await flush();
    const rec = await getProject(id);
    if (!rec) throw new Error('项目不存在');
    loading = true;
    status('加载中…');
    try {
      const entries = await loadProjectSlides(rec);
      const images = entries.filter(e => !e.placeholder);
      const created = await createSlides(images.map(r => ({ file: r.file, path: r.path, id: r.id, name: r.name })));
      const byId = new Map(created.map(x => [x.id, x]));
      const slides = entries
        .map(e => (e.placeholder ? placeholders.find(p => p.id === e.id) : byId.get(e.id)))
        .filter(Boolean);
      const assets = {};
      for (const a of await loadProjectAssets(rec)) {
        try { assets[a.id] = await createAsset(a); } catch (err) { console.warn('无法读取背景图：', a.name, err); }
      }
      actions.loadProject({ project: { id: rec.id, name: rec.name }, settings: rec.settings, slides, assets });
      remember(rec.id);
      return { record: rec, failed: images.length - created.length };
    } finally {
      dirty = false;
      loading = false;
      status('已保存');
      onChange();
    }
  }

  async function createNew(name) {
    await flush();
    const rec = await createProject({ name: await uniqueName(name || '未命名项目'), settings: defaultSettings() });
    await open(rec.id);
    return rec;
  }

  async function init() {
    try {
      let id = null;
      try { id = localStorage.getItem(CURRENT_PROJECT_KEY); } catch { /* 忽略 */ }
      let rec = await getProject(id);
      if (!rec) rec = (await listProjects())[0] || null;
      if (rec) return await open(rec.id);
      return { record: await createNew('未命名项目'), failed: 0 };
    } catch (err) {
      loading = false;
      status('无法使用本地存储');
      throw err;
    }
  }

  /* ---------- 管理 ---------- */

  async function rename(id, name) {
    name = String(name || '').trim();
    if (!name) return;
    if (current()?.id === id) {
      actions.setProjectName(name);
      dirty = true;
      await save();
    } else {
      await renameProject(id, name);
    }
    onChange();
  }

  async function duplicate(id) {
    await flush();
    const rec = await getProject(id);
    const copy = await duplicateProject(id, await uniqueName(`${rec.name} 副本`));
    onChange();
    return copy;
  }

  // 删除项目。删的是当前项目时换到最近的另一个；一个都不剩时新建一个空项目（返回 { created: true }）
  async function remove(id) {
    const wasCurrent = current()?.id === id;
    if (wasCurrent) {
      // 先停掉自动保存、缩略图，再等正在进行的保存结束，删除之后就不会再有东西写回去
      clearTimeout(saveTimer); clearTimeout(thumbTimer);
      saveTimer = 0;
      dirty = false;
      loading = true;
    }
    let created = false;
    try {
      await deleteProject(id);
      if (await getProject(id)) throw new Error('项目没有删除成功，请重试');
      if (wasCurrent) {
        const next = (await listProjects())[0];
        if (next) await open(next.id);
        else { await createNew('未命名项目'); created = true; }
      }
    } finally {
      if (wasCurrent) loading = false;
    }
    onChange();
    return { created };
  }

  /* ---------- 占用空间 / 清理 ---------- */

  // 当前项目先保存一下，数字才是最新的
  async function usage() {
    await flush();
    return storageUsage();
  }
  // 清理：what 里可以有 'unused'（用不到的文件）、'empty'（没有内容的项目，当前项目除外）。返回 { files, bytes, projects }
  async function cleanup(what) {
    await flush();
    const u = await storageUsage();
    const out = { files: 0, bytes: 0, projects: 0 };
    if (what.includes('unused')) { out.files = await deleteFiles(u.unused.keys); out.bytes = u.unused.bytes; }
    if (what.includes('empty')) {
      for (const p of u.empty) {
        if (p.id === current()?.id) continue;
        await deleteProject(p.id);
        out.projects++;
      }
    }
    onChange();
    return out;
  }

  const fileName = name => `${name.replace(/[\\/:*?"<>|]/g, '_')}.slidegrid`;
  async function exportFile(id) {
    if (current()?.id === id) await flush();
    const rec = await getProject(id);
    const blob = await exportProjectFile(id);
    await markProjectExported(id);
    onChange();
    return { blob, filename: fileName(rec.name) };
  }
  // 备份全部项目：每个项目一个 .slidegrid，打成一个 zip
  async function exportAll(onProgress = () => {}) {
    await flush();
    const list = await listProjects();
    const entries = [], used = new Set();
    for (let i = 0; i < list.length; i++) {
      let name = fileName(list[i].name);
      for (let n = 2; used.has(name); n++) name = fileName(`${list[i].name} ${n}`);
      used.add(name);
      entries.push({ name, data: await exportProjectFile(list[i].id) });
      onProgress((i + 1) / list.length);
    }
    const blob = await createZip(entries);
    const now = Date.now();
    for (const p of list) await markProjectExported(p.id, now);
    onChange();
    const d = new Date(now), pad = v => String(v).padStart(2, '0');
    return { blob, filename: `SlideGrid 备份 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.zip`, count: list.length };
  }

  /**
   * 当前项目的备份情况：{ need, never, days }。
   *   need：该备份了——有图片，而且从没导出过，或者上次导出之后又改过、并且已经过了 3 天
   */
  async function backupState() {
    const rec = current() ? await getProject(current().id) : null;
    if (!rec || !rec.slideCount) return { need: false, never: !rec?.exportedAt, days: 0 };
    const at = rec.exportedAt || 0;
    const days = at ? Math.floor((Date.now() - at) / 86400000) : 0;
    return { need: !at || (rec.updatedAt > at + 60000 && days >= 3), never: !at, days };
  }

  // 请浏览器把数据设为「持久保存」（空间紧张时不自动清理）。返回 true / false；不支持时为 null
  async function persist() {
    try {
      if (!navigator.storage?.persist) return null;
      return (await navigator.storage.persisted()) || (await navigator.storage.persist());
    } catch { return null; }
  }

  async function importFile(file) {
    await flush();
    const rec = await importProjectFile(file);
    const name = await uniqueName(rec.name);
    if (name !== rec.name) await renameProject(rec.id, name);
    const result = await open(rec.id);
    saveThumb();
    return result;
  }

  return {
    init, open, createNew, rename, duplicate, remove, exportFile, importFile,
    markDirty, flush, list: listProjects, usage, cleanup, exportAll, backupState, persist,
    isLoading: () => loading,
  };
}
