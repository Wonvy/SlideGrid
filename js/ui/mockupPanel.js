import { el } from './dom.js';
import { icon } from './icons.js';
import { DEVICES, FRAMES, DEVICE_PRESETS, deviceAspect, drawDevice, autoFit } from '../layers/devices.js';

const FRAME_KEY = 'slidegrid:mockup-frame';
const DEVICE_KEY = 'slidegrid:mockup-device';
const LOOK_KEY = 'slidegrid:mockup-look';
const LOOKS = [['simple', '简洁', '平涂、干净'], ['real', '写实', '拉丝金属、高光、玻璃反光']];
export const MOCKUP_DRAG_TYPE = 'application/x-slidegrid-mockup';

/**
 * 右栏「样机」页：先选设备（一排图标），再从这种设备的角度（正面 / 左侧 / 右侧 / 俯视 / 背面）里点一个加到当前画板中间；
 * 外观（深空灰 / 银色 / 白色）、风格（简洁 / 写实）作用于新添加的样机。
 * 也可以上传 PNG 样机（屏幕区域透明），本项目用过的 PNG 样机列在下面，点击再次添加。
 * 缩略图用当前画板的第一张幻灯片绘制，和实际效果一致。
 *   onAdd(preset, frame, at?, look?)：preset 为 DEVICE_PRESETS 里的一项（设备 + 角度）；onUpload(file)；onAddCustom(template, at?)
 *   卡片可以拖到画板上：拖动数据类型为 DRAG_TYPE，放下时由 main.js 调用 drop(data, at) 加到放下的位置
 *   getSlide() → 缩略图屏幕里显示的图片；getCustom() → [{ frameAssetId, frameW, frameH, screen, name, frameImg }]
 */
export function createMockupPanel(container, footer, { onAdd, getSlide, onUpload, onAddCustom, getCustom = () => [] }) {
  let frame = 'dark';
  try { if (localStorage.getItem(FRAME_KEY) in FRAMES) frame = localStorage.getItem(FRAME_KEY); } catch { /* 忽略 */ }

  const frameBtns = new Map();
  const framePicker = el('div', { class: 'mockup-finishes' }, Object.entries(FRAMES).map(([id, f]) => {
    const b = el('button', { type: 'button', class: 'mockup-finish', title: f.label, 'aria-label': f.label, style: `--finish-color: ${f.body}` });
    b.addEventListener('click', () => {
      frame = id;
      try { localStorage.setItem(FRAME_KEY, id); } catch { /* 忽略 */ }
      refresh();
    });
    frameBtns.set(id, b);
    return b;
  }));

  // 风格：简洁 / 写实
  let look = 'simple';
  try { if (LOOKS.some(x => x[0] === localStorage.getItem(LOOK_KEY))) look = localStorage.getItem(LOOK_KEY); } catch { /* 忽略 */ }
  const lookBtns = new Map();
  const lookSeg = el('div', { class: 'seg' }, LOOKS.map(([id, label, tip]) => {
    const b = el('button', { type: 'button', class: 'seg-btn', title: `${label}：${tip}` }, label);
    b.addEventListener('click', () => {
      look = id;
      try { localStorage.setItem(LOOK_KEY, id); } catch { /* 忽略 */ }
      refresh();
    });
    lookBtns.set(id, b);
    return b;
  }));

  // 设备选择：一排图标按钮，下面只显示这种设备的角度
  let device = 'laptop';
  try { if (localStorage.getItem(DEVICE_KEY) in DEVICES) device = localStorage.getItem(DEVICE_KEY); } catch { /* 忽略 */ }
  const deviceBtns = new Map();
  const devicePicker = el('div', { class: 'mockup-devices', role: 'group', 'aria-label': '设备' }, Object.entries(DEVICES).map(([id, d]) => {
    const b = el('button', { type: 'button', class: 'mockup-device', 'aria-label': d.label },
      icon(d.icon, 30), el('span', { class: 'mockup-device-label' }, d.label.replace('（横）', ' 横')));
    b.addEventListener('click', () => {
      device = id;
      try { localStorage.setItem(DEVICE_KEY, id); } catch { /* 忽略 */ }
      showDevice();
    });
    deviceBtns.set(id, b);
    return b;
  }));

  const cards = DEVICE_PRESETS.map(p => {
    const canvas = el('canvas', { class: 'mockup-thumb' });
    const b = el('button', { class: 'mockup-card', draggable: 'true', title: `点击添加「${p.label}」到当前画板中间，或拖到画板上` }, canvas, el('span', { class: 'mockup-name' }, p.label));
    b.addEventListener('click', () => onAdd(p, frame, null, look));
    dragSource(b, () => ({ preset: DEVICE_PRESETS.indexOf(p), frame, look }));
    return { p, canvas, card: b };
  });
  function showDevice() {
    deviceBtns.forEach((b, id) => {
      b.classList.toggle('active', id === device);
      b.setAttribute('aria-pressed', String(id === device));
    });
    cards.forEach(c => { c.card.hidden = c.p.device !== device; });
  }

  // 上传 PNG 样机
  const fileInput = el('input', { type: 'file', accept: 'image/png,image/webp', hidden: true });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) onUpload(fileInput.files[0]); fileInput.value = ''; });
  const uploadBtn = el('button', { class: 'btn mockup-upload', title: '上传带透明屏幕区域的 PNG 样机图', onclick: () => fileInput.click() },
    icon('upload', 15), '上传 PNG 样机');
  const customGrid = el('div', { class: 'mockup-grid' });
  const customHead = el('div', { class: 'ctrl-group mockup-sub' }, '本项目的 PNG 样机');

  container.append(
    el('div', { class: 'ctrls' },
      el('div', { class: 'ctrl stacked' }, el('label', { class: 'ctrl-label' }, '设备'), devicePicker),
      el('div', { class: 'ctrl mockup-option-row' }, el('label', { class: 'ctrl-label' }, '外观'), framePicker),
      el('div', { class: 'ctrl mockup-option-row' }, el('label', { class: 'ctrl-label' }, '风格'), lookSeg)),
    el('div', { class: 'mockup-grid' }, cards.map(c => c.card)),
    uploadBtn, fileInput,
    customHead, customGrid,
  );
  footer.append(
    el('p', { class: 'note pane-hint' }, 'PNG 样机：屏幕区域要是透明的（被外框包围），上传后自动识别屏幕。'),
    el('p', { class: 'note pane-hint' }, '点击把设备加到当前画板中间。选中样机后，拖它下方的圆形手柄可以转动角度（双击手柄回到正面，按住 ⌥ 直接拖样机也可以）。把图片或左栏的幻灯片拖到样机上即可更换屏幕内容；其他属性在「设计」页修改。'),
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
    if (Number.isInteger(data.preset) && DEVICE_PRESETS[data.preset]) onAdd(DEVICE_PRESETS[data.preset], data.frame in FRAMES ? data.frame : frame, at, data.look === 'real' ? 'real' : data.look === 'simple' ? 'simple' : look);
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
    drawDevice(ctx, { device: p.device, yaw: p.yaw || 0, pitch: p.pitch || 0, frame, look, fit: autoFit(p.device, getSlide()), shadow: false, x: (W - w) / 2, y: (H - h) / 2, w, h }, getSlide());
  }

  function refresh() {
    frameBtns.forEach((b, id) => b.setAttribute('aria-pressed', String(id === frame)));
    lookBtns.forEach((b, id) => b.classList.toggle('active', id === look));
    cards.forEach(draw);
    renderCustom();
    showDevice();
  }
  refresh();

  return { update: refresh, drop };
}
