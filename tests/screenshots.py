#!/usr/bin/env python3
"""
生成 README 用的截图（docs/images/）：用无头 Chromium 打开开发版，摆好场景后截图 / 导出。

    python tests/screenshots.py
"""
import base64
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke import start_server, wait_app  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs/images'


def export(page, path: Path, long_side=1600):
    """用应用自己的导出功能渲染当前画板，存成 PNG。"""
    data = page.evaluate('''async n => { const { blob } = await SlideGrid.renderToBlob({ longSide: n });
      const buf = new Uint8Array(await blob.arrayBuffer()); let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s); }''', long_side)
    path.write_bytes(base64.b64decode(data))
    print(f'已生成 {path.relative_to(ROOT)}')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    proc, url = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={'width': 1440, 'height': 900}, locale='zh-CN', device_scale_factor=2, color_scheme='dark')  # README 的截图用深色主题
            page.goto(url)
            wait_app(page)
            page.wait_for_timeout(600)

            # 1. 工作区：示例幻灯片 + 平面网格
            page.screenshot(path=str(OUT / 'workspace.png'))
            print(f'已生成 {(OUT / "workspace.png").relative_to(ROOT)}')

            # 2. 3D 版式的导出效果
            page.evaluate('''async () => { const L = (await import('/js/layouts/index.js')).layouts;
              SlideGrid.actions.setLayout(L.find(l => l.category === '3d').id); }''')
            page.wait_for_timeout(300)
            export(page, OUT / 'layout-3d.png')

            # 3. 样机场景：带角度的笔记本 + 手机 + 手表
            page.evaluate('''async () => {
              SlideGrid.actions.setLayout('grid');
              const M = await import('/js/layers/model.js'), D = await import('/js/layers/devices.js');
              const mk = (device, yaw, pitch, x, y, w, slide, extra = {}) => {
                const h = w * D.deviceAspect(device, { yaw, pitch });
                return M.createLayer('device', { device, yaw, pitch, x, y, w, h, slide, ...extra });
              };
              SlideGrid.actions.setLayers([
                mk('laptop', -30, 16, 70, 210, 900, 1),
                mk('phone', 26, 8, 1080, 150, 290, 2, { fit: 'contain' }),
                mk('watch', -22, 8, 1420, 330, 280, 3, { frame: 'silver' }),
              ]);
              SlideGrid.layers.clear();
            }''')
            page.wait_for_timeout(300)
            export(page, OUT / 'mockups.png')

            # 4. 样机页 + 画板上的样机
            page.click('.rp-top [data-tab="mockup"]')
            page.wait_for_timeout(400)
            page.screenshot(path=str(OUT / 'mockup-panel.png'))
            print(f'已生成 {(OUT / "mockup-panel.png").relative_to(ROOT)}')
            browser.close()
    finally:
        proc.kill()


if __name__ == '__main__':
    main()
