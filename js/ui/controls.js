import { el, isCollapsed, setCollapsed } from './dom.js';
import { attachWheel, shiftLightness } from './wheel.js';
import { icon } from './icons.js';
import { createFontPicker } from './fontPicker.js';

const clampTo = (v, def) => Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, v));
const decimals = step => (String(step).split('.')[1] || '').length;

/**
 * 根据 schema 自动生成控件。
 * schema 项：{ key, label, type: 'range'|'select'|'number'|'toggle'|'color'|'seed'|'image'|'textarea'|'font', default, show?(values), ... }
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

    let current = values?.[def.key];
    let render = () => {};
    let wheel = null; // (steps, fast) => 新值

    switch (def.type) {
      case 'range': {
        const step = def.step ?? 1;
        const input = el('input', { type: 'range', min: def.min, max: def.max, step });
        const display = el('span', { class: 'ctrl-value' });
        // 0 ~ 1 的比例（不透明度、位置…）显示成百分比
        const percent = !def.unit && def.min >= 0 && def.max <= 1 && step < 1;
        const fmt = v => (percent ? `${Math.round(v * 100)}%` : (step < 1 ? Number(v).toFixed(2) : String(Math.round(v))) + (def.unit || ''));
        const ws = def.wheelStep ?? step;
        const snap = v => Number(clampTo(Math.round(v / step) * step, def).toFixed(decimals(step)));
        wheel = (steps, fast) => Number(clampTo(current + steps * ws * (fast ? 10 : 1), def).toFixed(decimals(ws)));
        if (panel) {
          // 面板里：整行是一个「数值条」——名称在左、数值在右，底色按比例填充；左右拖动整条调整
          const fill = el('span', { class: 'sfield-fill' });
          row.classList.add('sfield');
          row.tabIndex = 0;
          row.setAttribute('role', 'slider');
          row.prepend(fill);
          row.append(display);
          let drag = null;
          row.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            drag = { x: e.clientX, v: current, w: row.getBoundingClientRect().width, moved: false };
            row.setPointerCapture(e.pointerId);
          });
          row.addEventListener('pointermove', e => {
            if (!drag) return;
            const dx = e.clientX - drag.x;
            if (!drag.moved && Math.abs(dx) < 3) return;
            drag.moved = true;
            row.classList.add('dragging');
            // 拖过整条宽度 = 走完整个范围（Shift 精调 1/10）
            const k = (def.max - def.min) / Math.max(1, drag.w) * (e.shiftKey ? 0.1 : 1);
            const v = snap(drag.v + dx * k);
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
        } else {
          input.addEventListener('input', () => onChange(def.key, Number(input.value)));
          render = v => {
            if (Number(input.value) !== v) input.value = v;
            display.textContent = fmt(v);
          };
          row.append(display, input);
        }
        break;
      }
      case 'select': {
        // 面板里：选项少且短时用分段按钮（类似 iOS / Figma），否则用下拉框；名称放在上方
        const short = def.options.length <= 4 && def.options.every(o => String(o.label).length <= 5);
        if (panel && def.segmented !== false && (def.segmented || short)) {
          const seg = el('div', { class: 'seg' });
          const btns = def.options.map(o => {
            const b = el('button', { type: 'button', class: 'seg-btn', title: o.label }, o.label);
            b.addEventListener('click', () => onChange(def.key, o.value));
            seg.append(b);
            return b;
          });
          render = v => btns.forEach((b, i) => b.classList.toggle('active', def.options[i].value === v));
          wheel = steps => {
            const idx = Math.max(0, def.options.findIndex(o => o.value === current));
            return def.options[Math.min(def.options.length - 1, Math.max(0, idx + steps))].value;
          };
          row.classList.add('stacked');
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
        if (panel) row.classList.add('nfield'); // 面板里：名称和数值在同一个输入条里
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
