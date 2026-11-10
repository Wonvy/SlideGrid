import { gridInRect, svg, countParam } from '../helpers.js';

// 第一张作为主图（在左侧列表拖动排序即可更换主图）
export default {
  id: 'hero',
  name: '主图 + 网格',
  category: 'flat',
  ordered: true, // 图片按版式顺序分配（不受「图片顺序」设置影响）
  long: true, // 支持长图模式
  icon: svg(`
    <rect x="12" y="3" width="24" height="14" rx="1.5"/>
    <rect x="6" y="20" width="11" height="7" rx="1.2"/><rect x="18.5" y="20" width="11" height="7" rx="1.2"/><rect x="31" y="20" width="11" height="7" rx="1.2"/>`),
  params: [
    countParam(0),
    {
      key: 'side', label: '主图位置', type: 'select', default: 'top',
      options: [{ value: 'left', label: '左侧' }, { value: 'right', label: '右侧' }, { value: 'top', label: '上方' }],
    },
    { key: 'heroSize', label: '主图占比', type: 'range', min: 0.3, max: 0.8, step: 0.01, default: 0.6 },
    { key: 'cols', label: '小图列数', type: 'range', min: 1, max: 8, default: 3 },
    { key: 'gap', label: '间距', type: 'range', min: 0, max: 120, default: 24 },
    { key: 'margin', label: '边距', type: 'range', min: 0, max: 300, default: 80 },
  ],
  compute({ n, aspect, W, H, p }) {
    const gap = p.gap;
    const aw = W - 2 * p.margin, ah = H - 2 * p.margin;
    const camera = { type: 'ortho' };

    if (n === 1) {
      return { items: gridInRect({ count: 1, cols: 1, aspect, gap, w: aw, h: ah }).items, camera };
    }

    if (p.side === 'top') {
      let hh = ah * p.heroSize - gap / 2, hw = hh * aspect;
      if (hw > aw) { hw = aw; hh = hw / aspect; }
      const g = gridInRect({ count: n - 1, cols: p.cols, aspect, gap, w: aw, h: ah - hh - gap, start: 1 });
      const top = (hh + gap + g.bh) / 2;
      const dy = top - hh - gap - g.bh / 2;
      return {
        items: [{ i: 0, x: 0, y: top - hh / 2, w: hw, h: hh }, ...g.items.map(it => ({ ...it, y: it.y + dy }))],
        camera,
      };
    }

    let hw = aw * p.heroSize - gap / 2, hh = hw / aspect;
    if (hh > ah) { hh = ah; hw = hh * aspect; }
    const g = gridInRect({ count: n - 1, cols: p.cols, aspect, gap, w: aw - hw - gap, h: ah, start: 1 });
    const bw = hw + gap + g.bw;
    const left = -bw / 2;
    const heroLeft = p.side === 'right' ? left + g.bw + gap : left;
    const gridLeft = p.side === 'right' ? left : left + hw + gap;
    const dx = gridLeft + g.bw / 2;
    return {
      items: [{ i: 0, x: heroLeft + hw / 2, y: 0, w: hw, h: hh }, ...g.items.map(it => ({ ...it, x: it.x + dx }))],
      camera,
    };
  },
};
