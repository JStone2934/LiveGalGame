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
 * Web 版实时助手页面 - 现代 SaaS 风格 UI
 */
export default function LiveAssistant() {
  const [searchParams] = useSearchParams();
  const characterIdFromUrl = searchParams.get('character');
  const conversationIdFromUrl = searchParams.get('conversation');

  // 使用自定义 Hooks
  const chatSession = useChatSession();
  const messages = useMessages(chatSession.sessionInfo?.conversationId);
  const suggestions = useSuggestions(chatSession.sessionInfo);

  // 音量检测相关状态
  const [micVolumeLevel, setMicVolumeLevel] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [asrStatus, setAsrStatus] = useState({ ready: false, message: '检测中...' });
  const [llmStatus, setLlmStatus] = useState({ ready: false, message: '检测中...' });

  // 角色和对话选择
  const [characters, setCharacters] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState(characterIdFromUrl || '');
  const [selectedConversationId, setSelectedConversationId] = useState(conversationIdFromUrl || '');

  // 复制反馈
  const [copiedId, setCopiedId] = useState(null);

  // 初始化检查服务状态
  useEffect(() => {
    const checkServices = async () => {
      const api = window.electronAPI;
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
    if (!selectedCharacterId) {
      alert('请先选择一个角色');
      return;
    }

    const api = window.electronAPI;
    const character = characters.find(c => c.id === selectedCharacterId);
    
    let conversationId = selectedConversationId;
    let conversationName = '新对话';

    if (!conversationId && api?.dbCreateConversation) {
      try {
        const newConv = await api.dbCreateConversation({
          character_id: selectedCharacterId,
          title: `与 ${character?.name || '角色'} 的对话`
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
      const conv = conversations.find(c => c.id === conversationId);
      conversationName = conv?.title || conversationName;
    }

    chatSession.handleSessionSelected({
      characterId: selectedCharacterId,
      characterName: character?.name || '角色',
      conversationId,
      conversationName,
      isNew: !selectedConversationId
    });
  };

  // 准备音频源
  const prepareAudioSources = async () => {
    const api = window.electronAPI;
    if (!api?.asrGetAudioSources) {
      throw new Error('ASR 音频源接口不可用');
    }

    let audioSources = await api.asrGetAudioSources();
    let speaker1 = audioSources.find(s => s.id === 'speaker1');

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
        is_active: 1
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

  // ========== 选择会话界面 ==========
  if (!chatSession.sessionInfo) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <div className="max-w-2xl mx-auto px-6 py-12">
          {/* 返回按钮 */}
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-slate-500 hover:text-primary transition-colors mb-8 group"
          >
            <span className="material-symbols-outlined text-xl group-hover:-translate-x-1 transition-transform">arrow_back</span>
            <span>返回首页</span>
          </Link>

          {/* 标题 */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-primary to-purple-600 shadow-lg shadow-primary/25 mb-6">
              <span className="material-symbols-outlined text-4xl text-white">mic</span>
            </div>
            <h1 className="text-4xl font-bold text-slate-800 dark:text-white mb-3">
              实时助手
            </h1>
            <p className="text-slate-500 dark:text-slate-400">
              智能语音识别 · AI 回复建议 · 实时对话辅助
            </p>
          </div>

          {/* 服务状态卡片 */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className={`p-4 rounded-2xl border-2 transition-all ${
              asrStatus.ready 
                ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20' 
                : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
            }`}>
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-3 h-3 rounded-full ${asrStatus.ready ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                <span className="font-semibold text-slate-700 dark:text-slate-200">语音识别</span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400">{asrStatus.message}</p>
            </div>

            <div className={`p-4 rounded-2xl border-2 transition-all ${
              llmStatus.ready 
                ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20' 
                : 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20'
            }`}>
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-3 h-3 rounded-full ${llmStatus.ready ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`} />
                <span className="font-semibold text-slate-700 dark:text-slate-200">AI 建议</span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400">{llmStatus.message}</p>
            </div>
          </div>

          {/* 选择表单 */}
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none p-8">
            {/* 角色选择 */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">
                选择角色
              </label>
              {characters.length === 0 ? (
                <div className="p-8 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl text-center">
                  <span className="material-symbols-outlined text-4xl text-slate-300 dark:text-slate-600 mb-3">person_add</span>
                  <p className="text-slate-500 dark:text-slate-400 mb-4">还没有创建角色</p>
                  <Link
                    to="/characters"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-colors"
                  >
                    <span className="material-symbols-outlined text-lg">add</span>
                    创建角色
                  </Link>
                </div>
              ) : (
                <select
                  value={selectedCharacterId}
                  onChange={(e) => {
                    setSelectedCharacterId(e.target.value);
                    setSelectedConversationId('');
                  }}
                  className="w-full px-5 py-4 border-2 border-slate-200 dark:border-slate-700 rounded-2xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all text-lg"
                >
                  <option value="">请选择角色...</option>
                  {characters.map(char => (
                    <option key={char.id} value={char.id}>
                      {char.name} {char.relationship_label ? `(${char.relationship_label})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* 对话选择 */}
            {selectedCharacterId && (
              <div className="mb-8">
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">
                  选择对话 <span className="font-normal text-slate-400">(可选)</span>
                </label>
                <select
                  value={selectedConversationId}
                  onChange={(e) => setSelectedConversationId(e.target.value)}
                  className="w-full px-5 py-4 border-2 border-slate-200 dark:border-slate-700 rounded-2xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all"
                >
                  <option value="">✨ 创建新对话</option>
                  {conversations.map(conv => (
                    <option key={conv.id} value={conv.id}>
                      {conv.title || '无标题对话'}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 开始按钮 */}
            <button
              onClick={handleStartSession}
              disabled={!selectedCharacterId || !asrStatus.ready}
              className="w-full py-5 bg-gradient-to-r from-primary to-purple-600 text-white rounded-2xl font-bold text-lg shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-lg transition-all"
            >
              {!asrStatus.ready ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  等待服务就绪...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined">play_arrow</span>
                  开始实时对话
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ========== 实时助手主界面 ==========
  const micVolumePercent = Math.min(100, Math.max(0, Math.round((micVolumeLevel || 0) * 100)));

  return (
    <div className="h-screen flex flex-col bg-slate-50 dark:bg-slate-900">
      {/* 顶部导航栏 */}
      <header className="flex-shrink-0 px-6 py-4 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                if (isListening) {
                  audioCaptureService.stopAllCaptures();
                  window.electronAPI?.asrStop?.();
                }
                chatSession.handleSwitchSession();
              }}
              className="p-2.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors"
              title="返回"
            >
              <span className="material-symbols-outlined text-slate-600 dark:text-slate-300">arrow_back</span>
            </button>
            <div>
              <h1 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                {chatSession.sessionInfo?.characterName || '实时助手'}
                {isListening && (
                  <span className="flex items-center gap-1.5 px-2.5 py-1 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-full text-xs font-medium">
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    监听中
                  </span>
                )}
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {chatSession.sessionInfo?.conversationName || '对话进行中'}
              </p>
            </div>
          </div>

          {/* 音量指示器 */}
          {isListening && (
            <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-xl">
              <span className="material-symbols-outlined text-slate-500">mic</span>
              <div className="w-32 h-2 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-400 to-green-500 transition-all duration-75"
                  style={{ width: `${micVolumePercent}%` }}
                />
              </div>
              <span className="text-xs font-mono text-slate-500 w-8">{micVolumePercent}%</span>
            </div>
          )}
        </div>
      </header>

      {/* 错误提示 */}
      {chatSession.error && (
        <div className="mx-6 mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm flex items-center gap-3">
          <span className="material-symbols-outlined">error</span>
          {chatSession.error}
        </div>
      )}

      {/* 主内容区 */}
      <main className="flex-1 overflow-hidden p-4 md:p-6">
        <div className="max-w-6xl mx-auto h-full grid grid-cols-1 lg:grid-cols-5 gap-4 md:gap-6">
          {/* 对话记录 - 占 3 列 */}
          <div className="lg:col-span-3 flex flex-col bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="flex-shrink-0 px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-800 dark:text-white">对话记录</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {messages.messages?.length || 0} 条消息
                </p>
              </div>
              {isListening && (
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {[...Array(4)].map((_, i) => (
                      <div
                        key={i}
                        className="w-1 bg-green-500 rounded-full animate-pulse"
                        style={{
                          height: `${8 + Math.random() * 12}px`,
                          animationDelay: `${i * 0.1}s`
                        }}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-green-500 font-medium">正在监听</span>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-auto p-4">
              <TranscriptView
                messages={messages.messages}
                loading={messages.loading}
                error={messages.error}
                isListening={isListening}
                isNew={chatSession.sessionInfo?.isNew}
                transcriptRef={messages.transcriptRef}
              />
            </div>
          </div>

          {/* AI 建议 - 占 2 列 */}
          <div className="lg:col-span-2 flex flex-col bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="flex-shrink-0 px-5 py-4 border-b border-slate-100 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">auto_awesome</span>
                    AI 建议
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {llmStatus.model || '智能回复建议'}
                  </p>
                </div>
                <button
                  onClick={() => suggestions.handleGenerateSuggestions({ trigger: 'manual', reason: 'refresh' })}
                  disabled={suggestions.suggestionStatus === 'loading'}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
                  title="刷新建议"
                >
                  <span className={`material-symbols-outlined text-slate-500 ${suggestions.suggestionStatus === 'loading' ? 'animate-spin' : ''}`}>
                    refresh
                  </span>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
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
          </div>
        </div>
      </main>

      {/* 底部麦克风控制栏 */}
      <footer className="flex-shrink-0 px-6 py-5 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
        <div className="max-w-6xl mx-auto flex items-center justify-center">
          <button
            onClick={toggleListening}
            className={`group relative flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-lg transition-all ${
              isListening
                ? 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg shadow-red-500/25 hover:shadow-xl hover:shadow-red-500/30'
                : 'bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/25 hover:shadow-xl hover:shadow-green-500/30'
            } hover:-translate-y-0.5`}
          >
            {/* 脉冲动画背景 */}
            {isListening && (
              <span className="absolute inset-0 rounded-2xl bg-red-500 animate-ping opacity-20" />
            )}
            
            <span className="material-symbols-outlined text-2xl">
              {isListening ? 'stop_circle' : 'mic'}
            </span>
            <span>{isListening ? '停止监听' : '开始监听'}</span>
            
            {/* 快捷键提示 */}
            <kbd className="hidden md:inline-block ml-2 px-2 py-0.5 bg-white/20 rounded text-sm font-mono">
              Space
            </kbd>
          </button>
        </div>
      </footer>
    </div>
  );
}
