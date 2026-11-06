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
 * async 函数在第一个 await 之前的代码是同步执行的，所以这里先把 entries 取出来。
 */
export async function collectFromDrop(dataTransfer) {
  const entries = [];
  for (const item of dataTransfer.items || []) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  const files = [...(dataTransfer.files || [])];

  if (!entries.length) {
    return sortByPath(files.filter(isImageFile).map(file => ({ file, path: file.name })));
  }
  const out = [];
  for (const entry of entries) await walk(entry, '', out);
  return sortByPath(out.filter(x => isImageFile(x.file)));
}

export function collectFromInput(fileList) {
  return sortByPath(
    [...fileList].filter(isImageFile).map(file => ({ file, path: file.webkitRelativePath || file.name })),
  );
}
