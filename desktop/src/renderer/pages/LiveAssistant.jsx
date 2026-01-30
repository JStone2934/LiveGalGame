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
 * Web 版实时助手页面
 * 替代桌面端的独立 HUD 窗口，在网页内直接展示
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

  // 初始化检查服务状态
  useEffect(() => {
    const checkServices = async () => {
      const api = window.electronAPI;
      if (!api) return;

      // 检查 ASR
      if (api.asrCheckReady) {
        const asr = await api.asrCheckReady();
        setAsrStatus(asr);
      }

      // 检查 LLM
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

    // 如果没有选择对话，创建新对话
    if (!conversationId && api?.dbCreateConversation) {
      try {
        const newConv = await api.dbCreateConversation({
          character_id: selectedCharacterId,
          title: `与 ${character?.name || '角色'} 的对话`
        });
        conversationId = newConv?.id;
        conversationName = newConv?.title || conversationName;
        setSelectedConversationId(conversationId);
        
        // 刷新对话列表
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

    // 设置会话信息
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

    // 若未配置麦克风，枚举设备并写入
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
      // 停止监听
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

    // 开始监听
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

      // 通知后端开始 ASR
      await api.asrStart(conversationId);

      // 开始麦克风捕获
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

    return () => {
      audioCaptureService.off('volume-update', handleVolumeUpdate);
    };
  }, []);

  // 监听新消息，触发建议生成
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.on) return;

    const handleNewMessage = (message) => {
      suggestions.handleNewMessage(message);
    };

    api.on('asr-sentence-complete', handleNewMessage);

    return () => {
      api.removeListener('asr-sentence-complete', handleNewMessage);
    };
  }, [suggestions]);

  // 未选择会话时，显示选择界面
  if (!chatSession.sessionInfo) {
    return (
      <div className="p-8">
        <div className="mx-auto max-w-3xl">
          {/* 返回按钮 */}
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-text-muted-light dark:text-text-muted-dark hover:text-primary mb-6"
          >
            <span className="material-symbols-outlined text-xl">arrow_back</span>
            返回首页
          </Link>

          <h1 className="text-3xl font-bold text-text-light dark:text-text-dark mb-8">
            🎙️ 实时助手
          </h1>

          {/* 服务状态 */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className={`p-4 rounded-xl border ${asrStatus.ready ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-red-500 bg-red-50 dark:bg-red-900/20'}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full ${asrStatus.ready ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="font-medium text-text-light dark:text-text-dark">语音识别 (ASR)</span>
              </div>
              <p className="text-sm text-text-muted-light dark:text-text-muted-dark">{asrStatus.message}</p>
              {asrStatus.engine && <p className="text-xs text-text-muted-light dark:text-text-muted-dark">引擎: {asrStatus.engine}</p>}
            </div>

            <div className={`p-4 rounded-xl border ${llmStatus.ready ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-red-500 bg-red-50 dark:bg-red-900/20'}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full ${llmStatus.ready ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="font-medium text-text-light dark:text-text-dark">AI 建议 (LLM)</span>
              </div>
              <p className="text-sm text-text-muted-light dark:text-text-muted-dark">{llmStatus.message}</p>
              {llmStatus.model && <p className="text-xs text-text-muted-light dark:text-text-muted-dark">模型: {llmStatus.model}</p>}
            </div>
          </div>

          {/* 角色选择 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-text-light dark:text-text-dark mb-2">
              选择角色
            </label>
            {characters.length === 0 ? (
              <div className="p-4 border border-dashed border-border-light dark:border-border-dark rounded-xl text-center">
                <p className="text-text-muted-light dark:text-text-muted-dark mb-3">还没有角色</p>
                <Link
                  to="/characters"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-full text-sm font-medium hover:opacity-90"
                >
                  <span className="material-symbols-outlined text-base">add</span>
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
                className="w-full px-4 py-3 border border-border-light dark:border-border-dark rounded-xl bg-surface-light dark:bg-surface-dark text-text-light dark:text-text-dark focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">-- 请选择角色 --</option>
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
              <label className="block text-sm font-medium text-text-light dark:text-text-dark mb-2">
                选择对话（可选，留空则创建新对话）
              </label>
              <select
                value={selectedConversationId}
                onChange={(e) => setSelectedConversationId(e.target.value)}
                className="w-full px-4 py-3 border border-border-light dark:border-border-dark rounded-xl bg-surface-light dark:bg-surface-dark text-text-light dark:text-text-dark focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">➕ 创建新对话</option>
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
            className="w-full py-4 bg-primary text-white rounded-xl font-bold text-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {!asrStatus.ready ? '等待服务就绪...' : '开始实时对话'}
          </button>
        </div>
      </div>
    );
  }

  // 已选择会话，显示实时助手界面
  const micVolumePercent = Math.min(100, Math.max(0, Math.round((micVolumeLevel || 0) * 100)));

  return (
    <div className="p-4 md:p-8 h-full flex flex-col">
      <div className="mx-auto max-w-4xl w-full flex-1 flex flex-col">
        {/* 顶部栏 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                if (isListening) {
                  audioCaptureService.stopAllCaptures();
                  window.electronAPI?.asrStop?.();
                }
                chatSession.handleSwitchSession();
              }}
              className="p-2 hover:bg-surface-light dark:hover:bg-surface-dark rounded-lg transition-colors"
              title="切换会话"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
            <div>
              <h1 className="text-xl font-bold text-text-light dark:text-text-dark">
                {chatSession.sessionInfo?.characterName || '实时助手'}
              </h1>
              <p className="text-sm text-text-muted-light dark:text-text-muted-dark">
                {chatSession.sessionInfo?.conversationName || '对话中'}
              </p>
            </div>
          </div>

          {/* 监听控制 */}
          <div className="flex items-center gap-4">
            {/* 音量指示 */}
            {isListening && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted-light dark:text-text-muted-dark">麦克风</span>
                <div className="w-20 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 transition-all duration-100"
                    style={{ width: `${micVolumePercent}%` }}
                  />
                </div>
              </div>
            )}

            {/* 监听按钮 */}
            <button
              onClick={toggleListening}
              className={`flex items-center gap-2 px-6 py-3 rounded-full font-bold transition-all ${
                isListening
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : 'bg-green-500 text-white hover:bg-green-600'
              }`}
            >
              <span className="material-symbols-outlined">
                {isListening ? 'stop' : 'mic'}
              </span>
              {isListening ? '停止监听' : '开始监听'}
            </button>
          </div>
        </div>

        {/* 错误提示 */}
        {chatSession.error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg text-red-700 dark:text-red-300 text-sm">
            {chatSession.error}
          </div>
        )}

        {/* 主内容区 */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">
          {/* 对话记录 */}
          <div className="flex flex-col border border-border-light dark:border-border-dark rounded-xl bg-surface-light dark:bg-surface-dark overflow-hidden">
            <div className="px-4 py-3 border-b border-border-light dark:border-border-dark">
              <h2 className="font-medium text-text-light dark:text-text-dark">对话记录</h2>
              <p className="text-xs text-text-muted-light dark:text-text-muted-dark">
                {isListening ? '正在监听中...' : '点击"开始监听"捕获语音'}
              </p>
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

          {/* AI 建议 */}
          <div className="flex flex-col border border-border-light dark:border-border-dark rounded-xl bg-surface-light dark:bg-surface-dark overflow-hidden">
            <div className="px-4 py-3 border-b border-border-light dark:border-border-dark">
              <h2 className="font-medium text-text-light dark:text-text-dark">AI 回复建议</h2>
              <p className="text-xs text-text-muted-light dark:text-text-muted-dark">
                {llmStatus.model ? `模型: ${llmStatus.model}` : '基于对话内容生成建议'}
              </p>
            </div>
            <div className="flex-1 overflow-auto">
              <SuggestionsPanel
                suggestions={suggestions.suggestions}
                suggestionMeta={suggestions.suggestionMeta}
                suggestionStatus={suggestions.suggestionStatus}
                suggestionError={suggestions.suggestionError}
                PASSIVE_REASON_LABEL={suggestions.PASSIVE_REASON_LABEL}
                copiedSuggestionId={suggestions.copiedSuggestionId}
                onGenerate={suggestions.handleGenerateSuggestions}
                onCopy={suggestions.handleCopySuggestion}
                onSelectSuggestion={suggestions.handleSelectSuggestion}
                suggestionConfig={suggestions.suggestionConfig}
                onTogglePassive={(enabled) => suggestions.updateSuggestionConfig({ enable_passive_suggestion: enabled ? 1 : 0 })}
                sessionInfo={chatSession.sessionInfo}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
