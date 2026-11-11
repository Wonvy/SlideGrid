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
    page.wait_for_function('window.SlideGrid && document.querySelector(".rp-top")', timeout=15000)


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


def t_board_menu(page, errors):
    # 右键画板名称：画板菜单（重命名、复制、删除在最前面）；点画板名称选中画板后按 Delete 删除
    n = page.evaluate('SlideGrid.store.get().artboards.length')
    page.evaluate('SlideGrid.layers.clear(); SlideGrid.duplicateSelected(); SlideGrid.fitAll(); SlideGrid.render()')
    page.wait_for_function(f'SlideGrid.store.get().artboards.length === {n + 1}')
    label = page.evaluate("""() => { const S = SlideGrid, id = S.store.get().activeBoard, r = S.boardLocalRect(id);
      const v = document.getElementById('viewport').getBoundingClientRect(), strip = document.querySelector('.toolstrip').getBoundingClientRect();
      return { x: v.left + r.l + 16, y: v.top + r.t - 12, id, clear: v.left + r.l > strip.right }; }""")
    assert label['clear'], '适合窗口后画板名称不应该被左边的工具条盖住'
    page.mouse.click(label['x'], label['y'], button='right')
    items = page.eval_on_selector_all('.ctx-menu .menu-item', 'xs => xs.map(x => x.textContent.trim())')
    assert items[0].startswith('重命名') and items[1].startswith('复制画板') and items[2].startswith('删除画板'), items
    page.keyboard.press('Escape')
    page.mouse.click(label['x'], label['y'])
    assert page.evaluate('SlideGrid.ui.boardPicked')
    # 重命名、删除都用应用自己的对话框（不是浏览器自带的 prompt / confirm）
    page.mouse.click(label['x'], label['y'], button='right')
    page.click('.ctx-menu .menu-item:has-text("重命名")')
    page.fill('.ask-modal[open] .ask-input', '要删的画板')
    page.keyboard.press('Enter')
    page.wait_for_function("SlideGrid.store.get().artboards.some(b => b.name === '要删的画板') && !document.querySelector('.ask-modal')")
    page.mouse.click(label['x'], label['y'])
    page.keyboard.press('Delete')
    page.wait_for_selector('.ask-modal[open]')
    page.keyboard.press('Escape')  # 取消：不删
    assert page.evaluate('SlideGrid.store.get().artboards.length') == n + 1
    page.keyboard.press('Delete')
    page.click('.ask-modal[open] .btn.primary')
    page.wait_for_function(f'SlideGrid.store.get().artboards.length === {n}')
    ids = page.evaluate('SlideGrid.store.get().artboards.map(b => b.id)')
    assert len(ids) == n and label['id'] not in ids, ids
    assert not page.evaluate('SlideGrid.ui.boardPicked')
    # 点卡片之后 Delete 不删画板
    page.evaluate('SlideGrid.fitBoard(); SlideGrid.render()')
    rect = page.evaluate('SlideGrid.itemRects()[0].rect')
    v = page.evaluate("document.getElementById('viewport').getBoundingClientRect().toJSON()")
    page.mouse.click(v['x'] + (rect['l'] + rect['r']) / 2, v['y'] + (rect['t'] + rect['b']) / 2)
    page.keyboard.press('Delete')
    assert page.evaluate('SlideGrid.store.get().artboards.length') == n
    page.keyboard.press('Escape')
    assert not errors, errors


def t_mockup(page, errors):
    page.click('.rp-top [data-tab="mockup"]')
    page.click('.mockup-device[aria-label="笔记本"]')
    page.locator('.mockup-card:not([hidden])').nth(1).click()   # 笔记本 · 左侧
    layer = page.evaluate('SlideGrid.store.get().layers.at(-1)')
    assert layer['type'] == 'device' and layer['device'] == 'laptop' and layer['yaw'] != 0, layer
    # 在画板上直接调角度：拖选框下方的圆形手柄（右拖 = 设备正面向右转，下拖 = 俯视），设备大小不变；双击手柄回到正面
    dev = 'SlideGrid.store.get().layers.at(-1)'
    page.evaluate('SlideGrid.fitBoard(); SlideGrid.render()')
    page.wait_for_timeout(900)  # 连续的修改会合并成一步撤销：等一下，让「加入样机」单独成一步
    h = page.evaluate('SlideGrid.layers.orbitHandle()')
    assert h, '选中样机后应该有角度手柄'
    page.mouse.move(h['x'], h['y'])
    page.mouse.down()
    page.mouse.move(h['x'] + 40, h['y'] + 20, steps=4)
    page.mouse.up()
    turned = page.evaluate(dev)
    assert turned['yaw'] == layer['yaw'] - 20 and turned['pitch'] == layer['pitch'] + 10, turned
    assert turned['w'] != layer['w'], '图层的框应该跟着新的外形变化'
    h = page.evaluate('SlideGrid.layers.orbitHandle()')
    page.mouse.dblclick(h['x'], h['y'])
    front = page.evaluate(dev)
    assert front['yaw'] == 0 and front['pitch'] == 0, front
    # 转一圈回到原来的角度，框也回到原样（大小、位置不累积误差）
    back = page.evaluate('''(() => { const { store, actions } = SlideGrid; const id = store.get().layers.at(-1).id;
      for (const [k, v] of [['yaw', 170], ['pitch', -40], ['yaw', %s], ['pitch', %s]]) {
        actions.updateLayers([id], l => SlideGrid.applyLayerProp(l, k, v));
      }
      return store.get().layers.at(-1); })()''' % (layer['yaw'], layer['pitch']))
    for k in ('x', 'y', 'w', 'h'):
        assert abs(back[k] - layer[k]) < 0.01, (k, back[k], layer[k])
    # 撤销到加入样机之前，再重做一步：回到刚加入时的状态（后面的测试接着用）
    count = 'SlideGrid.store.get().layers.length'
    n = page.evaluate(count)
    for _ in range(12):
        if page.evaluate(count) < n:
            break
        page.evaluate('SlideGrid.history.undo()')
    page.evaluate('SlideGrid.history.redo()')
    again = page.evaluate(dev)
    assert again['id'] == layer['id'] and again['yaw'] == layer['yaw'] and again['w'] == layer['w'], again


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
    page.click('.lp-top [data-tab="layers"]')  # 图层在左栏的「图层」页
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

    # 卡片拖出「幻灯片」一组、放到图层上面：导出的图里它盖在那个图层上（图层铺满整个画板、不透明）
    page.evaluate("""() => { const S = SlideGrid; S.actions.updateLayers(['l_pc'], { x: 0, y: 0, w: 1920, h: 1080 }); }""")
    adj = lambda: page.evaluate("(() => { const s = SlideGrid.store.get(); return s.adjust[s.layoutId] || {}; })()")
    probe = """async order => {
      const S = SlideGrid, s = S.store.get();
      const it = S.cards.visible().find(x => x.order === order) || S.cards.all().find(x => x.order === order);
      const { blob, width, height } = await S.renderToBlob({ longSide: 480, preview: true });
      const bmp = await createImageBitmap(blob), c = new OffscreenCanvas(width, height), g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      const r = S.itemRects().find(x => x.order === order)?.rect, b = S.boardLocalRect(s.activeBoard);
      if (!r) return null;
      const x = ((r.l + r.r) / 2 - b.l) / (b.r - b.l) * width, y = ((r.t + r.b) / 2 - b.t) / (b.b - b.t) * height;
      return [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data];
    }"""
    card = cards.nth(2)
    cid = int(card.get_attribute('data-id'))
    page.evaluate('SlideGrid.fitBoard(); SlideGrid.render()')
    white = page.evaluate(probe, cid)
    assert white and white[:3] == [255, 255, 255], white  # 图层在上面：卡片被盖住
    drag(card, row('l_pc'), 'above')
    assert adj()[str(cid)].get('above') == 'l_pc', adj()
    assert page.locator(f'.layer-list .layer-card.pulled[data-id="{cid}"]').count() == 1
    page.evaluate('SlideGrid.render()')
    shown = page.evaluate(probe, cid)
    assert shown and shown[:3] != [255, 255, 255], shown  # 拖出去以后盖在图层上面
    # 眼睛按钮：隐藏 / 显示这张卡片
    n_items = lambda: page.evaluate('SlideGrid.cards.all().length')
    total = n_items()
    pulled = page.locator(f'.layer-list .layer-card[data-id="{cid}"]')
    pulled.hover()
    pulled.locator('.layer-btn[title="隐藏这张卡片"]').click()
    assert n_items() == total - 1 and adj()[str(cid)].get('hidden') is True
    pulled = page.locator(f'.layer-list .layer-card.is-hidden[data-id="{cid}"]')
    pulled.hover()
    pulled.locator('.layer-btn[title="显示这张卡片"]').click()
    assert n_items() == total and 'hidden' not in adj()[str(cid)]
    # 右键「放回幻灯片一组」
    page.locator(f'.layer-list .layer-card.pulled[data-id="{cid}"]').click(button='right')
    page.click('.ctx-menu .menu-item:has-text("放回")')
    assert 'above' not in adj().get(str(cid), {}) and page.locator('.layer-list .layer-card.pulled').count() == 0
    # 3D 版式里也能拖动调整卡片的前后
    page.evaluate("SlideGrid.actions.setLayout('isoStage')")
    before = names()
    drag(cards.nth(3), cards.first, 'above')  # 铺满型版式卡片很多：只在画板里看得见的卡片之间排
    after = names()
    assert after[0] == before[3] and after[1:4] == before[:3] and after[4:] == before[4:], (before[:6], after[:6])
    page.evaluate("""() => { const S = SlideGrid; S.actions.setLayout('scatter'); S.actions.setLayers(S.store.get().layers.filter(l => !l.id.startsWith('l_p'))); S.layers.clear(); }""")
    assert not errors, errors


def t_switches(page, errors):
    # 「设计」页：投影 / 渐隐遮罩 / 空间效果的一键开关（关掉后数值保留），左栏分隔条能调高度
    r = page.evaluate("""async () => {
      const S = SlideGrid, st = () => S.store.get(), wait = ms => new Promise(r => setTimeout(r, ms));
      S.layers.clear();
      S.actions.setLayout('isoStage');
      document.querySelector('.rp-top [data-tab="params"]').click();
      await wait(100);
      const sec = name => [...document.querySelectorAll('.design-body .panel-section')].find(x => x.querySelector('h3').textContent === name);
      const out = { blur: st().style.shadowBlur };
      sec('投影').querySelector('.switch').click();
      out.shadowOff = st().style.shadowHidden === true && sec('投影').classList.contains('off') && st().style.shadowBlur === out.blur;
      out.render = (await S.renderToBlob({ longSide: 300, preview: true })).width;
      sec('投影').querySelector('.switch').click();
      out.shadowOn = st().style.shadowHidden === false;
      sec('渐隐遮罩').querySelector('.switch').click();
      out.fadeOn = st().style.fadeType === 'linear' && !st().style.fadeHidden;
      sec('渐隐遮罩').querySelector('.switch').click();
      out.fadeOff = st().style.fadeType === 'linear' && st().style.fadeHidden === true;
      S.actions.patchStyle({ fadeType: 'none', fadeHidden: false });
      const fx = [...document.querySelectorAll('.design-body .ctrl-group.has-switch')].find(x => x.textContent.includes('空间效果'));
      fx.querySelector('.switch').click();
      out.fxOff = st().params.isoStage.fxOff === true && st().params.isoStage.farFade > 0;
      fx.querySelector('.switch').click();
      out.fxOn = st().params.isoStage.fxOff === false;
      S.actions.setLayout('grid');
      return out;
    }""")
    assert all(r[k] for k in ('shadowOff', 'shadowOn', 'fadeOn', 'fadeOff', 'fxOff', 'fxOn')) and r['render'] == 300, r
    # 左栏「幻灯片」页的分隔条：把图集区域拉高 80px，双击恢复
    page.click('.lp-top [data-tab="slides"]')
    bar = page.locator('#album-bar')
    page.locator('#album-splitter').dblclick()
    h0 = bar.bounding_box()['height']
    sp = page.locator('#album-splitter').bounding_box()
    page.mouse.move(sp['x'] + sp['width'] / 2, sp['y'] + sp['height'] / 2)
    page.mouse.down()
    page.mouse.move(sp['x'] + sp['width'] / 2, sp['y'] + sp['height'] / 2 + 80, steps=4)
    page.mouse.up()
    h1 = bar.bounding_box()['height']
    assert 70 < h1 - h0 < 90, (h0, h1)
    page.locator('#album-splitter').dblclick()
    assert not errors, errors


def t_card_aspect(page, errors):
    # 卡片比例：默认跟随图片（示例图是 16:9）；固定成竖版、自定义比例后，网格里的卡片就是那个比例
    r = page.evaluate("""async () => {
      const S = SlideGrid, frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      S.actions.setLayout('grid');
      const ratio = async () => { await frame(); const it = S.itemRects()[0].rect; return (it.r - it.l) / (it.b - it.t); };
      const out = { auto: await ratio(), image: S.store.get().slides[0].aspect };
      S.actions.setStyle('cardAspect', '3:4');
      out.portrait = await ratio();
      S.actions.patchStyle({ cardAspect: 'custom', cardAspectW: 2, cardAspectH: 1 });
      document.querySelector('.rp-top [data-tab="params"]').click();
      await frame();
      out.inputs = [...document.querySelectorAll('.design-body .ctrl')].filter(x => x.offsetParent !== null && ['宽', '高'].includes(x.querySelector('.ctrl-label')?.textContent)).length;
      out.custom = await ratio();
      out.exported = (await S.renderToBlob({ longSide: 300, preview: true })).width;
      S.actions.setStyle('cardAspect', 'auto');
      out.back = await ratio();
      return out;
    }""")
    assert abs(r['auto'] - r['image']) < 0.02 and abs(r['back'] - r['image']) < 0.02, r
    assert abs(r['portrait'] - 0.75) < 0.02 and abs(r['custom'] - 2) < 0.03 and r['inputs'] == 2 and r['exported'] == 300, r
    assert not errors, errors


def t_thickness(page, errors):
    # 卡片厚度：3D 版式里导出的图和没有厚度时不一样（多了侧边）；侧边可以用指定颜色；平面正视时看不到侧边、图不变
    r = page.evaluate("""async () => {
      const S = SlideGrid;
      const shot = async () => {
        const { blob, width, height } = await S.renderToBlob({ longSide: 320, preview: true });
        const bmp = await createImageBitmap(blob), c = new OffscreenCanvas(width, height), g = c.getContext('2d');
        g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, width, height).data;
      };
      const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++; return n; };
      const count = (a, [r, g, b]) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - r) + Math.abs(a[i + 1] - g) + Math.abs(a[i + 2] - b) < 90) n++; return n; };
      const out = {};
      S.actions.setLayout('isoStage');
      const flat0 = await shot();
      S.actions.setStyle('thickness', 40);
      const edge = await shot();
      out.sides = diff(flat0, edge);
      S.actions.patchStyle({ sideMode: 'color', sideColor: '#ff00ff' });
      const colored = await shot();
      out.magentaBefore = count(edge, [200, 0, 200]);
      out.magenta = count(colored, [200, 0, 200]);
      S.actions.setLayout('grid');
      const gridThick = await shot();
      S.actions.patchStyle({ thickness: 0, sideMode: 'edge' });
      out.gridSame = diff(gridThick, await shot());
      document.querySelector('.rp-top [data-tab="params"]').click();
      return out;
    }""")
    assert r['sides'] > 200 and r['magenta'] > r['magentaBefore'] + 100 and r['gridSame'] == 0, r
    assert not errors, errors


def t_project_ui(page, errors):
    # 版本号；项目菜单 → 新建项目（名称 + 竖屏画板）；全部项目里搜索、点卡片切回原来的项目
    version = page.inner_text('#app-version')
    assert version.startswith('v') and version.count('.') == 2, version
    page.wait_for_function('document.getElementById("save-status")?.textContent.includes("已保存")', timeout=15000)
    orig = page.evaluate('SlideGrid.store.get().project.id')
    page.click('#project-btn')
    page.click('.project-menu .menu-item:has-text("新建项目")')
    page.fill('.project-name-input', '竖版项目')
    page.click('.size-card:has-text("竖屏 9:16")')
    page.click('.pm-actions .btn.primary')
    page.wait_for_function("SlideGrid.store.get().project?.name === '竖版项目' && SlideGrid.store.get().aspect === '1080x1920'", timeout=10000)
    assert not page.evaluate('SlideGrid.history.canUndo()'), '新项目的撤销记录应该是空的'
    page.wait_for_function('document.getElementById("save-status")?.textContent.includes("已保存")', timeout=15000)
    page.click('#project-btn')
    page.wait_for_selector('.project-menu .pm-recent-item')  # 「最近的项目」里有原来那个
    page.click('.project-menu .menu-item:has-text("全部项目")')
    page.wait_for_selector('.projects-modal[open] .project-card.current')
    cards = page.locator('.projects-modal .project-card:not(.project-add)')
    assert cards.count() == 2, cards.count()
    page.fill('.project-search', '竖版')
    assert cards.count() == 1
    page.fill('.project-search', '')
    page.click('.projects-modal .project-card:not(.project-add):not(.current)')
    page.wait_for_function(f"SlideGrid.store.get().project?.id === '{orig}' && !document.querySelector('.projects-modal[open]')", timeout=15000)
    # 占用空间：卡片上和左下角都有数字；「清理空间」列出没有内容的项目；删除项目后列表和数据库里都没有了
    page.click('#project-btn')
    page.click('.project-menu .menu-item:has-text("全部项目")')
    page.wait_for_function("/\\d (KB|MB|GB)/.test(document.querySelector('.storage-text')?.textContent || '')", timeout=10000)
    assert ' KB' in page.inner_text('.projects-modal .project-card.current .project-sub') or ' MB' in page.inner_text('.projects-modal .project-card.current .project-sub')
    page.click('.storage-clean')
    page.wait_for_selector('.ask-modal[open] .ask-option')
    assert '竖版项目' in page.inner_text('.ask-modal[open] .ask-options')
    page.keyboard.press('Escape')
    test_card = page.locator('.projects-modal .project-card:not(.project-add):not(.current)')
    test_card.hover()
    test_card.locator('.icon-btn[title="删除项目"]').click()
    page.click('.ask-modal[open] .btn.primary.danger')
    page.wait_for_function("document.querySelectorAll('.projects-modal .project-card:not(.project-add)').length === 1", timeout=10000)
    left = page.evaluate("SlideGrid.controller.list().then(l => l.map(p => p.name))")
    assert '竖版项目' not in left and len(left) == 1, left
    page.click('.projects-modal .modal-head .icon-btn')
    # 删除「当前」项目：换到剩下的那个，删掉的不会被自动保存写回来
    page.evaluate("SlideGrid.controller.createNew('临时项目').then(() => SlideGrid.actions.setStyle('radius', 33))")
    page.wait_for_function("SlideGrid.store.get().project?.name === '临时项目' && SlideGrid.store.get().style.radius === 33")
    page.click('#project-btn')
    page.click('.project-menu .menu-item:has-text("全部项目")')
    cur = page.locator('.projects-modal .project-card.current')
    cur.hover()
    cur.locator('.icon-btn[title="删除项目"]').click()
    page.click('.ask-modal[open] .btn.primary.danger')
    page.wait_for_function(f"SlideGrid.store.get().project?.id === '{orig}'", timeout=15000)
    page.wait_for_timeout(2200)  # 等过自动保存（0.5 秒）和缩略图（1.5 秒）的时间
    left = page.evaluate("SlideGrid.controller.list().then(l => l.map(p => p.name))")
    assert '临时项目' not in left and len(left) == 1, left
    page.click('.projects-modal .modal-head .icon-btn')
    # 立方体视图：平面版式下也显示
    assert page.evaluate("(SlideGrid.actions.setLayout('grid'), !document.querySelector('.view-cube').hidden)")
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
         ('图集：新建 / 切换', t_album), ('交换两张卡片的图片', t_swap), ('⌘D 复制画板', t_board_dup), ('画板右键菜单 / Delete 删除画板', t_board_menu), ('添加带角度的样机', t_mockup), ('撤销 / 重做', t_undo), ('导出 1600 × 900', t_export),
         ('画板像素 × 倍率导出', t_pixels), ('新版式 / 图层顺序', t_layers), ('图层列表：拖动 / 右键菜单', t_layer_panel), ('一键开关 / 左栏分隔条', t_switches),
         ('卡片比例', t_card_aspect), ('卡片厚度', t_thickness), ('版本号 / 项目菜单 / 新建项目', t_project_ui),
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
