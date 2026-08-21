export const THEMES = [
  { id: 'midnight', label: '星夜' },
  { id: 'aurora-glass', label: 'オーロラグラス' },
  { id: 'editorial-noir', label: 'ノワール・シック' },
  { id: 'studio-grid', label: 'スタジオ・グリッド' },
  { id: 'graphite', label: 'グラファイト' },
  { id: 'snow', label: 'スノー' },
  { id: 'ocean', label: 'オーシャン' },
  { id: 'forest', label: 'フォレスト' },
  { id: 'sunset', label: 'サンセット' },
  { id: 'sakura', label: '桜' },
  { id: 'lavender', label: 'ラベンダー' },
  { id: 'amber', label: 'アンバー' },
  { id: 'cyber', label: 'サイバー' },
  { id: 'coffee', label: 'コーヒー' },
  { id: 'nord', label: 'ノルド' },
  { id: 'mint', label: 'ミント' },
  { id: 'berry', label: 'ベリー' },
  { id: 'solarized', label: 'ソラライズ' },
  { id: 'contrast', label: 'ハイコントラスト' }
];

export const DEFAULT_THEME = 'midnight';
export const DEFAULT_LIST_FILE = 'master.txt';
export const STORAGE_PREFIX = 'songtasks:';

// Spotify検索のノイズになりやすい末尾表記。
export const SONG_SUFFIX_RE = /(remaster|remix|live|version|edit|acoustic|demo|mix|mono|stereo|feat|ft\.|single|deluxe|bonus|instrumental|radio|session|unplugged|(19|20)\d{2})/i;
