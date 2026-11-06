import { store, actions, boardsOf } from '../state.js';
import { canvasOf, slidesOf } from './boards.js';
import { createLayer } from '../layers/model.js';
import { deviceSize, deviceOf, deviceAspect, findScreen, autoFit } from '../layers/devices.js';
import { openQuadPicker } from '../ui/quadPicker.js';
import { createMockupPanel, MOCKUP_DRAG_TYPE } from '../ui/mockupPanel.js';
import { toast } from '../ui/toast.js';

// 矩形 [x, y, w, h] → 四个角（左上、右上、右下、左下）
const rectQuad = ([x, y, w, h]) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

/**
 * 设备样机的接线：右栏「样机」页（点击 / 拖到画板上添加）、上传 PNG 样机（对准屏幕四角）、
 * 设计页里「更换屏幕图片」「调整屏幕区域」。
 */
export function createMockups({ ws, viewport, settingsSlot, importing, getLayerTools, setTool, clearSelection }) {
  // 把样机加到当前画板：宽度不超过画板的 62%、高度不超过 72%；at 为放下的位置（中心），
  // 否则放在画板中间，多台时依次显示下一张、稍微错开
  function addDeviceLayer(props, label, asset = null, at = null) {
    const s = store.get();
    const { W, H } = canvasOf(s);
    const list = s.layers || [];
    const used = list.filter(l => l.type === 'device').length;
    const aspect = deviceAspect(props.device, props);
    const { w, h } = deviceSize(props.device, Math.min(W * 0.62, (H * 0.72) / aspect), props);
    const slide = (used % slidesOf(s).length) + 1;
    const l = createLayer('device', {
      fit: autoFit(props.device, slidesOf(s)[slide - 1]?.preview),
      ...props, w, h, slide,
      x: at ? at.x - w / 2 : (W - w) / 2 + used * 32, y: at ? at.y - h / 2 : (H - h) / 2 + used * 32,
    }, list);
    if (asset) actions.addAssetLayers([asset], [l]);
    else actions.setLayers([...list, l]);
    setTool('select');
    clearSelection();
    getLayerTools().select([l.id]);
    toast(`已添加${label}样机`);
  }

  const panel = createMockupPanel(settingsSlot, {
    getSlide: () => slidesOf(store.get())[0]?.preview,
    onAdd(p, frame, at = null) {
      const n = (store.get().layers || []).filter(x => x.type === 'device' && x.device === p.device).length + 1;
      addDeviceLayer({ device: p.device, yaw: p.yaw || 0, pitch: p.pitch || 0, frame, name: `${deviceOf(p.device).label} ${n}` }, `「${p.label}」`, null, at);
    },
    // 上传 PNG 样机：先自动识别透明的屏幕区域作为初始位置，再弹窗让用户拖四个角对准屏幕（支持透视）
    async onUpload(file) {
      let asset;
      try {
        toast('正在读取样机…', { sticky: true });
        asset = await importing.createAsset({ file });
      } catch (err) {
        console.error(err);
        toast('无法读取这张图片', { error: true });
        return;
      }
      toast('拖动四个角对准屏幕', { duration: 1500 });
      const found = findScreen(asset.preview);
      const auto = found && rectQuad(found);
      const quad = await openQuadPicker({
        image: asset.preview, quad: auto || rectQuad([0.2, 0.2, 0.6, 0.6]), auto,
        preview: slidesOf(store.get())[0]?.preview, screenOnTop: !found,
      });
      if (!quad) { asset.preview?.close?.(); return; }
      const name = file.name.replace(/\.[^.]+$/, '');
      addDeviceLayer({ device: 'custom', frameAssetId: asset.id, frameW: asset.width, frameH: asset.height, quad, screenOnTop: !found, name }, `「${name}」`, asset);
    },
    onAddCustom: (t, at = null) => addDeviceLayer({
      device: 'custom', frameAssetId: t.frameAssetId, frameW: t.frameW, frameH: t.frameH, screen: t.screen, quad: t.quad, screenOnTop: t.screenOnTop, name: t.name,
    }, `「${t.name}」`, null, at),
    // 本项目所有画板里用到的 PNG 样机（按外框去重）
    getCustom() {
      const s = store.get();
      const seen = new Map();
      for (const b of boardsOf(s)) {
        for (const l of b.settings.layers || []) {
          if (l.type !== 'device' || l.device !== 'custom' || !s.assets[l.frameAssetId] || seen.has(l.frameAssetId)) continue;
          seen.set(l.frameAssetId, {
            frameAssetId: l.frameAssetId, frameW: l.frameW, frameH: l.frameH, screen: l.screen, quad: l.quad, screenOnTop: l.screenOnTop,
            name: l.name.replace(/ \d+$/, ''), frameImg: s.assets[l.frameAssetId].preview,
          });
        }
      }
      return [...seen.values()];
    },
  });

  // 把样机页的卡片拖到画板上：放在松手的位置（落在哪个画板就加到哪个画板，画板外就加到当前画板）
  const isMockupDrag = e => [...(e.dataTransfer?.types || [])].includes(MOCKUP_DRAG_TYPE);
  viewport.addEventListener('dragover', e => {
    if (!isMockupDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  viewport.addEventListener('drop', e => {
    if (!isMockupDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const board = ws.boardAt(e.clientX, e.clientY);
    if (board && board !== store.get().activeBoard) actions.setActiveBoard(board);
    const at = getLayerTools().pointOnBoard(e.clientX, e.clientY, store.get().activeBoard);
    panel.drop(e.dataTransfer.getData(MOCKUP_DRAG_TYPE), at);
  });

  // 设计页：重新调整 PNG 样机的屏幕四角
  async function adjustQuad(l) {
    const s = store.get();
    const frame = s.assets[l.frameAssetId]?.preview;
    if (!frame) return;
    const found = findScreen(frame);
    const quad = await openQuadPicker({
      title: '调整屏幕区域', image: frame, quad: l.quad || rectQuad(l.screen || [0.1, 0.1, 0.8, 0.8]), auto: found && rectQuad(found),
      preview: l.imageId ? s.assets[l.imageId]?.preview : slidesOf(s)[(l.slide || 1) - 1]?.preview, screenOnTop: !!l.screenOnTop,
    });
    if (quad) actions.updateLayers([l.id], { quad });
  }

  // 幻灯片、素材或图层数量变化时刷新样机页（缩略图、本项目的 PNG 样机）
  function update(s, prev) {
    if (s.slides !== prev.slides || s.assets !== prev.assets
      || (s.layers !== prev.layers && s.activeBoard === prev.activeBoard && s.layers.length !== prev.layers.length)) panel.update();
  }

  return { update, adjustQuad, pickImage: l => importing.pickDeviceImage(l) };
}
