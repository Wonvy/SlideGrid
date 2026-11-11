#!/usr/bin/env python3
"""
SlideGrid 版式截图对比：每个版式用默认参数、同一组测试图片渲染一张小图，和 tests/baseline/ 里的基准图比较。
画面变了（卡片被裁掉、比例不对、少了卡片……）就报出来，并在 tests/visual-out/ 里留下这次的截图和差异图。

    python tests/visual.py            # 对比
    python tests/visual.py --update   # 改动是有意的：用这次的结果更新基准图（记得提交 tests/baseline/）
    python tests/visual.py --only isoStage,pile

本机（显卡）和 CI（SwiftShader，CPU 上的 WebGL）的渲染有细微差别（抗锯齿、贴图过滤），所以两张图先缩小到
160 像素宽再比较，并允许很小的差异：卡片少了 / 多了、位置或比例变了、被裁掉都能看出来，抗锯齿的差别不会误报。
"""
import argparse
import base64
import struct
import sys
import zlib
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke import start_server, wait_app  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / 'tests' / 'baseline'
OUT = ROOT / 'tests' / 'visual-out'

# 允许的差异（缩小到 160 像素宽之后）：平均每个通道差多少（0~255），以及明显不同（某个通道差 > 48）的像素占比
MEAN_LIMIT = 3.0
CHANGED_LIMIT = 0.01
SMALL = 160


def pattern_png(w: int, h: int, color: tuple, mark: int) -> bytes:
    """测试图片：底色 + 上面一条白带（看得出方向）+ 左下角 mark 个深色方块（看得出是第几张），不依赖字体。"""
    rows = []
    for y in range(h):
        row = bytearray()
        for x in range(w):
            if y < h * 0.22:
                px = (245, 245, 245)
            elif y > h * 0.7 and x < w * 0.12 * mark and (x // int(w * 0.12)) * int(w * 0.12) + int(w * 0.09) > x:
                px = (30, 30, 40)
            else:
                px = color
            row += bytes(px)
        rows.append(b'\x00' + bytes(row))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b''))


COLORS = [(230, 100, 70), (70, 110, 230), (70, 170, 110), (240, 180, 40)]
SLIDES = [{'name': f'v{i + 1}.png', 'mimeType': 'image/png', 'buffer': pattern_png(320, 180, c, i + 1)}
          for i, c in enumerate(COLORS)]

RENDER = '''async id => {
  const S = SlideGrid;
  S.actions.setLayout(id);
  S.actions.resetParams();
  await new Promise(r => setTimeout(r, 30));
  const { blob } = await S.renderToBlob({ longSide: 480, format: 'png', preview: true });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}'''

# 在页面里解码两张 PNG、逐像素比较；返回差异指标和一张差异图（不同的地方标红）
COMPARE = '''async ([a, b, SMALL]) => {
  const load = async b64 => createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  if (ia.width !== ib.width || ia.height !== ib.height) return { size: [ia.width, ia.height, ib.width, ib.height] };
  // 缩小后比较（高质量缩放 = 区域平均），抗锯齿、贴图过滤的细微差别会被抹平
  const w = SMALL, h = Math.round(ia.height * SMALL / ia.width);
  const px = img => { const c = new OffscreenCanvas(w, h); const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, w, h); return g.getImageData(0, 0, w, h); };
  const da = px(ia), db = px(ib), n = da.width * da.height;
  const diff = new ImageData(da.width, da.height);
  let sum = 0, changed = 0;
  for (let i = 0; i < n * 4; i += 4) {
    let m = 0;
    for (let k = 0; k < 3; k++) { const d = Math.abs(da.data[i + k] - db.data[i + k]); sum += d; if (d > m) m = d; }
    if (m > 48) changed++;
    const g = (da.data[i] + da.data[i + 1] + da.data[i + 2]) / 12;
    diff.data.set(m > 48 ? [255, 40, 40, 255] : [g, g, g, 255], i);
  }
  const c = new OffscreenCanvas(da.width, da.height); c.getContext('2d').putImageData(diff, 0, 0);
  const png = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let s = ''; for (let i = 0; i < png.length; i += 0x8000) s += String.fromCharCode(...png.subarray(i, i + 0x8000));
  return { mean: sum / (n * 3), changed: changed / n, diff: btoa(s) };
}'''


def main():
    ap = argparse.ArgumentParser(description='SlideGrid 版式截图对比')
    ap.add_argument('--update', action='store_true', help='用这次的结果更新基准图')
    ap.add_argument('--only', default='', help='只测这些版式（逗号分隔）')
    args = ap.parse_args()
    only = {x for x in args.only.split(',') if x}
    BASE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    failed, missing = [], []
    proc, url = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1).new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(url)
            wait_app(page)
            page.set_input_files('#file-input', SLIDES)
            page.wait_for_function(f'SlideGrid.store.get().slides.length === {len(SLIDES)}', timeout=15000)
            ids = page.evaluate("import('./js/layouts/index.js').then(m => m.layouts.map(l => l.id))")
            print(f'\n== 版式截图对比（{len(ids)} 个版式）')
            for lid in ids:
                if only and lid not in only:
                    continue
                shot = page.evaluate(RENDER, lid)
                (OUT / f'{lid}.png').write_bytes(base64.b64decode(shot))
                base = BASE / f'{lid}.png'
                if args.update:
                    base.write_bytes(base64.b64decode(shot))
                    print(f'  ↻ {lid}：已更新基准图')
                    continue
                if not base.is_file():
                    missing.append(lid)
                    print(f'  ? {lid}：没有基准图（python tests/visual.py --update 生成）')
                    continue
                r = page.evaluate(COMPARE, [base64.b64encode(base.read_bytes()).decode(), shot, SMALL])
                if 'size' in r:
                    failed.append(lid)
                    print(f'  ✗ {lid}：尺寸不同 {r["size"]}')
                    continue
                ok = r['mean'] <= MEAN_LIMIT and r['changed'] <= CHANGED_LIMIT
                (OUT / f'{lid}.diff.png').write_bytes(base64.b64decode(r['diff']))
                print(f'  {"✓" if ok else "✗"} {lid}：平均差 {r["mean"]:.2f}，明显不同 {r["changed"] * 100:.2f}%')
                if not ok:
                    failed.append(lid)
            if errors:
                failed.append('页面报错')
                print(f'  ✗ 页面报错：{errors}')
            browser.close()
    finally:
        proc.kill()
    if failed:
        print(f'\n画面有变化：{", ".join(failed)}\n  对比 tests/visual-out/ 里的截图和 .diff.png（红色是不同的地方）；'
              f'如果是有意的改动，运行 python tests/visual.py --update 更新基准图')
        sys.exit(1)
    if missing:
        print('\n有版式没有基准图')
        sys.exit(1)
    print('\n全部一致' if not args.update else '\n基准图已更新')


if __name__ == '__main__':
    main()
