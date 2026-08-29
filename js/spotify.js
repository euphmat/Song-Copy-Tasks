import { SPOTIFY_CLIENT_ID, STORAGE_PREFIX } from './config.js';

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_URL = 'https://api.spotify.com/v1';
const SCOPES = ['user-modify-playback-state', 'user-read-playback-state'];
const AUTH_KEY = `${STORAGE_PREFIX}spotify-auth`;
const VERIFIER_KEY = `${STORAGE_PREFIX}spotify-code-verifier`;
const STATE_KEY = `${STORAGE_PREFIX}spotify-oauth-state`;
const DEVICE_CACHE_MS = 15_000;

class SpotifyError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'SpotifyError';
    this.status = status;
  }
}

function randomString(length = 64) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
}

function base64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function codeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  return base64Url(await crypto.subtle.digest('SHA-256', data));
}

function redirectUri() {
  return `${window.location.origin}${window.location.pathname}`;
}

function supportsSpotifyRedirect() {
  return window.location.protocol === 'https:'
    || (window.location.protocol === 'http:' && window.location.hostname === '127.0.0.1');
}

function readAuth() {
  try {
    const value = JSON.parse(localStorage.getItem(AUTH_KEY));
    return value?.accessToken && value?.refreshToken ? value : null;
  } catch (error) { return null; }
}

function writeAuth(value) {
  try { localStorage.setItem(AUTH_KEY, JSON.stringify(value)); } catch (error) { /* unavailable */ }
}

function clearAuth() {
  try { localStorage.removeItem(AUTH_KEY); } catch (error) { /* unavailable */ }
}

function cleanupCallbackUrl() {
  const url = new URL(window.location.href);
  ['code', 'state', 'error'].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function normalized(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

function candidateScore(track, task) {
  const wantedTitle = normalized(task.title || task.raw);
  const actualTitle = normalized(track.name);
  const wantedArtist = normalized(task.artist);
  const actualArtists = (track.artists || []).map((artist) => normalized(artist.name));
  let score = 0;
  if (actualTitle === wantedTitle) score += 8;
  else if (actualTitle.includes(wantedTitle) || wantedTitle.includes(actualTitle)) score += 4;
  if (wantedArtist && actualArtists.includes(wantedArtist)) score += 6;
  else if (wantedArtist && actualArtists.some((artist) => artist.includes(wantedArtist) || wantedArtist.includes(artist))) score += 3;
  return score;
}

function searchQuery(task) {
  const title = String(task.title || task.raw || '').replace(/["\\]/g, ' ').trim();
  const artist = String(task.artist || '').replace(/["\\]/g, ' ').trim();
  return artist ? `track:"${title}" artist:"${artist}"` : title;
}

export function createSpotifyController({ button, label, notify }) {
  let auth = readAuth();
  let deviceCache = null;
  let playSequence = 0;

  function updateButton(busy = false) {
    const connected = Boolean(auth?.refreshToken);
    button.classList.toggle('connected', connected);
    button.classList.toggle('busy', busy);
    button.setAttribute('aria-pressed', String(connected));
    button.title = connected ? 'Spotify 接続済み（クリックで解除）' : 'Spotify と接続する';
    label.textContent = busy ? 'Spotify 接続中…' : (connected ? 'Spotify 接続済み' : 'Spotify 接続');
  }

  async function exchangeToken(body) {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new SpotifyError(data.error_description || data.error || 'Spotify の認証に失敗しました', response.status);
    return data;
  }

  function storeToken(data, previousRefreshToken = '') {
    auth = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || previousRefreshToken,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60_000
    };
    writeAuth(auth);
    updateButton();
  }

  async function refreshAccessToken() {
    if (!auth?.refreshToken) throw new SpotifyError('Spotify に接続してください');
    try {
      const data = await exchangeToken({
        client_id: SPOTIFY_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: auth.refreshToken
      });
      storeToken(data, auth.refreshToken);
      return auth.accessToken;
    } catch (error) {
      if ([400, 401].includes(error.status)) {
        auth = null;
        clearAuth();
        updateButton();
        throw new SpotifyError('Spotify の接続期限が切れました。再接続してください', error.status);
      }
      throw new SpotifyError('Spotify の認証を更新できませんでした。通信状態を確認してください', error.status);
    }
  }

  async function accessToken(forceRefresh = false) {
    if (!auth) throw new SpotifyError('Spotify に接続してください');
    if (forceRefresh || !auth.accessToken || Date.now() >= auth.expiresAt) return refreshAccessToken();
    return auth.accessToken;
  }

  async function api(path, options = {}, retry = true) {
    const token = await accessToken();
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    if (options.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${API_URL}${path}`, { ...options, headers });
    if (response.status === 401 && retry) {
      await accessToken(true);
      return api(path, options, false);
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const detail = data.error?.message || data.message || '';
      throw new SpotifyError(detail || `Spotify API エラー（${response.status}）`, response.status);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async function connect() {
    if (!supportsSpotifyRedirect()) {
      throw new SpotifyError('Spotify 接続には HTTPS で公開したページが必要です');
    }
    const verifier = randomString();
    const oauthState = randomString(32);
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, oauthState);
    const params = new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri(),
      scope: SCOPES.join(' '),
      code_challenge_method: 'S256',
      code_challenge: await codeChallenge(verifier),
      state: oauthState
    });
    window.location.assign(`${AUTHORIZE_URL}?${params}`);
  }

  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const oauthError = params.get('error');
    if (!code && !oauthError) return;
    updateButton(true);
    try {
      if (oauthError) throw new SpotifyError('Spotify への接続がキャンセルされました');
      const expectedState = sessionStorage.getItem(STATE_KEY);
      const returnedState = params.get('state');
      const verifier = sessionStorage.getItem(VERIFIER_KEY);
      if (!expectedState || !verifier || expectedState !== returnedState) {
        throw new SpotifyError('Spotify 認証の検証に失敗しました。もう一度接続してください');
      }
      const data = await exchangeToken({
        client_id: SPOTIFY_CLIENT_ID,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(),
        code_verifier: verifier
      });
      storeToken(data);
      notify('Spotify に接続しました');
    } catch (error) {
      notify(error.message || 'Spotify に接続できませんでした', true);
    } finally {
      sessionStorage.removeItem(VERIFIER_KEY);
      sessionStorage.removeItem(STATE_KEY);
      cleanupCallbackUrl();
      updateButton();
    }
  }

  async function desktopDevice(force = false) {
    if (!force && deviceCache && Date.now() - deviceCache.savedAt < DEVICE_CACHE_MS) return deviceCache.device;
    const data = await api('/me/player/devices');
    const devices = (data.devices || []).filter((device) => device.id && !device.is_restricted);
    const computers = devices.filter((device) => String(device.type).toLocaleLowerCase() === 'computer');
    const device = computers.find((item) => item.is_active) || computers[0];
    if (!device) throw new SpotifyError('Spotify Desktop を起動してから、もう一度曲を選んでください');
    deviceCache = { device, savedAt: Date.now() };
    return device;
  }

  async function findTrack(task) {
    const queries = [
      searchQuery(task),
      `${task.artist || ''} ${task.title || task.raw || ''}`.trim()
    ];
    let tracks = [];
    for (const query of [...new Set(queries)]) {
      const params = new URLSearchParams({ q: query, type: 'track', limit: '5' });
      const data = await api(`/search?${params}`);
      tracks = data.tracks?.items || [];
      if (tracks.length) break;
    }
    if (!tracks.length) throw new SpotifyError(`Spotify で「${task.artist ? `${task.artist} - ` : ''}${task.title || task.raw}」が見つかりませんでした`);
    return tracks
      .map((track, index) => ({ track, index, score: candidateScore(track, task) }))
      .sort((left, right) => right.score - left.score || left.index - right.index)[0].track;
  }

  async function play(task) {
    const sequence = ++playSequence;
    let track;
    let device;
    try {
      [track, device] = await Promise.all([findTrack(task), desktopDevice()]);
    } catch (error) {
      if (sequence !== playSequence) return null;
      throw error;
    }
    if (sequence !== playSequence) return null;
    const path = `/me/player/play?${new URLSearchParams({ device_id: device.id })}`;
    try {
      await api(path, { method: 'PUT', body: JSON.stringify({ uris: [track.uri] }) });
    } catch (error) {
      if (![404, 403].includes(error.status)) throw error;
      deviceCache = null;
      const refreshedDevice = await desktopDevice(true);
      if (sequence !== playSequence) return null;
      const retryPath = `/me/player/play?${new URLSearchParams({ device_id: refreshedDevice.id })}`;
      await api(retryPath, { method: 'PUT', body: JSON.stringify({ uris: [track.uri] }) });
    }
    return track;
  }

  button.addEventListener('click', async () => {
    if (auth?.refreshToken) {
      if (!window.confirm('Spotify との接続を解除しますか？')) return;
      playSequence += 1;
      auth = null;
      deviceCache = null;
      clearAuth();
      updateButton();
      notify('Spotify との接続を解除しました');
      return;
    }
    updateButton(true);
    try { await connect(); }
    catch (error) {
      updateButton();
      notify(error.message || 'Spotify に接続できませんでした', true);
    }
  });

  updateButton();

  return {
    handleCallback,
    isConnected: () => Boolean(auth?.refreshToken),
    play
  };
}
