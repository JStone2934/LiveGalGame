import Store from 'electron-store';

const store = new Store({
  name: 'livegalgame-settings',
});

export function getAsrCacheBaseSetting() {
  const value = store.get('asr.cacheBase');
  return typeof value === 'string' && value.trim() ? value : null;
}

export function setAsrCacheBaseSetting(cacheBase) {
  if (cacheBase === null || cacheBase === undefined || String(cacheBase).trim() === '') {
    store.delete('asr.cacheBase');
    return null;
  }
  const normalized = String(cacheBase).trim();
  store.set('asr.cacheBase', normalized);
  return normalized;
}

export function clearAsrCacheBaseSetting() {
  store.delete('asr.cacheBase');
}

export function getSiliconflowApiKeySetting() {
  const value = store.get('asr.siliconflowApiKey');
  return typeof value === 'string' && value.trim() ? value : null;
}

export function setSiliconflowApiKeySetting(apiKey) {
  if (apiKey === null || apiKey === undefined || String(apiKey).trim() === '') {
    store.delete('asr.siliconflowApiKey');
    return null;
  }
  const normalized = String(apiKey).trim();
  store.set('asr.siliconflowApiKey', normalized);
  return normalized;
}

export function clearSiliconflowApiKeySetting() {
  store.delete('asr.siliconflowApiKey');
}
