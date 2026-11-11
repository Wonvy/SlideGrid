import { store, boardSettingsOf, libraryOf } from '../state.js';
import { getLayout } from '../layouts/index.js';
import { cachedCanvas, cachedScene } from '../render/scene.js';
import { createPlaceholders } from '../slides/placeholders.js';

/**
 * 画板 → 渲染输入。只读 store，不碰 DOM。
 * 每个画板有自己的图片顺序、版式、参数、样式、比例、构图、卡片调整和图层；图片文件和背景素材是项目共用的。
 */

// 还没有导入图片时显示的示例卡片（同时也是可以放入图片的空位）
export const placeholders = createPlaceholders(9);
export const boardSlides = list => (list?.length ? list : placeholders);
export const slidesOf = s => boardSlides(s.slides); // 当前画板
export const hasRealSlides = () => store.get().slides.length > 0;
// 构图有没有转动过（立方体视图 / 构图工具）
export const cameraTurned = cam => (!!cam?.q && Math.abs(cam.q[3]) < 0.99999) || Math.abs(cam?.pitch || 0) > 1e-3 || Math.abs(cam?.yaw || 0) > 1e-3;
// 3D 视图：3D 版式，或者平面版式被立方体视图转动过 / 改成了透视（这时单张卡片的调整先停用，复位视角后恢复）
export const is3D = (s = store.get()) => getLayout(s.layoutId).category === '3d' || cameraTurned(s.camera) || s.camera?.proj === 'persp';

// 背景图 / 幻灯片模糊背景用到的图片：preview 用于预览，source 用于导出时读取原图
function bgSourceOf(s, st) {
  const style = st.style;
  if (style.bgType === 'image') {
    const a = s.assets[style.bgImageId];
    return a ? { preview: a.preview, source: a.file } : null;
  }
  if (style.bgType === 'slide') {
    const list = boardSlides(st.slides);
    const sl = list[Math.min(list.length, Math.max(1, Math.round(style.bgSlide || 1))) - 1];
    return sl ? { preview: sl.preview, source: sl.source } : null;
  }
  return null;
}

// 某个画板（st 为该画板的设置）的渲染输入，与 buildScene / renderToCanvas 的参数一致
// 项目里全部图片的 id → 幻灯片（卡片可以固定显示别的图集里的图片，见 scene.js）。按引用缓存，场景缓存才不会每帧失效
let poolKey = [], poolVal = new Map();
export function slidePool(s) {
  const key = [s.albums, s.artboards, s.slides];
  if (key.some((v, i) => v !== poolKey[i])) {
    poolKey = key;
    poolVal = new Map(libraryOf(s).map(x => [x.id, x]));
  }
  return poolVal;
}

export function boardInput(s, st) {
  const layout = getLayout(st.layoutId);
  return {
    slides: boardSlides(st.slides),
    pool: slidePool(s),
    albums: s.albums, // 分组版式按行 / 列取各个图集的图片
    layout,
    params: st.params[layout.id],
    style: st.style,
    aspect: st.aspect, // 比例 id，长图为 'long'
    camera: st.camera,
    background: bgSourceOf(s, st),
    adjust: st.adjust[st.layoutId] || null,
    layers: st.layers || [],
    assets: s.assets, // 图片图层用到的素材
  };
}

// 当前画板的设置在 store 顶层
export const sceneInput = s => boardInput(s, boardSettingsOf(s));
// 当前画板实际用的是不是透视相机（版式给的，或立方体视图里切换的）：构图的缩放 / 平移按这个换算
export const isPerspective = (s = store.get()) => !cachedScene(sceneInput(s)).ortho;
export const canvasOf = s => cachedCanvas(sceneInput(s));

// 画板在工作区里的世界坐标范围
export const boardWorldRect = (s, b) => {
  const { W, H } = cachedCanvas(boardInput(s, b.settings));
  return { x: b.x, y: b.y, w: W, h: H };
};

// 当前画板某张卡片的手动调整（副本）；新调整的卡片叠在最上面
const currentAdjust = () => store.get().adjust[store.get().layoutId] || {};
export const getAdjust = order => ({ ...currentAdjust()[order] });
export const nextLift = () => 1 + Math.max(0, ...Object.values(currentAdjust()).map(a => a.lift || 0));

export const safeName = s => String(s).replace(/[\\/:*?"<>|]/g, '_');
