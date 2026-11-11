import { clamp } from '../core/utils.js';

/**
 * 工作区视图（类似 Illustrator 的画板 + 粘贴板）。
 * 世界坐标：画板的单位（画板高 1000，长图宽 1600），y 轴向下，与屏幕方向一致。
 *   屏幕坐标（相对工作区左上角，CSS 像素）= (世界坐标 - [x, y]) × zoom
 * 视图只影响「怎么看」，不会被导出。
 */
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 16;

export const view = { zoom: 0.5, x: -100, y: -100 };

export const toScreen = (wx, wy) => [(wx - view.x) * view.zoom, (wy - view.y) * view.zoom];
export const toWorld = (sx, sy) => [sx / view.zoom + view.x, sy / view.zoom + view.y];

// 以屏幕上某点为中心缩放视图
export function zoomViewAt(sx, sy, nextZoom) {
  const [wx, wy] = toWorld(sx, sy);
  view.zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  view.x = wx - sx / view.zoom;
  view.y = wy - sy / view.zoom;
}

export function panView(dxPx, dyPx) {
  view.x -= dxPx / view.zoom;
  view.y -= dyPx / view.zoom;
}

/**
 * 让世界坐标中的矩形完整显示在工作区里并居中。
 * inset：{ top, right, bottom, left } 预留给浮动工具条等的空间
 */
// left：左边留多少（左侧浮着工具条时要让开它，画板名称才不会被盖住），默认同 pad
export function fitRect(rect, stageW, stageH, { pad = 40, left = pad, top = 56, bottom = 36, maxZoom = 4 } = {}) {
  const availW = Math.max(50, stageW - left - pad);
  const availH = Math.max(50, stageH - top - bottom - pad);
  view.zoom = clamp(Math.min(availW / rect.w, availH / rect.h), MIN_ZOOM, maxZoom);
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  view.x = cx - (left + availW / 2) / view.zoom;
  view.y = cy - (top + (stageH - top - bottom) / 2) / view.zoom;
}

export const unionRect = rects => {
  const x0 = Math.min(...rects.map(r => r.x)), y0 = Math.min(...rects.map(r => r.y));
  const x1 = Math.max(...rects.map(r => r.x + r.w)), y1 = Math.max(...rects.map(r => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
