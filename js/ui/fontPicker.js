import { el } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { fontGroups, fontLabel, fontStack, isInstalled, canReadSystemFonts, hasSystemList, readSystemFonts } from '../layers/fonts.js';

/**
 * 字体选择器：按钮显示当前字体（用该字体显示），点击打开可搜索的字体列表（每项用自己的字体预览）。
 *   - 搜索框里输入字体名，回车或点「使用」可以直接用列表里没有的字体
 *   - Chrome / Edge 可点「读取本机全部字体」（浏览器授权一次）
 * createFontPicker({ onChange, getExtra }) → { button, set(value), step(value, steps) }
 *   getExtra()：项目里正在使用的字体（不在列表里时也显示出来）
 */
let pop = null;     // 全局只有一个弹出列表
let owner = null;   // 当前打开它的选择器
let used = [];      // 项目里正在使用的字体（由 main.js 更新）
export const setUsedFonts = list => { used = list; };

function closePop() {
  pop?.remove();
  pop = null;
  owner?.button.classList.remove('open');
  owner = null;
}
document.addEventListener('pointerdown', e => {
  if (pop && !pop.contains(e.target) && !owner?.button.contains(e.target)) closePop();
}, true);
window.addEventListener('blur', closePop);

export function createFontPicker({ onChange, getExtra = () => used }) {
  const name = el('span', { class: 'font-name' });
  const button = el('button', { class: 'font-btn', title: '选择字体（滚轮切换）' }, name, icon('chevron-down', 12));
  let value = 'sans';
  const self = { button };

  function set(v) {
    value = v || 'sans';
    const ok = isInstalled(value);
    name.textContent = ok ? fontLabel(value) : `${fontLabel(value)}（未安装）`;
    name.style.fontFamily = fontStack(value);
    button.classList.toggle('missing', !ok);
    button.title = ok ? `字体：${fontLabel(value)}（点击选择，滚轮切换）` : `本机没有安装「${value}」，显示和导出会用系统默认字体代替`;
  }

  const flat = () => fontGroups(getExtra()).flatMap(g => g.fonts);
  // 滚轮：在列表里前后切换
  function step(v, steps) {
    const all = flat();
    const i = Math.max(0, all.indexOf(v));
    return all[Math.min(all.length - 1, Math.max(0, i - steps))];
  }

  function choose(v) {
    closePop();
    if (v && v !== value) onChange(v);
  }

  function open() {
    if (owner === self) { closePop(); return; }
    closePop();
    owner = self;
    button.classList.add('open');
    const search = el('input', { type: 'search', class: 'text-input font-search', placeholder: '搜索或输入字体名…', spellcheck: 'false' });
    const listBox = el('div', { class: 'font-list' });
    const foot = el('div', { class: 'font-foot' });
    pop = el('div', { class: 'menu font-pop show', role: 'listbox' }, search, listBox, foot);
    document.body.append(pop);

    let items = [];
    let active = 0;
    const highlight = i => {
      active = Math.max(0, Math.min(items.length - 1, i));
      items.forEach((x, k) => x.node.classList.toggle('kbd', k === active));
      items[active]?.node.scrollIntoView({ block: 'nearest' });
    };

    function render() {
      const q = search.value.trim().toLowerCase();
      listBox.innerHTML = '';
      items = [];
      for (const g of fontGroups(getExtra())) {
        const fonts = g.fonts.filter(f => !q || f.toLowerCase().includes(q) || fontLabel(f).toLowerCase().includes(q));
        if (!fonts.length) continue;
        listBox.append(el('div', { class: 'menu-title' }, g.title));
        for (const f of fonts) {
          const ok = isInstalled(f);
          const preview = el('span', { class: 'font-preview' }, fontLabel(f));
          preview.style.fontFamily = fontStack(f);
          const node = el('button', { class: `font-item${f === value ? ' active' : ''}${ok ? '' : ' missing'}`, role: 'option' },
            preview, ok ? null : el('span', { class: 'font-tag' }, '未安装'));
          node.addEventListener('click', () => choose(f));
          listBox.append(node);
          items.push({ f, node });
        }
      }
      // 输入了列表里没有的字体名：可以直接使用
      const typed = search.value.trim();
      if (typed && !items.some(x => x.f.toLowerCase() === typed.toLowerCase())) {
        const node = el('button', { class: 'font-item use-typed' }, icon('type', 13), `使用「${typed}」`);
        node.addEventListener('click', () => choose(typed));
        listBox.append(node);
        items.push({ f: typed, node });
      }
      if (!items.length) listBox.append(el('p', { class: 'note' }, '没有找到'));
      const cur = items.findIndex(x => x.f === value);
      highlight(q ? 0 : Math.max(0, cur));
    }

    // 读取本机全部字体（Chrome / Edge）
    foot.innerHTML = '';
    if (canReadSystemFonts()) {
      const read = el('button', { class: 'btn small' }, icon('refresh-cw', 13), hasSystemList() ? '重新读取本机字体' : '读取本机全部字体…');
      read.addEventListener('click', async () => {
        try {
          const n = (await readSystemFonts()).length;
          toast(`已读取 ${n} 个本机字体`);
          render();
        } catch (err) {
          console.warn(err);
          toast('无法读取本机字体（可能被浏览器拒绝了授权）', { error: true });
        }
      });
      foot.append(read);
    } else {
      foot.append(el('span', { class: 'note' }, '已列出本机安装的常用字体；也可以直接输入字体名'));
    }

    search.addEventListener('input', render);
    search.addEventListener('keydown', e => {
      e.stopPropagation(); // 输入时不触发工具快捷键
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(items[active]?.f); }
      else if (e.key === 'Escape') { e.preventDefault(); closePop(); }
    });

    render();
    // 位置：按钮下方，不超出窗口
    const r = button.getBoundingClientRect();
    const w = 260, h = Math.min(420, window.innerHeight - 24);
    pop.style.width = `${w}px`;
    pop.style.maxHeight = `${h}px`;
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
    const below = r.bottom + 6;
    pop.style.top = `${below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below}px`;
    search.focus();
  }

  button.addEventListener('click', open);
  set(value);
  return Object.assign(self, { set, step });
}
