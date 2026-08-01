export const byId = (id) => document.getElementById(id);

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

export function fnvHash(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

export function debounce(callback, delay) {
  let timer;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => callback.apply(this, args), delay);
  };
}

export function truncate(text, length) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

export function formatNumber(value) {
  return value.toLocaleString('ja-JP');
}

export function decodeBuffer(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch (error) { /* fallback */ }
  try { return new TextDecoder('shift_jis').decode(buffer); } catch (error) { /* fallback */ }
  return new TextDecoder('utf-8').decode(buffer);
}
