import { el, isCollapsed, setCollapsed } from './dom.js';
import { attachWheel, shiftLightness } from './wheel.js';
import { icon } from './icons.js';
import { createFontPicker } from './fontPicker.js';

const clampTo = (v, def) => Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, v));
const decimals = step => (String(step).split('.')[1] || '').length;

/**
 * 根据 schema 自动生成控件。
 * schema 项：{ key, label, type: 'range'|'select'|'number'|'toggle'|'color'|'seed'|'image'|'textarea'|'font'|'albumGroups', default, show?(values), ... }
 *          或 { group: '分组标题' }
 * label 可以是函数 (values) => 文本。
 * ctx（可选）：image 控件需要 { imageThumb(id) → canvas|null, pickImage(key), dropTarget }；
 *   wheelImmediate：鼠标悬停就能用滚轮调（不需要停留激活，用于顶部工具条）
 * 可选 wheelStep：滚轮每档的步长（默认等于 step）。
 *
 * 所有控件都支持「鼠标悬停 + 滚轮」调整：向上滚增大，Shift 加速 ×10。
 * 返回 update(values)：同步控件的值与可见性（不会重建 DOM，拖动滑块时不丢焦点）。
 */
export function buildControls(container, schema, values, onChange, ctx = {}) {
  container.innerHTML = '';
  // 面板里：每个参数一行「名称 | 控件 | 数值」，half 的两个并排；工具条里（inline）横排，由工具条自己排版
  container.classList.add(ctx.inline ? 'ctrls-inline' : 'ctrls');
  const panel = !ctx.inline;
  const rows = [];
  let group = null; // 当前分组的折叠 key

  for (const def of schema) {
    if (def.group) {
      // 分组标题：点击折叠 / 展开组内参数
      const key = `${ctx.collapseKey || 'ctrl'}:${def.group}`;
      const node = el('button', { class: 'ctrl-group', title: '折叠 / 展开' }, el('span', {}, def.group), icon('chevron-down', 16));
      node.addEventListener('click', () => {
        setCollapsed(key, !isCollapsed(key));
        update(lastValues);
      });
      container.append(node);
      rows.push({ def, node, groupKey: key });
      group = key;
      continue;
    }

    const row = el('div', { class: `ctrl ctrl-${def.type}${def.half ? ' half' : ''}` });
    const labelText = v => (typeof def.label === 'function' ? def.label(v || {}) : def.label);
    const label = el('label', { class: 'ctrl-label', title: '鼠标停留片刻后可用滚轮调整（Shift 加速）· 双击恢复默认' }, labelText(values));
    label.addEventListener('dblclick', () => onChange(def.key, def.default));
    row.append(label);

    // 工具条里名称可能省略显示，悬停时用提示说明是什么参数
    if (!panel) row.title = labelText(values);
    let current = values?.[def.key];
    let render = () => {};
    let wheel = null; // (steps, fast) => 新值

    switch (def.type) {
      case 'range': {
        const step = def.step ?? 1;
        const display = el('span', { class: 'ctrl-value' });
        // 0 ~ 1 的比例（不透明度、位置…）显示成百分比
        const percent = !def.unit && def.min >= 0 && def.max <= 1 && step < 1;
        const fmt = def.format || (v => (percent ? `${Math.round(v * 100)}%` : (step < 1 ? Number(v).toFixed(2) : String(Math.round(v))) + (def.unit || '')));
        const ws = def.wheelStep ?? step;
        const snap = v => Number(clampTo(Math.round(v / step) * step, def).toFixed(decimals(step)));
        wheel = (steps, fast) => Number(clampTo(current + steps * ws * (fast ? 10 : 1), def).toFixed(decimals(ws)));
        {
          // 数值条：名称在左、数值在右，底色按比例填充；按住拖动时数值跟着鼠标位置实时变化（面板和工具条共用）
          const fill = el('span', { class: 'sfield-fill' });
          row.classList.add('sfield');
          row.tabIndex = 0;
          row.setAttribute('role', 'slider');
          row.prepend(fill);
          row.append(display);
          let drag = null;
          row.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            const r = row.getBoundingClientRect();
            drag = { x: e.clientX, v: current, left: r.left, w: r.width, moved: false, fineFrom: null };
            row.setPointerCapture(e.pointerId);
          });
          row.addEventListener('pointermove', e => {
            if (!drag) return;
            const dx = e.clientX - drag.x;
            if (!drag.moved && Math.abs(dx) < 3) return;
            drag.moved = true;
            row.classList.add('dragging');
            let v;
            if (e.shiftKey) {
              // Shift：从当前值开始慢速精调（1/10）
              if (!drag.fineFrom) drag.fineFrom = { x: e.clientX, v: current };
              v = snap(drag.fineFrom.v + (e.clientX - drag.fineFrom.x) * ((def.max - def.min) / Math.max(1, drag.w)) * 0.1);
            } else {
              // 直接拖数值：底色的边缘跟着鼠标走，数值就是鼠标在条上的位置
              drag.fineFrom = null;
              const t = Math.max(0, Math.min(1, (e.clientX - drag.left) / Math.max(1, drag.w)));
              v = snap(def.min + t * (def.max - def.min));
            }
            if (v !== current) onChange(def.key, v);
          });
          const end = () => { drag = null; row.classList.remove('dragging'); };
          row.addEventListener('pointerup', end);
          row.addEventListener('pointercancel', end);
          row.addEventListener('keydown', e => {
            const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
            if (!dir) return;
            e.preventDefault();
            e.stopPropagation();
            onChange(def.key, wheel(dir, e.shiftKey));
          });
          render = v => {
            const t = (Number(v) - def.min) / ((def.max - def.min) || 1);
            fill.style.width = `${Math.max(0, Math.min(1, t)) * 100}%`;
            display.textContent = fmt(v);
            row.setAttribute('aria-valuenow', String(v));
          };
        }
        break;
      }
      case 'select': {
        // 面板里：选项少且短时用分段按钮（类似 iOS / Figma），否则用下拉框；名称放在上方
        // 选项少且短时用分段按钮：最多 4 个（每个不超过 5 个字），或 5 个都不超过 2 个字
        const len = o => String(o.label).length;
        const short = (def.options.length <= 4 && def.options.every(o => len(o) <= 5)) || (def.options.length === 5 && def.options.every(o => len(o) <= 2));
        if (def.segmented !== false && (def.segmented || short)) {
          const seg = el('div', { class: 'seg' });
          // 有图标的选项：工具条里显示图标（面板里 iconInPanel 时也用图标），悬停提示文字
          const useIcon = o => o.icon && (!panel || def.iconInPanel);
          const btns = def.options.map(o => {
            const b = el('button', { type: 'button', class: `seg-btn${useIcon(o) ? ' icon-only' : ''}`, title: o.label, 'aria-label': o.label },
              useIcon(o) ? icon(o.icon, 16) : o.label);
            b.addEventListener('click', () => onChange(def.key, o.value));
            seg.append(b);
            return b;
          });
          render = v => btns.forEach((b, i) => b.classList.toggle('active', def.options[i].value === v));
          wheel = steps => {
            const idx = Math.max(0, def.options.findIndex(o => o.value === current));
            return def.options[Math.min(def.options.length - 1, Math.max(0, idx + steps))].value;
          };
          if (panel) row.classList.add('stacked');
          row.append(seg);
          break;
        }
        if (panel) row.classList.add('stacked');
        const input = el('select', { class: 'select', title: def.title || null },
          def.options.map((o, idx) => el('option', { value: String(idx) }, o.label)));
        input.addEventListener('change', () => onChange(def.key, def.options[Number(input.value)].value));
        render = v => {
          input.value = String(Math.max(0, def.options.findIndex(o => o.value === v)));
        };
        wheel = steps => {
          const idx = Math.max(0, def.options.findIndex(o => o.value === current));
          return def.options[Math.min(def.options.length - 1, Math.max(0, idx + steps))].value;
        };
        // 下拉框获得焦点时浏览器自己也会响应滚轮，这里统一由行处理
        input.addEventListener('wheel', e => { if (document.activeElement === input) input.blur(); }, { passive: true });
        row.append(input);
        break;
      }
      case 'number': {
        const input = el('input', { type: 'number', class: 'num-input', min: def.min, max: def.max, step: def.step ?? 1 });
        const commit = () => onChange(def.key, clampTo(Number(input.value) || def.default, def));
        input.addEventListener('change', commit);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
        render = v => { if (document.activeElement !== input) input.value = v; };
        const ws = def.wheelStep ?? def.step ?? 1;
        wheel = (steps, fast) => {
          if (document.activeElement === input) input.blur();
          return clampTo(Math.round((current + steps * ws * (fast ? 10 : 1)) / ws) * ws, def);
        };
        row.append(el('div', { class: 'ctrl-actions' }, input, def.unit ? el('span', { class: 'ctrl-unit' }, def.unit) : null));
        row.classList.add('inline');
        row.classList.add('nfield'); // 名称和数值在同一个输入条里
        break;
      }
      case 'toggle': {
        const input = el('input', { type: 'checkbox', class: 'switch' });
        input.addEventListener('change', () => onChange(def.key, input.checked));
        render = v => { input.checked = !!v; };
        wheel = steps => steps > 0;
        row.append(input);
        break;
      }
      case 'color': {
        const input = el('input', { type: 'color' });
        input.addEventListener('input', () => onChange(def.key, input.value));
        wheel = (steps, fast) => shiftLightness(current, steps * (fast ? 0.1 : 0.02)); // 滚轮调亮度
        if (panel) {
          // 面板里：色块 + 可输入的十六进制色值，名称在上方
          const hex = el('input', { type: 'text', class: 'hex-input', spellcheck: 'false', maxlength: 7, 'aria-label': `${labelText(values)}色值` });
          const commit = () => {
            const m = hex.value.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
            if (!m) { hex.value = String(current || '').toUpperCase(); return; }
            let h = m[1];
            if (h.length === 3) h = h.split('').map(c => c + c).join('');
            onChange(def.key, `#${h.toLowerCase()}`);
          };
          hex.addEventListener('change', commit);
          hex.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { commit(); hex.blur(); } });
          render = v => {
            if (input.value !== v) input.value = v;
            if (document.activeElement !== hex) hex.value = String(v || '').toUpperCase();
          };
          row.classList.add('stacked');
          row.append(el('div', { class: 'color-field' }, input, hex));
        } else {
          render = v => { if (input.value !== v) input.value = v; };
          row.append(input);
        }
        break;
      }
      case 'image': {
        // 图片：缩略图 + 选择 / 移除；也可以把图片文件拖到这一行上
        const thumb = el('div', { class: 'img-thumb', title: '点击选择图片，或把图片拖到这里' });
        const pick = () => ctx.pickImage?.(def.key);
        thumb.addEventListener('click', pick);
        const clear = el('button', { class: 'icon-btn visible', title: '移除图片' }, icon('x', 14));
        clear.addEventListener('click', () => onChange(def.key, null));
        const choose = el('button', { class: 'btn small' }, icon('image-plus', 13), '选择…');
        choose.addEventListener('click', pick);
        let shown = '';
        render = v => {
          const c = v ? ctx.imageThumb?.(v) : null;
          const key = `${v}:${c ? 1 : 0}`;
          if (key === shown) return; // 只在图片变化时重绘缩略图
          shown = key;
          thumb.innerHTML = '';
          if (c) {
            const copy = document.createElement('canvas');
            copy.width = c.width;
            copy.height = c.height;
            copy.getContext('2d').drawImage(c, 0, 0);
            thumb.append(copy);
          } else {
            thumb.append(el('span', {}, '拖入图片'));
          }
          clear.hidden = !v;
        };
        if (ctx.dropTarget) row.dataset.drop = ctx.dropTarget;
        row.classList.add('image-ctrl');
        row.append(el('div', { class: 'ctrl-actions' }, choose, clear), thumb);
        break;
      }
      case 'font': {
        // 字体：可搜索的本机字体列表，滚轮前后切换
        const picker = createFontPicker({ onChange: v => onChange(def.key, v) });
        if (panel) row.classList.add('stacked');
        render = v => picker.set(v);
        wheel = steps => picker.step(current, steps);
        row.append(picker.button);
        break;
      }
      case 'textarea': {
        // 多行文字：边输入边生效（输入框有焦点时不被外部更新覆盖）
        const input = el('textarea', { class: 'text-input textarea', rows: def.rows || 3, spellcheck: 'false' });
        input.addEventListener('input', () => onChange(def.key, input.value));
        input.addEventListener('keydown', e => e.stopPropagation()); // 输入时不触发工具快捷键
        render = v => { if (document.activeElement !== input) input.value = v ?? ''; };
        row.classList.add('stacked');
        row.append(input);
        break;
      }
      case 'albumGroups': {
        // 分组版式：每一组（行 / 列）用哪个图集。def.count(values) 组数，def.itemLabel(values, i) 名称；ctx.albums() 图集列表
        const box = el('div', { class: 'album-groups' });
        let key = '';
        render = v => {
          const vals = lastValues || {};
          const albums = ctx.albums?.() || [];
          const n = def.count(vals);
          const list = Array.isArray(v) ? v : [];
          const k = JSON.stringify([n, list, albums.map(a => [a.id, a.name]), def.itemLabel(vals, 0)]);
          if (k === key) return;
          key = k;
          if (!albums.length) { box.replaceChildren(el('p', { class: 'note' }, '还没有图集')); return; }
          box.replaceChildren(...Array.from({ length: n }, (_, i) => {
            const autoName = albums[i % albums.length].name;
            const sel = el('select', { class: 'select' },
              el('option', { value: '' }, `自动 · ${autoName}`),
              ...albums.map(a => el('option', { value: a.id }, a.name)));
            sel.value = list[i] && albums.some(a => a.id === list[i]) ? list[i] : '';
            sel.addEventListener('change', () => {
              const next = Array.from({ length: Math.max(n, list.length) }, (_, j) => list[j] ?? null);
              next[i] = sel.value || null;
              onChange(def.key, next);
            });
            return el('div', { class: 'ag-row' }, el('span', { class: 'ag-label' }, def.itemLabel(vals, i)), sel);
          }));
        };
        row.classList.add('stacked');
        row.append(box);
        break;
      }
      case 'seed': {
        const display = el('span', { class: 'ctrl-value' });
        const btn = el('button', { class: 'btn small' }, icon('shuffle', 13), '换一组');
        btn.addEventListener('click', () => onChange(def.key, Math.floor(Math.random() * 1e6)));
        render = v => { display.textContent = `#${v}`; };
        wheel = (steps, fast) => Math.max(0, current + steps * (fast ? 10 : 1));
        row.append(el('div', { class: 'ctrl-actions' }, display, btn));
        row.classList.add('inline');
        break;
      }
    }

    // 按住名称上下（或左右）拖动调整数值，类似 Photoshop：向上 / 向右增大
    //   数值条：拖过约 240 像素走完整个范围，Shift 精调；数字：每像素一步，Shift ×10
    //   数字输入框本身也可以拖：拖动调数值，单击（没拖动）才进入输入
    if (def.type === 'range' || def.type === 'number') {
      const scrub = (e, target, onClick) => {
        if (e.button !== 0) return;
        e.stopPropagation(); // 不触发数值条本身的拖动
        e.preventDefault();
        target.setPointerCapture(e.pointerId);
        const start = Number(current) || 0, x0 = e.clientX, y0 = e.clientY;
        const step = def.step ?? 1;
        const span = Number.isFinite(def.max - def.min) ? def.max - def.min : null;
        let moved = false;
        const move = ev => {
          const d = (ev.clientX - x0) - (ev.clientY - y0);
          if (!moved && Math.abs(d) < 3) return;
          if (!moved) { moved = true; document.body.classList.add('scrubbing'); }
          const perPx = def.type === 'range' && span ? (span / 240) * (ev.shiftKey ? 0.1 : 1) : step * (ev.shiftKey ? 10 : 1);
          const v = Number(clampTo(Math.round((start + d * perPx) / step) * step, def).toFixed(decimals(step)));
          if (v !== current) onChange(def.key, v);
        };
        const up = () => {
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', up);
          target.removeEventListener('pointercancel', up);
          document.body.classList.remove('scrubbing');
          if (!moved) onClick?.();
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
      };
      label.classList.add('scrub');
      label.title = '按住上下拖动调整（Shift 精调 / 加速）· 双击恢复默认 · 悬停后可用滚轮';
      label.addEventListener('pointerdown', e => scrub(e, label));
      const numInput = def.type === 'number' ? row.querySelector('.num-input') : null;
      if (numInput) {
        numInput.classList.add('scrub-input');
        numInput.addEventListener('pointerdown', e => {
          if (document.activeElement === numInput) return; // 正在输入时照常选择文字
          scrub(e, numInput, () => { numInput.focus(); numInput.select(); });
        });
      }
    }

    if (wheel && !def.nowheel) {
      attachWheel(row, (steps, e) => {
        const next = wheel(steps, e.shiftKey);
        if (next !== undefined && next !== current) onChange(def.key, next);
      }, { immediate: !!ctx.wheelImmediate });
    }

    container.append(row);
    rows.push({ def, node: row, label, labelText, group, setValue: v => { current = v; render(v); } });
  }

  let lastValues = values;
  const update = vals => {
    lastValues = vals;
    for (const r of rows) {
      if (r.groupKey) { r.node.classList.toggle('collapsed', isCollapsed(r.groupKey)); continue; }
      r.node.hidden = !!(r.def.show && !r.def.show(vals)) || (r.group && isCollapsed(r.group));
      if (r.setValue && r.def.key) r.setValue(vals[r.def.key]);
      if (typeof r.def.label === 'function') r.label.textContent = r.labelText(vals);
    }
    // 并排（half）的两项：只剩一项显示时让它占满整行
    const visible = rows.filter(r => !r.groupKey && !r.node.hidden);
    for (let i = 0; i < visible.length; i++) {
      const r = visible[i];
      if (!r.def.half) continue;
      const paired = visible[i + 1]?.def.half;
      r.node.classList.toggle('solo', !paired);
      if (paired) { visible[i + 1].node.classList.remove('solo'); i++; }
    }
  };
  update(values);
  return update;
}
