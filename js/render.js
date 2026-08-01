import { isSong } from './parser.js';
import { escapeHtml, formatNumber } from './utils.js';

function matchesQuery(task, query) {
  if (!query) return true;
  return `${task.artist} ${task.title} ${task.raw}`.toLowerCase().includes(query);
}

function matchesStatus(task, filter) {
  if (filter === 'all') return true;
  return filter === 'todo' ? !task.done : task.done;
}

function taskRow(task, showArtist) {
  let html = `<div class="task${task.done ? ' done' : ''}" data-id="${task.id}" tabindex="0" role="button" aria-label="クリックでコピー">`;
  html += '<button class="check" type="button" aria-label="完了状態を切り替え" tabindex="-1"></button>';
  html += `<div class="body"><div class="line1"><span class="title">${escapeHtml(task.title)}</span>`;
  if (task.extra) html += `<span class="extra">${escapeHtml(task.extra)}</span>`;
  if (task.count > 1) html += `<span class="dup">×${task.count}</span>`;
  html += '</div>';
  if (showArtist) html += `<div class="line2">${escapeHtml(task.artist)}</div>`;
  html += '</div><span class="copyhint">クリックでコピー</span></div>';
  return html;
}

function exceptionRow(task) {
  let html = `<div class="task ex${task.done ? ' done' : ''}" data-id="${task.id}" tabindex="0" role="button" aria-label="クリックで行全体をコピー">`;
  html += '<button class="check" type="button" aria-label="完了状態を切り替え" tabindex="-1"></button>';
  html += `<div class="body"><div class="line1"><span class="title">${escapeHtml(task.raw)}</span>`;
  if (task.count > 1) html += `<span class="dup">×${task.count}</span>`;
  html += '</div><div class="exnote">区切り「 - 」が見つかりません。クリックで行全体をコピーします。</div>';
  html += '</div><span class="copyhint">クリックでコピー</span></div>';
  return html;
}

export function createRenderer(state, elements) {
  function buildVisibleItems() {
    const query = state.query.toLowerCase();
    if (state.view === 'song') {
      return state.tasks.filter((task) => isSong(task) && matchesQuery(task, query) && matchesStatus(task, state.statusFilter));
    }
    if (state.view === 'ex') {
      return state.tasks.filter((task) => !isSong(task) && matchesQuery(task, query) && matchesStatus(task, state.statusFilter));
    }

    state.groupIndexByName = new Map();
    const groups = [];
    state.artistGroups.forEach((group) => {
      const ids = group.ids.filter((id) => {
        const task = state.tasks[id];
        return matchesQuery(task, query) && matchesStatus(task, state.statusFilter);
      });
      if (ids.length) {
        state.groupIndexByName.set(group.name, groups.length);
        groups.push({ name: group.name, ids, all: group.ids });
      }
    });
    return groups;
  }

  function groupMarkup(group, groupIndex) {
    const done = group.all.reduce((total, id) => total + Number(state.tasks[id].done), 0);
    const percent = group.all.length ? Math.round((done / group.all.length) * 100) : 0;
    const expanded = Boolean(state.query || state.statusFilter !== 'all');
    const allDone = done === group.all.length;

    let html = `<div class="group${expanded ? ' open' : ''}" data-gi="${groupIndex}">`;
    html += `<button class="ghead" type="button" aria-expanded="${expanded}"><span class="chev">▶</span>`;
    html += `<span class="gname">${escapeHtml(group.name)}</span>`;
    html += `<span class="gcount">${group.all.length}曲 · 完了 ${done}</span>`;
    html += `<span class="gbar"><i style="inline-size:${percent}%"></i></span></button>`;
    html += `<button class="gbulk${allDone ? ' all-done' : ''}" type="button" aria-label="${escapeHtml(group.name)}の曲を${allDone ? 'すべて未完了に戻す' : 'まとめて完了にする'}">${allDone ? '完了を戻す' : 'まとめて完了'}</button>`;
    html += `<div class="gbody${state.layout !== 'list' ? ` ${state.layout}` : ''}"${expanded ? '' : ' hidden'} data-loaded="${expanded ? '1' : '0'}">`;
    if (expanded) group.ids.forEach((id) => { html += taskRow(state.tasks[id], false); });
    html += '</div></div>';
    return html;
  }

  function renderMore() {
    const amount = state.view === 'artist' ? 150 : (state.layout === 'compact' ? 500 : 300);
    const end = Math.min(state.chunkItems.length, state.chunkPosition + amount);
    let html = '';
    for (let index = state.chunkPosition; index < end; index += 1) {
      const item = state.chunkItems[index];
      if (state.view === 'artist') html += groupMarkup(item, index);
      else if (state.view === 'ex') html += exceptionRow(item);
      else html += taskRow(item, true);
    }
    elements.list.insertAdjacentHTML('beforeend', html);
    state.chunkPosition = end;
    elements.sentinel.hidden = state.chunkPosition >= state.chunkItems.length;
  }

  function render() {
    elements.list.textContent = '';
    elements.list.classList.toggle('tile', state.view !== 'artist' && state.layout === 'tile');
    elements.list.classList.toggle('compact', state.view !== 'artist' && state.layout === 'compact');
    state.chunkItems = buildVisibleItems();
    state.chunkPosition = 0;

    if (state.view === 'ex' && state.chunkItems.length) {
      elements.list.insertAdjacentHTML('beforeend', '<div class="notebox">⚠ 区切り「 - 」が見つからなかった行です。行全体をそのままコピーできます。</div>');
    }
    if (!state.chunkItems.length) {
      const message = state.view === 'ex'
        ? '例外はありません'
        : (state.query || state.statusFilter !== 'all') ? '条件に一致するタスクがありません' : 'タスクがありません';
      elements.list.insertAdjacentHTML('beforeend', `<div class="emptymsg">${message}</div>`);
      elements.sentinel.hidden = true;
      return;
    }
    renderMore();
  }

  function updateProgress() {
    const total = state.tasks.length;
    const percent = total ? Math.round((state.doneCount / total) * 100) : 0;
    elements.progressFill.style.inlineSize = `${percent}%`;
    elements.progressCount.textContent = `${formatNumber(state.doneCount)} / ${formatNumber(total)}（残り ${formatNumber(total - state.doneCount)}）`;
  }

  function updateRandom() {
    if (!state.randPick) {
      elements.randomButton.classList.add('alldone');
      elements.randomTitle.textContent = 'すべての曲をコピーしました！';
      elements.randomArtist.textContent = 'おつかれさまでした';
      return;
    }
    elements.randomButton.classList.remove('alldone');
    elements.randomTitle.textContent = state.randPick.title;
    elements.randomArtist.textContent = state.randPick.artist;
  }

  function updateTabs() {
    const songs = state.tasks.filter(isSong).length;
    const exceptions = state.tasks.length - songs;
    elements.artistCount.textContent = formatNumber(state.artistGroups.length);
    elements.songCount.textContent = formatNumber(songs);
    elements.exceptionCount.textContent = formatNumber(exceptions);
    elements.exceptionCount.classList.toggle('warn', exceptions > 0);
  }

  function updateGroupHead(groupElement) {
    const group = state.chunkItems[Number(groupElement.dataset.gi)];
    if (!group?.all) return;
    const done = group.all.reduce((total, id) => total + Number(state.tasks[id].done), 0);
    groupElement.querySelector('.gcount').textContent = `${group.all.length}曲 · 完了 ${done}`;
    groupElement.querySelector('.gbar i').style.inlineSize = `${group.all.length ? Math.round((done / group.all.length) * 100) : 0}%`;

    const bulkButton = groupElement.querySelector('.gbulk');
    const allDone = done === group.all.length;
    bulkButton.textContent = allDone ? '完了を戻す' : 'まとめて完了';
    bulkButton.classList.toggle('all-done', allDone);
    bulkButton.setAttribute('aria-label', `${group.name}の曲を${allDone ? 'すべて未完了に戻す' : 'まとめて完了にする'}`);
  }

  function fillGroup(groupElement) {
    const group = state.chunkItems[Number(groupElement.dataset.gi)];
    const body = groupElement.querySelector('.gbody');
    if (body.dataset.loaded !== '1') {
      body.innerHTML = group.ids.map((id) => taskRow(state.tasks[id], false)).join('');
      body.dataset.loaded = '1';
    }
  }

  return { fillGroup, render, renderMore, updateGroupHead, updateProgress, updateRandom, updateTabs };
}
