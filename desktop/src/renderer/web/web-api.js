import { ASR_MODEL_PRESETS } from "../../shared/asr-models.js";
import { loadState, updateState, generateId, clone } from "./storage.js";

class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(listener);
    return () => this.off(event, listener);
  }

  off(event, listener) {
    if (!this.listeners.has(event)) return;
    this.listeners.get(event).delete(listener);
  }

  emit(event, payload) {
    if (!this.listeners.has(event)) return;
    for (const listener of this.listeners.get(event)) {
      try {
        listener(payload);
      } catch (error) {
        console.warn(`[WebAPI] Listener error for ${event}:`, error);
      }
    }
  }
}

function normalizeWsBase(base) {
  if (!base) return "";
  if (base.startsWith("ws://") || base.startsWith("wss://")) {
    return base;
  }
  if (base.startsWith("http://") || base.startsWith("https://")) {
    return base.replace(/^http/, "ws");
  }
  if (base.startsWith("/")) {
    if (typeof window !== "undefined") {
      return window.location.origin.replace(/^http/, "ws") + base;
    }
  }
  return base;
}

function normalizeHttpBase(base) {
  if (!base) return "";
  if (base.startsWith("http://") || base.startsWith("https://")) {
    return base;
  }
  if (base.startsWith("ws://") || base.startsWith("wss://")) {
    return base.replace(/^ws/, "http");
  }
  if (base.startsWith("/")) {
    if (typeof window !== "undefined") {
      return window.location.origin + base;
    }
  }
  return base;
}

function getEnvValue(name) {
  try {
    return import.meta?.env?.[name];
  } catch {
    return undefined;
  }
}

function getWsBase() {
  const explicit =
    getEnvValue("VITE_ASR_WS_URL") ||
    getEnvValue("VITE_ASR_WS_BASE") ||
    getEnvValue("VITE_ASR_BASE_URL") ||
    getEnvValue("VITE_API_BASE_URL");
  const base = explicit || (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:8000");
  return normalizeWsBase(base);
}

function getHttpBase() {
  const explicit =
    getEnvValue("VITE_ASR_HTTP_URL") ||
    getEnvValue("VITE_ASR_BASE_URL") ||
    getEnvValue("VITE_API_BASE_URL");
  const base = explicit || (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:8000");
  return normalizeHttpBase(base);
}

function buildWsUrl(sourceId) {
  const wsBase = getWsBase().replace(/\/$/, "");
  if (!wsBase) {
    return "";
  }
  if (wsBase.includes("/ws/transcribe")) {
    const joiner = wsBase.includes("?") ? "&" : "?";
    return `${wsBase}${joiner}session_id=${encodeURIComponent(sourceId)}`;
  }
  return `${wsBase}/ws/transcribe?session_id=${encodeURIComponent(sourceId)}`;
}

function float32ToInt16(float32Array) {
  const buffer = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i += 1) {
    let sample = float32Array[i];
    if (sample > 1) sample = 1;
    if (sample < -1) sample = -1;
    buffer[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return buffer;
}

function normalizeAudioBuffer(audioBuffer) {
  if (!audioBuffer) return new Int16Array();
  if (audioBuffer instanceof Int16Array) return audioBuffer;
  if (audioBuffer instanceof Float32Array) return float32ToInt16(audioBuffer);
  if (Array.isArray(audioBuffer)) {
    return float32ToInt16(Float32Array.from(audioBuffer));
  }
  try {
    const float32 = new Float32Array(audioBuffer);
    return float32ToInt16(float32);
  } catch {
    return new Int16Array();
  }
}

class WebASRManager {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.sessions = new Map();
    this.isInitialized = false;
    this.isRunning = false;
    this.currentConversationId = null;
    this.lastTexts = new Map();
  }

  async initialize(conversationId) {
    this.currentConversationId = conversationId || this.currentConversationId;
    this.isInitialized = true;
    return true;
  }

  async checkReady() {
    const base = getHttpBase().replace(/\/$/, "");
    if (!base) {
      return {
        ready: false,
        message: "ASR 地址未配置",
        missingBase: true
      };
    }
    try {
      const res = await fetch(base + "/health", { method: "GET" });
      if (!res.ok) {
        return {
          ready: false,
          message: "ASR 服务不可用 (HTTP " + res.status + ")",
          status: res.status
        };
      }
      let payload = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }
      return {
        ready: true,
        message: "ASR 服务已就绪",
        status: payload?.status || "ok",
        engine: payload?.engine,
        model: payload?.model
      };
    } catch (error) {
      return {
        ready: false,
        message: "ASR 服务连接失败",
        error: error?.message || "unknown"
      };
    }
  }

  async checkLLMReady() {
    const base = getHttpBase().replace(/\/$/, "");
    if (!base) {
      return {
        ready: false,
        message: "API 地址未配置",
        missingBase: true
      };
    }
    try {
      const res = await fetch(base + "/api/llm/status", { method: "GET" });
      if (!res.ok) {
        return {
          ready: false,
          message: "LLM 服务不可用 (HTTP " + res.status + ")",
          status: res.status
        };
      }
      const payload = await res.json();
      return {
        ready: payload.ready,
        message: payload.message || (payload.ready ? "LLM 服务已就绪" : "LLM 服务未配置"),
        model: payload.model,
        base_url: payload.base_url
      };
    } catch (error) {
      return {
        ready: false,
        message: "LLM 服务连接失败",
        error: error?.message || "unknown"
      };
    }
  }

  async start(conversationId) {
    this.currentConversationId = conversationId || this.currentConversationId;
    this.isInitialized = true;
    this.isRunning = true;
    return { success: true };
  }

  async stop() {
    this.isRunning = false;
    for (const [sourceId, session] of this.sessions.entries()) {
      try {
        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(JSON.stringify({ type: "reset_session" }));
          session.ws.close();
        }
      } catch {
        // ignore
      }
      this.sessions.delete(sourceId);
      this.eventBus.emit("asr-partial-clear", { sessionId: sourceId, sourceId });
    }
    return { success: true };
  }

  ensureSession(sourceId) {
    if (!sourceId) return null;
    const existing = this.sessions.get(sourceId);
    if (existing && existing.ws && existing.ws.readyState !== WebSocket.CLOSED) {
      return existing;
    }

    const wsUrl = buildWsUrl(sourceId);
    if (!wsUrl) {
      this.eventBus.emit("asr-error", { sourceId, error: "ASR WebSocket URL 未配置" });
      return null;
    }

    const ws = new WebSocket(wsUrl);
    const session = { ws, queue: [] };
    this.sessions.set(sourceId, session);

    ws.binaryType = "arraybuffer";

    ws.addEventListener("open", () => {
      if (session.queue.length > 0) {
        session.queue.forEach((payload) => {
          try {
            ws.send(payload);
          } catch {
            // ignore
          }
        });
        session.queue = [];
      }
    });

    ws.addEventListener("message", async (event) => {
      let text;
      try {
        if (typeof event.data === "string") {
          text = event.data;
        } else if (event.data instanceof ArrayBuffer) {
          text = new TextDecoder().decode(event.data);
        } else if (event.data && event.data.text) {
          text = await event.data.text();
        }
      } catch {
        text = null;
      }

      if (!text) return;

      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        return;
      }

      this.handleServerMessage(sourceId, payload);
    });

    ws.addEventListener("error", () => {
      this.eventBus.emit("asr-error", { sourceId, error: "ASR WebSocket 连接失败" });
    });

    ws.addEventListener("close", () => {
      if (this.isRunning) {
        this.eventBus.emit("asr-error", { sourceId, error: "ASR WebSocket 连接已断开" });
      }
    });

    return session;
  }

  handleServerMessage(sourceId, payload) {
    if (!payload || !payload.type) return;
    if (payload.status === "error") {
      this.eventBus.emit("asr-error", { sourceId, error: payload.error || "ASR 服务错误" });
      return;
    }

    const timestamp = payload.timestamp || Date.now();

    if (payload.type === "partial" || payload.type === "partial_result") {
      const text = payload.text || payload.partialText || payload.full_text || payload.fullText || "";
      if (!text.trim()) return;
      this.eventBus.emit("asr-partial-update", {
        sessionId: payload.session_id || sourceId,
        sourceId,
        content: text,
        timestamp,
        conversationId: this.currentConversationId
      });
      return;
    }

    if (payload.type === "sentence_complete") {
      const text = (payload.text || "").trim();
      if (!text) return;

      const last = this.lastTexts.get(sourceId);
      if (last && last.text === text && timestamp - last.timestamp < 3000) {
        return;
      }
      this.lastTexts.set(sourceId, { text, timestamp });

      const message = updateState((state) => {
        const conversationId = this.currentConversationId;
        if (!conversationId) return null;
        const sender = sourceId === "speaker1" ? "user" : "character";
        const msg = {
          id: generateId("msg"),
          conversation_id: conversationId,
          sender,
          content: text,
          timestamp,
          is_ai_generated: 0,
          source_id: sourceId
        };
        state.messages.push(msg);
        const conversation = state.conversations.find((c) => c.id === conversationId);
        if (conversation) {
          conversation.updated_at = timestamp;
        }
        return clone(msg);
      });

      if (message) {
        this.eventBus.emit("asr-sentence-complete", message);
        this.eventBus.emit("asr-partial-clear", { sessionId: sourceId, sourceId });
      }
      return;
    }
  }

  handleAudioData(payload) {
    if (!this.isRunning) return;
    if (!payload || !payload.sourceId) return;
    const session = this.ensureSession(payload.sourceId);
    if (!session) return;

    const int16Audio = normalizeAudioBuffer(payload.audioBuffer);
    if (!int16Audio || int16Audio.length === 0) return;

    const buffer = int16Audio.buffer;
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(buffer);
    } else {
      if (session.queue.length > 10) {
        session.queue.shift();
      }
      session.queue.push(buffer);
    }
  }

  handleSilenceCommit(payload) {
    const sourceId = payload?.sourceId;
    if (!sourceId) return;
    const session = this.ensureSession(sourceId);
    if (!session) return;
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({ type: "force_commit" }));
    }
  }
}

const eventBus = new EventBus();
const asrManager = new WebASRManager(eventBus);

function getCharacterMap(state) {
  const map = new Map();
  state.characters.forEach((c) => {
    map.set(c.id, c);
  });
  return map;
}

function attachCharacterInfo(conversation, character) {
  return {
    ...conversation,
    character_name: character?.name || "",
    character_avatar_color: character?.avatar_color || "#ff6b6b"
  };
}

function listConversations(state) {
  const characterMap = getCharacterMap(state);
  return state.conversations
    .map((conv) => attachCharacterInfo(conv, characterMap.get(conv.character_id)))
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
}

function getCharacterById(characterId) {
  const state = loadState();
  const character = state.characters.find((item) => item.id === characterId);
  return character ? clone(character) : null;
}

function getConversationsByCharacter(characterId) {
  const state = loadState();
  const character = state.characters.find((item) => item.id === characterId);
  return clone(
    state.conversations
      .filter((conv) => conv.character_id === characterId)
      .map((conv) => attachCharacterInfo(conv, character))
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
  );
}

const webApi = {
  isWeb: true,

  on: (event, listener) => eventBus.on(event, listener),
  removeListener: (event, listener) => eventBus.off(event, listener),

  send: (channel, payload) => {
    if (channel === "asr-audio-data") {
      asrManager.handleAudioData(payload);
    } else if (channel === "asr-silence-commit") {
      asrManager.handleSilenceCommit(payload);
    } else if (channel === "suggestion-config-updated") {
      eventBus.emit("suggestion-config-updated", payload);
    }
  },

  asrInitialize: (conversationId) => asrManager.initialize(conversationId),
  asrCheckReady: () => asrManager.checkReady(),
  asrStart: (conversationId) => asrManager.start(conversationId),
  asrStop: () => asrManager.stop(),

  llmCheckReady: () => asrManager.checkLLMReady(),

  asrGetConfigs: () => clone(loadState().asrConfigs),
  asrCreateConfig: (configData) => updateState((state) => {
    const now = Date.now();
    const config = {
      id: configData?.id || generateId("asr"),
      model_name: configData?.model_name || "siliconflow-cloud",
      language: configData?.language || "zh",
      enable_vad: configData?.enable_vad ?? 1,
      sentence_pause_threshold: configData?.sentence_pause_threshold ?? 1.0,
      retain_audio_files: configData?.retain_audio_files ?? 0,
      audio_retention_days: configData?.audio_retention_days ?? 30,
      audio_storage_path: configData?.audio_storage_path ?? null,
      is_default: configData?.is_default ? 1 : 0,
      created_at: now,
      updated_at: now
    };
    if (config.is_default) {
      state.asrConfigs.forEach((item) => {
        item.is_default = 0;
      });
    }
    state.asrConfigs.push(config);
    return clone(config);
  }),
  asrUpdateConfig: (id, updates) => updateState((state) => {
    const config = state.asrConfigs.find((item) => item.id === id);
    if (!config) return null;
    Object.assign(config, updates || {});
    if (updates?.is_default) {
      state.asrConfigs.forEach((item) => {
        item.is_default = item.id === id ? 1 : 0;
      });
    }
    config.updated_at = Date.now();
    return clone(config);
  }),
  asrDeleteConfig: (id) => updateState((state) => {
    const before = state.asrConfigs.length;
    state.asrConfigs = state.asrConfigs.filter((item) => item.id !== id);
    if (!state.asrConfigs.some((item) => item.is_default)) {
      const first = state.asrConfigs[0];
      if (first) first.is_default = 1;
    }
    return { success: state.asrConfigs.length < before };
  }),
  asrSetDefaultConfig: (id) => updateState((state) => {
    let updated = null;
    state.asrConfigs.forEach((item) => {
      item.is_default = item.id === id ? 1 : 0;
      if (item.id === id) {
        item.updated_at = Date.now();
        updated = clone(item);
      }
    });
    return updated;
  }),

  asrGetAudioSources: () => clone(loadState().audioSources),
  asrCreateAudioSource: (sourceData) => updateState((state) => {
    const now = Date.now();
    const source = {
      id: sourceData?.id || generateId("audio"),
      name: sourceData?.name || "",
      is_active: sourceData?.is_active ?? 0,
      device_id: sourceData?.device_id || "",
      device_name: sourceData?.device_name || "",
      created_at: now,
      updated_at: now
    };
    const existing = state.audioSources.find((item) => item.id === source.id);
    if (existing) {
      Object.assign(existing, source, { created_at: existing.created_at, updated_at: now });
      return clone(existing);
    }
    state.audioSources.push(source);
    return clone(source);
  }),
  asrUpdateAudioSource: (id, updates) => updateState((state) => {
    const source = state.audioSources.find((item) => item.id === id);
    if (!source) return null;
    Object.assign(source, updates || {});
    source.updated_at = Date.now();
    return clone(source);
  }),
  asrGetModelPresets: () => clone(ASR_MODEL_PRESETS.filter((preset) => preset.isRemote)),
  asrGetAllModelStatuses: () => {
    const statuses = {};
    ASR_MODEL_PRESETS.filter((preset) => preset.isRemote).forEach((preset) => {
      statuses[preset.id] = {
        modelId: preset.id,
        engine: preset.engine,
        sizeBytes: 0,
        downloadedBytes: 0,
        isDownloaded: true,
        activeDownload: false,
        updatedAt: Date.now()
      };
    });
    return statuses;
  },
  asrDownloadModel: () => ({ success: false, message: "Web 端不需要下载模型" }),
  asrCancelModelDownload: () => ({ success: false, message: "Web 端不需要下载模型" }),
  asrReloadModel: () => ({ success: true }),
  asrGetSpeechRecords: () => [],
  asrConvertToMessage: () => null,
  asrCleanupAudioFiles: () => ({ success: false, error: "Web 端不支持" }),
  asrGetAudioDataUrl: () => null,
  asrDeleteAudioFile: () => ({ success: false, error: "Web 端不支持" }),

  getStatistics: () => {
    const state = loadState();
    const characterCount = state.characters.length;
    const conversationCount = state.conversations.length;
    const messageCount = state.messages.length;
    const avgAffinity = characterCount
      ? Math.round(state.characters.reduce((sum, c) => sum + (Number(c.affinity) || 0), 0) / characterCount)
      : 0;
    return { characterCount, conversationCount, messageCount, avgAffinity };
  },
  getCharacterPageStatistics: () => {
    const state = loadState();
    const characterCount = state.characters.length;
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const activeConversationCount = state.conversations.filter((conv) => (conv.created_at || 0) >= twoDaysAgo).length;
    const avgAffinity = characterCount
      ? Math.round(state.characters.reduce((sum, c) => sum + (Number(c.affinity) || 0), 0) / characterCount)
      : 0;
    return { characterCount, activeConversationCount, avgAffinity };
  },
  getRecentConversations: (limit = 10) => {
    const state = loadState();
    return clone(listConversations(state).slice(0, limit));
  },

  getAllCharacters: () => {
    const state = loadState();
    return clone([...state.characters].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)));
  },
  getCharacterById: (id) => getCharacterById(id),
  createCharacter: (characterData) => updateState((state) => {
    const now = Date.now();
    const character = {
      id: characterData?.id || generateId("char"),
      name: characterData?.name || "",
      nickname: characterData?.nickname || "",
      relationship_label: characterData?.relationship_label || "",
      avatar_color: characterData?.avatar_color || "#ff6b6b",
      affinity: characterData?.affinity ?? 50,
      notes: characterData?.notes || "",
      tags: Array.isArray(characterData?.tags) ? characterData.tags : [],
      created_at: now,
      updated_at: now
    };
    state.characters.push(character);
    state.characterDetails[character.id] = {
      character_id: character.id,
      profile: {
        name: character.name,
        nickname: character.nickname,
        relationship_label: character.relationship_label,
        affinity: character.affinity,
        tags: character.tags || [],
        created_at: character.created_at,
        notes: character.notes
      },
      personality_traits: null,
      likes_dislikes: null,
      important_events: [],
      conversation_summary: "暂无对话记录",
      custom_fields: {},
      updated_at: now
    };
    return clone(character);
  }),
  deleteCharacter: (characterId) => updateState((state) => {
    const before = state.characters.length;
    state.characters = state.characters.filter((item) => item.id !== characterId);
    state.conversations = state.conversations.filter((conv) => conv.character_id !== characterId);
    state.messages = state.messages.filter((msg) => {
      const conv = state.conversations.find((c) => c.id === msg.conversation_id);
      return Boolean(conv);
    });
    delete state.characterDetails[characterId];
    return before !== state.characters.length;
  }),

  getCharacterDetails: (characterId) => {
    const state = loadState();
    const existing = state.characterDetails?.[characterId];
    if (existing) return clone(existing);
    const character = state.characters.find((item) => item.id === characterId);
    if (!character) return null;
    const details = {
      character_id: characterId,
      profile: {
        name: character.name,
        nickname: character.nickname,
        relationship_label: character.relationship_label,
        affinity: character.affinity,
        tags: character.tags || [],
        created_at: character.created_at,
        notes: character.notes
      },
      personality_traits: null,
      likes_dislikes: null,
      important_events: [],
      conversation_summary: "暂无对话记录",
      custom_fields: {},
      updated_at: Date.now()
    };
    return details;
  },

  saveCharacterDetails: (characterId, details) => updateState((state) => {
    const now = Date.now();
    state.characterDetails[characterId] = {
      ...details,
      character_id: characterId,
      updated_at: now
    };
    const profile = details?.profile || {};
    const character = state.characters.find((item) => item.id === characterId);
    if (character) {
      if (profile.name !== undefined) character.name = profile.name;
      if (profile.nickname !== undefined) character.nickname = profile.nickname;
      if (profile.relationship_label !== undefined) character.relationship_label = profile.relationship_label;
      if (profile.affinity !== undefined) character.affinity = profile.affinity;
      if (Array.isArray(profile.tags)) character.tags = profile.tags;
      character.updated_at = now;
    }
    return true;
  }),

  getAllConversations: () => {
    const state = loadState();
    return clone(listConversations(state));
  },
  getConversationById: (conversationId) => {
    const state = loadState();
    const conversation = state.conversations.find((item) => item.id === conversationId);
    if (!conversation) return null;
    const character = state.characters.find((item) => item.id === conversation.character_id);
    return clone(attachCharacterInfo(conversation, character));
  },
  getConversationsByCharacter: (characterId) => getConversationsByCharacter(characterId),
  dbGetConversationsByCharacter: (characterId) => getConversationsByCharacter(characterId),

  dbCreateConversation: (conversationData) => updateState((state) => {
    const now = Date.now();
    const conversation = {
      id: conversationData?.id || generateId("conv"),
      character_id: conversationData?.character_id,
      title: conversationData?.title || "新对话",
      date: now,
      affinity_change: conversationData?.affinity_change ?? 0,
      summary: conversationData?.summary || "",
      tags: conversationData?.tags || "",
      created_at: now,
      updated_at: now
    };
    state.conversations.push(conversation);
    const character = state.characters.find((item) => item.id === conversation.character_id);
    return clone(attachCharacterInfo(conversation, character));
  }),

  updateConversation: (conversationId, updates) => updateState((state) => {
    const conversation = state.conversations.find((item) => item.id === conversationId);
    if (!conversation) return null;
    Object.assign(conversation, updates || {});
    conversation.updated_at = Date.now();
    const character = state.characters.find((item) => item.id === conversation.character_id);
    return clone(attachCharacterInfo(conversation, character));
  }),

  deleteConversation: (conversationId) => updateState((state) => {
    const before = state.conversations.length;
    state.conversations = state.conversations.filter((item) => item.id !== conversationId);
    state.messages = state.messages.filter((msg) => msg.conversation_id !== conversationId);
    return before !== state.conversations.length;
  }),

  getMessagesByConversation: (conversationId) => {
    const state = loadState();
    return clone(
      state.messages
        .filter((msg) => msg.conversation_id === conversationId)
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    );
  },

  updateMessage: (messageId, updates) => updateState((state) => {
    const message = state.messages.find((item) => item.id === messageId);
    if (!message) return null;
    Object.assign(message, updates || {});
    return clone(message);
  }),

  dbGetCharacterById: (characterId) => getCharacterById(characterId),

  getSuggestionConfig: () => clone(loadState().suggestionConfig),
  updateSuggestionConfig: (updates) => updateState((state) => {
    state.suggestionConfig = {
      ...state.suggestionConfig,
      ...(updates || {}),
      updated_at: Date.now()
    };
    eventBus.emit("suggestion-config-updated", clone(state.suggestionConfig));
    return clone(state.suggestionConfig);
  }),

  generateLLMSuggestions: async (payload = {}) => {
    const base = getHttpBase().replace(/\/$/, "");
    if (!base) {
      return { suggestions: [], metadata: { source: "web", error: "API 地址未配置" } };
    }

    try {
      // Build request body
      const state = loadState();
      const conversationId = payload.conversationId;
      const conversation = conversationId
        ? state.conversations.find((c) => c.id === conversationId)
        : null;
      const characterId = payload.characterId || conversation?.character_id;
      const character = characterId
        ? state.characters.find((c) => c.id === characterId)
        : null;
      const characterDetails = characterId ? state.characterDetails[characterId] : null;

      // Get recent messages
      const messages = conversationId
        ? state.messages
            .filter((m) => m.conversation_id === conversationId)
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
            .slice(-20)
        : [];

      if (!character) {
        return { suggestions: [], metadata: { source: "web", error: "角色未找到" } };
      }

      const res = await fetch(`${base}/api/llm/suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          character,
          messages,
          character_details: characterDetails,
          user_profile: payload.userProfile || null,
          trigger_type: payload.triggerType || "manual",
          previous_suggestions: payload.previousSuggestions || null,
          count: payload.count || 3
        })
      });

      if (!res.ok) {
        return { suggestions: [], metadata: { source: "web", error: `HTTP ${res.status}` } };
      }

      const data = await res.json();
      if (data.skip) {
        return { suggestions: [], skip: true, metadata: { source: "web", ...data.metadata } };
      }

      // Transform suggestions to match desktop format
      const suggestions = (data.suggestions || []).map((s, idx) => ({
        id: `web-${Date.now()}-${idx}`,
        text: s.text,
        affinity_delta: s.affinity_delta,
        tags: s.tags || [],
        timestamp: Date.now()
      }));

      return { suggestions, metadata: { source: "web", ...data.metadata } };
    } catch (error) {
      console.error("[WebAPI] generateLLMSuggestions error:", error);
      return { suggestions: [], metadata: { source: "web", error: error?.message || "unknown" } };
    }
  },

  detectTopicShift: async () => ({ shift: false }),

  selectActionSuggestion: async (payload = {}) => {
    const base = getHttpBase().replace(/\/$/, "");
    if (!base || !payload.suggestion) {
      return { success: false };
    }

    try {
      const res = await fetch(`${base}/api/affinity/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          character: payload.character || {},
          selected_suggestion: payload.suggestion.text || "",
          affinity_delta: payload.suggestion.affinity_delta || 0,
          messages: payload.messages || []
        })
      });

      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}` };
      }

      const data = await res.json();

      // Update local character affinity if successful
      if (data.success && payload.characterId) {
        updateState((state) => {
          const character = state.characters.find((c) => c.id === payload.characterId);
          if (character) {
            character.affinity = data.new_affinity;
            character.updated_at = Date.now();
          }
          return true;
        });
        eventBus.emit("affinity-changed", {
          characterId: payload.characterId,
          previous: data.previous_affinity,
          current: data.new_affinity,
          delta: data.delta
        });
      }

      return { success: data.success, ...data };
    } catch (error) {
      console.error("[WebAPI] selectActionSuggestion error:", error);
      return { success: false, error: error?.message || "unknown" };
    }
  },

  telemetryTrack: async () => ({ ok: true }),

  getAllLLMConfigs: () => clone(loadState().llmConfigs),
  getDefaultLLMConfig: () => {
    const state = loadState();
    return clone(state.llmConfigs.find((item) => item.is_default === 1) || state.llmConfigs[0] || null);
  },
  getLLMConfigById: (id) => {
    const state = loadState();
    return clone(state.llmConfigs.find((item) => item.id === id) || null);
  },
  saveLLMConfig: (configData) => updateState((state) => {
    const now = Date.now();
    const existing = state.llmConfigs.find((item) => item.id === configData?.id || item.name === configData?.name);
    if (configData?.is_default) {
      state.llmConfigs.forEach((item) => {
        item.is_default = 0;
      });
    }
    if (existing) {
      Object.assign(existing, {
        name: configData?.name ?? existing.name,
        api_key: configData?.api_key ?? existing.api_key,
        base_url: configData?.base_url ?? existing.base_url,
        model_name: configData?.model_name ?? configData?.modelName ?? existing.model_name,
        timeout_ms: configData?.timeout_ms ?? existing.timeout_ms,
        is_default: configData?.is_default ? 1 : existing.is_default,
        updated_at: now
      });
      return clone(existing);
    }
    const config = {
      id: configData?.id || generateId("llm"),
      name: configData?.name || "默认配置",
      api_key: configData?.api_key || "",
      base_url: configData?.base_url || null,
      model_name: configData?.model_name || configData?.modelName || "gpt-4o-mini",
      timeout_ms: configData?.timeout_ms ?? null,
      is_default: configData?.is_default ? 1 : 0,
      created_at: now,
      updated_at: now
    };
    state.llmConfigs.push(config);
    return clone(config);
  }),
  deleteLLMConfig: (id) => updateState((state) => {
    const before = state.llmConfigs.length;
    state.llmConfigs = state.llmConfigs.filter((item) => item.id !== id);
    Object.keys(state.llmFeatureConfigs || {}).forEach((feature) => {
      if (state.llmFeatureConfigs[feature] === id) {
        state.llmFeatureConfigs[feature] = null;
      }
    });
    return before !== state.llmConfigs.length;
  }),
  setDefaultLLMConfig: (id) => updateState((state) => {
    state.llmConfigs.forEach((item) => {
      item.is_default = item.id === id ? 1 : 0;
      if (item.id === id) item.updated_at = Date.now();
    });
    return clone(state.llmConfigs.find((item) => item.id === id) || null);
  }),
  getLLMFeatureConfigs: () => clone(loadState().llmFeatureConfigs),
  setLLMFeatureConfig: (feature, llmConfigId) => updateState((state) => {
    state.llmFeatureConfigs = state.llmFeatureConfigs || {};
    state.llmFeatureConfigs[feature] = llmConfigId || null;
    return clone(state.llmFeatureConfigs);
  }),
  testLLMConnection: async () => ({ success: false, message: "Web 端未启用 LLM 测试" }),

  getConversationReview: async () => ({ success: false }),
  generateConversationReview: async () => ({ success: false, error: "Web 端暂不支持复盘" }),
  onReviewProgress: (listener) => eventBus.on("review:progress", listener),

  showHUD: () => {
    console.warn("[WebAPI] HUD is not available in web mode");
  },
  closeHUD: () => {
    console.warn("[WebAPI] HUD is not available in web mode");
  }
};

if (typeof window !== "undefined" && !window.electronAPI) {
  window.electronAPI = webApi;
}

export default webApi;
