// 画布比例
export const ASPECTS = [
  { id: '16:9', value: 16 / 9 },
  { id: '4:3', value: 4 / 3 },
  { id: '3:2', value: 3 / 2 },
  { id: '1:1', value: 1 },
  { id: '4:5', value: 4 / 5 },
  { id: '9:16', value: 9 / 16 },
  { id: '21:9', value: 21 / 9 },
  { id: 'long', label: '长图', value: null }, // 宽度固定，高度随内容
];

export const isLongAspect = id => id === 'long';
export const aspectValue = id => (ASPECTS.find(a => a.id === id && a.value) || ASPECTS[0]).value;

// 预览纹理的最长边（导出时会重新读取原图）
export const PREVIEW_MAX_SIDE = 1600;

// yaw/pitch：旋转（度）；zoom：缩放；panX/panY：平移（世界单位）
export const DEFAULT_CAMERA = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 };
