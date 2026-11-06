import { el } from './dom.js';
import { icon } from './icons.js';
import { FRAMES, DEVICE_PRESETS, deviceAspect, drawDevice } from '../layers/devices.js';

const FRAME_KEY = 'slidegrid:mockup-frame';
export const MOCKUP_DRAG_TYPE = 'application/x-slidegrid-mockup';

/**
 * 右栏「样机」页：选外观（深空灰 / 银色 / 白色），点设备把它加到当前画板中间（样机图层）；
 * 也可以上传 PNG 样机（屏幕区域透明），本项目用过的 PNG 样机列在下面，点击再次添加。
 * 缩略图用当前画板的第一张幻灯片绘制，和实际效果一致。
 *   onAdd(preset, frame, at?)：preset 为 DEVICE_PRESETS 里的一项（设备 + 角度）；onUpload(file)；onAddCustom(template, at?)
 *   卡片可以拖到画板上：拖动数据类型为 DRAG_TYPE，放下时由 main.js 调用 drop(data, at) 加到放下的位置
 *   getSlide() → 缩略图屏幕里显示的图片；getCustom() → [{ frameAssetId, frameW, frameH, screen, name, frameImg }]
 */
export function createMockupPanel(container, { onAdd, getSlide, onUpload, onAddCustom, getCustom = () => [] }) {
  let frame = 'dark';
  try { if (localStorage.getItem(FRAME_KEY) in FRAMES) frame = localStorage.getItem(FRAME_KEY); } catch { /* 忽略 */ }

  const frameBtns = new Map();
  const seg = el('div', { class: 'seg' }, Object.entries(FRAMES).map(([id, f]) => {
    const b = el('button', { type: 'button', class: 'seg-btn', title: f.label }, f.label);
    b.addEventListener('click', () => {
      frame = id;
      try { localStorage.setItem(FRAME_KEY, id); } catch { /* 忽略 */ }
      refresh();
    });
    frameBtns.set(id, b);
    return b;
  }));

  const cards = DEVICE_PRESETS.map(p => {
    const canvas = el('canvas', { class: 'mockup-thumb' });
    const b = el('button', { class: 'mockup-card', draggable: 'true', title: `点击添加「${p.label}」到当前画板中间，或拖到画板上` }, canvas, el('span', { class: 'mockup-name' }, p.label));
    b.addEventListener('click', () => onAdd(p, frame));
    dragSource(b, () => ({ preset: DEVICE_PRESETS.indexOf(p), frame }));
    return { p, canvas };
  });

  // 上传 PNG 样机
  const fileInput = el('input', { type: 'file', accept: 'image/png,image/webp', hidden: true });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) onUpload(fileInput.files[0]); fileInput.value = ''; });
  const uploadBtn = el('button', { class: 'btn mockup-upload', title: '上传带透明屏幕区域的 PNG 样机图', onclick: () => fileInput.click() },
    icon('upload', 15), '上传 PNG 样机');
  const customGrid = el('div', { class: 'mockup-grid' });
  const customHead = el('div', { class: 'ctrl-group mockup-sub' }, '本项目的 PNG 样机');

  container.append(
    el('div', { class: 'ctrls' },
      el('div', { class: 'ctrl stacked' }, el('label', { class: 'ctrl-label' }, '外观'), seg)),
    el('div', { class: 'mockup-grid' }, cards.map(c => c.canvas.parentElement)),
    uploadBtn, fileInput,
    el('p', { class: 'note pane-hint' }, 'PNG 样机：屏幕区域要是透明的（被外框包围），上传后自动识别屏幕。'),
    customHead, customGrid,
    el('p', { class: 'note pane-hint' }, '点击把设备加到当前画板中间。把图片或左栏的幻灯片拖到样机上即可更换屏幕内容；选中样机后，可在「设计」页修改。'),
  );

  // 拖动卡片：拖到画板上放下（drop 由 main.js 处理）；拖动时用缩略图做拖影
  function dragSource(b, data) {
    b.addEventListener('dragstart', e => {
      e.dataTransfer.setData(MOCKUP_DRAG_TYPE, JSON.stringify(data()));
      e.dataTransfer.effectAllowed = 'copy';
      const cv = b.querySelector('canvas');
      if (cv) e.dataTransfer.setDragImage(cv, cv.clientWidth / 2, cv.clientHeight / 2);
    });
  }
  // 放下：按拖动数据加到 at（画板坐标的中心点）
  function drop(raw, at) {
    let data;
    try { data = JSON.parse(raw); } catch { return; }
    if (Number.isInteger(data.preset) && DEVICE_PRESETS[data.preset]) onAdd(DEVICE_PRESETS[data.preset], data.frame in FRAMES ? data.frame : frame, at);
    else if (data.custom) { const t = getCustom().find(x => x.frameAssetId === data.custom); if (t) onAddCustom(t, at); }
  }

  // 本项目用过的 PNG 样机
  let customKey = '';
  function renderCustom() {
    const list = getCustom();
    const key = list.map(t => t.frameAssetId).join();
    customHead.hidden = customGrid.hidden = !list.length;
    if (key === customKey) { customGrid.querySelectorAll('canvas').forEach((c, i) => drawCustomThumb(c, list[i])); return; }
    customKey = key;
    customGrid.replaceChildren(...list.map(t => {
      const canvas = el('canvas', { class: 'mockup-thumb' });
      const b = el('button', { class: 'mockup-card', draggable: 'true', title: `点击添加「${t.name}」到当前画板中间，或拖到画板上` }, canvas, el('span', { class: 'mockup-name' }, t.name));
      b.addEventListener('click', () => onAddCustom(t));
      dragSource(b, () => ({ custom: t.frameAssetId }));
      drawCustomThumb(canvas, t);
      return b;
    }));
  }
  function drawCustomThumb(canvas, t) {
    const W = 132, H = 96, dpr = 2;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = 8, w = Math.min(W - pad * 2, ((H - pad * 2) * t.frameW) / t.frameH), h = (w * t.frameH) / t.frameW;
    drawDevice(ctx, { device: 'custom', screen: t.screen, quad: t.quad, screenOnTop: t.screenOnTop, fit: 'cover', shadow: false, x: (W - w) / 2, y: (H - h) / 2, w, h }, getSlide(), t.frameImg);
  }

  // 缩略图：按设备比例画在 2 倍分辨率的小画布上
  function draw(c) {
    const { p } = c;
    const W = 132, H = 96, dpr = 2;
    c.canvas.width = W * dpr;
    c.canvas.height = H * dpr;
    const ctx = c.canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const ar = deviceAspect(p.device, p);
    const pad = 10, w = Math.min(W - pad * 2, (H - pad * 2) / ar), h = w * ar;
    drawDevice(ctx, { device: p.device, yaw: p.yaw || 0, pitch: p.pitch || 0, frame, fit: 'cover', shadow: false, x: (W - w) / 2, y: (H - h) / 2, w, h }, getSlide());
  }

  function refresh() {
    frameBtns.forEach((b, id) => b.classList.toggle('active', id === frame));
    cards.forEach(draw);
    renderCustom();
  }
  refresh();

  return { update: refresh, drop };
}
