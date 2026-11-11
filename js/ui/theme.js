/**
 * 界面主题：深色 / 浅色。偏好存在本机：'auto'（跟随系统，默认）| 'dark' | 'light'。
 * 实际生效的主题写在 <html data-theme="…"> 上，颜色全部由 css/style.css 里的变量决定；
 * 画在 canvas 上的界面颜色（画布外的底色、画板名称…）用 themeColor() 读变量，主题变了通过 onThemeChange 重画。
 * index.html 开头有一小段脚本先把 data-theme 设好，避免刚打开时闪一下。
 */
const KEY = 'slidegrid:theme';
const mq = window.matchMedia?.('(prefers-color-scheme: light)');
const listeners = new Set();

export const THEMES = [{ value: 'auto', label: '跟随系统' }, { value: 'dark', label: '深色' }, { value: 'light', label: '浅色' }];

export function themePref() {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch { return 'auto'; }
}
export const currentTheme = () => { const p = themePref(); return p === 'auto' ? (mq?.matches ? 'light' : 'dark') : p; };

function apply() {
  const t = currentTheme();
  document.documentElement.dataset.theme = t;
  listeners.forEach(fn => fn(t));
}
export function setThemePref(v) {
  try { if (v === 'light' || v === 'dark') localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* 忽略 */ }
  apply();
}
// 在深色 / 浅色之间切换（切换后不再跟随系统）
export const toggleTheme = () => setThemePref(currentTheme() === 'light' ? 'dark' : 'light');
export const onThemeChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
// 读 CSS 变量（画 canvas 时用）
export const themeColor = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

mq?.addEventListener?.('change', () => { if (themePref() === 'auto') apply(); });
document.documentElement.dataset.theme = currentTheme();
