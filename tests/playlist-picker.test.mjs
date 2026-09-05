import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaylistPicker } from '../js/playlist-picker.js';

const id = '3cEYpjA9oz9GiPac4AsH4n';
function setup(listPlaylists) {
  const stored = new Map();
  globalThis.localStorage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
  globalThis.Option = class { constructor(text, value) { this.text = text; this.value = value; } };
  const element = () => ({ value: '', listeners: {}, options: [], addEventListener(name, fn) { this.listeners[name] = fn; }, setAttribute() {}, replaceChildren(...options) { this.options = options; }, add(option) { this.options.push(option); } });
  const parts = { input: element(), select: element(), status: element(), refreshButton: element(), playbackButton: element() };
  const picker = createPlaylistPicker({ ...parts, spotify: { listPlaylists } });
  return { ...parts, picker, stored };
}
test('refresh discovers new playlists and renames while preserving chosen target', async () => {
  let items = [{ id, name: 'Old', owner: 'me', writable: true }];
  const { picker, select, input } = setup(async () => items);
  await picker.refresh();
  select.value = id;
  select.listeners.change();
  items = [{ id, name: 'New name', owner: 'me', writable: true }, { id: 'another', name: 'New playlist', owner: 'me', writable: true }];
  await picker.refresh();
  assert.equal(select.value, id);
  assert.equal(input.value, `https://open.spotify.com/playlist/${id}`);
  assert.equal(select.options.length, 3);
  assert.match(select.options[1].text, /New name/);
});
test('failed refresh keeps selection and allows retry', async () => {
  const { picker, input, select, status, refreshButton } = setup(async () => { throw new Error('offline'); });
  input.value = `https://open.spotify.com/playlist/${id}`;
  input.listeners.input();
  await picker.refresh();
  assert.equal(select.value, id);
  assert.equal(status.textContent, 'offline');
  assert.equal(refreshButton.disabled, false);
});
test('disconnect discards in-flight playlist response and saved selection', async () => {
  let resolve;
  const { picker, select, input } = setup(() => new Promise(done => { resolve = done; }));
  const pending = picker.refresh();
  picker.clear();
  resolve([{ id, name: 'Private', owner: 'me', writable: true }]);
  await pending;
  assert.equal(select.options.length, 1);
  assert.equal(input.value, '');
});
