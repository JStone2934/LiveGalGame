import { renderPromptTemplate } from './prompt-manager.js';

const DEFAULT_REVIEW_TIMEOUT_MS = 1000 * 20;

export default class ReviewService {
    constructor(dbGetter) {
        this.dbGetter = dbGetter;
        this.clientPool = {};
        this.clientConfigSignature = null; // 保留兼容字段
        this.currentLLMConfig = null;
        this.currentLLMFeature = 'review';

        // 复盘输入规模控制（避免超长对话导致上下文爆炸）
        this.MAX_NODES = 999; // 移除限制
        this.MAX_MESSAGES = 99999; // 移除限制
        this.MAX_OPTIONS_PER_NODE = 6;
        // 粗略 token 上限（经验值）：超出会触发更激进裁剪
        this.MAX_PROMPT_TOKENS_EST = 180000; // 按 200k 来，留一些 buffer
    }

    get db() {
        const db = this.dbGetter?.();
        if (!db) {
            throw new Error('Database is not initialized');
        }
        return db;
    }

    async ensureClient(feature = 'review') {
        const featureKey = typeof feature === 'string' && feature.trim() ? feature.trim().toLowerCase() : 'review';
        const llmConfig =
            (this.db.getLLMConfigForFeature && this.db.getLLMConfigForFeature(featureKey)) ||
            this.db.getDefaultLLMConfig();
        if (!llmConfig) {
            throw new Error('未找到默认LLM配置，请先在设置中配置。');
        }

        const signature = `${featureKey}:${llmConfig.id || 'unknown'}-${llmConfig.updated_at || 0}`;
        const cached = this.clientPool[featureKey];
        if (!cached || cached.signature !== signature) {
            const { default: OpenAI } = await import('openai');
            const clientConfig = { apiKey: llmConfig.api_key };
            if (llmConfig.base_url) {
                // Remove trailing '/chat/completions' if present
                const baseURL = llmConfig.base_url.replace(/\/chat\/completions\/?$/, '');
                clientConfig.baseURL = baseURL;
            }
            this.clientPool[featureKey] = {
                client: new OpenAI(clientConfig),
                signature,
                config: llmConfig
            };
        }

        this.currentLLMConfig = llmConfig;
        this.currentLLMFeature = featureKey;
        return this.clientPool[featureKey].client;
    }

    // 1. 生成复盘报告
    async generateReview(conversationId, options = {}) {
        const force = !!options.force;
        const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
        const report = (stage, percent, message, extra = null) => {
            try {
                onProgress?.({
                    stage,
                    percent,
                    message,
                    ...(extra ? { extra } : {})
                });
            } catch {
                // ignore
            }
        };

        // 检查是否已有复盘
        const existing = this.getExistingReview(conversationId);
        if (existing && existing.review_data && !force) {
            return existing.review_data;
        }

        // 1. 获取消息和选项
        report('load_data', 0.05, '加载对话与建议数据...');
        const messagesRaw = this.db.getMessagesByConversation(conversationId);
        const suggestions = this.db.getActionSuggestions(conversationId);

        // 2. 按时间戳分组，识别节点
        report('group_nodes', 0.15, '识别决策点并分组...');
        const nodesRaw = this.groupIntoNodes(suggestions);
        const explicitReviewNodes = this.buildReviewNodesFromUserSelection(nodesRaw);
        const affinityFromSelection = this.computeAffinityChangeFromSelection(explicitReviewNodes);
        const conversation = this.db.getConversationById(conversationId);

        // 3. 特殊情况处理：
        // - 如果没有节点但有消息，仍然走 LLM 复盘（不降级），让模型给出完整总结
        // - 如果既没有节点也没有消息，才使用兜底简要复盘
        const hasMessages = Array.isArray(messagesRaw) && messagesRaw.length > 0;
        if (nodesRaw.length === 0 && !hasMessages) {
            const simpleReview = this.buildSimpleSummary(conversation);
            report('save', 0.9, '保存复盘结果...');
            this.db.saveConversationReview({
                conversation_id: conversationId,
                review_data: simpleReview,
                model_used: 'none'
            });
            report('done', 1, '复盘完成');
            return simpleReview;
        }

        report('trim', 0.25, '裁剪输入规模以避免超长上下文...');
        const { messages, nodes, trimInfo } = this.trimReviewInputs(messagesRaw, nodesRaw);

        // 4. 调用 LLM 分析（带一次重试）
        let reviewData;
        try {
            report('llm_request', 0.35, '调用模型生成复盘（可能需要一些时间）...', trimInfo);
            reviewData = await this.callLLMForReview(messages, nodes);
            report('parse', 0.75, '解析模型输出...');
        } catch (err) {
            console.warn('[ReviewService] LLM 调用失败，准备重试...', err);
            // 针对“上下文过长”做更激进裁剪再重试；其他错误维持一次重试
            if (this.isLikelyContextLimitError(err)) {
                console.warn('[ReviewService] Suspected context window issue. Retrying with aggressive trimming...');
                const aggressive = this.trimReviewInputs(messagesRaw, nodesRaw, { aggressive: true });
                report('llm_request', 0.35, '上下文疑似超限，已裁剪后重试...', aggressive.trimInfo);
                reviewData = await this.callLLMForReview(aggressive.messages, aggressive.nodes);
                report('parse', 0.75, '解析模型输出...');
            } else {
                report('llm_request', 0.35, '调用失败，准备重试一次...');
                reviewData = await this.callLLMForReview(messages, nodes);
                report('parse', 0.75, '解析模型输出...');
            }
        }

        // 5. 合并 LLM 分析 + 系统记录
        report('enrich', 0.82, '合并 LLM 分析与系统记录...');
        
        // 策略：LLM 提供 reasoning 和 node_title，系统记录提供准确的选择状态
        const llmNodes = Array.isArray(reviewData.nodes) ? reviewData.nodes : [];
        const sysNodesMap = new Map(explicitReviewNodes.map(n => [n.node_id, n]));
        
        if (llmNodes.length > 0) {
            // LLM 输出了节点：合并两者
            const mergedNodes = llmNodes.map((llmNode) => {
                const sysNode = sysNodesMap.get(llmNode.node_id);
                if (sysNode) {
                    // 对于系统已有的决策点
                    const isSystemSelected = sysNode.choice_type === 'matched';
                    return {
                        node_id: llmNode.node_id,
                        node_title: llmNode.node_title || sysNode.node_title,
                        timestamp: sysNode.timestamp,
                        // 选择状态：优先使用系统显式选择；若无，使用 LLM 的判定
                        choice_type: isSystemSelected ? 'matched' : (llmNode.choice_type || 'custom'),
                        matched_suggestion_id: sysNode.selected_suggestion_id || llmNode.matched_suggestion_id,
                        selected_suggestion_id: sysNode.selected_suggestion_id,
                        selected_affinity_delta: sysNode.selected_affinity_delta,
                        // 描述和推理：使用 LLM 分析（更丰富）
                        user_description: llmNode.user_description || sysNode.user_description,
                        reasoning: llmNode.reasoning || sysNode.reasoning,
                        match_confidence: llmNode.match_confidence,
                        ghost_options: []
                    };
                } else {
                    // LLM 额外识别的 Insight 节点
                    return {
                        ...llmNode,
                        choice_type: 'insight',
                        ghost_options: []
                    };
                }
            });

            // 检查是否有系统决策点被 LLM 漏掉了
            const mergedIds = new Set(mergedNodes.map(n => n.node_id));
            explicitReviewNodes.forEach(sysNode => {
                if (!mergedIds.has(sysNode.node_id)) {
                    mergedNodes.push(sysNode);
                }
            });

            // 按时间排序
            reviewData.nodes = mergedNodes.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            console.log(`[ReviewService] 已合并 LLM 分析与系统记录 (LLM:${llmNodes.length}, Sys:${explicitReviewNodes.length}, Result:${reviewData.nodes.length})`);
        } else {
            // LLM 未输出节点：回退到系统记录
            console.warn('[ReviewService] LLM 未输出任何节点，使用系统记录');
            reviewData.nodes = explicitReviewNodes;
        }

        reviewData.has_nodes = reviewData.nodes.length > 0;
        if (!reviewData.summary) reviewData.summary = {};
        reviewData.summary.node_count = reviewData.nodes.length;
        reviewData.summary.matched_count = reviewData.nodes.filter((n) => n.choice_type === 'matched').length;
        reviewData.summary.custom_count = reviewData.nodes.filter((n) => n.choice_type === 'custom' || n.choice_type === 'insight').length;

        this.enrichGhostOptions(reviewData, nodes);
        this.enrichAudioInfo(reviewData, conversationId);

        // 6. 校验/兜底
        report('validate', 0.86, '校验并兜底复盘结构...');
        reviewData = this.ensureReviewDataIntegrity(reviewData, nodes, conversation);

        // 6.1 覆盖好感度变化：完全由用户显式选择决定
        if (!reviewData.summary) reviewData.summary = {};
        reviewData.summary.total_affinity_change = affinityFromSelection;

        // 7. 保存
        report('save', 0.9, '保存复盘结果...');
        this.db.saveConversationReview({
            conversation_id: conversationId,
            review_data: reviewData,
            model_used: this.currentLLMConfig?.model_name || 'unknown'
        });

        // 8. 更新会话信息（标题、摘要、Tag、好感度）
        if (reviewData.summary) {
            report('update_conversation', 0.95, '更新会话摘要与标签...');
            const updates = {};
            if (reviewData.summary.title) updates.title = reviewData.summary.title;
            if (reviewData.summary.conversation_summary) updates.summary = reviewData.summary.conversation_summary;
            if (Array.isArray(reviewData.summary.tags)) updates.tags = reviewData.summary.tags.join(',');
            if (reviewData.summary.total_affinity_change !== undefined) updates.affinity_change = reviewData.summary.total_affinity_change;

            if (Object.keys(updates).length > 0) {
                this.db.updateConversation(conversationId, updates);
            }
        }

        report('done', 1, '复盘完成');
        return reviewData;
    }

    estimateTokens(text = '') {
        if (!text) return 0;
        // 经验：中英混合平均 1 token ~ 3-4 chars，取 4 做保守估计
        return Math.ceil(String(text).length / 4);
    }

    isLikelyContextLimitError(err) {
        const msg = String(err?.message || '').toLowerCase();
        return (
            msg.includes('context') ||
            msg.includes('maximum context') ||
            msg.includes('max context') ||
            msg.includes('token') ||
            msg.includes('length') ||
            msg.includes('too large')
        );
    }

    trimReviewInputs(messagesRaw, nodesRaw, opts = {}) {
        const aggressive = !!opts.aggressive;
        const maxNodes = aggressive ? Math.max(6, Math.floor(this.MAX_NODES / 2)) : this.MAX_NODES;
        const maxMessages = aggressive ? Math.max(40, Math.floor(this.MAX_MESSAGES / 2)) : this.MAX_MESSAGES;
        const maxOptions = aggressive ? Math.max(3, Math.floor(this.MAX_OPTIONS_PER_NODE / 2)) : this.MAX_OPTIONS_PER_NODE;

        const messages = Array.isArray(messagesRaw) ? [...messagesRaw] : [];
        const nodes = Array.isArray(nodesRaw) ? [...nodesRaw] : [];

        // 1) 先限制 nodes 数量：保留最近 maxNodes 个（按 timestamp）
        nodes.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        const trimmedNodes = nodes.length > maxNodes ? nodes.slice(nodes.length - maxNodes) : nodes;

        // 2) 限制每个节点的 options 数量（保留最靠前的若干条，通常 index=0..）
        const finalNodes = trimmedNodes.map((n) => ({
            ...n,
            suggestions: Array.isArray(n.suggestions) ? n.suggestions.slice(0, maxOptions) : []
        }));

        // 3) 限制消息数量：保留最近 maxMessages 条
        messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        const finalMessages = messages.length > maxMessages ? messages.slice(messages.length - maxMessages) : messages;

        // 4) 如仍超估计 token，上下文再裁一次（优先裁消息）
        const promptPreview = this.buildReviewPrompt(finalMessages, finalNodes);
        const est = this.estimateTokens(promptPreview);
        if (est > this.MAX_PROMPT_TOKENS_EST) {
            const moreAggressiveMessages = finalMessages.slice(Math.max(0, finalMessages.length - Math.floor(maxMessages / 2)));
            const moreAggressivePrompt = this.buildReviewPrompt(moreAggressiveMessages, finalNodes);
            const est2 = this.estimateTokens(moreAggressivePrompt);
            return {
                messages: moreAggressiveMessages,
                nodes: finalNodes,
                trimInfo: { aggressive, nodes: { before: nodesRaw?.length || 0, after: finalNodes.length }, messages: { before: messagesRaw?.length || 0, after: moreAggressiveMessages.length }, tokenEst: { before: est, after: est2 } }
            };
        }

        return {
            messages: finalMessages,
            nodes: finalNodes,
            trimInfo: { aggressive, nodes: { before: nodesRaw?.length || 0, after: finalNodes.length }, messages: { before: messagesRaw?.length || 0, after: finalMessages.length }, tokenEst: { est } }
        };
    }

    // 获取已有复盘
    getExistingReview(conversationId) {
        return this.db.getConversationReview(conversationId);
    }

    // 分组节点逻辑
    groupIntoNodes(suggestions) {
        if (!suggestions || suggestions.length === 0) return [];

        const withDecisionPoint = [];
        const legacy = [];
        for (const s of suggestions) {
            if (s && s.decision_point_id) withDecisionPoint.push(s);
            else legacy.push(s);
        }

        const nodes = [];

        // 1) 新版：按 decision_point_id 聚合；
        // - 若用户在某个 batch 显式选择了建议，则该决策点选择“被选中项所在 batch”作为节点选项（便于回放 ghost options）
        // - 否则取“最新 batch”作为该节点的选项
        if (withDecisionPoint.length > 0) {
            const byDP = new Map();
            for (const s of withDecisionPoint) {
                const dpId = s.decision_point_id;
                if (!byDP.has(dpId)) byDP.set(dpId, []);
                byDP.get(dpId).push(s);
            }

            // 按决策点的最早 created_at 排序，稳定输出 node_1..n
            const dpGroups = [...byDP.entries()].map(([dpId, list]) => {
                const minTs = Math.min(...list.map((x) => x.created_at || 0));
                const maxTs = Math.max(...list.map((x) => x.created_at || 0));
                return { dpId, list, minTs, maxTs };
            }).sort((a, b) => a.minTs - b.minTs);

            for (const group of dpGroups) {
                // 找最新批次：优先按 batch_id 分组，取 created_at 最大的 batch
                const byBatch = new Map();
                for (const s of group.list) {
                    const batchId = s.batch_id || 'unknown';
                    if (!byBatch.has(batchId)) byBatch.set(batchId, []);
                    byBatch.get(batchId).push(s);
                }
                const batchCount = byBatch.size;

                // 若存在显式选择，优先使用该 batch
                let selectedBatchId = null;
                for (const [batchId, list] of byBatch.entries()) {
                    if (list.some((x) => x && (x.is_selected === 1 || x.is_selected === true || x.is_selected === '1'))) {
                        selectedBatchId = batchId;
                        break;
                    }
                }

                let latestBatchId = null;
                let latestBatchTs = -1;
                for (const [batchId, list] of byBatch.entries()) {
                    const ts = Math.max(...list.map((x) => x.created_at || 0));
                    if (ts > latestBatchTs) {
                        latestBatchTs = ts;
                        latestBatchId = batchId;
                    }
                }

                const pickedBatchId = selectedBatchId || latestBatchId;
                const latest = (pickedBatchId && byBatch.get(pickedBatchId)) ? byBatch.get(pickedBatchId) : group.list;
                const sortedLatest = [...latest].sort((a, b) => {
                    const aIndex = a.suggestion_index ?? a.index ?? 999;
                    const bIndex = b.suggestion_index ?? b.index ?? 999;
                    return aIndex - bIndex;
                });

                nodes.push({
                    decision_point_id: group.dpId,
                    batch_id: pickedBatchId !== 'unknown' ? pickedBatchId : null,
                    batch_count: batchCount,
                    timestamp: sortedLatest[0]?.created_at || group.minTs,
                    suggestions: sortedLatest
                });
            }
        }

        // 2) 旧版数据：回退到时间窗口分组（保留原逻辑，但不再硬丢弃为3条）
        if (legacy.length > 0) {
            // 按 created_at 排序，如果时间戳相同，则按 index 排序
            const sorted = [...legacy].sort((a, b) => {
                if (a.created_at !== b.created_at) {
                    return a.created_at - b.created_at;
                }
                const aIndex = a.index !== undefined ? a.index : 999;
                const bIndex = b.index !== undefined ? b.index : 999;
                return aIndex - bIndex;
            });

            const groups = [];
            let currentGroup = [sorted[0]];

            for (let i = 1; i < sorted.length; i++) {
                const prev = currentGroup[currentGroup.length - 1];
                const curr = sorted[i];

                const timeDiff = curr.created_at - prev.created_at;
                const hasIndexInfo = curr.index !== undefined && prev.index !== undefined;
                const isIndexReset = hasIndexInfo && curr.index === 0 && prev.index >= 0 && prev.index < 3;
                const isFullBatch = currentGroup.length >= 3;

                if (timeDiff < 1000 && !(isFullBatch && isIndexReset)) {
                    currentGroup.push(curr);
                } else {
                    groups.push(currentGroup);
                    currentGroup = [curr];
                }
            }
            groups.push(currentGroup);

            const legacyNodes = groups.map((group) => ({
                timestamp: group[0].created_at,
                suggestions: group
            }));
            nodes.push(...legacyNodes);
        }

        // 统一生成 node_id
        return nodes
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
            .map((node, index) => ({
                node_id: `node_${index + 1}`,
                timestamp: node.timestamp || 0,
                decision_point_id: node.decision_point_id || null,
                batch_id: node.batch_id || null,
                suggestions: node.suggestions || []
            }));
    }

    // 构建 Prompt
    buildReviewPrompt(messages, nodes) {
        const formatTime = (ts) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });

        // 过滤掉 system 消息，保留 user 和 character
        // 确保时间顺序
        const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp);

        const transcript = sortedMessages.map(m =>
            `[${formatTime(m.timestamp)}] ${m.sender === 'user' ? 'User' : 'Character'}: ${m.content}`
        ).join('\n');

        const nodeInfo = nodes.length > 0
            ? nodes.map((node, i) => {
                const dpInfo = node.decision_point_id ? `, DP:${node.decision_point_id}` : '';
                const batchInfo = node.batch_id ? `, Batch:${node.batch_id}` : '';
                const batchCountInfo = node.batch_count && node.batch_count > 1 ? `, BatchCount:${node.batch_count}` : '';

                // 补充上下文：决策点锚点消息 + 本批次触发信息（可解释“为什么弹建议/是否换一批”）
                let anchorLine = '';
                let triggerLine = '';
                try {
                    if (node.decision_point_id && this.db.getDecisionPointById) {
                        const dp = this.db.getDecisionPointById(node.decision_point_id);
                        const anchorId = dp?.anchor_message_id;
                        if (anchorId && this.db.getMessageById) {
                            const msg = this.db.getMessageById(anchorId);
                            if (msg) {
                                anchorLine = `锚点消息: [${formatTime(msg.timestamp)}] ${msg.sender === 'user' ? 'User' : 'Character'}: ${msg.content}`;
                            }
                        }
                    }
                    if (node.batch_id && this.db.getSuggestionBatchById) {
                        const batch = this.db.getSuggestionBatchById(node.batch_id);
                        if (batch) {
                            triggerLine = `触发: ${batch.trigger || 'unknown'} / ${batch.reason || 'unknown'}`;
                        }
                    }
                } catch {
                    // ignore
                }

                const options = node.suggestions.map(s => `  - ID:${s.id} 内容:${s.content || s.title}`).join('\n');
                const extraLines = [triggerLine, anchorLine].filter(Boolean).map((l) => `  ${l}`).join('\n');
                return `节点${i + 1} (ID: ${node.node_id}${dpInfo}${batchInfo}${batchCountInfo}, Time: ${formatTime(node.timestamp)}):\n${extraLines ? `${extraLines}\n` : ''}${options}`;
            }).join('\n\n')
            : "无关键决策节点";

        const sections = [
            "# Role",
            "你是恋爱对话复盘分析师，擅长细腻地洞察人际互动的关键动态。",
            "",
            "# Task",
            nodes.length > 0
                ? '根据对话记录和已知的"关键决策点"（系统当时生成建议的时刻），分析用户的实际选择，并生成优雅、专业的复盘总结。'
                : '根据对话记录，总结对话内容并评估好感度变化。',
            "",
            "## 节点判定规则（重要）：",
            "**必须分析的节点**：已提供的决策点（带有系统建议的时刻）必须全部分析。",
            "**可额外生成的节点**：在对话中识别以下关键时刻，作为额外的 insight 节点：",
            "1. **话题转折点**：对话主题/情绪发生明显变化的时刻",
            "2. **情感峰值点**：最感动/最尴尬/最有趣的时刻",
            "3. **关系里程碑**：关系推进的关键点（如首次称呼昵称、主动示好等）",
            "4. **冲突/和解点**：意见不合或和解的时刻",
            "",
            "## 复盘核心元素：",
            "1. **决策点标题 (title)**：用极简的词汇（2-4字）概括该次互动的本质，如\"破冰契机\"、\"情绪共振\"、\"婉转拒绝\"。不要包含数字或符号。",
            "2. **用户行为描述 (user_desc)**：用一句话（10-20字）精准描述用户做了什么。",
            "   - **Bad**: \"用户回复了'好的'，表示同意\"",
            "   - **Good**: \"积极响应邀请，展现出极高的社交主动性\"",
            "3. **选择类型 (choice_type)**：",
            "   - **matched**：用户选择了系统建议的选项",
            "   - **custom**：用户在决策点使用了自定义回复",
            "   - **insight**：非决策点的关键时刻（话题转折/情感峰值等），此类节点 matched_id 为空",
            "4. **整体表现评价 (self_evaluation)**：作为第一人称视高的教练，给用户一段富有启发性的反馈（20-40字）。",
            "",
            "## 其他内容：",
            "- **标题 (title)**：为本次对话生成一个富有文学美感的标题，如\"月色下的温柔守候\"、\"初见时的微小悸动\"。",
            "- **对话标签 (tags)**：生成3-5个高阶感性标签，如：双向奔赴、微妙暧昧、情感防御、深度共情。",
            "- **对话概要 (conversation_summary)**：一句话概括故事走向。",
            "- **好感度变化 (total_affinity_change)**：-10 到 +10 的整数。",
            "",
            "# Input",
            "",
            "## 对话记录",
            transcript,
            "",
            "## 决策点及建议选项",
            nodeInfo,
            "",
            "# Output (TOON 格式)",
            "请严格遵守以下格式，只需输出 Data 行。",
            "",
            "**输出示例**：",
            "review_node: node_1,情感共鸣,matched,sugg-xxx-1A,1.0,表达对回忆的珍视,用户选择了温情回复",
            "review_node: node_2,话题转折,insight,,0.9,主动提起工作话题,从轻松闲聊转向深度讨论",
            "review_node: node_3,关心表达,custom,,0.8,担忧对方状态,没有采纳建议而是自由发挥",
            "",
            "",
            "review_summary[1]{total_affinity_change,title,conversation_summary,self_evaluation,chat_overview,expression_score,expression_desc,topic_score,topic_desc,tags,attitude_analysis}:",
            "3,月色下的守候,本次对话从尴尬破冰到温馨互动,展现了极强的同理心,...,8,表达清晰,7,话题自然,双向奔赴;微妙暧昧,对方对你产生了好感",
            ""
        ];

        if (nodes.length > 0) {
            const minNodes = Math.max(nodes.length, Math.ceil(messages.length / 50));
            sections.push(
                "第一部分：节点分析",
                `请分析 ${nodes.length} 个已知决策点，并额外识别 insight 节点（话题转折/情感峰值等）。共约 ${minNodes} 个以上节点。`,
                `请分析 ${nodes.length} 个已知决策点，并额外识别 insight 节点（话题转折/情感峰值等）。共约 ${minNodes} 个以上节点。`,
                "review_node: <node_id>,<极简标题>,<matched/custom/insight>,<matched_id>,<置信度>,<精准行为描述>,<深度原因分析>",
                "",
                "**注意**：每个节点必须单独一行，以 `review_node:` 开头。node_id 格式为 node_1, node_2...。",
                "",
                "第二部分：整体总结"
            );
        } else {
            sections.push("第一部分：整体总结");
        }

        sections.push(
            "review_summary: <好感度变化>,<美感标题>,<走向概述>,<启发性评价>,<对话概要>,<表述分>,<表释放评价>,<话题分>,<话题选择评价>,<分号分隔标签>,<对象态度分析>",
            "",
            "## 严禁行为：",
            "- 禁止输出 markdown 代码块标记 (```)。",
            "- 禁止省略引号（如果内容中包含逗号）。",
            "- 必须在一行内写完一个节点的数据。",
            "- 必须以 `review_node:` 或 `review_summary:` 开头。"
        );

        return sections.join('\n');
    }

    buildReviewNodesFromUserSelection(nodes = []) {
        const reviewNodes = [];
        for (const node of nodes || []) {
            const suggestions = Array.isArray(node.suggestions) ? node.suggestions : [];
            const selected = suggestions.find((s) => s && (s.is_selected === 1 || s.is_selected === true || s.is_selected === '1')) || null;
            reviewNodes.push({
                node_id: node.node_id,
                node_title: selected?.title || '已选择建议',
                timestamp: node.timestamp || 0,
                choice_type: selected ? 'matched' : 'custom',
                selected_suggestion_id: selected?.id || null,
                selected_affinity_delta: typeof selected?.affinity_prediction === 'number' ? selected.affinity_prediction : null,
                user_description: selected?.content || selected?.title || (selected ? '已选择建议' : '未选择建议'),
                reasoning: selected
                    ? `该节点为用户显式选择：${selected.title || selected.id || '建议'}.`
                    : '该节点未进行显式选择，无法从系统记录确定采用了哪个选项。',
                ghost_options: []
            });
        }
        return reviewNodes;
    }

    computeAffinityChangeFromSelection(reviewNodes = []) {
        // affinity_delta 现在是 0-10 的接受度评分，计算平均接受度
        const scores = Array.isArray(reviewNodes) ? reviewNodes.map((n) => n?.selected_affinity_delta).filter((v) => typeof v === 'number' && !Number.isNaN(v)) : [];
        if (scores.length === 0) return null;
        const avg = scores.reduce((acc, v) => acc + v, 0) / scores.length;
        // 返回平均接受度（0-10），保留一位小数
        return Math.round(avg * 10) / 10;
    }

    async callLLMForReview(messages, nodes) {
        const client = await this.ensureClient('review');
        const prompt = this.buildReviewPrompt(messages, nodes);

        console.log('[ReviewService] Sending prompt to LLM (Streaming):', prompt);

        let fullContent = '';
        const timeoutMs = this.resolveTimeoutMs(this.currentLLMConfig, DEFAULT_REVIEW_TIMEOUT_MS);
        const controller = new AbortController();

        let timer = null;
        const resetTimer = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                controller.abort(new Error(`LLM 生成响应超时（${timeoutMs}ms内无新数据）`));
            }, timeoutMs);
        };

        try {
            resetTimer(); // 初始请求开始计时
            const stream = await client.chat.completions.create({
                model: this.currentLLMConfig.model_name,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 20000, // 按 200k context 来，给足输出空间
                stream: true,
                thinking: { type: 'enabled' }  // 启用 GLM-4.7 深度思考
            }, { signal: controller.signal });

            let chunkCount = 0;
            for await (const chunk of stream) {
                chunkCount++;
                const delta = chunk.choices?.[0]?.delta;
                if (!delta) continue;

                // GLM-4.7: reasoning_content 是思考，content 是输出
                const reasoningContent = delta.reasoning_content || '';
                const content = delta.content || '';

                if (reasoningContent || content) {
                    fullContent += content; // 只保存 content
                    resetTimer(); // 有任何输出就重置计时器
                }

                if (chunkCount <= 3 && content) {
                    console.log(`[ReviewService] Chunk ${chunkCount} content preview:`, content.slice(0, 50));
                }
            }

            console.log(`[ReviewService] Stream finished. Total chunks: ${chunkCount}`);
        } catch (apiError) {
            if (apiError.name === 'AbortError') {
                console.error('[ReviewService] LLM API 调用超时中断');
                throw new Error(`LLM API 生成响应超时，已自动中断（活跃超时限制: ${timeoutMs}ms）`);
            }
            console.error('[ReviewService] LLM API 流式调用失败:', apiError);
            throw new Error(`LLM API 调用失败: ${apiError.message || apiError}`);
        } finally {
            if (timer) clearTimeout(timer);
        }

        console.log('[ReviewService] LLM Stream Completed. Full length:', fullContent.length);

        if (!fullContent || !fullContent.trim()) {
            throw new Error('LLM response is empty or invalid');
        }

        // 打印简短预览用于调试
        console.log('[ReviewService] LLM Response Preview:', fullContent.slice(0, 100).replace(/\n/g, '\\n') + '...');

        return this.parseReviewToon(fullContent, nodes);
    }

    csvSplit(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i += 1) {
            const char = line[i];
            if (char === '"' && line[i - 1] !== '\\') {
                inQuotes = !inQuotes;
                continue;
            }
            if ((char === ',' || char === '，') && !inQuotes) {
                result.push(current);
                current = '';
                continue;
            }
            current += char;
        }
        if (current !== '' || line.endsWith(',') || line.endsWith('，')) {
            result.push(current);
        }
        return result.map(s => s.trim().replace(/^["']|["']$/g, '')); // Trim and unquote
    }

    resolveTimeoutMs(config, fallback) {
        const raw = config?.timeout_ms;
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.round(parsed);
        }
        return fallback;
    }

    parseReviewToon(text, originalNodes) {
        if (!text) {
            return {
                version: "1.0",
                has_nodes: originalNodes && originalNodes.length > 0,
                summary: {},
                nodes: []
            };
        }

        // 预处理：处理引号内的换行符，将跨行记录合并为单行
        const rawLines = text.split('\n');
        const lines = [];
        let buffer = '';
        let inQuotes = false;

        for (const line of rawLines) {
            const currentLine = line.trim();
            if (!currentLine && !inQuotes) continue;

            if (buffer) {
                buffer += '\n' + line;
            } else {
                buffer = line;
            }

            // 统计未转义的引号
            for (let i = 0; i < line.length; i++) {
                if (line[i] === '"' && (i === 0 || line[i - 1] !== '\\')) {
                    inQuotes = !inQuotes;
                }
            }

            if (!inQuotes) {
                lines.push(buffer.trim());
                buffer = '';
            }
        }
        if (buffer) lines.push(buffer.trim());

        const result = {
            version: "1.0",
            has_nodes: true,
            summary: {},
            nodes: []
        };

        // 解析 summary
        const summaryHeaderRegex = /^review_summary\[(\d+)\]\{([^}]+)\}:?/;
        const summaryHeaderIndex = lines.findIndex(l => l.match(summaryHeaderRegex));
        if (summaryHeaderIndex !== -1) {
            const headerLine = lines[summaryHeaderIndex];
            const headerMatch = headerLine.match(summaryHeaderRegex);
            const fieldsContent = headerMatch?.[2] || "";
            
            // 预期字段顺序
            const expectedFields = [
                'total_affinity_change', 'title', 'conversation_summary', 'self_evaluation', 
                'chat_overview', 'expression_score', 'expression_desc', 'topic_score', 
                'topic_desc', 'tags', 'attitude_analysis'
            ];
            
            let parts = [];
            // 启发式判断：如果大括号内包含引号、数字或加减号，认为数据被错误地填入了括号内（模型幻觉）
            const hasDataInBraces = fieldsContent.includes('"') || fieldsContent.includes('+') || fieldsContent.includes('-') || /\d/.test(fieldsContent);
            
            if (hasDataInBraces) {
                parts = this.csvSplit(fieldsContent);
            } else if (lines[summaryHeaderIndex + 1]) {
                parts = this.csvSplit(lines[summaryHeaderIndex + 1]);
            }

            if (parts.length > 0) {
                const summaryMap = {};
                expectedFields.forEach((field, idx) => {
                    summaryMap[field] = parts[idx] ?? '';
                });

                result.summary.total_affinity_change = parseInt(summaryMap.total_affinity_change) || 0;
                result.summary.title = summaryMap.title || "";
                // 优先 chat_overview 填充概要，其次 conversation_summary
                result.summary.conversation_summary = summaryMap.conversation_summary || summaryMap.chat_overview || "";
                result.summary.self_evaluation = summaryMap.self_evaluation || "";
                result.summary.chat_overview = summaryMap.chat_overview || result.summary.conversation_summary;
                // 解析用户表现评价的评分
                result.summary.performance_evaluation = {
                    expression_ability: {
                        score: parseInt(summaryMap.expression_score) || null,
                        description: summaryMap.expression_desc || ""
                    },
                    topic_selection: {
                        score: parseInt(summaryMap.topic_score) || null,
                        description: summaryMap.topic_desc || ""
                    }
                };
                // 解析 Tags
                result.summary.tags = (summaryMap.tags || "").split(/[;；]/).map(t => t.trim()).filter(Boolean);
                // 解析对象态度分析
                result.summary.attitude_analysis = summaryMap.attitude_analysis || "";
            }
        }

        // 解析 nodes
        const nodesHeaderRegex = /^(?:review_nodes|review_node)\[(\d+)\]\{([^}]+)\}:?/;
        const headerLineIndex = lines.findIndex(l => l.match(nodesHeaderRegex));

        // 策略：无论有没有 header，都尝试寻找 review_node: 开头的行
        const potentialNodeLines = lines.filter(l => l.trim().startsWith('review_node:'));
        
        if (headerLineIndex !== -1 || potentialNodeLines.length > 0) {
            // 如果有 header，先处理 header 括号里的数据（模型有时会把第一条数据挤在括号里）
            if (headerLineIndex !== -1) {
                const headerLine = lines[headerLineIndex];
                const headerMatch = headerLine.match(nodesHeaderRegex);
                const fieldsContent = headerMatch?.[2] || "";
                
                const hasDataInBraces = fieldsContent.includes('"') || fieldsContent.includes('node_');
                if (hasDataInBraces && !fieldsContent.includes('node_id')) {
                    const parts = this.csvSplit(fieldsContent);
                    if (parts.length >= 7) {
                        const nodeId = parts[0];
                        const originalNode = originalNodes.find(n => n.node_id === nodeId);
                        result.nodes.push({
                            node_id: nodeId,
                            node_title: parts[1],
                            timestamp: originalNode ? originalNode.timestamp : 0,
                            choice_type: parts[2] === 'matched' ? 'matched' : (parts[2] === 'insight' ? 'insight' : 'custom'),
                            matched_suggestion_id: parts[3] || null,
                            match_confidence: parseFloat(parts[4]) || 0,
                            user_description: parts[5],
                            reasoning: parts[6],
                            ghost_options: []
                        });
                    }
                }
            }

            // 处理所有以 review_node: 开头的行
            potentialNodeLines.forEach(line => {
                // 去掉前缀
                const content = line.replace(/^review_node:\s*/, '').trim();
                if (!content.includes(',')) return;

                const parts = this.csvSplit(content);
                if (parts.length >= 7) {
                    let nodeId = parts[0];
                    if (nodeId && !nodeId.startsWith('node_') && !isNaN(nodeId)) {
                        nodeId = `node_${nodeId}`;
                    }
                    
                    // 避免重复（如果 header 处理逻辑已经加过了）
                    if (result.nodes.some(n => n.node_id === nodeId)) return;

                    const originalNode = originalNodes.find(n => n.node_id === nodeId);

                    result.nodes.push({
                        node_id: nodeId,
                        node_title: parts[1],
                        timestamp: originalNode ? originalNode.timestamp : (result.nodes.length > 0 ? result.nodes[result.nodes.length - 1].timestamp + 1000 : 0),
                        choice_type: parts[2] === 'matched' ? 'matched' : (parts[2] === 'insight' ? 'insight' : 'custom'),
                        matched_suggestion_id: parts[3] || null,
                        match_confidence: parseFloat(parts[4]) || 0,
                        user_description: parts[5],
                        reasoning: parts[6],
                        ghost_options: []
                    });
                }
            });

            // 如果连 review_node: 前缀都没写，只是纯 CSV 行（最后兜底）
            if (result.nodes.length === 0 && headerLineIndex !== -1) {
                for (let i = headerLineIndex + 1; i < lines.length; i++) {
                    const line = lines[i];
                    if (line.match(/^review_summary/)) break;
                    if (line.startsWith('review_node:')) continue; // 已经处理过了
                    if (!line.includes(',')) continue;

                    const parts = this.csvSplit(line);
                    if (parts.length >= 7 && (parts[0].startsWith('node_') || !isNaN(parts[0]))) {
                        let nodeId = parts[0];
                        if (!nodeId.startsWith('node_')) nodeId = `node_${nodeId}`;
                        
                        const originalNode = originalNodes.find(n => n.node_id === nodeId);
                        result.nodes.push({
                            node_id: nodeId,
                            node_title: parts[1],
                            timestamp: originalNode ? originalNode.timestamp : 0,
                            choice_type: parts[2] === 'matched' ? 'matched' : (parts[2] === 'insight' ? 'insight' : 'custom'),
                            matched_suggestion_id: parts[3] || null,
                            match_confidence: parseFloat(parts[4]) || 0,
                            user_description: parts[5],
                            reasoning: parts[6],
                            ghost_options: []
                        });
                    }
                }
            }
        }

        // 去重
        const seenNodes = new Set();
        result.nodes = result.nodes.filter(n => {
            if (seenNodes.has(n.node_id)) return false;
            seenNodes.add(n.node_id);
            return true;
        });

        return result;
    }

    buildSimpleSummary(conversation, summaryText) {
        return {
            version: "1.0",
            has_nodes: false,
            summary: {
                total_affinity_change: conversation?.affinity_change || 0,
                node_count: 0,
                matched_count: 0,
                custom_count: 0,
                conversation_summary: summaryText || "本次对话较为顺畅，无需特别决策点。",
                self_evaluation: "暂无复盘评价。",
                chat_overview: summaryText || "本次对话较为顺畅，无需特别决策点。",
                performance_evaluation: {
                    expression_ability: {
                        score: null,
                        description: ""
                    },
                    topic_selection: {
                        score: null,
                        description: ""
                    }
                },
                tags: [],
                attitude_analysis: "暂无态度分析。"
            },
            nodes: []
        };
    }

    ensureReviewDataIntegrity(reviewData, originalNodes, conversation) {
        const safe = reviewData || { summary: {}, nodes: [] };
        safe.summary = safe.summary || {};
        safe.nodes = Array.isArray(safe.nodes) ? safe.nodes : [];

        const expectedCount = originalNodes?.length || 0;
        const parsedCount = safe.nodes.length;
        const missingNodes = expectedCount > 0 && parsedCount === 0;
        const countMismatch = expectedCount > 0 && parsedCount !== expectedCount;

        if (missingNodes) {
            console.warn('[ReviewService] LLM 输出未解析出任何节点，降级为无节点复盘。');
            return this.buildSimpleSummary(
                conversation,
                safe.summary.conversation_summary || "未能解析关键决策点，已输出简要复盘。"
            );
        }

        if (countMismatch) {
            console.warn('[ReviewService] LLM 节点数与输入不一致，已继续使用解析结果：', {
                expected: expectedCount,
                parsed: parsedCount
            });
        }

        safe.has_nodes = safe.nodes.length > 0;
        safe.summary.node_count = safe.nodes.length;
        
        // 关键决策：原始输入中存在的节点（带系统建议）
        safe.summary.decision_count = safe.nodes.filter(n => n.has_source).length;
        // 转折点/Insight：LLM 额外识别的节点
        safe.summary.insight_count = safe.nodes.filter(n => !n.has_source).length;

        safe.summary.matched_count = safe.nodes.filter(n => n.choice_type === 'matched').length;
        safe.summary.custom_count = safe.nodes.filter(n => n.choice_type === 'custom' || n.choice_type === 'insight').length;

        if (safe.summary.total_affinity_change === undefined || safe.summary.total_affinity_change === null) {
            safe.summary.total_affinity_change = conversation?.affinity_change || 0;
        }
        if (!safe.summary.conversation_summary) {
            safe.summary.conversation_summary = "本次对话复盘已生成。";
        }
        if (!safe.summary.chat_overview) {
            safe.summary.chat_overview = safe.summary.conversation_summary;
        }
        if (!safe.summary.self_evaluation) {
            safe.summary.self_evaluation = "暂无复盘评价。";
        }
        // 确保performance_evaluation字段存在
        if (!safe.summary.performance_evaluation) {
            safe.summary.performance_evaluation = {
                expression_ability: {
                    score: null,
                    description: ""
                },
                topic_selection: {
                    score: null,
                    description: ""
                }
            };
        } else {
            // 确保子字段存在
            if (!safe.summary.performance_evaluation.expression_ability) {
                safe.summary.performance_evaluation.expression_ability = { score: null, description: "" };
            }
            if (!safe.summary.performance_evaluation.topic_selection) {
                safe.summary.performance_evaluation.topic_selection = { score: null, description: "" };
            }
        }
        if (!safe.summary.tags) {
            safe.summary.tags = [];
        }
        if (!safe.summary.attitude_analysis) {
            safe.summary.attitude_analysis = "暂无态度分析。";
        }

        return safe;
    }

    enrichGhostOptions(reviewData, originalNodes) {
        reviewData.nodes.forEach(reviewNode => {
            const original = originalNodes.find(n => n.node_id === reviewNode.node_id);
            // Mark if this node originated from a system suggestion (vs pure LLM insight)
            reviewNode.has_source = !!original;

            if (original) {
                // 使用系统记录的 selected_suggestion_id（优先）或 LLM 的 matched_suggestion_id
                const actualSelectedId = reviewNode.selected_suggestion_id || reviewNode.matched_suggestion_id;
                reviewNode.ghost_options = original.suggestions
                    .filter(s => s.id !== actualSelectedId) // 过滤掉实际选中的
                    .map(s => ({
                        suggestion_id: s.id,
                        content: s.content || s.title
                    }));
            }
        });
    }

    enrichAudioInfo(reviewData, conversationId) {
        if (!reviewData.nodes || reviewData.nodes.length === 0) return;

        // 获取该对话的所有录音记录，按时间排序
        const records = this.db.getSpeechRecordsByConversation(conversationId);
        if (!records || records.length === 0) return;

        reviewData.nodes.forEach(node => {
            if (!node.timestamp) return;

            // 寻找离该节点 timestamp 最近的一个录音记录 (时间差最小)
            // 且录音记录通常在节点之前或附近（例如用户说话后产生的节点）
            let closest = null;
            let minDiff = Infinity;

            for (const record of records) {
                // 录音记录的 start_time 或 end_time 与节点 timestamp 的关系
                // 建议使用 end_time，因为识别完成时刻更接近节点触发时刻
                const refTime = record.end_time || record.start_time;
                const diff = Math.abs(refTime - node.timestamp);

                // 只有当录音记录有文件路径时才考虑
                if (record.audio_file_path && diff < minDiff) {
                    minDiff = diff;
                    closest = record;
                }
            }

            // 如果找到且时间差距在合理范围内（例如 30秒内），则关联
            if (closest && minDiff < 30000) {
                node.audio_record_id = closest.id;
                node.audio_file_path = closest.audio_file_path;
                node.audio_duration = closest.audio_duration;
            }
        });
    }
}
