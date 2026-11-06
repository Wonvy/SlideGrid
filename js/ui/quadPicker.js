import { el } from './dom.js';
import { icon } from './icons.js';
import { drawWarped } from '../layers/warp.js';

/**
 * 标出 PNG 样机的屏幕区域：弹窗里显示 PNG，上面一个半透明的四边形，拖动四个角对准屏幕的四个角。
 *   拖角点：移动这个角（放大镜辅助对准）；拖四边形内部：整体移动；方向键：微调最后选中的角（Shift ×10）
 *   预览：把幻灯片按透视填进去，看实际效果
 * 返回 Promise<quad | null>：四个角占图片的比例 [[x, y] × 4]（左上、右上、右下、左下），取消时为 null
 *
 *   image：PNG（ImageBitmap / canvas）；quad：初始位置；preview：预览用的幻灯片图片；
 *   detected：初始位置是否来自自动识别；screenOnTop：屏幕是否画在外框上面（PNG 屏幕不透明时）
 */
export function openQuadPicker({ image, quad, preview = null, auto = null, screenOnTop = false, title = '标出屏幕区域' }) {
  return new Promise(resolve => {
    let q = quad.map(p => [...p]);
    let active = 0;       // 最后选中的角（方向键微调）
    let drag = null;      // { kind: 'corner' | 'move', index, start, base }
    let showPreview = !!preview;

    const canvas = el('canvas', { class: 'qp-canvas' });
    const ctx = canvas.getContext('2d');
    const previewToggle = el('input', { type: 'checkbox', class: 'switch' });
    previewToggle.checked = showPreview;
    previewToggle.disabled = !preview;
    previewToggle.addEventListener('change', () => { showPreview = previewToggle.checked; draw(); });

    const ok = el('button', { class: 'btn primary', onclick: () => close(q) }, '确定');
    const cancel = el('button', { class: 'btn', onclick: () => close(null) }, '取消');
    const autoBtn = el('button', { class: 'btn ghost', title: '按自动识别的透明区域重新放置四个角', onclick: () => { if (auto) { q = auto.map(p => [...p]); draw(); } } },
      icon('scan', 14), '自动识别');
    autoBtn.disabled = !auto;
    const resetBtn = el('button', { class: 'btn ghost', title: '把四个角放回矩形', onclick: () => {
      const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      q = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      draw();
    } }, icon('rotate-ccw', 14), '恢复矩形');

    const dialog = el('div', { class: 'qp-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('div', { class: 'qp-head' },
        el('div', { class: 'qp-title' }, title),
        el('div', { class: 'qp-hint' },
          '拖动四个角点，对准 PNG 里屏幕的四个角（可以是倾斜的透视屏幕）；拖动区域内部整体移动，方向键微调。',
          screenOnTop ? ' 这张 PNG 的屏幕不透明，图片会画在外框上面。' : '')),
      el('div', { class: 'qp-stage' }, canvas),
      el('div', { class: 'qp-foot' },
        autoBtn, resetBtn,
        el('label', { class: 'check-row qp-preview' }, previewToggle, '预览填充效果'),
        el('span', { class: 'bar-spacer' }), cancel, ok),
    );
    const backdrop = el('div', { class: 'qp-backdrop' }, dialog);
    document.body.append(backdrop);

    // 画布尺寸：PNG 等比放进可用区域
    let W = 0, H = 0, dpr = 1;
    function layout() {
      const maxW = Math.min(1100, window.innerWidth * 0.9) - 32, maxH = window.innerHeight * 0.66;
      const s = Math.min(maxW / image.width, maxH / image.height, 2);
      W = Math.round(image.width * s);
      H = Math.round(image.height * s);
      dpr = window.devicePixelRatio || 1;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      draw();
    }

    const P = ([x, y]) => [x * W, y * H];
    const checker = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const g = c.getContext('2d');
      g.fillStyle = '#e9ebef'; g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#d3d6dc'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
      return ctx.createPattern(c, 'repeat');
    })();

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = checker;
      ctx.fillRect(0, 0, W, H);
      const pts = q.map(P);
      const fillScreen = () => {
        if (!(showPreview && preview)) return;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = '#000';
        ctx.fill();
        drawWarped(ctx, preview, pts, { fit: 'cover' });
      };
      if (!screenOnTop) fillScreen();
      ctx.drawImage(image, 0, 0, W, H);
      if (screenOnTop) fillScreen();
      // 半透明的四边形 + 四个角点
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = showPreview && preview ? 'rgba(124, 140, 255, 0.10)' : 'rgba(124, 140, 255, 0.35)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#7c8cff';
      ctx.stroke();
      pts.forEach(([x, y], i) => {
        ctx.beginPath();
        ctx.arc(x, y, i === active ? 8 : 7, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.lineWidth = i === active ? 3 : 2;
        ctx.strokeStyle = '#5b6cff';
        ctx.stroke();
      });
      if (drag?.kind === 'corner') drawLoupe(pts[drag.index]);
    }

    // 放大镜：拖角点时在画布一角显示 4 倍放大，十字对准角点
    function drawLoupe([x, y]) {
      const R = 64, Z = 4;
      const left = x > W / 2 ? 12 : W - 12 - R * 2, top = y > H / 2 ? 12 : H - 12 - R * 2;
      const cx = left + R, cy = top + R;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = checker;
      ctx.fill();
      ctx.clip();
      ctx.translate(cx - x * Z, cy - y * Z);
      ctx.scale(Z, Z);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 0, 0, W, H);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 12, cy); ctx.lineTo(cx + 12, cy);
      ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy + 12);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#ff3b6b';
      ctx.stroke();
    }

    const local = e => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const inside = ([x, y]) => {
      const pts = q.map(P);
      let c = false;
      for (let i = 0, j = 3; i < 4; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const clamp01 = v => Math.max(0, Math.min(1, v));

    canvas.addEventListener('pointerdown', e => {
      const p = local(e);
      const pts = q.map(P);
      let best = -1, bd = 18;
      pts.forEach((c, i) => { const d = Math.hypot(c[0] - p[0], c[1] - p[1]); if (d < bd) { bd = d; best = i; } });
      if (best >= 0) { drag = { kind: 'corner', index: best }; active = best; }
      else if (inside(p)) drag = { kind: 'move', start: p, base: q.map(c => [...c]) };
      else return;
      canvas.setPointerCapture(e.pointerId);
      draw();
    });
    canvas.addEventListener('pointermove', e => {
      const p = local(e);
      if (!drag) {
        const near = q.map(P).some(c => Math.hypot(c[0] - p[0], c[1] - p[1]) < 18);
        canvas.style.cursor = near ? 'crosshair' : inside(p) ? 'move' : 'default';
        return;
      }
      if (drag.kind === 'corner') {
        q[drag.index] = [clamp01(p[0] / W), clamp01(p[1] / H)];
      } else {
        const dx = (p[0] - drag.start[0]) / W, dy = (p[1] - drag.start[1]) / H;
        const xs = drag.base.map(c => c[0]), ys = drag.base.map(c => c[1]);
        const kx = Math.max(-Math.min(...xs), Math.min(1 - Math.max(...xs), dx));
        const ky = Math.max(-Math.min(...ys), Math.min(1 - Math.max(...ys), dy));
        q = drag.base.map(([x, y]) => [x + kx, y + ky]);
      }
      draw();
    });
    const endDrag = () => { if (drag) { drag = null; draw(); } };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    function onKey(e) {
      e.stopPropagation(); // 弹窗打开时不触发工具快捷键、不移动画布上的图层
      if (e.key === 'Escape') { e.preventDefault(); close(null); return; }
      if (e.key === 'Enter') { e.preventDefault(); close(q); return; }
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!dir) return;
      e.preventDefault();
      const k = e.shiftKey ? 10 : 1; // 按 PNG 原图的像素微调
      const [x, y] = q[active];
      q[active] = [clamp01(x + (dir[0] * k) / image.width), clamp01(y + (dir[1] * k) / image.height)];
      draw();
    }
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', layout);
    backdrop.addEventListener('pointerdown', e => { if (e.target === backdrop) close(null); });

    function close(result) {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', layout);
      backdrop.remove();
      resolve(result ? result.map(([x, y]) => [x, y]) : null);
    }

    layout();
    ok.focus();
  });
}
