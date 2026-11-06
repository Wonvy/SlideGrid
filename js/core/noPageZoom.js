// 禁止浏览器自带的页面缩放（Ctrl/⌘ + 滚轮、触控板捏合、⌘ +/−/0、Safari 手势）。
// 工作区自己的缩放在 ui/viewportInteraction.js 里处理，不受影响。

window.addEventListener('wheel', e => {
  if (e.ctrlKey || e.metaKey) e.preventDefault();
}, { passive: false, capture: true });

window.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (['=', '+', '-', '_', '0'].includes(e.key) || ['Equal', 'Minus', 'Digit0', 'NumpadAdd', 'NumpadSubtract', 'Numpad0'].includes(e.code)) {
    e.preventDefault();
  }
}, { capture: true });

// Safari 的触控板捏合会触发 gesture 事件
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, e => e.preventDefault(), { passive: false });
}
