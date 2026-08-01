import { STORAGE_PREFIX } from './config.js';

const LAYOUT_KEY = `${STORAGE_PREFIX}layout`;

export function loadLayout() {
  try {
    const layout = localStorage.getItem(LAYOUT_KEY);
    if (['list', 'tile', 'compact'].includes(layout)) return layout;
  } catch (error) { /* storage may be unavailable */ }
  return 'list';
}

export function storeLayout(layout) {
  try { localStorage.setItem(LAYOUT_KEY, layout); } catch (error) { /* storage may be unavailable */ }
}

export function saveProgress(state) {
  if (!state.fileKey) return;
  const done = state.tasks.filter((task) => task.done).map((task) => task.id);
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${state.fileKey}`, JSON.stringify({
      v: 2,
      name: state.fileName,
      fmt: state.fmt,
      done
    }));
  } catch (error) { /* storage may be unavailable */ }
}

export function restoreProgress(state) {
  let raw;
  try { raw = localStorage.getItem(`${STORAGE_PREFIX}${state.fileKey}`); } catch (error) { return false; }
  if (!raw) return false;

  let data;
  try { data = JSON.parse(raw); } catch (error) { return false; }
  if (!data || ![1, 2].includes(data.v)) return false;

  state.doneCount = 0;
  if (Array.isArray(data.done)) {
    data.done.forEach((id) => {
      const task = state.tasks[id];
      if (task && !task.done) {
        task.done = true;
        state.doneCount += 1;
      }
    });
  }
  if (data.fmt) state.fmt = data.fmt;
  return state.doneCount > 0;
}
