// IndexedDB 的极简封装（无依赖）
//   projects：项目记录
//   files：   原图 / 素材（按 projectId 索引）
//   presets： 我的版式（跨项目）
// v1 为早期单项目结构，升级时直接重建；v2 起为增量升级，不会删除已有数据。
const DB_NAME = 'slidegrid';
const VERSION = 3;
export const CURRENT_PROJECT_KEY = 'slidegrid:current-project';

let dbPromise = null;

export function openDB() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = e => {
      const db = req.result;
      if (e.oldVersion < 2) {
        for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
        db.createObjectStore('projects', { keyPath: 'id' });
        db.createObjectStore('files', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('presets')) db.createObjectStore('presets', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // 其他标签页要升级数据库时主动断开，避免把它卡住
      db.onversionchange = () => {
        db.close();
        window.dispatchEvent(new CustomEvent('slidegrid:db', { detail: '应用已在其他标签页更新，请刷新本页' }));
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      window.dispatchEvent(new CustomEvent('slidegrid:db', { detail: '请关闭其他打开着的 SlideGrid 标签页，本页会自动继续' }));
    };
  });
  return dbPromise;
}

export const request = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export const done = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('事务已中止'));
});
