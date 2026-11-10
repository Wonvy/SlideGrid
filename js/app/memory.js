import { store, libraryOf } from '../state.js';
import { toast } from '../ui/toast.js';

/**
 * 大项目的内存保护：粗略估算图片占用的内存（解码后的预览图，GPU 里的贴图大约再占一份），
 * 超过阈值时提示一次，并把撤销步数调低（撤销记录会一直引用已删除的图片，无法释放）。
 */
const WARN_BYTES = 1.5e9;     // 约 1.5 GB 时提示
const NORMAL_UNDO = 100, HEAVY_UNDO = 25;

const bitmapBytes = img => (img?.width ? img.width * img.height * 4 : 0);

export function estimateMemory(s) {
  const slides = libraryOf(s).filter(x => !x.placeholder);
  let bytes = 0;
  for (const x of slides) bytes += bitmapBytes(x.preview) * 2 + bitmapBytes(x.thumb);
  for (const a of Object.values(s.assets || {})) bytes += bitmapBytes(a.preview) * 2;
  return { count: slides.length, bytes };
}

export function createMemoryGuard({ history }) {
  let warned = false, heavy = false, prev = store.get();
  const check = s => {
    const { count, bytes } = estimateMemory(s);
    const nowHeavy = bytes > WARN_BYTES;
    if (nowHeavy !== heavy) {
      heavy = nowHeavy;
      history.setLimit(heavy ? HEAVY_UNDO : NORMAL_UNDO);
    }
    if (heavy && !warned) {
      warned = true;
      toast(`图片较多（${count} 张，约占 ${(bytes / 1e9).toFixed(1)} GB 内存），浏览器可能变慢；撤销步数已减少到 ${HEAVY_UNDO} 步，建议拆成多个项目`, { error: true, duration: 7000 });
    }
    if (!heavy) warned = false; // 降下来以后，再次超过时重新提示
  };
  store.subscribe(s => {
    if (s.albums !== prev.albums || s.slides !== prev.slides || s.assets !== prev.assets || s.project !== prev.project) check(s);
    prev = s;
  });
  check(prev);
  return { estimate: () => estimateMemory(store.get()), isHeavy: () => heavy };
}
