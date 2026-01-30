/**
 * 转录视图组件 - 深色主题
 */

import React from 'react';

export const TranscriptView = ({
  messages,
  loading,
  error,
  isListening,
  isNew,
  transcriptRef
}) => {
  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-4" />
          <p className="text-sm text-zinc-500">加载中...</p>
        </div>
      );
    }

    if (error) {
      const isSystemAudioError = error.includes('系统音频捕获失败');

      return (
        <div className={`p-4 rounded-xl border ${
          isSystemAudioError 
            ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' 
            : 'bg-red-500/10 border-red-500/20 text-red-400'
        }`}>
          <p className="text-sm whitespace-pre-line">
            {isSystemAudioError ? '⚠️ ' : '❌ '}{error}
          </p>
        </div>
      );
    }

    if (!messages.length) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
            <span className="material-symbols-outlined text-3xl text-zinc-600">
              {isListening ? 'chat_bubble' : 'mic_off'}
            </span>
          </div>
          <p className="text-sm text-zinc-500">
            {isListening 
              ? (isNew ? '新对话，开始聊天吧！' : '该对话还没有消息') 
              : '点击下方麦克风按钮开始监听'
            }
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {messages.map((msg, index) => {
          const isUser = msg.sender === 'user';
          const key = msg.id ?? `${msg.sender}-${msg.timestamp ?? index}`;
          
          return (
            <div 
              className={`flex ${isUser ? 'justify-end' : 'justify-start'}`} 
              key={key}
            >
              <div 
                className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                  isUser 
                    ? 'bg-gradient-to-r from-primary to-pink-500 text-white rounded-br-md' 
                    : 'bg-white/[0.08] text-zinc-200 border border-white/10 rounded-bl-md'
                }`}
              >
                {/* 发言者标签 */}
                <div className={`text-xs mb-1 ${isUser ? 'text-white/70' : 'text-zinc-500'}`}>
                  {isUser ? '你' : (msg.sender_name || '对方')}
                </div>
                {/* 消息内容 */}
                <p className="text-sm leading-relaxed">
                  {msg.content || msg.text || ''}
                </p>
                {/* 时间戳 */}
                {msg.timestamp && (
                  <div className={`text-[10px] mt-1.5 ${isUser ? 'text-white/50' : 'text-zinc-600'}`}>
                    {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="h-full" ref={transcriptRef}>
      {renderContent()}
    </div>
  );
};
