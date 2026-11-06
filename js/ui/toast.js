let node, timer;

export function toast(message, { sticky = false, error = false, duration = 2400 } = {}) {
  node ||= document.getElementById('toast');
  node.textContent = message;
  node.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(timer);
  if (!sticky) timer = setTimeout(() => node.classList.remove('show'), duration);
}
