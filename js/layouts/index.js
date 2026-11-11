// 版式注册表。新增版式：在 flat/ 或 3d/ 下新建文件，然后加到下面的数组里。
//
// 每个版式是一个对象：
//   id, name, category ('flat' | '3d'), icon (SVG 字符串)
//   ordered（可选）：true 时图片始终按版式顺序分配（第一张是主图 / 最前面），不受「图片顺序」设置影响
//   surface（可选）：'table' = 卡片平铺在桌面上（立方体视图把内容平面当作「上」面，俯视 = 正对卡片）
//   params   参数 schema，右侧面板据此自动生成控件
//   compute({ n, aspect, W, H, p }) => {
//     items:  [{ i, x, y, z?, rx?, ry?, rz?, w, h, opacity?, stack? }]   // i 为幻灯片序号，超出数量时自动循环；
//             stack：叠放层级（大的画在上面，优先于远近），不给时按离镜头的远近
//             floor（可选）：抬起的卡片竖直投到桌面上的形状 { sx, sy }（桌面投影、远近效果按它下面的桌面算）
//     group?: { x, y, z, rx, ry, rz, s }                         // 整组变换（角度单位：度）
//     camera: { type: 'ortho' } | { type: 'perspective', fov }
//     depthFx?: { fade, dof, focus: 0~1 | 'auto' }               // 远处渐隐 / 景深模糊（见 helpers.tableFxParams）
//     floorShadow?: 0~1                                           // 抬起的卡片在桌面上的投影强度
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
import tumble from './3d/tumble.js';
import pile from './3d/pile.js';
import isoGroups from './3d/isoGroups.js';
import { withDepthFx } from './helpers.js';

// 其他 3D 版式也可以加远处渐隐 / 景深（等距展台、分组展台、满铺堆叠自己带了这几项，另外还有桌面投影）；
// 景深感强的版式（空中飘落、纵深层叠）默认开一点
const D = withDepthFx;
export const layouts = [grid, hero, staggered, tilted, scatter, fan, D(isoWall), D(corridor), D(cylinder), D(cascade, { dof: 0.35 }), D(carousel),
  D(floating), isoStage, isoGroups, D(tumble, { dof: 0.4 }), pile];

// legacy：已并入另一个版式（值是那个版式的 id）的旧版式——版式列表里不再列出，用过它的画板、保存的版式照常使用
const byId = new Map(layouts.map(l => [l.id, l]));
export const getLayout = id => byId.get(id);
