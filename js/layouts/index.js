// 版式注册表。新增版式：在 flat/ 或 3d/ 下新建文件，然后加到下面的数组里。
//
// 每个版式是一个对象：
//   id, name, category ('flat' | '3d'), icon (SVG 字符串)
//   ordered（可选）：true 时图片始终按版式顺序分配（第一张是主图 / 最前面），不受「图片顺序」设置影响
//   params   参数 schema，右侧面板据此自动生成控件
//   compute({ n, aspect, W, H, p }) => {
//     items:  [{ i, x, y, z?, rx?, ry?, rz?, w, h, opacity? }]   // i 为幻灯片序号，超出数量时自动循环
//     group?: { x, y, z, rx, ry, rz, s }                         // 整组变换（角度单位：度）
//     camera: { type: 'ortho' } | { type: 'perspective', fov }
//   }
// 坐标为世界单位：画布高 H=1000，宽 W=1000×画布比例，原点在中心，y 轴向上。

import grid from './flat/grid.js';
import hero from './flat/hero.js';
import { staggered, tilted } from './flat/fill.js';
import scatter from './flat/scatter.js';
import fan from './flat/fan.js';
import isoWall from './3d/isoWall.js';
import corridor from './3d/corridor.js';
import cylinder from './3d/cylinder.js';
import cascade from './3d/cascade.js';
import carousel from './3d/carousel.js';
import floating from './3d/floating.js';
import isoStage from './3d/isoStage.js';

export const layouts = [grid, hero, staggered, tilted, scatter, fan, isoWall, corridor, cylinder, cascade, carousel, floating, isoStage];

const byId = new Map(layouts.map(l => [l.id, l]));
export const getLayout = id => byId.get(id);
