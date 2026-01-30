import React, { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import audioCaptureService from '../../asr/audio-capture-service.js';

// Hooks
import { useChatSession } from '../hooks/useChatSession.js';
import { useMessages } from '../hooks/useMessages.js';
import { useSuggestions } from '../hooks/useSuggestions.js';

// Components
import { TranscriptView } from '../components/Chat/TranscriptView.jsx';
import { SuggestionsPanel } from '../components/Chat/SuggestionsPanel.jsx';

/**
 * 声波动画组件
 */
function VoiceWaveform({ isActive }) {
  return (
    <div className="flex items-center gap-[3px] h-8">
      {[...Array(20)].map((_, i) => (
        <div
          key={i}
          className={`w-[3px] rounded-full transition-all duration-150 ${
            isActive ? 'bg-primary' : 'bg-zinc-700'
          }`}
          style={{
            height: isActive ? `${Math.random() * 24 + 8}px` : '4px',
            animationDelay: `${i * 0.05}s`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * 服务状态指示器
 */
function StatusIndicator({ label, status }) {
  const statusConfig = {
    ready: { color: 'bg-emerald-500', textColor: 'text-emerald-400', text: '已就绪' },
    loading: { color: 'bg-amber-500', textColor: 'text-amber-400', text: '连接中...' },
    offline: { color: 'bg-zinc-600', textColor: 'text-zinc-500', text: '离线' },
  };
  const config = statusConfig[status] || statusConfig.offline;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 backdrop-blur-sm border border-white/10">
      <div className={`relative w-2 h-2 rounded-full ${config.color}`}>
        {status === 'ready' && (
          <div className={`absolute inset-0 rounded-full ${config.color} animate-ping opacity-75`} />
        )}
      </div>
      <span className="text-xs text-zinc-400">{label}</span>
      <span className={`text-xs font-medium ${config.textColor}`}>{config.text}</span>
    </div>
  );
}

/**
 * 角色头像组件
 */
function CharacterAvatar({ name, size = 'md' }) {
  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-14 h-14 text-lg',
  };

  const gradients = [
    'from-pink-500 to-rose-500',
    'from-violet-500 to-purple-500',
    'from-blue-500 to-cyan-500',
    'from-emerald-500 to-teal-500',
    'from-amber-500 to-orange-500',
  ];

  const gradientIndex = name ? name.charCodeAt(0) % gradients.length : 0;

  return (
    <div
      className={`${sizeClasses[size]} rounded-full bg-gradient-to-br ${gradients[gradientIndex]} flex items-center justify-center flex-shrink-0 shadow-lg`}
    >
      <span className="text-white font-bold">{name?.slice(0, 1) || '?'}</span>
    </div>
  );
}

/**
 * Web 版实时助手页面 - 响应式三栏布局
 */
export default function LiveAssistant() {
  const [searchParams] = useSearchParams();
  const characterIdFromUrl = searchParams.get('character');
  const conversationIdFromUrl = searchParams.get('conversation');

  const chatSession = useChatSession();
  const messages = useMessages(chatSession.sessionInfo?.conversationId);
  const suggestions = useSuggestions(chatSession.sessionInfo);

  const [micVolumeLevel, setMicVolumeLevel] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [asrStatus, setAsrStatus] = useState({ ready: false, message: '检测中...' });
  const [llmStatus, setLlmStatus] = useState({ ready: false, message: '检测中...' });

  const [characters, setCharacters] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState(characterIdFromUrl || '');
  const [selectedConversationId, setSelectedConversationId] = useState(conversationIdFromUrl || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  
  const messagesEndRef = useRef(null);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.messages]);

  // 初始化检查服务状态
  useEffect(() => {
    const checkServices = async () => {
      const api = window.electronAPI;
      const isElectron = !!(api?.isElectron);
      
      // Web 预览模式：直接设为演示就绪状态
      if (!isElectron) {
        setAsrStatus({ ready: true, message: '演示模式' });
        setLlmStatus({ ready: true, message: '演示模式' });
        return;
      }

      // Electron 桌面端：正常检测服务
      if (!api) return;
      if (api.asrCheckReady) {
        const asr = await api.asrCheckReady();
        setAsrStatus(asr);
      }
      if (api.llmCheckReady) {
        const llm = await api.llmCheckReady();
        setLlmStatus(llm);
      }
    };

    checkServices();
  }, []);

  // 加载角色列表
  useEffect(() => {
    const loadCharacters = async () => {
      const api = window.electronAPI;
      if (!api?.getAllCharacters) return;

      try {
        const chars = await api.getAllCharacters();
        setCharacters(chars || []);
      } catch (err) {
        console.error('加载角色失败:', err);
      }
    };

    loadCharacters();
  }, []);

  // 当选择角色后，加载该角色的对话
  useEffect(() => {
    const loadConversations = async () => {
      if (!selectedCharacterId) {
        setConversations([]);
        return;
      }

      const api = window.electronAPI;
      if (!api?.getConversationsByCharacter) return;

      try {
        const convs = await api.getConversationsByCharacter(selectedCharacterId);
        setConversations(convs || []);
      } catch (err) {
        console.error('加载对话失败:', err);
      }
    };

    loadConversations();
  }, [selectedCharacterId]);

  // 开始会话
  const handleStartSession = async () => {
    if (!selectedCharacterId) return;

    const api = window.electronAPI;
    const character = characters.find((c) => c.id === selectedCharacterId);

    let conversationId = selectedConversationId;
    let conversationName = '新对话';

    if (!conversationId && api?.dbCreateConversation) {
      try {
        const newConv = await api.dbCreateConversation({
          character_id: selectedCharacterId,
          title: `与 ${character?.name || '角色'} 的对话`,
        });
        conversationId = newConv?.id;
        conversationName = newConv?.title || conversationName;
        setSelectedConversationId(conversationId);

        const convs = await api.getConversationsByCharacter(selectedCharacterId);
        setConversations(convs || []);
      } catch (err) {
        console.error('创建对话失败:', err);
        return;
      }
    } else if (conversationId) {
      const conv = conversations.find((c) => c.id === conversationId);
      conversationName = conv?.title || conversationName;
    }

    chatSession.handleSessionSelected({
      characterId: selectedCharacterId,
      characterName: character?.name || '角色',
      conversationId,
      conversationName,
      isNew: !selectedConversationId,
    });
  };

  // 准备音频源
  const prepareAudioSources = async () => {
    const api = window.electronAPI;
    if (!api?.asrGetAudioSources) {
      throw new Error('ASR 音频源接口不可用');
    }

    let audioSources = await api.asrGetAudioSources();
    let speaker1 = audioSources.find((s) => s.id === 'speaker1');

    if (!speaker1 || !speaker1.device_id) {
      const devices = await audioCaptureService.enumerateDevices();
      if (!devices || devices.length === 0) {
        throw new Error('未找到可用麦克风设备');
      }

      const firstDevice = devices[0];
      const payload = {
        id: 'speaker1',
        name: '用户（麦克风）',
        device_id: firstDevice.deviceId,
        device_name: firstDevice.label || firstDevice.deviceId,
        is_active: 1,
      };

      if (speaker1) {
        await api.asrUpdateAudioSource('speaker1', payload);
      } else if (api.asrCreateAudioSource) {
        await api.asrCreateAudioSource(payload);
      }
      speaker1 = payload;
    }

    return { speaker1 };
  };

  // 切换监听状态
  const toggleListening = async () => {
    if (isListening) {
      try {
        await audioCaptureService.stopAllCaptures();
        const api = window.electronAPI;
        if (api?.asrStop) {
          await api.asrStop();
        }
        setIsListening(false);
        setMicVolumeLevel(0);
      } catch (err) {
        console.error('停止监听失败:', err);
      }
      return;
    }

    try {
      const api = window.electronAPI;
      if (!api?.asrStart) {
        chatSession.setError('ASR 服务不可用');
        return;
      }

      const conversationId = chatSession.sessionInfo?.conversationId;
      if (!conversationId) {
        chatSession.setError('请先选择或创建对话');
        return;
      }

      const { speaker1 } = await prepareAudioSources();
      await api.asrStart(conversationId);
      await audioCaptureService.startMicrophoneCapture('speaker1', speaker1.device_id);

      setIsListening(true);
      chatSession.setError('');
    } catch (error) {
      console.error('启动语音识别失败:', error);
      chatSession.setError(`启动语音识别失败：${error.message}`);
    }
  };

  // 监听音量更新
  useEffect(() => {
    const handleVolumeUpdate = ({ sourceId, volume }) => {
      if (sourceId === 'speaker1') {
        setMicVolumeLevel(volume);
      }
    };

    audioCaptureService.on('volume-update', handleVolumeUpdate);
    return () => audioCaptureService.off('volume-update', handleVolumeUpdate);
  }, []);

  // 监听新消息
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.on) return;

    const handleNewMessage = (message) => {
      suggestions.handleNewMessage(message);
    };

    api.on('asr-sentence-complete', handleNewMessage);
    return () => api.removeListener('asr-sentence-complete', handleNewMessage);
  }, [suggestions]);

  // 复制建议
  const handleCopySuggestion = (suggestion) => {
    navigator.clipboard.writeText(suggestion.content || suggestion.title);
    setCopiedId(suggestion.id);
    setTimeout(() => setCopiedId(null), 2000);
    suggestions.handleCopySuggestion(suggestion);
  };

  const filteredCharacters = characters.filter((c) =>
    c.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedCharacter = characters.find((c) => c.id === selectedCharacterId);

  // ========== 选择会话界面 ==========
  if (!chatSession.sessionInfo) {
    return (
      <div className="fixed inset-0 flex overflow-hidden">
        {/* 背景 */}
        <div className="absolute inset-0 z-0 bg-[#0a0a0f]">
          <div 
            className="absolute inset-0"
            style={{
              backgroundImage: 'radial-gradient(ellipse at top, rgba(139,92,246,0.15) 0%, transparent 50%), radial-gradient(ellipse at bottom right, rgba(236,72,153,0.1) 0%, transparent 50%)',
            }}
          />
        </div>

        {/* 左侧：角色选择 */}
        <div className="w-[260px] flex flex-col relative z-10 bg-black/40 backdrop-blur-xl border-r border-white/10">
          <div className="p-4 border-b border-white/10">
            <h2 className="text-sm font-medium text-zinc-400 mb-3">选择角色</h2>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-lg">search</span>
              <input
                type="text"
                placeholder="搜索角色..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredCharacters.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
                  <span className="material-symbols-outlined text-2xl text-zinc-600">person_add</span>
                </div>
                <p className="text-sm text-zinc-500 mb-4">还没有角色</p>
                <Link
                  to="/characters"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary/20 text-primary rounded-xl text-sm font-medium hover:bg-primary/30 transition-colors"
                >
                  <span className="material-symbols-outlined text-lg">add</span>
                  创建角色
                </Link>
              </div>
            ) : (
              filteredCharacters.map((character) => (
                <button
                  key={character.id}
                  onClick={() => {
                    setSelectedCharacterId(character.id);
                    setSelectedConversationId('');
                  }}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition-all duration-200 ${
                    selectedCharacterId === character.id
                      ? 'bg-primary/20 border border-primary/40'
                      : 'hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <CharacterAvatar name={character.name} size="md" />
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-sm font-medium text-white truncate">{character.name}</div>
                    <div className="text-xs text-zinc-500 truncate">{character.relationship_label || '未设置'}</div>
                  </div>
                  {selectedCharacterId === character.id && (
                    <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>

          <div className="p-3 border-t border-white/10">
            <Link
              to="/characters"
              className="w-full flex items-center justify-center gap-2 py-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-xl transition-colors text-sm"
            >
              <span className="material-symbols-outlined text-lg">add</span>
              添加角色
            </Link>
          </div>
        </div>

        {/* 右侧：配置面板 */}
        <div className="flex-1 flex flex-col items-center justify-center relative z-10 p-8 min-w-0">
          <div className="w-full max-w-md">
            {/* Logo & 标题 */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-pink-500 shadow-lg shadow-primary/25 mb-4">
                <span className="material-symbols-outlined text-3xl text-white">mic</span>
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">实时助手</h1>
              <p className="text-zinc-500 text-sm">智能语音识别 · AI 回复建议</p>
            </div>

            {/* 服务状态 */}
            <div className="flex justify-center gap-3 mb-6">
              <StatusIndicator label="语音" status={asrStatus.ready ? 'ready' : 'offline'} />
              <StatusIndicator label="AI" status={llmStatus.ready ? 'ready' : 'offline'} />
            </div>

            {/* 配置卡片 */}
            <div className="p-5 rounded-2xl bg-white/[0.03] backdrop-blur-xl border border-white/[0.06]">
              {selectedCharacter ? (
                <>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 mb-5">
                    <CharacterAvatar name={selectedCharacter.name} size="lg" />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-white truncate">{selectedCharacter.name}</div>
                      <div className="text-sm text-zinc-500 truncate">{selectedCharacter.relationship_label || '未设置'}</div>
                    </div>
                    <button
                      onClick={() => setSelectedCharacterId('')}
                      className="p-1.5 hover:bg-white/10 rounded-lg transition-colors flex-shrink-0"
                    >
                      <span className="material-symbols-outlined text-zinc-500 text-lg">close</span>
                    </button>
                  </div>

                  <div className="mb-5">
                    <label className="block text-sm font-medium text-zinc-400 mb-2">选择对话</label>
                    <select
                      value={selectedConversationId}
                      onChange={(e) => setSelectedConversationId(e.target.value)}
                      className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-primary/50 transition-colors appearance-none cursor-pointer"
                    >
                      <option value="" className="bg-[#1a1a24]">✨ 创建新对话</option>
                      {conversations.map((conv) => (
                        <option key={conv.id} value={conv.id} className="bg-[#1a1a24]">{conv.title || '无标题'}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={handleStartSession}
                    disabled={!asrStatus.ready}
                    className="w-full py-3 bg-gradient-to-r from-primary to-pink-500 text-white rounded-xl font-bold shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 transition-all"
                  >
                    {!asrStatus.ready ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        等待服务...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <span className="material-symbols-outlined text-lg">play_arrow</span>
                        开始对话
                      </span>
                    )}
                  </button>
                </>
              ) : (
                <div className="text-center py-6">
                  <span className="material-symbols-outlined text-4xl text-zinc-600 mb-3">arrow_back</span>
                  <p className="text-zinc-500 text-sm">请从左侧选择一个角色</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ========== 实时助手主界面 ==========
  return (
    <div className="fixed inset-0 flex overflow-hidden">
      {/* 背景 */}
      <div className="absolute inset-0 z-0 bg-[#0a0a0f]">
        <div 
          className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(ellipse at top left, rgba(139,92,246,0.1) 0%, transparent 50%), radial-gradient(ellipse at bottom right, rgba(236,72,153,0.08) 0%, transparent 50%)',
          }}
        />
      </div>

      {/* 左侧：聊天区 */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* 顶部导航栏 */}
        <div className="h-14 flex items-center justify-between px-4 bg-black/30 backdrop-blur-sm border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => {
                if (isListening) {
                  audioCaptureService.stopAllCaptures();
                  window.electronAPI?.asrStop?.();
                }
                chatSession.handleSwitchSession();
              }}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors flex-shrink-0"
            >
              <span className="material-symbols-outlined text-zinc-400 text-xl">arrow_back</span>
            </button>
            <CharacterAvatar name={chatSession.sessionInfo?.characterName} size="sm" />
            <div className="min-w-0">
              <h1 className="font-semibold text-white text-sm truncate flex items-center gap-2">
                {chatSession.sessionInfo?.characterName || '实时助手'}
                {isListening && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full text-xs">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                    监听中
                  </span>
                )}
              </h1>
              <p className="text-xs text-zinc-500 truncate">{chatSession.sessionInfo?.conversationName}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <StatusIndicator label="语音" status={asrStatus.ready ? 'ready' : 'offline'} />
            <StatusIndicator label="AI" status={llmStatus.ready ? 'ready' : 'offline'} />
          </div>
        </div>

        {/* 错误提示 */}
        {chatSession.error && (
          <div className="mx-4 mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2 flex-shrink-0">
            <span className="material-symbols-outlined text-lg">error</span>
            {chatSession.error}
          </div>
        )}

        {/* 消息区 - 关键：flex-1 + overflow-y-auto */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-3xl mx-auto">
            <TranscriptView
              messages={messages.messages}
              loading={messages.loading}
              error={messages.error}
              isListening={isListening}
              isNew={chatSession.sessionInfo?.isNew}
              transcriptRef={messages.transcriptRef}
            />

            {/* 正在监听提示 */}
            {isListening && (
              <div className="flex justify-center py-4">
                <div className="flex items-center gap-4 px-4 py-2 rounded-full bg-white/5 backdrop-blur-sm border border-white/10">
                  <VoiceWaveform isActive={true} />
                  <span className="text-sm text-zinc-400">正在聆听...</span>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 底部控制栏 */}
        <div className="h-20 flex items-center justify-center gap-4 bg-black/40 backdrop-blur-xl border-t border-white/10 flex-shrink-0">
          <button
            className="w-10 h-10 rounded-full flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="清空对话"
          >
            <span className="material-symbols-outlined text-xl">delete</span>
          </button>

          <button
            onClick={toggleListening}
            className={`relative w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 ${
              isListening
                ? 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/30'
                : 'bg-gradient-to-r from-primary to-pink-500 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30'
            }`}
          >
            {isListening && (
              <span className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-30" />
            )}
            <span className="material-symbols-outlined text-xl text-white">
              {isListening ? 'mic_off' : 'mic'}
            </span>
          </button>

          <button
            className="w-10 h-10 rounded-full flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/10 transition-colors"
            title="设置"
          >
            <span className="material-symbols-outlined text-xl">settings</span>
          </button>
        </div>
      </div>

      {/* 右侧：AI 建议 */}
      <div className="w-[320px] flex flex-col relative z-10 bg-black/40 backdrop-blur-xl border-l border-white/10">
        <div className="p-4 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-lg">auto_awesome</span>
              <h2 className="text-sm font-medium text-white">AI 回复建议</h2>
            </div>
            <button
              onClick={() => suggestions.handleGenerateSuggestions({ trigger: 'manual', reason: 'refresh' })}
              disabled={suggestions.suggestionStatus === 'loading'}
              className="p-1.5 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
            >
              <span className={`material-symbols-outlined text-zinc-500 text-lg ${suggestions.suggestionStatus === 'loading' ? 'animate-spin' : ''}`}>
                refresh
              </span>
            </button>
          </div>
        </div>

        {/* 建议列表 - 关键：flex-1 + overflow-y-auto */}
        <div className="flex-1 overflow-y-auto">
          <SuggestionsPanel
            suggestions={suggestions.suggestions}
            suggestionMeta={suggestions.suggestionMeta}
            suggestionStatus={suggestions.suggestionStatus}
            suggestionError={suggestions.suggestionError}
            PASSIVE_REASON_LABEL={suggestions.PASSIVE_REASON_LABEL}
            copiedSuggestionId={copiedId || suggestions.copiedSuggestionId}
            onGenerate={suggestions.handleGenerateSuggestions}
            onCopy={handleCopySuggestion}
            onSelectSuggestion={suggestions.handleSelectSuggestion}
            suggestionConfig={suggestions.suggestionConfig}
            onTogglePassive={(enabled) => suggestions.updateSuggestionConfig({ enable_passive_suggestion: enabled ? 1 : 0 })}
            sessionInfo={chatSession.sessionInfo}
          />
        </div>

        {/* 快捷回复 */}
        <div className="p-4 border-t border-white/10 flex-shrink-0">
          <p className="text-xs text-zinc-500 mb-2">快捷回复</p>
          <div className="flex flex-wrap gap-2">
            {['明白了', '好的', '让我想想', '继续说'].map((text) => (
              <button
                key={text}
                onClick={() => navigator.clipboard.writeText(text)}
                className="px-2.5 py-1 rounded-lg bg-white/5 text-xs text-zinc-400 hover:bg-white/10 hover:text-white transition-colors border border-white/10"
              >
                {text}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
