import { STORAGE_PREFIX } from './config.js';
import { parsePlaylistId } from './spotify.js';

export function createPlaylistPicker({ spotify, input, select, refreshButton, playbackButton, status }) {
  const key = `${STORAGE_PREFIX}spotify-playlist`;
  let playlists = [];
  let generation = 0;
  let loading = false;
  try { input.value = localStorage.getItem(key) || ''; } catch (error) { /* unavailable */ }

  function selectedId() {
    try { return parsePlaylistId(input.value); } catch (error) { return ''; }
  }
  function render() {
    const id = selectedId();
    select.replaceChildren(new Option('追加先を選択してください', ''));
    for (const playlist of playlists) {
      const option = new Option(`${playlist.name} — ${playlist.owner}${playlist.writable ? '' : '（閲覧用）'}`, playlist.id);
      option.disabled = !playlist.writable;
      select.add(option);
    }
    if (id && !playlists.some(item => item.id === id)) {
      select.add(new Option(`リンクで指定 — ${id}`, id));
    }
    select.value = id;
  }
  function save() {
    try { localStorage.setItem(key, input.value); } catch (error) { /* unavailable */ }
    render();
  }
  input.addEventListener('input', () => { save(); status.textContent = ''; });
  select.addEventListener('change', () => {
    input.value = select.value ? `https://open.spotify.com/playlist/${select.value}` : '';
    save();
    status.textContent = select.value ? `追加先：${playlists.find(item => item.id === select.value)?.name || select.value}` : '';
  });

  async function refresh() {
    if (loading) return;
    loading = true;
    const request = ++generation;
    refreshButton.disabled = true;
    select.setAttribute('aria-busy', 'true');
    status.textContent = 'プレイリストを取得中…';
    try {
      const result = await spotify.listPlaylists();
      if (request !== generation) return;
      playlists = result;
      render();
      status.textContent = playlists.length
        ? `${playlists.length}件を取得しました（追加可能 ${playlists.filter(item => item.writable).length}件）`
        : 'プレイリストがありません。Spotify で作成してから一覧を更新してください。';
    } catch (error) {
      if (request === generation) status.textContent = error.message;
    } finally {
      if (request === generation) {
        loading = false;
        refreshButton.disabled = false;
        select.setAttribute('aria-busy', 'false');
      }
    }
  }
  refreshButton.addEventListener('click', refresh);
  playbackButton.addEventListener('click', async () => {
    const request = generation;
    playbackButton.disabled = true;
    try {
      const id = await spotify.playbackPlaylist();
      if (request !== generation) return;
      input.value = `https://open.spotify.com/playlist/${id}`;
      save();
      status.textContent = 'Desktop の再生元を追加先に設定しました';
    } catch (error) { if (request === generation) status.textContent = error.message; }
    finally { playbackButton.disabled = false; }
  });
  function clear() {
    generation += 1;
    loading = false;
    playlists = [];
    input.value = '';
    save();
    refreshButton.disabled = false;
    select.setAttribute('aria-busy', 'false');
    status.textContent = 'Spotify に接続してプレイリストを取得してください';
  }
  render();
  return { refresh, clear };
}
