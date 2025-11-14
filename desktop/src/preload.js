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

  // 数据库API
  getAllCharacters: () => ipcRenderer.invoke('db-get-all-characters'),
  getCharacterById: (id) => ipcRenderer.invoke('db-get-character-by-id', id),
  createCharacter: (characterData) => ipcRenderer.invoke('db-create-character', characterData),
  getConversationsByCharacter: (characterId) => ipcRenderer.invoke('db-get-conversations-by-character', characterId),
  getMessagesByConversation: (conversationId) => ipcRenderer.invoke('db-get-messages-by-conversation', conversationId),
  getStatistics: () => ipcRenderer.invoke('db-get-statistics'),
  getRecentConversations: (limit) => ipcRenderer.invoke('db-get-recent-conversations', limit),
  getAllConversations: () => ipcRenderer.invoke('db-get-all-conversations')
});

// 监听主进程消息
ipcRenderer.on('window-focused', () => {
  console.log('Window focused');
});

console.log('Preload script loaded successfully');
