import { SONG_SUFFIX_RE } from './config.js';

export function classifyLine(raw) {
  const parts = raw.split(' - ');
  if (parts.length === 1) return { kind: 'exception', artist: '', title: raw, extra: '' };

  const artist = parts[0].trim();
  const rest = parts.slice(1);
  let cut = rest.length;
  while (cut > 1 && SONG_SUFFIX_RE.test(rest[cut - 1])) cut -= 1;

  return {
    kind: 'normal',
    artist,
    title: rest.slice(0, cut).join(' - ').trim(),
    extra: rest.slice(cut).join(' - ').trim()
  };
}

export function parseSongText(input) {
  let text = input;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const seen = new Map();
  const tasks = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const raw = line.trim();
    if (!raw) continue;

    const task = classifyLine(raw);
    const duplicateKey = task.kind === 'normal'
      ? `song:${JSON.stringify([task.artist.toLocaleLowerCase(), task.title.toLocaleLowerCase()])}`
      : `exception:${task.title.toLocaleLowerCase()}`;
    if (seen.has(duplicateKey)) {
      tasks[seen.get(duplicateKey)].count += 1;
      continue;
    }

    task.id = tasks.length;
    task.raw = raw;
    task.done = false;
    task.count = 1;
    seen.set(duplicateKey, task.id);
    tasks.push(task);
  }
  return tasks;
}

export function isSong(task) {
  return task.kind === 'normal';
}

export function buildArtistGroups(tasks) {
  const groupsByName = new Map();
  tasks.forEach((task) => {
    if (!isSong(task)) return;
    const name = task.artist || '（アーティスト不明）';
    if (!groupsByName.has(name)) groupsByName.set(name, []);
    groupsByName.get(name).push(task.id);
  });

  const collator = new Intl.Collator('ja', { sensitivity: 'base', numeric: true });
  return Array.from(groupsByName, ([name, ids]) => ({ name, ids }))
    .sort((a, b) => collator.compare(a.name, b.name));
}
