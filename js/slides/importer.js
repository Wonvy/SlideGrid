// 从拖放 / 文件选择框中收集图片，支持递归读取文件夹，按路径自然排序。

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i;

export const isImageFile = f =>
  !f.name.startsWith('.') && ((f.type && f.type.startsWith('image/')) || IMAGE_EXT.test(f.name));

// 数字按数值比较："幻灯片2" 排在 "幻灯片10" 之前
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const sortByPath = list => list.sort((a, b) => collator.compare(a.path, b.path));

const readFile = entry => new Promise((resolve, reject) => entry.file(resolve, reject));
const readBatch = reader => new Promise((resolve, reject) => reader.readEntries(resolve, reject));

async function walk(entry, prefix, out) {
  if (entry.name.startsWith('.')) return;
  if (entry.isFile) {
    const file = await readFile(entry);
    out.push({ file, path: prefix + file.name });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    const dir = prefix + entry.name + '/';
    // readEntries 每次最多返回一批，需要循环读到空为止
    for (;;) {
      const batch = await readBatch(reader);
      if (!batch.length) break;
      for (const child of batch) await walk(child, dir, out);
    }
  }
}

/**
 * 必须在 drop 事件处理函数里同步调用（DataTransfer 在事件结束后失效）。
 * async 函数在第一个 await 之前的代码是同步执行的，所以这里先把 entries / 文件取出来。
 *
 * 文件直接用 getAsFile() 读取；只有文件夹才用文件系统接口（webkitGetAsEntry）递归读取。
 * 直接双击打开的单文件版（file:// 页面）里，Chrome 会拦截文件系统接口，这时文件照常导入，
 * 读不了的文件夹给出提示（改用「选择文件夹」按钮）。
 */
export async function collectFromDrop(dataTransfer) {
  const items = [];
  for (const item of dataTransfer.items || []) {
    if (item.kind !== 'file') continue;
    items.push({ entry: item.webkitGetAsEntry?.() || null, file: item.getAsFile() });
  }
  if (!items.length) {
    return sortByPath([...(dataTransfer.files || [])].filter(isImageFile).map(file => ({ file, path: file.name })));
  }
  const out = [];
  let folderFailed = false;
  for (const { entry, file } of items) {
    if (entry?.isDirectory) {
      try {
        await walk(entry, '', out);
      } catch (err) {
        console.warn('无法读取拖入的文件夹', err);
        folderFailed = true;
      }
    } else if (file) {
      out.push({ file, path: file.name });
    } else if (entry?.isFile) {
      try { await walk(entry, '', out); } catch (err) { console.warn(err); }
    }
  }
  const images = sortByPath(out.filter(x => isImageFile(x.file)));
  if (!images.length && folderFailed) {
    const err = new Error('浏览器不允许这个页面读取拖入的文件夹（直接打开的单文件版会这样），请用左栏的「选择文件夹」按钮');
    err.userMessage = err.message;
    throw err;
  }
  return images;
}

export function collectFromInput(fileList) {
  return sortByPath(
    [...fileList].filter(isImageFile).map(file => ({ file, path: file.webkitRelativePath || file.name })),
  );
}
