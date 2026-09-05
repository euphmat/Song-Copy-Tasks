import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpotifyController, parsePlaylistId } from '../js/spotify.js';

const id = '3cEYpjA9oz9GiPac4AsH4n';
const scope = 'user-modify-playback-state user-read-playback-state playlist-modify-public playlist-modify-private playlist-read-private playlist-read-collaborative';
function controller(routes, granted = scope) {
  globalThis.localStorage = {
    getItem: () => JSON.stringify({ accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 60000, scope: granted }),
    setItem() {}, removeItem() {}
  };
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname.replace('/v1', '');
    calls.push({ path, query: new URL(url).search, ...options });
    return routes(path, options);
  };
  const button = { classList: { toggle() {} }, setAttribute() {}, addEventListener() {} };
  return { api: createSpotifyController({ button, label: {}, notify() {} }), calls };
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
function route(path, options, playbackFails = false) {
  if (path === '/search') return json({ tracks: { items: [{ name: 'Song', uri: 'spotify:track:test', artists: [{ name: 'Artist' }] }] } });
  if (path === '/me/player/devices') return json({ devices: [{ id: 'desktop', type: 'Computer', is_active: true }] });
  if (path === `/playlists/${id}/items`) return json({ snapshot_id: 'snapshot' }, 201);
  if (path === '/me/player/play') return playbackFails ? json({ error: { message: 'Premium required' } }, 403) : new Response(null, { status: 204 });
  throw new Error(`Unexpected request ${path}`);
}
test('accepts Spotify playlist links and URIs, rejects unrelated destinations', () => {
  assert.equal(parsePlaylistId(`https://open.spotify.com/playlist/${id}?si=abc`), id);
  assert.equal(parsePlaylistId(`spotify:playlist:${id}`), id);
  for (const value of ['', `https://example.com/playlist/${id}`, `https://open.spotify.com/track/${id}`]) assert.throws(() => parsePlaylistId(value));
});
test('adds exact resolved track to specified playlist before Desktop playback', async () => {
  const { api, calls } = controller(route);
  const result = await api.addAndPlay({ title: 'Song', artist: 'Artist' }, id);
  assert.equal(result.played, true);
  const writes = calls.filter(call => call.body);
  assert.deepEqual(writes.map(call => [call.path, call.method]), [[`/playlists/${id}/items`, 'POST'], ['/me/player/play', 'PUT']]);
  assert.deepEqual(JSON.parse(writes[0].body), { uris: ['spotify:track:test'] });
});
test('playback failure preserves successful addition without reposting', async () => {
  const { api, calls } = controller((path, options) => route(path, options, true));
  const result = await api.addAndPlay({ title: 'Song' }, id);
  assert.equal(result.played, false);
  assert.equal(result.track.name, 'Song');
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});
test('missing new scopes fails before issuing requests', async () => {
  const { api, calls } = controller(route, 'user-modify-playback-state');
  await assert.rejects(api.addAndPlay({ title: 'Song' }, id), /追加権限/);
  assert.equal(calls.length, 0);
});
test('failed addition never starts playback', async () => {
  const { api, calls } = controller((path, options) => path.includes('/items') ? json({ error: { message: 'Forbidden' } }, 403) : route(path, options));
  await assert.rejects(api.addAndPlay({ title: 'Song' }, id), /Forbidden/);
  assert.equal(calls.some(call => call.path === '/me/player/play'), false);
});
test('imports only Desktop playlist playback, rejects mobile and empty state', async () => {
  for (const data of [null, { device: { type: 'Smartphone' }, context: { type: 'playlist', uri: `spotify:playlist:${id}` } }]) {
    const { api } = controller(() => data ? json(data) : new Response(null, { status: 204 }));
    await assert.rejects(api.playbackPlaylist(), /Desktop/);
  }
  const { api } = controller(() => json({ device: { type: 'Computer' }, context: { type: 'playlist', uri: `spotify:playlist:${id}` } }));
  assert.equal(await api.playbackPlaylist(), id);
});

test('loads all pages, skips nulls, distinguishes owned and followed playlists', async () => {
  let page = 0;
  const { api, calls } = controller(path => {
    if (path === '/me') return json({ id: 'me' });
    assert.equal(path, '/me/playlists');
    page += 1;
    return page === 1
      ? json({ items: [null, { id: 'own', name: 'Anime', owner: { id: 'me' } }], next: 'next' })
      : json({ items: [{ id: 'other', name: 'Pops', owner: { id: 'other' } }, { id: 'shared', name: 'Shared', collaborative: true, owner: { id: 'other' } }], next: null });
  });
  const result = await api.listPlaylists();
  assert.equal(result.length, 3);
  assert.equal(result.find(item => item.id === 'own').writable, true);
  assert.equal(result.find(item => item.id === 'other').writable, false);
  assert.equal(result.find(item => item.id === 'shared').writable, true);
  assert.equal(calls.at(-1).query, '?limit=50&offset=2');
});
test('legacy connection requests read permission without breaking add permission', async () => {
  const { api, calls } = controller(route, 'user-modify-playback-state user-read-playback-state playlist-modify-public playlist-modify-private');
  await assert.rejects(api.listPlaylists(), /一覧の取得権限/);
  assert.equal(calls.length, 0);
  assert.equal((await api.addAndPlay({ title: 'Song' }, id)).played, true);
});
