// 没有导入图片时显示的示例幻灯片，方便先挑版式。

const PALETTES = [
  ['#ff7a59', '#ffc078'], ['#4f6bff', '#9b7bff'], ['#12b886', '#63e6be'],
  ['#e64980', '#ffa8c5'], ['#f59f00', '#ffd43b'], ['#7048e8', '#da77f2'],
  ['#1098ad', '#66d9e8'], ['#e03131', '#ff8787'], ['#37b24d', '#c0eb75'],
  ['#364fc7', '#91a7ff'], ['#d9480f', '#ffa94d'], ['#343a40', '#868e96'],
];

const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif';

function bar(g, x, y, w, h) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, h / 2);
  else g.rect(x, y, w, h);
  g.fill();
}

export function createPlaceholders(count = 9) {
  const W = 1600, H = 900;
  return Array.from({ length: count }, (_, k) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const [c1, c2] = PALETTES[k % PALETTES.length];
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    g.fillStyle = 'rgba(255,255,255,.16)';
    g.beginPath();
    g.arc(W * 0.8, H * 0.32, 250, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.1)';
    g.beginPath();
    g.arc(W * 0.92, H * 0.85, 180, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = 'rgba(255,255,255,.96)';
    g.font = `800 300px ${FONT}`;
    g.fillText(String(k + 1).padStart(2, '0'), 110, 470);
    g.font = `600 70px ${FONT}`;
    g.fillText('Slide Title', 122, 610);
    g.fillStyle = 'rgba(255,255,255,.55)';
    bar(g, 124, 670, 640, 24);
    bar(g, 124, 716, 460, 24);

    return {
      id: `ph${k}`,
      name: `示例 ${k + 1}`,
      path: '',
      source: c,
      preview: c,
      thumb: c,
      aspect: W / H,
      width: W,
      height: H,
      placeholder: true,
    };
  });
}
