
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useConversationReview } from '../../hooks/useConversationReview.js';

export default function ReviewSection({ conversationId, onReviewGenerated }) {
    const { review, isLoading, progress, generate } = useConversationReview(conversationId);
    const navigate = useNavigate();

    if (isLoading) {
        const hint = progress?.message || '正在生成复盘分析...';
        return (
            <div className="rounded-2xl border border-border-light bg-surface-light p-4 shadow-sm dark:border-border-dark dark:bg-surface-dark flex items-center justify-center py-8">
                <div className="flex flex-col items-center">
                    <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary mb-2"></div>
                    <p className="text-sm text-text-muted-light dark:text-text-muted-dark">{hint}</p>
                </div>
            </div>
        );
    }

    if (!review) {
        return (
            <div className="rounded-2xl border border-border-light bg-surface-light p-4 shadow-sm dark:border-border-dark dark:bg-surface-dark">
                <div className="flex items-center gap-2 text-sm font-semibold text-text-light dark:text-text-dark mb-3">
                    <span className="material-symbols-outlined text-primary">history_edu</span>
                    剧情复盘
                </div>
                <p className="text-sm text-text-muted-light dark:text-text-muted-dark mb-4">
                    点击生成复盘，回顾关键决策点，探索"如果当时..."的可能性。
                </p>
                <button
                    onClick={async () => {
                        await generate();
                        if (onReviewGenerated) onReviewGenerated();
                    }}
                    className="w-full py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
                >
                    生成复盘
                </button>
            </div>
        );
    }

    const { summary, has_nodes } = review;
    const hasNodes = !!has_nodes;
    const chatOverview = summary.chat_overview || summary.conversation_summary;
    const selfEvaluation = summary.self_evaluation;
    const performanceEval = summary.performance_evaluation || {};
    const expressionAbility = performanceEval.expression_ability || {};
    const topicSelection = performanceEval.topic_selection || {};
    const tags = summary.tags || [];
    const attitudeAnalysis = summary.attitude_analysis || "";

    return (
        <div className="rounded-2xl border border-border-light bg-surface-light p-4 shadow-sm dark:border-border-dark dark:bg-surface-dark">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-text-light dark:text-text-dark">
                    <span className="material-symbols-outlined text-primary">history_edu</span>
                    剧情复盘
                </div>

                {hasNodes ? (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={async () => {
                                await generate();
                                if (onReviewGenerated) onReviewGenerated();
                            }}
                            className="p-1 text-text-muted-light dark:text-text-muted-dark hover:text-primary transition-colors rounded hover:bg-surface-light dark:hover:bg-surface-dark/50"
                            title="重新生成复盘"
                        >
                            <span className="material-symbols-outlined text-sm">refresh</span>
                        </button>
                        {has_nodes && (
                            <button
                                onClick={() => navigate(`/review/${conversationId}`)}
                                className="text-xs text-primary hover:underline flex items-center"
                            >
                                查看剧情树 <span className="material-symbols-outlined text-sm">chevron_right</span>
                            </button>
                        )}
                    </div>
                ) : (
                    <button
                        onClick={async () => {
                            await generate();
                            if (onReviewGenerated) onReviewGenerated();
                        }}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
                    >
                        <span className="material-symbols-outlined text-base">auto_awesome</span>
                        生成剧情复盘
                    </button>
                )}
            </div>

            <div className="space-y-2 mb-3">
                <div className="flex items-center justify-between text-xs text-text-muted-light dark:text-text-muted-dark">
                    <span>关键节点: {summary.node_count || 0}</span>
                    <span>命中建议: {summary.matched_count || 0}</span>
                </div>
                {summary.total_affinity_change !== undefined && summary.total_affinity_change !== null && (
                    <div className="flex items-center justify-between text-xs text-text-muted-light dark:text-text-muted-dark">
                        <span>平均接受度:</span>
                        <span className={
                            summary.total_affinity_change >= 8 ? 'text-green-500' :
                            summary.total_affinity_change >= 6 ? 'text-blue-500' :
                            summary.total_affinity_change >= 4 ? 'text-yellow-500' : 'text-red-500'
                        }>
                            {summary.total_affinity_change}/10
                        </span>
                    </div>
                )}
            </div>

            <div className="space-y-3">
                {/* 用户表现评价 - 评分卡片 */}
                {(expressionAbility.score !== null || topicSelection.score !== null || selfEvaluation) && (
                    <div className="space-y-2">
                        {(expressionAbility.score !== null || topicSelection.score !== null) && (
                            <div className="grid grid-cols-2 gap-2">
                                {expressionAbility.score !== null && (
                                    <div className="rounded-xl bg-white/60 dark:bg-white/5 p-3 border border-border-light/60 dark:border-border-dark/60">
                                        <div className="flex items-center justify-between mb-1">
                                            <p className="text-xs text-text-muted-light dark:text-text-muted-dark">表述能力</p>
                                            <span className="text-xs font-semibold text-primary">{expressionAbility.score}分</span>
                                        </div>
                                        {expressionAbility.description && (
                                            <p className="text-xs text-text-light dark:text-text-dark leading-relaxed">{expressionAbility.description}</p>
                                        )}
                                    </div>
                                )}
                                {topicSelection.score !== null && (
                                    <div className="rounded-xl bg-white/60 dark:bg-white/5 p-3 border border-border-light/60 dark:border-border-dark/60">
                                        <div className="flex items-center justify-between mb-1">
                                            <p className="text-xs text-text-muted-light dark:text-text-muted-dark">话题选择</p>
                                            <span className="text-xs font-semibold text-primary">{topicSelection.score}分</span>
                                        </div>
                                        {topicSelection.description && (
                                            <p className="text-xs text-text-light dark:text-text-dark leading-relaxed">{topicSelection.description}</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                        {selfEvaluation && (
                            <div className="rounded-xl bg-white/60 dark:bg-white/5 p-3 border border-border-light/60 dark:border-border-dark/60">
                                <p className="text-xs text-text-muted-light dark:text-text-muted-dark mb-1">整体表现评价</p>
                                <p className="text-sm text-text-light dark:text-text-dark leading-relaxed">{selfEvaluation}</p>
                            </div>
                        )}
                    </div>
                )}
                {/* 聊天概要 */}
                {chatOverview && (
                    <div className="rounded-xl bg-white/60 dark:bg-white/5 p-3 border border-border-light/60 dark:border-border-dark/60">
                        <p className="text-xs text-text-muted-light dark:text-text-muted-dark mb-1">聊天概要</p>
                        <p className="text-sm text-text-light dark:text-text-dark leading-relaxed">{chatOverview}</p>
                    </div>
                )}

                {/* 标签 Tags */}
                {tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {tags.map((tag, i) => (
                            <span key={i} className="px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium">
                                {tag}
                            </span>
                        ))}
                    </div>
                )}

                {/* 对象态度分析 */}
                {attitudeAnalysis && (
                    <div className="rounded-xl bg-white/60 dark:bg-white/5 p-3 border border-border-light/60 dark:border-border-dark/60">
                        <p className="text-xs text-text-muted-light dark:text-text-muted-dark mb-1">对象态度分析</p>
                        <p className="text-sm text-text-light dark:text-text-dark leading-relaxed">{attitudeAnalysis}</p>
                    </div>
                )}
            </div>

        </div>
    );
}
