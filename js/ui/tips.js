import { toast } from './toast.js';

/**
 * 第一次用到某个功能时提示一下（每条只出现一次，记在本机）。
 * 用在那些藏在画布上、不点不知道的操作：样机的角度手柄、把卡片拖到图层之间、厚度要转动视角才看得到…
 */
const KEY = 'slidegrid:tips';
let seen = null;
const load = () => { if (!seen) { try { seen = new Set(JSON.parse(localStorage.getItem(KEY)) || []); } catch { seen = new Set(); } } return seen; };

export function tipOnce(id, message, { duration = 6000 } = {}) {
  const set = load();
  if (set.has(id)) return false;
  set.add(id);
  try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch { /* 忽略 */ }
  toast(message, { duration });
  return true;
}
