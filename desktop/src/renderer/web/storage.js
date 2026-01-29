const STORAGE_KEY = "livegalgame:web:state";
const STORAGE_VERSION = 1;

const memoryStore = {
  _data: {},
  getItem(key) {
    return this._data[key] ?? null;
  },
  setItem(key, value) {
    this._data[key] = String(value);
  },
  removeItem(key) {
    delete this._data[key];
  }
};

function getStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // ignore and fall back to memory
  }
  return memoryStore;
}

function now() {
  return Date.now();
}

function createDefaultState() {
  const timestamp = now();
  return {
    meta: {
      version: STORAGE_VERSION,
      created_at: timestamp,
      updated_at: timestamp
    },
    characters: [],
    conversations: [],
    messages: [],
    characterDetails: {},
    asrConfigs: [
      {
        id: "default",
        model_name: "siliconflow-cloud",
        language: "zh",
        enable_vad: 1,
        sentence_pause_threshold: 1.0,
        retain_audio_files: 0,
        audio_retention_days: 30,
        audio_storage_path: null,
        is_default: 1,
        created_at: timestamp,
        updated_at: timestamp
      }
    ],
    audioSources: [
      {
        id: "speaker1",
        name: "用户（麦克风）",
        is_active: 1,
        device_id: "",
        device_name: "",
        created_at: timestamp,
        updated_at: timestamp
      },
      {
        id: "speaker2",
        name: "角色（系统音频）",
        is_active: 0,
        device_id: "",
        device_name: "",
        created_at: timestamp,
        updated_at: timestamp
      }
    ],
    llmConfigs: [],
    llmFeatureConfigs: {},
    suggestionConfig: {
      id: "default",
      enable_passive_suggestion: 1,
      suggestion_count: 3,
      silence_threshold_seconds: 3,
      message_threshold_count: 3,
      cooldown_seconds: 15,
      context_message_limit: 20,
      topic_detection_enabled: 0,
      situation_llm_enabled: 0,
      model_name: "gpt-4o-mini",
      situation_model_name: "gpt-4o-mini",
      thinking_enabled: 0,
      user_profile: null,
      created_at: timestamp,
      updated_at: timestamp
    },
    conversationReviews: {}
  };
}

function normalizeState(state) {
  if (!state || typeof state !== "object") {
    return createDefaultState();
  }

  const next = { ...state };
  next.meta = next.meta || { version: STORAGE_VERSION };
  next.characters = Array.isArray(next.characters) ? next.characters : [];
  next.conversations = Array.isArray(next.conversations) ? next.conversations : [];
  next.messages = Array.isArray(next.messages) ? next.messages : [];
  next.characterDetails = next.characterDetails && typeof next.characterDetails === "object" ? next.characterDetails : {};
  next.asrConfigs = Array.isArray(next.asrConfigs) ? next.asrConfigs : [];
  next.audioSources = Array.isArray(next.audioSources) ? next.audioSources : [];
  next.llmConfigs = Array.isArray(next.llmConfigs) ? next.llmConfigs : [];
  next.llmFeatureConfigs = next.llmFeatureConfigs && typeof next.llmFeatureConfigs === "object" ? next.llmFeatureConfigs : {};
  next.suggestionConfig = next.suggestionConfig && typeof next.suggestionConfig === "object"
    ? next.suggestionConfig
    : createDefaultState().suggestionConfig;
  next.conversationReviews = next.conversationReviews && typeof next.conversationReviews === "object"
    ? next.conversationReviews
    : {};

  if (next.asrConfigs.length === 0) {
    next.asrConfigs = createDefaultState().asrConfigs;
  }
  if (next.audioSources.length === 0) {
    next.audioSources = createDefaultState().audioSources;
  }

  return next;
}

export function loadState() {
  const storage = getStorage();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      const fresh = createDefaultState();
      storage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      return fresh;
    }
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    console.warn("[WebStore] Failed to load state, resetting:", error);
    const fresh = createDefaultState();
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    } catch {
      // ignore
    }
    return fresh;
  }
}

export function saveState(state) {
  const storage = getStorage();
  const next = normalizeState(state);
  next.meta = next.meta || { version: STORAGE_VERSION };
  next.meta.updated_at = now();
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn("[WebStore] Failed to save state:", error);
  }
  return next;
}

export function updateState(mutator) {
  const state = loadState();
  const result = mutator(state);
  saveState(state);
  return result;
}

export function generateId(prefix = "id") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
