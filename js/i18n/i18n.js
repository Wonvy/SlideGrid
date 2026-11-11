/**
 * 界面语言。源码里的界面文字都是简体中文；其他语言由 XML 语言文件提供（lang/*.xml，lang/languages.xml 里登记）。
 *
 * 语言文件：<language code="en" name="English"><s k="中文原文">译文</s>…</language>
 *   原文里的 {0}、{1}… 是运行时填进去的内容，译文里用同样的占位符。
 *
 * 怎么翻译界面：不是每处文字都改成函数调用，而是在页面上「看着」——
 *   选了别的语言后，监听页面的变化，把出现的中文（文字、title / placeholder / aria-label）按语言文件换成译文：
 *     1. 整句和某条原文一样 → 直接换
 *     2. 和带占位符的原文对得上（「已删除 {0} 个画板」）→ 填进译文；占位符里的内容如果也是界面文字，再翻一次
 *     3. 「前缀：内容」、用 · / 空格 拼起来的几段 → 各段分别翻
 *   用户自己输入的内容（文字图层正在编辑的内容、输入框里的值）不动。
 *   画在 canvas 上的文字、会被代码再拆开处理的文字，用 tr() / t() 显式翻译。
 * 简体中文时什么都不做（没有监听，没有开销）。
 *
 * 切换语言后刷新页面（setLanguage）；用户还可以导入自己的语言文件（存在本机）。
 */
const KEY = 'slidegrid:lang';           // 'auto'（没存时）| 语言代码
const CUSTOM_KEY = 'slidegrid:lang-custom'; // { 代码: XML 文本 }：用户导入的语言文件
export const SOURCE = { code: 'zh-CN', name: '简体中文' };
const CJK = /[㐀-鿿]/;
const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];

let current = SOURCE.code;
let list = [SOURCE];
let exact = new Map();   // 原文 → 译文
let patterns = [];       // 带占位符的：[{ re, order, tpl }]
let templates = new Map(); // 带占位符的原文 → 译文（t() 用）
const cache = new Map();

export const currentLanguage = () => current;
export const languages = () => list;
export function languagePref() {
  try { return localStorage.getItem(KEY) || 'auto'; } catch { return 'auto'; }
}

/* ---------------- 语言文件 ---------------- */

export function parseLanguage(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root?.nodeName !== 'language') throw new Error('不是有效的语言文件');
  const code = (root.getAttribute('code') || '').trim();
  if (!code) throw new Error('语言文件缺少 code');
  const entries = new Map();
  for (const s of root.getElementsByTagName('s')) {
    const k = s.getAttribute('k');
    if (k && s.textContent) entries.set(k, s.textContent);
  }
  return { code, name: (root.getAttribute('name') || code).trim(), entries };
}

function customFiles() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY)) || {}; } catch { return {}; }
}

// 语言文件的内容：单文件版里是内嵌的（<script type="application/xml" data-lang-file="…">），否则从 lang/ 读
async function readFile(name) {
  const embedded = document.querySelector(`script[data-lang-file="${name}"]`);
  if (embedded) return embedded.textContent;
  const res = await fetch(`lang/${name}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`读不到 lang/${name}`);
  return res.text();
}

async function loadList() {
  const out = [SOURCE];
  try {
    const doc = new DOMParser().parseFromString(await readFile('languages.xml'), 'application/xml');
    for (const el of doc.getElementsByTagName('language')) {
      const code = el.getAttribute('code'), file = el.getAttribute('file');
      if (code && file && code !== SOURCE.code) out.push({ code, name: el.getAttribute('name') || code, file });
    }
  } catch (err) {
    console.warn('读不到语言列表：', err);
  }
  for (const [code, xml] of Object.entries(customFiles())) {
    try {
      const lang = parseLanguage(xml);
      const at = out.findIndex(x => x.code === code);
      const item = { code, name: lang.name, xml, custom: true };
      if (at >= 0) out[at] = item; else out.push(item);
    } catch { /* 坏了的就不列 */ }
  }
  return out;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function compile(entries) {
  exact = new Map();
  patterns = [];
  templates = new Map();
  cache.clear();
  for (const [k, v] of entries) {
    if (!/\{\d+\}/.test(k)) { exact.set(k, v); continue; }
    templates.set(k, v);
    const order = [];
    const src = k.split(/(\{\d+\})/).map(part => {
      const m = /^\{(\d+)\}$/.exec(part);
      if (!m) return escapeRe(part);
      order.push(+m[1]);
      return '([\\s\\S]*?)';
    }).join('');
    // quoted：哪些占位符在原文里是用「」括起来的（那是名称之类用户的内容，翻不出来也没关系）
    const quoted = new Set([...k.matchAll(/「\{(\d+)\}」/g)].map(m => +m[1]));
    patterns.push({ re: new RegExp(`^${src}$`), order, tpl: v, quoted, weight: k.replace(/\{\d+\}/g, '').length });
  }
  patterns.sort((a, b) => b.weight - a.weight); // 固定文字多的先试（更具体）
}

/* ---------------- 翻译 ---------------- */

// 把占位符换成内容；英文里相邻的两段之间缺空格时补上（「3 images」+「(current)」）
function fill(tpl, values) {
  return tpl.replace(/\{(\d+)\}/g, (m, i, at) => {
    const v = String(values[+i] ?? '');
    const before = tpl.slice(0, at);
    return v && /[A-Za-z0-9)\]"”]$/.test(before) && /^[A-Za-z(“"]/.test(v) ? ` ${v}` : v;
  });
}

const SEPARATORS = [['\n', '\n'], ['  ·  ', '  ·  '], [' · ', ' · '], [' / ', ' / '], ['；', '; '], ['、', ', '], ['，', ', '], [' ', ' ']];
function lookup(core, depth = 0) {
  const hit = exact.get(core);
  if (hit != null) return hit;
  if (depth > 3) return null;
  for (const p of patterns) {
    const m = p.re.exec(core);
    if (!m) continue;
    const values = [];
    let ok = true;
    p.order.forEach((idx, k) => {
      const v = m[k + 1];
      if (!CJK.test(v)) { values[idx] = v; return; }
      const sub = lookup(v.trim(), depth + 1);
      // 占位符里的中文翻不出来：如果原文固定的字很少（「{0}版式{1}」这种几乎什么都对得上），就不算对上，换下一条试
      if (sub == null && p.weight < 4 && !p.quoted.has(idx)) ok = false;
      // 两头的空格留着（「 · 支持长图」翻完还是以空格开头）
      values[idx] = sub == null ? v : /^\s*/.exec(v)[0] + sub + /\s*$/.exec(v)[0];
    });
    if (ok) return fill(p.tpl, values);
  }
  // 「名称」→ "名称"
  const quote = /^「([\s\S]*)」$/.exec(core);
  if (quote) return `"${CJK.test(quote[1]) ? lookup(quote[1].trim(), depth + 1) ?? quote[1] : quote[1]}"`;
  // 「前缀：内容」：前缀连冒号一起是一条原文（「导出失败：」），或者前缀本身翻得出来（「选择（V）：…」）
  const colon = core.indexOf('：');
  if (colon > 0) {
    const rest = core.slice(colon + 1);
    const head = exact.get(core.slice(0, colon + 1))?.trimEnd().replace(/[:：]$/, '') ?? lookup(core.slice(0, colon), depth + 1);
    const tail = !rest ? '' : CJK.test(rest) ? lookup(rest.trim(), depth + 1) : rest.trim();
    if (head != null && tail != null) return tail ? `${head}: ${tail}` : `${head}:`;
  }
  // 「内容（补充）」：两部分分别翻
  const paren = /^([^（）]+)（([^（）]*)）$/.exec(core);
  if (paren) {
    const a = CJK.test(paren[1]) ? lookup(paren[1].trim(), depth + 1) : paren[1].trim();
    const b = CJK.test(paren[2]) ? lookup(paren[2].trim(), depth + 1) : paren[2].trim();
    if (a != null && b != null) return `${a} (${b})`;
  }
  // 用分隔符拼起来的几段：每段都翻得出来才算
  for (const [sep, join] of SEPARATORS) {
    if (!core.includes(sep)) continue;
    const parts = core.split(sep).map(part => (CJK.test(part) ? lookup(part.trim(), depth + 1) : part));
    if (parts.every(x => x != null)) return parts.join(join);
  }
  return null;
}

/** 把一段已经拼好的界面文字翻成当前语言（翻不出来就原样返回）。画在 canvas 上的文字用它 */
export function tr(text) {
  if (current === SOURCE.code || typeof text !== 'string' || !CJK.test(text)) return text;
  const cached = cache.get(text);
  if (cached !== undefined) return cached;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const out = lookup(m[2]);
  const result = out == null ? text : m[1] + out + m[3];
  if (cache.size > 6000) cache.clear();
  cache.set(text, result);
  return result;
}

/** 按原文取译文，再填占位符：t('已删除 {0} 个画板', n)。代码要继续处理这段文字（拆开、测量）时用它 */
export function t(text, ...args) {
  const tpl = current === SOURCE.code ? text : exact.get(text) ?? templates.get(text) ?? text;
  return args.length ? fill(tpl, args) : tpl;
}

/* ---------------- 把页面上的中文换成译文 ---------------- */

const doneText = new WeakMap(); // 文字节点 → 我们写进去的译文（再看到同样的内容就不用处理）
const doneAttr = new WeakMap(); // 元素 → { 属性: 译文 }
const skipped = el => !!el.closest?.('[contenteditable], [data-no-i18n], script, style, textarea');

function translateText(node) {
  const cur = node.nodeValue;
  if (!cur || doneText.get(node) === cur || !CJK.test(cur)) return;
  const parent = node.parentElement;
  if (!parent || skipped(parent)) return;
  const out = tr(cur);
  if (out !== cur) { doneText.set(node, out); node.nodeValue = out; }
}
function translateAttrs(el) {
  for (const a of ATTRS) {
    const cur = el.getAttribute(a);
    if (!cur || !CJK.test(cur) || doneAttr.get(el)?.[a] === cur) continue;
    const out = tr(cur);
    if (out === cur) continue;
    doneAttr.set(el, { ...doneAttr.get(el), [a]: out });
    el.setAttribute(a, out);
  }
}
function translateTree(root) {
  if (root.nodeType === 3) { translateText(root); return; }
  if (root.nodeType !== 1 || skipped(root)) return;
  translateAttrs(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 3) translateText(n); else translateAttrs(n);
  }
}
function watch() {
  translateTree(document.body);
  new MutationObserver(list2 => {
    for (const m of list2) {
      if (m.type === 'childList') m.addedNodes.forEach(translateTree);
      else if (m.type === 'characterData') translateText(m.target);
      else translateAttrs(m.target);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

/* ---------------- 启动 / 切换 ---------------- */

// 跟随系统：浏览器的语言是中文就用中文，否则用列表里对得上的（en-US → en），都没有就用英文（有的话）
function resolve(pref) {
  if (pref !== 'auto') return list.some(x => x.code === pref) ? pref : SOURCE.code;
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language || 'zh-CN']) {
    if (/^zh\b/i.test(tag)) return SOURCE.code;
    const hit = list.find(x => x.code.toLowerCase() === tag.toLowerCase()) || list.find(x => x.code.split('-')[0].toLowerCase() === tag.split('-')[0].toLowerCase());
    if (hit) return hit.code;
  }
  return list.some(x => x.code === 'en') ? 'en' : SOURCE.code;
}

/** 启动时调用一次（在搭界面之前）：读语言列表和当前语言的文件，然后开始翻译页面 */
export async function initI18n() {
  try {
    list = await loadList();
    const code = resolve(languagePref());
    if (code !== SOURCE.code) {
      const item = list.find(x => x.code === code);
      const lang = parseLanguage(item.xml ?? await readFile(item.file));
      compile(lang.entries);
      current = code;
      document.documentElement.lang = code;
      watch();
    }
  } catch (err) {
    console.error('界面语言加载失败，用简体中文：', err);
    current = SOURCE.code;
  }
  document.documentElement.classList.remove('i18n-wait');
}

/** 换语言：记下来，然后刷新页面（beforeReload：刷新前要做的事，比如先保存项目） */
export async function setLanguage(code, { beforeReload } = {}) {
  try { if (code && code !== 'auto') localStorage.setItem(KEY, code); else localStorage.removeItem(KEY); } catch { /* 忽略 */ }
  try { await beforeReload?.(); } catch { /* 照样刷新 */ }
  location.reload();
}

/** 导入一个语言文件（XML 文本）：存在本机，返回 { code, name }。同一个 code 的会覆盖 */
export function importLanguage(xml) {
  const lang = parseLanguage(xml);
  if (lang.code === SOURCE.code) throw new Error('简体中文是内置的，不能覆盖');
  const files = customFiles();
  files[lang.code] = xml;
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(files));
  return { code: lang.code, name: lang.name };
}
export function removeLanguage(code) {
  const files = customFiles();
  delete files[code];
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(files)); } catch { /* 忽略 */ }
}

/** 一份语言文件的内容（做新语言时当模板）：默认给英文的 */
export const languageFileText = (name = 'en.xml') => readFile(name);
