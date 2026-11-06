import { el, isCollapsed, setCollapsed } from './dom.js';
import { attachWheel, shiftLightness } from './wheel.js';
import { icon } from './icons.js';

const clampTo = (v, def) => Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, v));
const decimals = step => (String(step).split('.')[1] || '').length;

/**
 * 根据 schema 自动生成控件。
 * schema 项：{ key, label, type: 'range'|'select'|'number'|'toggle'|'color'|'seed'|'image', default, show?(values), ... }
 *          或 { group: '分组标题' }
 * label 可以是函数 (values) => 文本。
 * ctx（可选）：image 控件需要 { imageThumb(id) → canvas|null, pickImage(key), dropTarget }
 * 可选 wheelStep：滚轮每档的步长（默认等于 step）。
 *
 * 所有控件都支持「鼠标悬停 + 滚轮」调整：向上滚增大，Shift 加速 ×10。
 * 返回 update(values)：同步控件的值与可见性（不会重建 DOM，拖动滑块时不丢焦点）。
 */
export function buildControls(container, schema, values, onChange, ctx = {}) {
  container.innerHTML = '';
  const rows = [];
  let group = null; // 当前分组的折叠 key

  for (const def of schema) {
    if (def.group) {
      // 分组标题：点击折叠 / 展开组内参数
      const key = `${ctx.collapseKey || 'ctrl'}:${def.group}`;
      const node = el('button', { class: 'ctrl-group', title: '折叠 / 展开' }, icon('chevron-down', 12), def.group);
      node.addEventListener('click', () => {
        setCollapsed(key, !isCollapsed(key));
        update(lastValues);
      });
      container.append(node);
      rows.push({ def, node, groupKey: key });
      group = key;
      continue;
    }

    const row = el('div', { class: 'ctrl' });
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
        const fmt = v => (step < 1 ? Number(v).toFixed(2) : String(Math.round(v))) + (def.unit || '');
        input.addEventListener('input', () => onChange(def.key, Number(input.value)));
        render = v => {
          if (Number(input.value) !== v) input.value = v;
          display.textContent = fmt(v);
        };
        const ws = def.wheelStep ?? step;
        wheel = (steps, fast) => Number(clampTo(current + steps * ws * (fast ? 10 : 1), def).toFixed(decimals(ws)));
        row.append(display, input);
        break;
      }
      case 'select': {
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
        render = v => { if (input.value !== v) input.value = v; };
        wheel = (steps, fast) => shiftLightness(current, steps * (fast ? 0.1 : 0.02)); // 滚轮调亮度
        row.append(input);
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
      });
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
  };
  update(values);
  return update;
}
