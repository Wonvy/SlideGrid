import { el } from './dom.js';

/**
 * 通用下拉菜单：点击 anchor 打开，点外面 / Esc 关闭。
 * render(container, close) 每次打开时重新生成内容。
 */
export function createMenu(anchor, { render, className = '', align = 'left', flip = false, onClose }) {
  const pop = el('div', { class: `menu ${className}`, role: 'menu' });
  document.body.append(pop);
  let open = false;

  function position() {
    const r = anchor.getBoundingClientRect();
    let top = r.bottom + 6;
    if (flip) {
      const roomBelow = window.innerHeight - top - 6;
      const roomAbove = r.top - 12;
      pop.style.maxHeight = '';
      const above = pop.offsetHeight > roomBelow && roomAbove > roomBelow;
      const room = above ? roomAbove : roomBelow;
      if (pop.offsetHeight > room) pop.style.maxHeight = `${Math.max(0, room)}px`;
      if (above) top = r.top - 6 - pop.offsetHeight;
    }
    pop.style.top = `${Math.round(top)}px`;
    if (align === 'right') { pop.style.left = ''; pop.style.right = `${Math.round(window.innerWidth - r.right)}px`; }
    else if (align === 'center') { pop.style.right = ''; pop.style.left = `${Math.round(r.left + r.width / 2 - pop.offsetWidth / 2)}px`; }
    else { pop.style.right = ''; pop.style.left = `${Math.round(r.left)}px`; }
  }

  function show() {
    // 按钮在弹窗（<dialog>）里时，菜单也放进弹窗：弹窗在浏览器的「顶层」，放在 body 里会被它盖住
    const host = anchor.closest('dialog') || document.body;
    if (pop.parentElement !== host) host.append(pop);
    render(pop, close);
    pop.classList.add('show');
    anchor.classList.add('open');
    anchor.setAttribute('aria-expanded', 'true');
    open = true;
    position();
  }
  function close() {
    if (!open) return;
    pop.classList.remove('show');
    anchor.classList.remove('open');
    anchor.setAttribute('aria-expanded', 'false');
    open = false;
    onClose?.();
  }

  anchor.addEventListener('click', () => (open ? close() : show()));
  document.addEventListener('pointerdown', e => {
    if (open && !pop.contains(e.target) && !anchor.contains(e.target)) close();
  }, true);
  window.addEventListener('keydown', e => {
    if (!open || e.key !== 'Escape') return;
    if (anchor.closest('dialog[open]')) {
      e.preventDefault();
      anchor.focus();
    }
    close();
  });
  window.addEventListener('resize', () => { if (open) position(); });

  return { show, close, isOpen: () => open, refresh: () => { if (open) { render(pop, close); position(); } } };
}
