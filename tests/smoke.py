#!/usr/bin/env python3
"""
SlideGrid 冒烟测试：用无头 Chromium 打开开发版（本地服务）和单文件版（file:// 直接打开），
把最常用的流程走一遍。任何一步失败，退出码为 1。

    pip install -r tests/requirements.txt
    python -m playwright install chromium
    python tests/smoke.py            # 两个版本都测
    python tests/smoke.py --dev      # 只测开发版
    python tests/smoke.py --single   # 只测单文件版（根目录的 SlideGrid.html）
"""
import argparse
import socket
import struct
import subprocess
import sys
import time
import traceback
import zlib
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


def png(w: int, h: int, rgb: tuple) -> bytes:
    """生成一张纯色 PNG（只用标准库）。"""
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


SLIDES = [{'name': f's{i + 1}.png', 'mimeType': 'image/png', 'buffer': png(320, 180, c)}
          for i, c in enumerate([(230, 100, 70), (70, 110, 230), (70, 170, 110)])]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def start_server():
    port = free_port()
    proc = subprocess.Popen([sys.executable, str(ROOT / 'serve.py'), str(port)], cwd=ROOT,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            socket.create_connection(('127.0.0.1', port), timeout=0.2).close()
            return proc, f'http://127.0.0.1:{port}/'
        except OSError:
            time.sleep(0.1)
    proc.kill()
    raise SystemExit('本地服务没有启动')


# ---------------- 测试步骤（按顺序执行，共用同一个页面） ----------------

def wait_app(page):
    page.wait_for_function('window.SlideGrid && document.querySelector(".rp-rail")', timeout=15000)


def t_load(page, errors):
    wait_app(page)
    assert not errors, f'页面报错：{errors}'
    assert page.evaluate('SlideGrid.store.get().artboards.length') == 1


def t_import(page, errors):
    page.set_input_files('#file-input', SLIDES)
    page.wait_for_function('SlideGrid.store.get().slides.length === 3', timeout=15000)
    names = page.evaluate('SlideGrid.store.get().slides.map(x => x.name)')
    assert names == ['s1.png', 's2.png', 's3.png'], names


def t_drop(page, errors):
    # 模拟把两张图片拖到左栏（DataTransfer 里只有文件，没有文件系统入口——和单文件版直接打开时一样）
    page.evaluate('''async () => {
      const mk = async n => { const c = new OffscreenCanvas(320, 180); c.getContext('2d').fillRect(0, 0, 320, 180);
        return new File([await c.convertToBlob({ type: 'image/png' })], `d${n}.png`, { type: 'image/png' }); };
      const dt = new DataTransfer(); dt.items.add(await mk(1)); dt.items.add(await mk(2));
      const t = document.querySelector('#slides-panel');
      for (const type of ['dragenter', 'dragover', 'drop']) t.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    }''')
    page.wait_for_function('SlideGrid.store.get().slides.length === 5', timeout=15000)
    # 恢复成 3 张，方便后面的检查
    page.evaluate('''() => { for (const x of SlideGrid.store.get().slides.slice(3)) SlideGrid.actions.removeSlide(x.id); }''')
    assert page.evaluate('SlideGrid.store.get().slides.length') == 3


def t_inherit(page, errors):
    r = page.evaluate('''async () => {
      const S = () => SlideGrid.store.get();
      const names = l => l.map(x => x.name.replace(/\\D/g, '')).join('');
      const first = S().activeBoard;
      SlideGrid.addBoard(); await new Promise(r => setTimeout(r, 100));
      const second = S().activeBoard;
      const out = { newFollows: !S().slidesOwn };
      SlideGrid.actions.swapSlides(0, 1);                       // 画布上交换：画板 2 单独设置
      out.ownAfterSwap = S().slidesOwn; out.second = names(S().slides); out.library = names(S().albums[0].slides);
      SlideGrid.actions.setActiveBoard(first);
      SlideGrid.actions.moveSlide(0, 2);                        // 左栏排序：共用列表变，画板 2 不变
      out.firstAfterMove = names(S().slides);
      out.secondAfterMove = names(S().artboards.find(b => b.id === second).settings.slides);
      SlideGrid.actions.setActiveBoard(second);
      SlideGrid.actions.followLibrary();                        // 恢复跟随
      out.followed = names(S().slides) === names(S().albums[0].slides);
      SlideGrid.actions.setActiveBoard(first);
      return out;
    }''')
    assert r['newFollows'], r
    assert r['ownAfterSwap'] and r['second'] == '213' and r['library'] == '123', r
    assert r['firstAfterMove'] == '231' and r['secondAfterMove'] == '213', r
    assert r['followed'], r


def t_album(page, errors):
    # 图集：新建一个图集并让当前画板换过去，再换回来；另一个图集不受影响
    r = page.evaluate('''() => {
      const S = () => SlideGrid.store.get();
      const first = S().albumId, list = S().albums[0].slides;
      const id = SlideGrid.actions.addAlbum('第二组', list.slice(0, 2));
      const out = { switched: S().albumId === id && S().slides.length === 2, firstSame: S().albums[0].slides === list };
      SlideGrid.actions.setBoardAlbum(first);
      out.back = S().slides === list;
      out.count = S().albums.length;
      return out;
    }''')
    assert r['switched'] and r['firstSame'] and r['back'] and r['count'] == 2, r


def t_swap(page, errors):
    # 交换两张卡片的图片：只有这两张变，幻灯片列表不变
    r = page.evaluate('''() => {
      const before = SlideGrid.itemRects().map(x => x.order);
      const s = SlideGrid.store.get();
      const list = s.slides;
      SlideGrid.actions.swapCards(0, list[0].id, 1, list[1].id);
      const adj = SlideGrid.store.get().adjust[SlideGrid.store.get().layoutId] || {};
      const out = { pinned: Object.values(adj).filter(a => a.slide != null).length, listSame: SlideGrid.store.get().slides === list, cards: before.length };
      SlideGrid.history.undo();
      return out;
    }''')
    assert r['pinned'] == 2 and r['listSame'], r


def t_board_dup(page, errors):
    # ⌘D 复制所选画板（没有选中图层时）
    n = page.evaluate('SlideGrid.store.get().artboards.length')
    page.evaluate('SlideGrid.layers.clear()')
    page.keyboard.press('Meta+d' if sys.platform == 'darwin' else 'Control+d')
    page.wait_for_function(f'SlideGrid.store.get().artboards.length === {n + 1}', timeout=5000)
    page.evaluate('SlideGrid.history.undo()')
    assert page.evaluate('SlideGrid.store.get().artboards.length') == n


def t_mockup(page, errors):
    page.click('.rp-rail [aria-label="样机"]')
    page.click('.mockup-device[aria-label="笔记本"]')
    page.locator('.mockup-card:not([hidden])').nth(1).click()   # 笔记本 · 左侧
    layer = page.evaluate('SlideGrid.store.get().layers.at(-1)')
    assert layer['type'] == 'device' and layer['device'] == 'laptop' and layer['yaw'] != 0, layer


def t_undo(page, errors):
    n = page.evaluate('SlideGrid.store.get().layers.length')
    page.evaluate('SlideGrid.history.undo()')
    assert page.evaluate('SlideGrid.store.get().layers.length') == n - 1
    page.evaluate('SlideGrid.history.redo()')
    assert page.evaluate('SlideGrid.store.get().layers.length') == n


def t_export(page, errors):
    r = page.evaluate('''async () => { const { blob, width, height } = await SlideGrid.renderToBlob({ longSide: 1600 });
      return { width, height, size: blob.size }; }''')
    assert r['width'] == 1600 and r['height'] == 900 and r['size'] > 20000, r


def t_pixels(page, errors):
    # 画板像素尺寸 × 倍率：1242 × 1660 的画板 1× / 2× 导出正好是这么多像素
    r = page.evaluate('''async () => {
      const before = SlideGrid.store.get().aspect;
      SlideGrid.actions.setAspect('1242x1660');
      const a = await SlideGrid.renderToBlob({ scale: 1 }), b = await SlideGrid.renderToBlob({ scale: 2 });
      SlideGrid.actions.setAspect(before);
      return [a.width, a.height, b.width, b.height];
    }''')
    assert r == [1242, 1660, 2484, 3320], r


def t_layers(page, errors):
    # 新版式能渲染；图层可以放到幻灯片下面；平面版式里卡片可以调前后
    r = page.evaluate('''async () => {
      const S = SlideGrid, before = S.store.get().layoutId;
      const sizes = [];
      for (const id of ['floating', 'isoStage', 'isoGroups', 'tumble', 'pile']) {
        S.actions.setLayout(id);
        const b = await S.renderToBlob({ longSide: 400, preview: true });
        sizes.push(b.width);
      }
      S.actions.setLayout('scatter');
      const top = () => S.cards.visible()[0]?.order;
      const first = top();
      const bottom = S.cards.visible().at(-1).order;
      S.cards.stack([bottom], 1, true);
      const raised = top() === bottom && top() !== first;
      const rect = { id: 'l_test_rect', type: 'rect', name: '底板', x: 100, y: 100, w: 400, h: 300, rotation: 0, opacity: 1,
        fillType: 'solid', fill: '#ffffff', fillAlpha: 1, strokeWidth: 0, radius: 0 };
      S.actions.setLayers([...S.store.get().layers, rect]);
      S.layers.select([rect.id]);
      S.layers.moveUnderSlides(true);
      const under = S.store.get().layers.find(l => l.id === rect.id)?.under === true;
      const exp = await S.renderToBlob({ longSide: 400, preview: true });
      S.actions.setLayers(S.store.get().layers.filter(l => l.id !== rect.id));
      S.actions.setLayout(before);
      return { sizes, raised, under, exp: exp.width };
    }''')
    assert r['sizes'] == [400, 400, 400, 400, 400] and r['raised'] and r['under'] and r['exp'] == 400, r
    assert not errors, errors


def t_layer_panel(page, errors):
    # 图层列表：拖动调整前后（图层、卡片）、右键菜单（置于顶层 / 底层）
    page.evaluate("""() => {
      const S = SlideGrid;
      S.actions.setLayout('scatter');
      const mk = (id, name, x) => ({ id, type: 'rect', name, x, y: 100, w: 300, h: 200, rotation: 0, opacity: 1,
        fillType: 'solid', fill: '#ffffff', fillAlpha: 1, strokeWidth: 0, radius: 0 });
      S.actions.setLayers([...S.store.get().layers, mk('l_pa', '甲', 100), mk('l_pb', '乙', 200), mk('l_pc', '丙', 300)]);
    }""")
    page.click('.rp-tab[aria-label^="图层"]')
    row = lambda i: page.locator(f'.layer-list .layer-row[data-kind="layer"][data-id="{i}"]')
    order = lambda: page.evaluate("SlideGrid.store.get().layers.filter(l => l.id.startsWith('l_p')).map(l => l.name + (l.under ? '↓' : '')).join('')")

    def drag(src, dst, where):  # where：放在 dst 这一行的上半 / 下半
        a, b = src.bounding_box(), dst.bounding_box()
        page.mouse.move(a['x'] + 60, a['y'] + a['height'] / 2)
        page.mouse.down()
        page.mouse.move(a['x'] + 60, a['y'] + a['height'] / 2 + 8, steps=2)
        page.mouse.move(b['x'] + 60, b['y'] + (3 if where == 'above' else b['height'] - 3), steps=4)
        page.mouse.up()

    assert order() == '甲乙丙', order()  # 列表里从上到下是 丙 乙 甲
    drag(row('l_pa'), row('l_pc'), 'above')
    assert order() == '乙丙甲', order()
    # 拖到「幻灯片」一组的下面：放到卡片后面
    cards = page.locator('.layer-list .layer-row[data-kind="card"]')
    drag(row('l_pa'), cards.last, 'below')
    assert order() == '甲↓乙丙', order()
    # 右键菜单：置于顶层（只在幻灯片上面这一侧）、置于底层
    row('l_pb').click(button='right')
    page.click('.ctx-menu .menu-item:has-text("置于顶层")')
    assert order() == '甲↓丙乙', order()
    # 卡片：把最下面一张拖到最上面；右键置于底层
    names = lambda: page.evaluate("[...document.querySelectorAll('.layer-list .layer-row[data-kind=card]')].map(r => r.dataset.id)")
    before = names()
    drag(cards.last, cards.first, 'above')
    after = names()
    assert after[0] == before[-1] and after[1:] == before[:-1], (before, after)
    cards.first.click(button='right')
    page.click('.ctx-menu .menu-item:has-text("置于底层")')
    assert names() == before, (before, names())
    page.evaluate("""() => { const S = SlideGrid; S.actions.setLayers(S.store.get().layers.filter(l => !l.id.startsWith('l_p'))); S.layers.clear(); }""")
    assert not errors, errors


def t_persist(page, errors):
    page.wait_for_function('document.getElementById("save-status")?.textContent.includes("已保存")', timeout=15000)
    page.reload()
    wait_app(page)
    page.wait_for_function('SlideGrid.store.get().slides.length === 3', timeout=15000)
    r = page.evaluate('''() => { const s = SlideGrid.store.get();
      return { boards: s.artboards.length, devices: s.artboards.flatMap(b => b.id === s.activeBoard ? s.layers : b.settings.layers).filter(l => l.type === 'device').length }; }''')
    assert r['boards'] == 2 and r['devices'] == 1, r


STEPS = [('打开页面', t_load), ('选择图片导入', t_import), ('拖入图片', t_drop), ('图片继承（共用 / 单独设置）', t_inherit),
         ('图集：新建 / 切换', t_album), ('交换两张卡片的图片', t_swap), ('⌘D 复制画板', t_board_dup), ('添加带角度的样机', t_mockup), ('撤销 / 重做', t_undo), ('导出 1600 × 900', t_export),
         ('画板像素 × 倍率导出', t_pixels), ('新版式 / 图层顺序', t_layers), ('图层列表：拖动 / 右键菜单', t_layer_panel),
         ('刷新后数据还在', t_persist)]


def run(browser, label, url) -> bool:
    print(f'\n== {label}：{url}')
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url)
    ok = True
    for name, step in STEPS:
        try:
            step(page, errors)
            print(f'  ✓ {name}')
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f'  ✗ {name}：{e}')
            traceback.print_exc(limit=1)
            break
    if errors:
        ok = False
        print(f'  ✗ 页面报错：{errors}')
    ctx.close()
    return ok


def main():
    ap = argparse.ArgumentParser(description='SlideGrid 冒烟测试')
    ap.add_argument('--dev', action='store_true', help='只测开发版')
    ap.add_argument('--single', action='store_true', help='只测单文件版')
    args = ap.parse_args()
    both = not args.dev and not args.single
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        if both or args.dev:
            proc, url = start_server()
            try:
                results.append(run(browser, '开发版', url))
            finally:
                proc.kill()
        if both or args.single:
            single = ROOT / 'SlideGrid.html'
            if not single.is_file():
                raise SystemExit('找不到 SlideGrid.html，请先运行 python3 build.py')
            results.append(run(browser, '单文件版（直接打开）', single.as_uri()))
        browser.close()
    print('\n全部通过' if all(results) else '\n有测试失败')
    sys.exit(0 if all(results) else 1)


if __name__ == '__main__':
    main()
