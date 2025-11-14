const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 平台信息
  platform: process.platform,

  // IPC通信
  send: (channel, data) => ipcRenderer.send(channel, data),
  on: (channel, callback) => ipcRenderer.on(channel, (event, ...args) => callback(...args)),
  once: (channel, callback) => ipcRenderer.once(channel, (event, ...args) => callback(...args)),
  removeListener: (channel, callback) => ipcRenderer.removeListener(channel, callback),

  // 日志
  log: (message) => ipcRenderer.send('log', message),

  // HUD控制
  showHUD: () => ipcRenderer.send('show-hud'),
  hideHUD: () => ipcRenderer.send('hide-hud'),
  closeHUD: () => ipcRenderer.send('close-hud'),

  // HUD拖拽
  startHUDDrag: (pos) => ipcRenderer.send('start-hud-drag', pos),
  updateHUDDrag: (pos) => ipcRenderer.send('update-hud-drag', pos),
  endHUDDrag: () => ipcRenderer.send('end-hud-drag'),

  // 主窗口控制
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),

  // 窗口拖拽
  startDrag: (pos) => ipcRenderer.send('start-drag', pos),
  updateDrag: (pos) => ipcRenderer.send('update-drag', pos),
  endDrag: () => ipcRenderer.send('end-drag'),

  // 数据库API
  getAllCharacters: () => ipcRenderer.invoke('db-get-all-characters'),
  getCharacterById: (id) => ipcRenderer.invoke('db-get-character-by-id', id),
  createCharacter: (characterData) => ipcRenderer.invoke('db-create-character', characterData),
  getConversationsByCharacter: (characterId) => ipcRenderer.invoke('db-get-conversations-by-character', characterId),
  getMessagesByConversation: (conversationId) => ipcRenderer.invoke('db-get-messages-by-conversation', conversationId),
  getStatistics: () => ipcRenderer.invoke('db-get-statistics'),
  getCharacterPageStatistics: () => ipcRenderer.invoke('db-get-character-page-statistics'),
  getRecentConversations: (limit) => ipcRenderer.invoke('db-get-recent-conversations', limit),
  getAllConversations: () => ipcRenderer.invoke('db-get-all-conversations'),
  updateMessage: (messageId, updates) => ipcRenderer.invoke('db-update-message', messageId, updates),
  getConversationAIData: (conversationId) => ipcRenderer.invoke('db-get-conversation-ai-data', conversationId),
  getCharacterDetails: (characterId) => ipcRenderer.invoke('db-get-character-details', characterId),
  updateCharacterDetailsCustomFields: (characterId, customFields) => ipcRenderer.invoke('db-update-character-details-custom-fields', characterId, customFields),
  regenerateCharacterDetails: (characterId) => ipcRenderer.invoke('db-regenerate-character-details', characterId),

  // LLM配置API
  saveLLMConfig: (configData) => ipcRenderer.invoke('llm-save-config', configData),
  getAllLLMConfigs: () => ipcRenderer.invoke('llm-get-all-configs'),
  getDefaultLLMConfig: () => ipcRenderer.invoke('llm-get-default-config'),
  getLLMConfigById: (id) => ipcRenderer.invoke('llm-get-config-by-id', id),
  deleteLLMConfig: (id) => ipcRenderer.invoke('llm-delete-config', id),
  testLLMConnection: (configData) => ipcRenderer.invoke('llm-test-connection', configData),
  setDefaultLLMConfig: (id) => ipcRenderer.invoke('llm-set-default-config', id)
});

// 监听主进程消息
ipcRenderer.on('window-focused', () => {
  console.log('Window focused');
});

console.log('Preload script loaded successfully');
