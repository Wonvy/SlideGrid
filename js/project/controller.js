import { settingsOf, projectSettings } from '../state.js';
import { CURRENT_PROJECT_KEY } from '../persist/db.js';
import {
  listProjects, getProject, loadProjectSlides, loadProjectAssets, createProject, saveProject,
  renameProject, setProjectThumb, deleteProject, duplicateProject,
  exportProjectFile, importProjectFile,
} from '../persist/projects.js';
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
      await saveProject({ id: p.id, name: p.name, settings: settingsOf(s), slides: s.slides, assets: Object.values(s.assets) });
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
    const rec = await createProject({ name: await uniqueName(name || '未命名项目'), settings: projectSettings() });
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

  async function remove(id) {
    const wasCurrent = current()?.id === id;
    if (wasCurrent) { clearTimeout(saveTimer); clearTimeout(thumbTimer); dirty = false; }
    await deleteProject(id);
    if (wasCurrent) {
      const next = (await listProjects())[0];
      if (next) await open(next.id);
      else await createNew('未命名项目');
    }
    onChange();
  }

  async function exportFile(id) {
    if (current()?.id === id) await flush();
    const rec = await getProject(id);
    const blob = await exportProjectFile(id);
    return { blob, filename: `${rec.name.replace(/[\\/:*?"<>|]/g, '_')}.slidegrid` };
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
    markDirty, flush, list: listProjects,
    isLoading: () => loading,
  };
}
