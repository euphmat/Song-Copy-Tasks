import { DEFAULT_LIST_FILE } from './config.js';
import { buildArtistGroups, isSong, parseSongText } from './parser.js';
import { createRenderer } from './render.js';
import { loadLayout, restoreProgress, saveProgress, storeLayout } from './storage.js';
import { setupThemePicker } from './theme.js';
import { byId, debounce, decodeBuffer, fnvHash, formatNumber, truncate } from './utils.js';

const state = {
  tasks: [],
  fileName: '',
  fileKey: '',
  doneCount: 0,
  view: 'artist',
  statusFilter: 'all',
  query: '',
  fmt: 'space',
  layout: loadLayout(),
  artistGroups: [],
  groupIndexByName: new Map(),
  chunkItems: [],
  chunkPosition: 0,
  randPick: null
};

const elements = {
  empty: byId('empty'),
  listSection: byId('listSection'),
  workspaceHeader: byId('workspaceHeader'),
  list: byId('list'),
  sentinel: byId('sentinel'),
  fileInput: byId('fileInput'),
  fileName: byId('fname'),
  fileStatus: byId('fstat'),
  search: byId('search'),
  formatSelect: byId('fmtSel'),
  progressFill: byId('pfill'),
  progressCount: byId('pcount'),
  randomDisplay: byId('randDisplay'),
  completeNextButton: byId('completeNextBtn'),
  randomTitle: byId('randTitle'),
  randomArtist: byId('randArtist'),
  artistCount: byId('nArtist'),
  songCount: byId('nSong'),
  exceptionCount: byId('nEx')
};

const renderer = createRenderer(state, elements);
const persistProgress = debounce(() => saveProgress(state), 400);
let toastTimer;

setupThemePicker(byId('themeSelect'));
syncLayoutButtons();

function showToast(message, isError = false) {
  const toast = byId('toast');
  toast.textContent = message;
  toast.classList.toggle('err', isError);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function copyPayload(task) {
  if (!isSong(task)) return task.raw;
  if (state.fmt === 'dash') return `${task.artist} - ${task.title}`;
  if (state.fmt === 'reverse') return `${task.title} ${task.artist}`;
  return `${task.artist} ${task.title}`;
}

function legacyCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch (error) { /* unavailable */ }
  textarea.remove();
  return copied;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) { return legacyCopy(text); }
  }
  return legacyCopy(text);
}

async function copyTask(task, markDone) {
  const text = copyPayload(task);
  const copied = await copyText(text);
  if (!copied) {
    showToast('コピーに失敗しました。もう一度お試しください', true);
    return;
  }
  if (markDone && !task.done) {
    setDone(task, true, false);
  }
  showToast(`コピーしました — ${truncate(text, 42)}`);
}

async function copyDisplayedNextTrack(task, announce = true) {
  if (!task) return null;
  const text = copyPayload(task);
  const copied = await copyText(text);
  if (!copied) {
    if (announce) showToast('NEXT TRACK のコピーに失敗しました。もう一度お試しください', true);
    return false;
  }
  if (announce) showToast(`NEXT TRACK をコピーしました — ${truncate(text, 42)}`);
  return true;
}

function drawRandom(exclude = null) {
  const pool = state.tasks.filter((task) => isSong(task) && !task.done && task !== exclude);
  if (!pool.length) {
    state.randPick = exclude && !exclude.done ? exclude : null;
    return;
  }
  state.randPick = pool[Math.floor(Math.random() * pool.length)];
}

function syncSearchToRandomArtist() {
  const artist = state.randPick?.artist || '';
  elements.search.value = artist;
  state.query = artist.trim();
  renderer.render();
}

function displayRandom(previousPick, announceCopy = true) {
  renderer.updateRandom();
  if (state.randPick === previousPick) return Promise.resolve(null);
  syncSearchToRandomArtist();
  return copyDisplayedNextTrack(state.randPick, announceCopy);
}

function refreshRandom(announceCopy = true) {
  const previousPick = state.randPick;
  if (!state.randPick || state.randPick.done) drawRandom();
  return displayRandom(previousPick, announceCopy);
}

function completeDisplayedNextTrack() {
  if (!state.randPick) return;
  if (state.randPick.done) refreshRandom();
  else setDone(state.randPick, true);
}

function setDone(task, value, advanceNextTrack = true) {
  if (task.done === value) return;
  task.done = value;
  state.doneCount += value ? 1 : -1;

  const rows = elements.list.querySelectorAll(`.task[data-id="${task.id}"]`);
  rows.forEach((row) => {
    row.classList.toggle('done', value);
    if (state.view === 'artist') {
      const groupElement = row.closest('.group');
      if (groupElement) renderer.updateGroupHead(groupElement);
    }
  });

  if (state.view === 'artist' && !rows.length && isSong(task)) {
    const groupIndex = state.groupIndexByName.get(task.artist || '（アーティスト不明）');
    const groupElement = elements.list.querySelector(`.group[data-gi="${groupIndex}"]`);
    if (groupElement) renderer.updateGroupHead(groupElement);
  }

  renderer.updateProgress();
  if (advanceNextTrack) refreshRandom();
  persistProgress();
}

function setArtistDone(group, value) {
  let changed = 0;
  group.all.forEach((id) => {
    const task = state.tasks[id];
    if (task.done !== value) {
      task.done = value;
      state.doneCount += value ? 1 : -1;
      changed += 1;
    }
  });
  if (!changed) return;
  renderer.render();
  renderer.updateProgress();
  refreshRandom();
  persistProgress();
  showToast(value ? `${group.name} の ${changed}曲をまとめて完了しました` : `${group.name} の完了を戻しました`);
}

function syncLayoutButtons() {
  document.querySelectorAll('#layoutSeg button').forEach((button) => {
    button.classList.toggle('on', button.dataset.l === state.layout);
  });
}

function resetControls() {
  state.view = 'artist';
  state.statusFilter = 'all';
  state.query = '';
  elements.search.value = '';
  document.querySelectorAll('#statusSeg button').forEach((button) => button.classList.toggle('on', button.dataset.f === 'all'));
  document.querySelectorAll('#tabs .tab').forEach((button) => button.classList.toggle('on', button.dataset.view === 'artist'));
}

async function loadBuffer(buffer, name) {
  const text = decodeBuffer(buffer);
  if (text.includes(String.fromCharCode(0))) {
    showToast('テキストファイルではないようです（.txt を選択してください）', true);
    return;
  }

  const tasks = parseSongText(text);
  if (!tasks.length) {
    showToast('曲の行が見つかりませんでした', true);
    return;
  }

  state.tasks = tasks;
  state.fileName = name;
  state.fileKey = `${fnvHash(text)}-${text.length}`;
  state.doneCount = 0;
  state.fmt = 'space';
  const restored = restoreProgress(state);
  state.artistGroups = buildArtistGroups(state.tasks);
  resetControls();
  elements.formatSelect.value = state.fmt;

  elements.empty.hidden = true;
  elements.listSection.hidden = false;
  elements.workspaceHeader.hidden = false;
  elements.fileName.textContent = state.fileName;
  elements.fileName.title = state.fileName;
  elements.fileStatus.textContent = `${formatNumber(state.tasks.length)}曲`;

  state.randPick = null;
  renderer.updateTabs();
  renderer.render();
  renderer.updateProgress();
  const copiedNextTrack = await refreshRandom(false);
  const loadedMessage = restored
    ? `前回の進捗を復元しました（${formatNumber(state.doneCount)} / ${formatNumber(state.tasks.length)}）`
    : `${truncate(state.fileName, 28)} を読み込みました（${formatNumber(state.tasks.length)}曲）`;
  if (copiedNextTrack === null) {
    showToast(loadedMessage);
  } else {
    showToast(copiedNextTrack
      ? `${loadedMessage}・NEXT TRACK をコピーしました`
      : `${loadedMessage}。NEXT TRACK のコピーに失敗しました`, !copiedNextTrack);
  }
}

async function loadFile(file) {
  try { await loadBuffer(await file.arrayBuffer(), file.name); }
  catch (error) { showToast('ファイルを読み込めませんでした', true); }
}

elements.list.addEventListener('click', (event) => {
  const bulkButton = event.target.closest('.gbulk');
  if (bulkButton) {
    event.stopPropagation();
    const group = state.chunkItems[Number(bulkButton.closest('.group').dataset.gi)];
    const allDone = group.all.every((id) => state.tasks[id].done);
    setArtistDone(group, !allDone);
    return;
  }

  const checkButton = event.target.closest('.check');
  if (checkButton) {
    event.stopPropagation();
    const task = state.tasks[Number(checkButton.closest('.task').dataset.id)];
    setDone(task, !task.done);
    return;
  }

  const groupHead = event.target.closest('.ghead');
  if (groupHead) {
    const groupElement = groupHead.closest('.group');
    const body = groupElement.querySelector('.gbody');
    const willOpen = body.hidden;
    if (willOpen) renderer.fillGroup(groupElement);
    body.hidden = !willOpen;
    groupElement.classList.toggle('open', willOpen);
    groupHead.setAttribute('aria-expanded', String(willOpen));
    return;
  }

  const row = event.target.closest('.task');
  if (row) copyTask(state.tasks[Number(row.dataset.id)], !event.shiftKey);
});

elements.list.addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  const row = event.target.closest('.task');
  if (!row) return;
  event.preventDefault();
  copyTask(state.tasks[Number(row.dataset.id)], !event.shiftKey);
});

byId('tabs').addEventListener('click', (event) => {
  const button = event.target.closest('.tab');
  if (!button) return;
  state.view = button.dataset.view;
  document.querySelectorAll('#tabs .tab').forEach((item) => item.classList.toggle('on', item === button));
  renderer.render();
});

byId('statusSeg').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  state.statusFilter = button.dataset.f;
  document.querySelectorAll('#statusSeg button').forEach((item) => item.classList.toggle('on', item === button));
  renderer.render();
});

byId('layoutSeg').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  state.layout = button.dataset.l;
  storeLayout(state.layout);
  syncLayoutButtons();
  renderer.render();
});

elements.search.addEventListener('input', debounce((event) => {
  state.query = event.target.value.trim();
  renderer.render();
}, 200));

elements.formatSelect.addEventListener('change', (event) => {
  state.fmt = event.target.value;
  persistProgress();
});

elements.completeNextButton.addEventListener('click', () => {
  completeDisplayedNextTrack();
});

document.addEventListener('keydown', (event) => {
  if (!['r', 'n'].includes((event.key || '').toLowerCase())) return;
  if (['input', 'textarea', 'select'].includes((event.target.tagName || '').toLowerCase())) return;
  completeDisplayedNextTrack();
});

byId('resetBtn').addEventListener('click', () => {
  if (!state.tasks.length || !window.confirm('完了状態をすべてリセットしますか？（読み込んだリストはそのまま残ります）')) return;
  state.tasks.forEach((task) => { task.done = false; });
  state.doneCount = 0;
  state.randPick = null;
  renderer.render();
  renderer.updateProgress();
  refreshRandom();
  saveProgress(state);
  showToast('進捗をリセットしました');
});

function openFilePicker() { elements.fileInput.click(); }
byId('reloadBtn').addEventListener('click', openFilePicker);
byId('pickBtn').addEventListener('click', openFilePicker);
elements.fileInput.addEventListener('change', (event) => {
  if (event.target.files?.[0]) loadFile(event.target.files[0]);
  event.target.value = '';
});

let dragDepth = 0;
window.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth += 1;
  byId('dropOverlay').classList.add('on');
  byId('drop').classList.add('over');
});
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('dragleave', (event) => {
  event.preventDefault();
  dragDepth -= 1;
  if (dragDepth <= 0) {
    dragDepth = 0;
    byId('dropOverlay').classList.remove('on');
    byId('drop').classList.remove('over');
  }
});
window.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  byId('dropOverlay').classList.remove('on');
  byId('drop').classList.remove('over');
  const file = event.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) renderer.renderMore();
  }, { rootMargin: '600px' });
  observer.observe(elements.sentinel);
}

fetch(DEFAULT_LIST_FILE)
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  })
  .then((buffer) => loadBuffer(buffer, DEFAULT_LIST_FILE))
  .catch(() => showToast(`${DEFAULT_LIST_FILE} を読み込めませんでした`, true));
