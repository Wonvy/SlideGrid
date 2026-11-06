// 复制 PNG 到剪贴板。需要安全上下文（HTTPS 或 localhost）。
// 传入 Promise<Blob>：必须在点击事件中同步调用（Safari 要求在用户手势内创建 ClipboardItem）。
export async function copyPngToClipboard(blobPromise) {
  if (!window.ClipboardItem || !navigator.clipboard?.write) {
    throw new Error('当前浏览器不支持复制图片（需要 HTTPS 或 localhost）');
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
  } catch (err) {
    // 部分浏览器不接受 Promise 形式，退回到先生成再写入
    const blob = await blobPromise;
    if (err?.name === 'NotAllowedError' && !document.hasFocus()) throw new Error('页面未获得焦点，请点击页面后重试');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }
}
