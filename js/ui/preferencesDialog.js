import { buildControls } from './controls.js';
import { el, section } from './dom.js';
import { icon } from './icons.js';
import { THEMES, themePref, setThemePref, onThemeChange } from './theme.js';
import { wheelModeSchema } from './wheel.js';
import { languages, languagePref, setLanguage, importLanguage, removeLanguage, languageFileText, DEFAULT as DEFAULT_LANG } from '../i18n/i18n.js';

export function createPreferencesDialog(anchor, { store, actions, beforeReload }) {
  const body = el('div', { class: 'prefs-pane' });
  const prefsBox = el('div');
  body.append(section('操作习惯', prefsBox, null, 'section:prefs'));
  const updatePrefs = buildControls(prefsBox, wheelModeSchema, store.get(), actions.setPref);
  store.subscribe(updatePrefs);
  // 界面主题：跟随系统 / 深色 / 浅色（存在本机，不属于项目）
  const themeBox = el('div');
  body.append(section('界面', themeBox, null, 'section:prefs-theme'));
  const updateTheme = buildControls(themeBox, [{ key: 'theme', label: '主题', type: 'select', default: 'auto', segmented: false, options: THEMES }], { theme: themePref() }, (_, v) => setThemePref(v));
  onThemeChange(() => updateTheme({ theme: themePref() }));
  // 界面语言：跟随系统 / 简体中文 / 语言文件里的语言（lang/*.xml）/ 自己导入的。换了以后刷新页面
  const langBox = el('div');
  themeBox.append(langBox);
  const langOptions = [...languages().map(l => ({ value: l.code, label: l.custom ? `${l.name}（导入的）` : l.name })), { value: 'auto', label: '跟随系统' }];
  const pref = languagePref();
  buildControls(langBox, [{ key: 'lang', label: '语言', type: 'select', segmented: false, default: DEFAULT_LANG, options: langOptions }],
    { lang: langOptions.some(o => o.value === pref) ? pref : DEFAULT_LANG }, (_, v) => setLanguage(v, { beforeReload }));
  // 导入语言文件（XML）：存在这台电脑上，马上换过去；下载英文语言文件：翻译新语言时照着改
  const langError = el('p', { class: 'prefs-error', role: 'alert' });
  const langInput = el('input', { type: 'file', accept: '.xml,text/xml,application/xml', hidden: true });
  langInput.addEventListener('change', async () => {
    const file = langInput.files[0];
    langInput.value = '';
    if (!file) return;
    langError.textContent = '';
    try {
      const { code } = importLanguage(await file.text());
      await setLanguage(code, { beforeReload });
    } catch (err) {
      langError.textContent = `导入失败：${err.message || err}`;
    }
  });
  const langFileBtn = el('button', { class: 'btn small', type: 'button', title: '导入一个 XML 语言文件（存在这台电脑上），界面马上换成这种语言' }, icon('upload', 13), el('span', {}, '导入语言文件…'));
  langFileBtn.addEventListener('click', () => langInput.click());
  const langTemplateBtn = el('button', { class: 'btn small', type: 'button', title: '下载英文的语言文件：翻译新语言时复制一份，改 code、name 和每条译文' }, icon('download', 13), el('span', {}, '下载语言文件模板'));
  langTemplateBtn.addEventListener('click', async () => {
    langError.textContent = '';
    try {
      const blob = new Blob([await languageFileText('en.xml')], { type: 'application/xml' });
      const a = el('a', { href: URL.createObjectURL(blob), download: 'en.xml' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (err) {
      langError.textContent = `下载失败：${err.message || err}`;
    }
  });
  // 导入过的语言：每个一个「移除」按钮（正在用的那个移除后回到跟随系统）
  const langRemoveBtns = languages().filter(l => l.custom).map(l => {
    const btn = el('button', { class: 'btn small lang-remove', type: 'button', 'data-code': l.code, title: '从这台电脑上移除这个导入的语言文件' }, icon('trash-2', 13), `移除「${l.name}」`);
    btn.addEventListener('click', () => {
      removeLanguage(l.code);
      setLanguage(pref === l.code ? null : pref, { beforeReload });
    });
    return btn;
  });
  themeBox.append(el('div', { class: 'lang-actions' }, el('div', { class: 'lang-file-actions' }, langFileBtn, langTemplateBtn), ...langRemoveBtns, langInput), langError,
    el('p', { class: 'note' }, '默认跟随系统语言（系统不是中文时用英文）；顶栏右边的语言按钮也可以直接切换。界面语言来自 XML 语言文件：每条是「中文原文 → 译文」。换语言后页面会刷新一次（项目会先保存）。'));

  const close = el('button', { type: 'button', class: 'icon-btn visible', title: '关闭', 'aria-label': '关闭', autofocus: true }, icon('x', 16));
  const dialog = el('dialog', { id: 'preferences-dialog', class: 'modal prefs-modal', 'aria-labelledby': 'preferences-title' },
    el('div', { class: 'modal-head' }, el('h2', { id: 'preferences-title' }, '设置'), close),
    body);
  document.body.append(dialog);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('pointerdown', e => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });
  function open() {
    if (dialog.open) return;
    langError.textContent = '';
    anchor.focus();
    dialog.showModal();
  }
  anchor.addEventListener('click', open);
  return { open };
}
