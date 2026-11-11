import { el } from './dom.js';
import { icon } from './icons.js';

/**
 * 应用自己的对话框（代替浏览器自带的 prompt / confirm：样式统一，在嵌入的浏览器里也能用）。
 *   askText({ title, label, value, placeholder, okText })           → Promise<string | null>（去掉首尾空格；取消为 null）
 *   askConfirm({ title, message, okText, danger })                  → Promise<boolean>
 *   askOptions({ title, message, options, okText, danger })         → Promise<string[] | null>（勾选的 id；取消为 null）
 *     options：[{ id, label, note, checked, disabled }]
 * Enter 确定，Esc / 点外面 / 「取消」取消。同一时间只开一个；后面的会排队。
 */
let chain = Promise.resolve();

function open({ title, body, okText = '确定', danger = false, cancelText = '取消', focus = null, result = () => true, canSubmit = () => true }) {
  const run = () => new Promise(resolve => {
    const ok = el('button', { type: 'submit', class: `btn primary${danger ? ' danger' : ''}` }, okText);
    const cancel = el('button', { type: 'button', class: 'btn' }, cancelText);
    const form = el('form', { class: 'ask-form', method: 'dialog' },
      el('div', { class: 'modal-head' },
        el('h2', {}, title),
        el('button', { type: 'button', class: 'icon-btn visible', title: '关闭', 'aria-label': '关闭', onclick: () => finish(null) }, icon('x', 16))),
      el('div', { class: 'ask-body' }, body),
      el('div', { class: 'ask-foot' }, cancel, ok));
    const dialog = el('dialog', { class: 'modal ask-modal' }, form);
    let settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    }
    const sync = () => { ok.disabled = !canSubmit(); };
    form.addEventListener('submit', e => { e.preventDefault(); if (canSubmit()) finish(result()); });
    form.addEventListener('input', sync);
    cancel.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', e => { e.preventDefault(); finish(null); }); // Esc
    dialog.addEventListener('pointerdown', e => { if (e.target === dialog) finish(null); }); // 点外面
    dialog.addEventListener('keydown', e => e.stopPropagation()); // 输入时不触发应用的快捷键
    document.body.append(dialog);
    dialog.showModal();
    sync();
    (focus || ok).focus();
    focus?.select?.();
  });
  const p = chain.then(run);
  chain = p.catch(() => {});
  return p;
}

export function askText({ title, label = '', value = '', placeholder = '', okText = '确定', maxLength = 60, allowEmpty = false } = {}) {
  const input = el('input', { type: 'text', class: 'text-input ask-input', value, placeholder, maxlength: maxLength, spellcheck: 'false', autocomplete: 'off', 'aria-label': label || title });
  return open({
    title, okText, focus: input,
    body: label ? el('label', { class: 'ask-field' }, el('span', { class: 'ask-label' }, label), input) : input,
    result: () => input.value.trim(),
    canSubmit: () => allowEmpty || input.value.trim().length > 0,
  });
}

export function askConfirm({ title, message = '', okText = '确定', danger = false } = {}) {
  return open({
    title, okText, danger,
    body: message ? el('p', { class: 'ask-message' }, message) : null,
  }).then(v => v === true);
}

export function askOptions({ title, message = '', options = [], okText = '确定', danger = false } = {}) {
  const rows = options.map(o => {
    const box = el('input', { type: 'checkbox', class: 'ask-check', checked: o.checked && !o.disabled ? true : null, disabled: o.disabled ? true : null });
    return {
      id: o.id, box,
      node: el('label', { class: `ask-option${o.disabled ? ' disabled' : ''}` }, box,
        el('span', { class: 'ask-option-text' }, el('span', { class: 'ask-option-label' }, o.label), o.note ? el('span', { class: 'ask-option-note' }, o.note) : null)),
    };
  });
  return open({
    title, okText, danger,
    body: [message ? el('p', { class: 'ask-message' }, message) : null, el('div', { class: 'ask-options' }, rows.map(r => r.node))],
    result: () => rows.filter(r => r.box.checked).map(r => r.id),
    canSubmit: () => rows.some(r => r.box.checked),
  });
}
