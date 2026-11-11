import * as m4 from '../render/math.js';
import { DEG } from '../core/utils.js';
import { cachedScene } from '../render/scene.js';
import { cameraRot, mat4ToQuat, slerp, lookFrom, rotationOf, transpose3 } from '../render/orient.js';
import { sceneInput, is3D } from '../app/boards.js';
import { getLayout } from '../layouts/index.js';
import { el } from './dom.js';
import { icon } from './icons.js';

/**
 * 立方体视图（3D 版式时显示在画布右上角）：
 *   立方体按当前视角转动（前 / 后 / 左 / 右 / 上 / 下 = 版式内容本身的方向；桌面类版式的桌面是「上」，俯视 = 正对卡片）
 *   拖动立方体：旋转视角；点面 = 正视 / 侧视 / 俯视…，点棱 = 45° 视角，点角 = 等轴视角（动画过渡）
 *   「透视 / 正交」切换投影；「复位」回到版式默认视角
 * 视角存在画板的构图里（camera.q 四元数；pitch / yaw 是构图工具的转动，叠加在前面），导出和预览一致。
 */
const SIZE = 54; // 立方体边长（像素）
// 内容坐标：x 右、y 上、z 朝镜头。一般的版式「上」是 +y、「前」是 +z；
// 桌面类版式（surface: 'table'）内容平面是桌面：「上」是 +z（俯视 = 正对卡片），「前」是靠近观众的 -y
const FRAMES = {
  wall: { up: [0, 1, 0], front: [0, 0, 1] },
  table: { up: [0, 0, 1], front: [0, -1, 0] },
};
const VIEW_NAMES = { 前: '正视', 后: '后视', 左: '左视', 右: '右视', 上: '俯视', 下: '仰视' };
const neg = v => v.map(x => -x);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// 六个面：[名称, 法线 n, 文字的上方向 u]；右方向 r = u × n
const facesOf = ({ up, front }) => [
  ['前', front, up], ['后', neg(front), up], ['右', [1, 0, 0], up], ['左', [-1, 0, 0], up],
  ['上', up, neg(front)], ['下', neg(up), front],
].map(([name, n, u]) => [name, cross(u, n), u, n]);
const flipY = v => [v[0], -v[1], v[2]]; // 内容坐标（y 上）→ CSS（y 下）
const cssMatrix = (cols, t = [0, 0, 0]) => `matrix3d(${[...flipY(cols[0]), 0, ...flipY(cols[1]), 0, ...flipY(cols[2]), 0, ...flipY(t), 1].map(v => +v.toFixed(6)).join(',')})`;

export function createViewCube(host, { store, actions }) {
  const cube = el('div', { class: 'vc-cube' });
  let frameKey = '', frame = FRAMES.wall;
  function buildFaces(key) {
    frameKey = key;
    frame = FRAMES[key];
    cube.replaceChildren();
    for (const [name, r, u, n] of facesOf(frame)) {
      const face = el('div', { class: 'vc-face' });
      // 局部 x → r，局部 y（向下）→ -u，局部 z → n；面中心在 n × 边长 / 2
      face.style.transform = `${cssMatrix([r, neg(u), n], n.map(v => (v * SIZE) / 2))} translate(-50%, -50%)`;
      // 3 × 3 的格子：中间 = 面，四边 = 棱（45°），四角 = 角（等轴）
      for (const dv of [1, 0, -1]) {
        for (const du of [-1, 0, 1]) {
          const d = n.map((v, i) => v + du * r[i] + dv * u[i]);
          const kind = du && dv ? 'corner' : du || dv ? 'edge' : 'center';
          const cell = el('div', { class: `vc-cell vc-${kind}` });
          cell.dataset.dir = d.join(',');
          cell.title = kind === 'center' ? `${VIEW_NAMES[name]}（${name}）` : kind === 'edge' ? '45° 视角' : '等轴视角';
          face.append(cell);
        }
      }
      face.append(el('span', { class: 'vc-label' }, name));
      cube.append(face);
    }
  }
  buildFaces('wall');
  const stage = el('div', { class: 'vc-stage', title: '拖动旋转视角 · 点面 / 棱 / 角切换视图' }, cube);
  const projBtn = el('button', { class: 'vc-btn', type: 'button' });
  const homeBtn = el('button', { class: 'vc-btn icon', type: 'button', title: '复位视角（回到版式默认的角度）', 'aria-label': '复位视角' }, icon('rotate-ccw', 13));
  const root = el('div', { class: 'view-cube', hidden: true }, stage, el('div', { class: 'vc-bar' }, projBtn, homeBtn));
  host.append(root);

  const scene = () => cachedScene(sceneInput(store.get()));
  const groupRot = () => rotationOf(scene().groupM || m4.identity()); // 版式内容本身的转向（等距展台的桌面倾斜等）
  const viewRot = (cam = store.get().camera) => m4.multiply(cameraRot(cam), groupRot()); // 内容 → 屏幕

  /* ---------- 视角动画 ---------- */
  let anim = 0;
  function animateTo(targetRot) {
    cancelAnimationFrame(anim);
    const cam = store.get().camera;
    const q0 = mat4ToQuat(cameraRot(cam)), q1 = mat4ToQuat(targetRot);
    const t0 = performance.now(), dur = 320;
    const step = now => {
      const t = Math.min(1, (now - t0) / dur), e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const q = slerp(q0, q1, e);
      // 回到版式默认的角度时不留单位旋转（构图里就不再显示「3D 角度」，复位按钮也变灰）
      actions.setCamera({ q: t === 1 && Math.abs(q[3]) > 0.99999 ? undefined : q, pitch: 0, yaw: 0 });
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  // 从内容的方向 d 看过去：屏幕旋转 = lookFrom(d) · 内容转向的逆
  const viewFrom = d => animateTo(m4.multiply(lookFrom(d, frame.up, frame.front), transpose3(groupRot())));

  /* ---------- 拖动旋转 / 点击 ---------- */
  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    cancelAnimationFrame(anim);
    stage.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY, r0 = cameraRot(store.get().camera), target = e.target;
    let moved = false;
    const move = ev => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      root.classList.add('dragging');
      // 屏幕空间的转动叠在前面：左右拖绕屏幕竖轴转，上下拖绕屏幕横轴转（和构图工具的方向一致）
      const r = m4.multiplyAll(m4.rotationX(dy * 0.8 * DEG), m4.rotationY(dx * 0.8 * DEG), r0);
      actions.setCamera({ q: mat4ToQuat(r), pitch: 0, yaw: 0 });
    };
    const up = () => {
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      stage.removeEventListener('pointercancel', up);
      root.classList.remove('dragging');
      if (!moved && target.dataset?.dir) viewFrom(target.dataset.dir.split(',').map(Number));
    };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
  });
  stage.addEventListener('wheel', e => e.stopPropagation(), { passive: true });

  projBtn.addEventListener('click', () => {
    const sc = scene();
    const next = sc.ortho ? 'persp' : 'ortho';
    const own = sc.layoutCamera?.type === 'perspective' ? 'persp' : 'ortho';
    actions.setCamera({ proj: next === own ? undefined : next }); // 和版式自己的一样时不用记
  });
  homeBtn.addEventListener('click', () => animateTo(m4.identity()));

  /* ---------- 同步 ---------- */
  let lastKey = '';
  function update(s = store.get()) {
    const show = is3D() && s.slides.length > 0;
    root.hidden = !show;
    if (!show) return;
    const sc = scene();
    const fk = getLayout(s.layoutId)?.surface === 'table' ? 'table' : 'wall';
    if (fk !== frameKey) { buildFaces(fk); lastKey = ''; }
    const m = viewRot(s.camera);
    const key = `${Array.from(m).map(v => v.toFixed(4)).join(',')}|${sc.ortho}`;
    if (key === lastKey) return;
    lastKey = key;
    // 立方体自己的坐标也是 CSS 坐标（y 向下）：S · M · S，第二列取反（cssMatrix 负责前面的 S）
    cube.style.transform = cssMatrix([[m[0], m[1], m[2]], [-m[4], -m[5], -m[6]], [m[8], m[9], m[10]]]);
    projBtn.textContent = sc.ortho ? '正交' : '透视';
    projBtn.title = sc.ortho ? '现在是正交投影（没有近大远小），点击切换为透视' : '现在是透视投影（近大远小），点击切换为正交';
    const custom = (!!s.camera.q && Math.abs(s.camera.q[3]) < 0.99999) || Math.abs(s.camera.pitch || 0) > 1e-3 || Math.abs(s.camera.yaw || 0) > 1e-3;
    homeBtn.disabled = !custom;
  }
  store.subscribe(s => update(s));
  update();
  return { update };
}
