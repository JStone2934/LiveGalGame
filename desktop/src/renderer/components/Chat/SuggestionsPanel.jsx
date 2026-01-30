/**
 * 建议面板组件 - 深色主题
 */

import React from 'react';

export const SuggestionsPanel = ({
  suggestions,
  suggestionMeta,
  suggestionStatus,
  suggestionError,
  PASSIVE_REASON_LABEL,
  copiedSuggestionId,
  onGenerate,
  onCopy,
  onSelectSuggestion,
  suggestionConfig,
  onTogglePassive,
  sessionInfo
}) => {
  const isStreaming = suggestionStatus === 'streaming';
  const expectedCount = suggestionMeta?.expectedCount || null;
  const generatedCount = suggestions.length;
  const passiveEnabled = Boolean(suggestionConfig?.enable_passive_suggestion);

  return (
    <div className="p-4 space-y-4">
      {/* 控制栏 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {typeof onTogglePassive === 'function' && (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div className={`relative w-9 h-5 rounded-full transition-colors ${passiveEnabled ? 'bg-primary' : 'bg-zinc-700'}`}>
              <input
                type="checkbox"
                checked={passiveEnabled}
                onChange={(e) => onTogglePassive(e.target.checked)}
                className="sr-only"
              />
              <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${passiveEnabled ? 'translate-x-4' : ''}`} />
            </div>
            <span className="text-xs text-zinc-400">{passiveEnabled ? '自动触发' : '手动触发'}</span>
          </label>
        )}
        
        <div className="flex items-center gap-2">
          {suggestionMeta?.reason && (
            <span className="px-2 py-1 rounded-md bg-primary/20 text-primary text-xs">
              {PASSIVE_REASON_LABEL[suggestionMeta.reason] || '自动触发'}
            </span>
          )}
          {isStreaming && (
            <span className="px-2 py-1 rounded-md bg-emerald-500/20 text-emerald-400 text-xs flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              生成中 {generatedCount}{expectedCount ? `/${expectedCount}` : ''}
            </span>
          )}
        </div>
      </div>

      {/* 错误提示 */}
      {suggestionError && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
          {suggestionError}
        </div>
      )}

      {/* 建议列表 */}
      <div className="space-y-3">
        {suggestionStatus === 'loading' && (
          <div className="flex flex-col items-center py-8">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-3" />
            <p className="text-sm text-zinc-500">正在生成个性化建议…</p>
          </div>
        )}

        {isStreaming && generatedCount === 0 && (
          <div className="flex flex-col items-center py-8">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-3" />
            <p className="text-sm text-zinc-500">正在流式生成，请稍候…</p>
          </div>
        )}

        {!isStreaming && suggestionStatus !== 'loading' && suggestions.length === 0 && (
          <div className="flex flex-col items-center py-8 text-center">
            <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-3">
              <span className="material-symbols-outlined text-2xl text-zinc-600">lightbulb</span>
            </div>
            <p className="text-sm text-zinc-500">暂无建议</p>
            <p className="text-xs text-zinc-600 mt-1">点击刷新按钮或等待系统自动推荐</p>
          </div>
        )}

        {suggestions.map((suggestion) => {
          const showCombined = !suggestion.content || suggestion.title === suggestion.content;
          const mainText = suggestion.content || suggestion.title;
          const isCopied = copiedSuggestionId === suggestion.id;
          
          return (
            <article
              className={`relative p-4 rounded-xl cursor-pointer transition-all duration-200 border ${
                suggestion.is_selected 
                  ? 'bg-primary/20 border-primary/40' 
                  : isCopied 
                    ? 'bg-emerald-500/20 border-emerald-500/40' 
                    : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06] hover:border-white/20'
              }`}
              key={suggestion.id}
              role="button"
              tabIndex={0}
              title="点击复制到剪贴板"
              onClick={() => onCopy?.(suggestion)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onCopy?.(suggestion);
                }
              }}
            >
              {/* 已选中标记 */}
              {suggestion.is_selected && (
                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                  <span className="text-white text-xs">✓</span>
                </div>
              )}

              {/* 复制成功反馈 */}
              {isCopied && (
                <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-emerald-500 text-white text-xs">
                  已复制
                </div>
              )}

              {showCombined ? (
                <p className="text-sm text-zinc-200 leading-relaxed pr-12">{mainText}</p>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <strong className="text-sm text-white">{suggestion.title}</strong>
                    {suggestion.tags?.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {suggestion.tags.map((tag) => (
                          <span 
                            className="px-1.5 py-0.5 rounded text-[10px] bg-white/10 text-zinc-400" 
                            key={`${suggestion.id}-${tag}`}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-zinc-300 leading-relaxed">{suggestion.content}</p>
                </>
              )}

              {/* 标签 (仅展示模式) */}
              {showCombined && suggestion.tags?.length > 0 && (
                <div className="flex gap-1 flex-wrap mt-2">
                  {suggestion.tags.map((tag) => (
                    <span 
                      className="px-1.5 py-0.5 rounded text-[10px] bg-white/10 text-zinc-400" 
                      key={`${suggestion.id}-${tag}`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* 亲和度预测 */}
              {typeof suggestion.affinity_prediction === 'number' && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-zinc-500">接受度</span>
                  <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all ${
                        suggestion.affinity_prediction >= 8 ? 'bg-emerald-500' :
                        suggestion.affinity_prediction >= 6 ? 'bg-blue-500' :
                        suggestion.affinity_prediction >= 4 ? 'bg-amber-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${suggestion.affinity_prediction * 10}%` }}
                    />
                  </div>
                  <span className={`text-xs font-medium ${
                    suggestion.affinity_prediction >= 8 ? 'text-emerald-400' :
                    suggestion.affinity_prediction >= 6 ? 'text-blue-400' :
                    suggestion.affinity_prediction >= 4 ? 'text-amber-400' : 'text-red-400'
                  }`}>
                    {suggestion.affinity_prediction}
                  </span>
                </div>
              )}

              {/* 采用按钮 */}
              {!suggestion.is_selected && (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg bg-primary/20 text-primary text-xs font-medium hover:bg-primary/30 transition-colors"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onSelectSuggestion?.(suggestion, true);
                    }}
                    title="确认采用该建议"
                  >
                    采用
                  </button>
                </div>
              )}
            </article>
          );
        })}

        {/* 流式生成中的占位 */}
        {isStreaming && generatedCount > 0 && (!expectedCount || generatedCount < expectedCount) && (
          <div className="flex items-center justify-center py-4 gap-2">
            <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-xs text-zinc-500">继续生成中…</span>
          </div>
        )}
      </div>

      {/* 换一批按钮 */}
      {suggestions.length > 0 && !isStreaming && suggestionStatus !== 'loading' && (
        <button
          className="w-full py-2.5 rounded-xl bg-white/5 border border-white/10 text-zinc-400 text-sm font-medium hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
          onClick={() => onGenerate({ trigger: 'manual', reason: 'refresh' })}
          disabled={suggestionStatus === 'loading' || suggestionStatus === 'streaming'}
        >
          🔄 换一批
        </button>
      )}
    </div>
  );
};
