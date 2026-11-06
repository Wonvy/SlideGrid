// 滚轮调参的通用工具
//
// 防误操作：控件需要先「激活」，滚轮才会改参数——
//   1. 鼠标真的移动到控件上（滚动页面时内容在鼠标下经过不算），并停留 DWELL 毫秒
//   2. 任何一次页面滚动都会取消激活，必须再移动鼠标才能重新激活
//   3. 激活后 IDLE 毫秒内没有调整也会自动取消
// 另有两种模式：'alt' 只在按住 ⌥/Alt 时调参；'off' 关闭滚轮调参。

const DWELL = 300;
const IDLE = 2500;

let mode = 'hover'; // 'hover' | 'alt' | 'off'
let armed = null;
let candidate = null;
let dwellTimer = 0, idleTimer = 0;
let lastX = null, lastY = null;

function disarm() {
  clearTimeout(dwellTimer);
  clearTimeout(idleTimer);
  candidate = null;
  armed?.classList.remove('wheel-armed');
  armed = null;
}

function arm(node) {
  armed = node;
  node.classList.add('wheel-armed');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(disarm, IDLE);
}

export function setWheelMode(m) {
  mode = m;
  disarm();
}

// 记录鼠标是否真的移动了（浏览器在滚动后补发的 mousemove 坐标不变）
document.addEventListener('pointermove', e => {
  e.sgRealMove = lastX === null || Math.abs(e.screenX - lastX) + Math.abs(e.screenY - lastY) >= 2;
  lastX = e.screenX;
  lastY = e.screenY;
}, { capture: true, passive: true });

// 没被控件处理的滚轮 = 页面滚动 → 取消激活
document.addEventListener('wheel', e => {
  if (!e.sgHandled) disarm();
}, { passive: true });

/** 让元素支持滚轮调参：允许时调用 onSteps(steps, event)，steps 向上为正 */
export function attachWheel(node, onSteps) {
  const stepper = createWheelStepper();
  node.classList.add('wheelable');

  node.addEventListener('pointermove', e => {
    if (mode !== 'hover' || e.pointerType === 'touch' || !e.sgRealMove || armed === node) return;
    if (armed) disarm();
    candidate = node;
    clearTimeout(dwellTimer);
    dwellTimer = setTimeout(() => {
      if (candidate === node && node.matches(':hover')) arm(node);
    }, DWELL);
  });

  node.addEventListener('pointerleave', () => {
    if (candidate === node) { clearTimeout(dwellTimer); candidate = null; }
    if (armed === node) disarm();
  });

  node.addEventListener('wheel', e => {
    const allowed = mode === 'alt' ? e.altKey : mode === 'hover' && armed === node;
    if (!allowed) return; // 交给页面滚动
    e.preventDefault();
    e.sgHandled = true;
    if (mode === 'hover') arm(node); // 调整时保持激活
    const steps = stepper(e);
    if (steps) onSteps(steps, e);
  }, { passive: false });
}

export const wheelModeSchema = [
  {
    key: 'wheelNav', label: '工作区滚轮', type: 'select', default: 'zoom', nowheel: true,
    options: [
      { value: 'zoom', label: '缩放视图（推荐）' },
      { value: 'scroll', label: '滚动视图（⌘ + 滚轮缩放）' },
    ],
  },
  {
    key: 'wheelMode', label: '滚轮调参', type: 'select', default: 'hover', nowheel: true,
    options: [
      { value: 'hover', label: '悬停激活（推荐）' },
      { value: 'alt', label: '按住 ⌥ / Alt 时' },
      { value: 'off', label: '关闭' },
    ],
  },
];

/**
 * 把滚轮事件换算成"档位"：向上滚为正。
 * 鼠标滚轮每格一档；触控板的连续小增量累加到一定距离才算一档。
 * 一个事件最多一档，加速滚动时靠事件数量变快。
 * Mac 上按住 Shift 时滚轮会变成横向，所以也读取 deltaX。
 */
export function createWheelStepper(threshold = 40) {
  let acc = 0;
  let lastTime = 0;
  return e => {
    let d = e.deltaY || e.deltaX;
    if (e.deltaMode === 1) d *= 33;
    else if (e.deltaMode === 2) d *= 300;
    const now = performance.now();
    if (now - lastTime > 250) acc = 0;
    lastTime = now;
    // 鼠标滚轮：每个事件只算一档（带加速的滚轮单次 delta 可能有几百，不能按距离换算）
    if (Math.abs(d) >= 50) {
      acc = 0;
      return -Math.sign(d);
    }
    acc += d;
    if (Math.abs(acc) < threshold) return 0;
    const steps = -Math.sign(acc);
    acc = 0;
    return steps;
  };
}

// 颜色：调整 HSL 亮度
function hexToHsl(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let hue = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue /= 6;
  }
  return [hue, s, l];
}

function hslToHex(h, s, l) {
  const f = n => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function shiftLightness(hex, delta) {
  const [h, s, l] = hexToHsl(hex || '#000000');
  return hslToHex(h, s, Math.min(1, Math.max(0, l + delta)));
}
