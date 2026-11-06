/**
 * 字体：文字图层可以使用电脑上安装的任何字体。
 *   - 通用字体：sans / serif / mono（跨平台的字体组合，换电脑也能显示）
 *   - 常用字体：内置一份 macOS / Windows 常见的中英文字体名单，打开时检测哪些已安装（不需要授权）
 *   - 全部系统字体：Chrome / Edge 支持读取本机字体列表（queryLocalFonts，需要用户点击并授权一次），
 *     读到的列表记在 localStorage，下次直接用
 * 图层里保存的是字体名（family）；导出在本机进行，所以用到的字体只要本机安装了就会正确导出。
 */
export const GENERIC = {
  sans: { label: '系统默认黑体', stack: '-apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif' },
  serif: { label: '系统默认宋体', stack: '"Songti SC", "Noto Serif SC", SimSun, Georgia, serif' },
  mono: { label: '等宽', stack: '"SF Mono", Menlo, Consolas, monospace' },
};

// 常见字体的中文名
const ZH_NAMES = {
  'PingFang SC': '苹方-简', 'PingFang TC': '苹方-繁', 'Hiragino Sans GB': '冬青黑体', 'STHeiti': '华文黑体',
  'Heiti SC': '黑体-简', 'Songti SC': '宋体-简', 'Songti TC': '宋体-繁', 'STSong': '华文宋体', 'Kaiti SC': '楷体-简',
  'STKaiti': '华文楷体', 'STFangsong': '华文仿宋', 'Yuanti SC': '圆体-简', 'Lantinghei SC': '兰亭黑-简',
  'Weibei SC': '魏碑-简', 'Xingkai SC': '行楷-简', 'Baoli SC': '报隶-简', 'Libian SC': '隶变-简',
  'HanziPen SC': '翩翩体-简', 'Hannotate SC': '手札体-简', 'Wawati SC': '娃娃体-简', 'Yuppy SC': '雅痞-简',
  'LingWai SC': '凌慧体-简', 'Microsoft YaHei': '微软雅黑', 'Microsoft JhengHei': '微软正黑', 'SimSun': '宋体',
  'NSimSun': '新宋体', 'SimHei': '黑体', 'KaiTi': '楷体', 'FangSong': '仿宋', 'DengXian': '等线', 'YouYuan': '幼圆',
  'LiSu': '隶书', 'STXihei': '华文细黑', 'STZhongsong': '华文中宋', 'STXingkai': '华文行楷', 'STLiti': '华文隶书',
  'Source Han Sans SC': '思源黑体', 'Source Han Serif SC': '思源宋体', 'Noto Sans SC': '思源黑体（Noto）',
  'Noto Serif SC': '思源宋体（Noto）', 'Noto Sans CJK SC': '思源黑体（Noto CJK）', 'Alibaba PuHuiTi': '阿里巴巴普惠体',
  'HarmonyOS Sans SC': '鸿蒙黑体', 'MiSans': '小米 MiSans', 'OPPOSans': 'OPPO Sans', 'LXGW WenKai': '霞鹜文楷',
  'ZCOOL KuaiLe': '站酷快乐体', 'ZCOOL XiaoWei': '站酷小薇体',
};

// 内置检测名单：常见中文字体在前
const COMMON = [
  ...Object.keys(ZH_NAMES),
  'Helvetica Neue', 'Helvetica', 'Arial', 'Arial Black', 'Avenir', 'Avenir Next', 'Futura', 'Gill Sans', 'Optima',
  'Inter', 'Roboto', 'Segoe UI', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Impact', 'DIN Alternate', 'DIN Condensed',
  'SF Pro Display', 'SF Pro Text', 'Montserrat', 'Poppins', 'Open Sans', 'Lato',
  'Georgia', 'Times New Roman', 'Baskerville', 'Didot', 'Bodoni 72', 'Palatino', 'Hoefler Text', 'Garamond', 'Cambria',
  'Menlo', 'Monaco', 'Courier New', 'Consolas', 'SF Mono', 'JetBrains Mono',
  'Bradley Hand', 'Brush Script MT', 'Chalkboard SE', 'Comic Sans MS', 'Marker Felt', 'Noteworthy', 'Snell Roundhand',
];

const LOCAL_KEY = 'slidegrid:local-fonts:v1';
const quote = f => `"${String(f).replace(/["\\]/g, '')}"`;

// 字体名 → CSS font-family（装不上时退回系统黑体）
export const fontStack = f => GENERIC[f]?.stack || `${quote(f)}, ${GENERIC.sans.stack}`;
export const fontLabel = f => GENERIC[f]?.label || (ZH_NAMES[f] ? `${ZH_NAMES[f]} ${f}` : String(f));
export const isChinese = f => !!ZH_NAMES[f] || /SC|TC|CJK|GB|Hei|Song|Kai|Ming|Yuan|宋|黑|楷|圆|明/.test(f);

/* ---------------- 检测 ---------------- */

let ctx = null;
const SAMPLE = 'mmmmmmmmmmlli1WQ@#中文字体测试';
function widthOf(font) {
  ctx ||= document.createElement('canvas').getContext('2d');
  ctx.font = font;
  return ctx.measureText(SAMPLE).width;
}
// 和三种基础字体分别比较宽度：只要有一种不同，就说明这个字体真的被用上了（已安装）
const installedCache = new Map();
export function isInstalled(f) {
  if (GENERIC[f]) return true;
  if (installedCache.has(f)) return installedCache.get(f);
  const ok = ['monospace', 'serif', 'sans-serif'].some(base => widthOf(`72px ${quote(f)}, ${base}`) !== widthOf(`72px ${base}`));
  installedCache.set(f, ok);
  return ok;
}

let local = (() => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || []; } catch { return []; } })();
export const canReadSystemFonts = () => typeof window.queryLocalFonts === 'function' && window.isSecureContext;
export const hasSystemList = () => local.length > 0;

/**
 * 读取本机全部字体（需要在点击事件里调用；浏览器会请求一次授权）。返回字体名列表。
 */
export async function readSystemFonts() {
  const fonts = await window.queryLocalFonts();
  local = [...new Set(fonts.map(f => f.family))].sort((a, b) => a.localeCompare(b));
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); } catch { /* 忽略 */ }
  list = null;
  return local;
}

/**
 * 可选的字体，分组：[{ title, fonts: [name] }]
 * extra：项目里已经在用、但不在列表里的字体（换了电脑时也能看到、选中）
 */
let list = null;
export function fontGroups(extra = []) {
  if (!list) {
    const installed = [...new Set([...COMMON.filter(isInstalled), ...local])];
    const zh = installed.filter(isChinese), other = installed.filter(f => !isChinese(f)).sort((a, b) => a.localeCompare(b));
    list = [
      { title: '通用', fonts: Object.keys(GENERIC) },
      { title: '中文字体', fonts: zh },
      { title: local.length ? '其他字体' : '常用字体', fonts: other },
    ];
  }
  const known = new Set(list.flatMap(g => g.fonts));
  const missing = extra.filter(f => f && !known.has(f));
  return missing.length ? [{ title: '项目中使用', fonts: missing }, ...list] : list;
}
