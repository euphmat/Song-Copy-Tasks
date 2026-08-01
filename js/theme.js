import { DEFAULT_THEME, STORAGE_PREFIX, THEMES } from './config.js';

const THEME_KEY = `${STORAGE_PREFIX}theme`;

function isKnownTheme(id) {
  return THEMES.some((theme) => theme.id === id);
}

export function readTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (isKnownTheme(saved)) return saved;
  } catch (error) { /* storage may be unavailable */ }
  return DEFAULT_THEME;
}

export function applyTheme(id) {
  const theme = isKnownTheme(id) ? id : DEFAULT_THEME;
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch (error) { /* storage may be unavailable */ }
  return theme;
}

export function setupThemePicker(select) {
  select.replaceChildren(...THEMES.map(({ id, label }) => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    return option;
  }));

  select.value = applyTheme(readTheme());
  select.addEventListener('change', () => applyTheme(select.value));
}
