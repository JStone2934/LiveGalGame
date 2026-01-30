import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

// 检测是否在 Electron 环境中
const isElectron = !!(window.electronAPI?.isElectron);

function Overview() {
  const [statistics, setStatistics] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [asrStatus, setAsrStatus] = useState({ ready: false });
  const [llmStatus, setLlmStatus] = useState({ ready: false });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const api = window.electronAPI;

      if (!api) {
        setLoading(false);
        return;
      }

      // 加载统计数据
      if (api.getStatistics) {
        const stats = await api.getStatistics();
        setStatistics(stats);
      }

      // 加载最近对话
      if (api.getRecentConversations) {
        const recent = await api.getRecentConversations(10);
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const filtered = recent.filter((conv) => {
          const timestamp = new Date(conv.updated_at || conv.created_at || 0).getTime();
          return timestamp >= weekAgo;
        });
        setConversations(filtered);
      }

      // 检查服务状态
      if (api.asrCheckReady) {
        const asr = await api.asrCheckReady();
        setAsrStatus(asr);
      }
      if (api.llmCheckReady) {
        const llm = await api.llmCheckReady();
        setLlmStatus(llm);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const daysAgo = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (daysAgo === 0) return '今天';
    if (daysAgo === 1) return '昨天';
    return `${daysAgo}天前`;
  };

  // ========== Web 端布局 ==========
  if (!isElectron) {
    return (
      <div className="min-h-[calc(100vh-8rem)]">
        {/* Hero 区域 */}
        <div className="bg-gradient-to-br from-pink-500 via-purple-500 to-indigo-600 text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 md:py-24">
            <div className="max-w-3xl">
              <h1 className="text-4xl md:text-5xl font-bold mb-4">
                实时对话辅助
              </h1>
              <p className="text-xl md:text-2xl text-white/80 mb-8">
                智能语音识别 · AI 回复建议 · 让每次对话都更自然
              </p>
              <div className="flex flex-wrap gap-4">
                <Link
                  to="/live"
                  className="inline-flex items-center gap-2 px-8 py-4 bg-white text-purple-600 rounded-xl font-bold text-lg shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
                >
                  <span className="material-symbols-outlined">mic</span>
                  开始实时对话
                </Link>
                <Link
                  to="/characters"
                  className="inline-flex items-center gap-2 px-8 py-4 bg-white/10 text-white border-2 border-white/30 rounded-xl font-bold text-lg hover:bg-white/20 transition-colors"
                >
                  <span className="material-symbols-outlined">person_add</span>
                  创建角色
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* 服务状态 */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 -mt-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`p-5 rounded-2xl shadow-lg ${
              asrStatus.ready 
                ? 'bg-green-50 border-2 border-green-200' 
                : 'bg-amber-50 border-2 border-amber-200'
            }`}>
              <div className="flex items-center gap-3">
                <div className={`w-4 h-4 rounded-full ${asrStatus.ready ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`} />
                <div>
                  <h3 className="font-semibold text-slate-800">语音识别服务</h3>
                  <p className="text-sm text-slate-500">{asrStatus.message || (asrStatus.ready ? '已就绪' : '检测中...')}</p>
                </div>
              </div>
            </div>
            <div className={`p-5 rounded-2xl shadow-lg ${
              llmStatus.ready 
                ? 'bg-green-50 border-2 border-green-200' 
                : 'bg-amber-50 border-2 border-amber-200'
            }`}>
              <div className="flex items-center gap-3">
                <div className={`w-4 h-4 rounded-full ${llmStatus.ready ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`} />
                <div>
                  <h3 className="font-semibold text-slate-800">AI 建议服务</h3>
                  <p className="text-sm text-slate-500">{llmStatus.message || (llmStatus.ready ? '已就绪' : '检测中...')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 功能卡片 */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
          <h2 className="text-2xl font-bold text-slate-800 mb-8 text-center">核心功能</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
              <div className="w-14 h-14 rounded-xl bg-pink-100 flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-3xl text-pink-600">mic</span>
              </div>
              <h3 className="text-lg font-semibold text-slate-800 mb-2">实时语音识别</h3>
              <p className="text-slate-500 text-sm">
                自动识别对话双方的语音，实时转写为文字，让你不错过任何对话内容。
              </p>
            </div>
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
              <div className="w-14 h-14 rounded-xl bg-purple-100 flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-3xl text-purple-600">auto_awesome</span>
              </div>
              <h3 className="text-lg font-semibold text-slate-800 mb-2">AI 回复建议</h3>
              <p className="text-slate-500 text-sm">
                根据对话内容和角色性格，智能生成多个回复建议，点击即可复制使用。
              </p>
            </div>
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
              <div className="w-14 h-14 rounded-xl bg-indigo-100 flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-3xl text-indigo-600">history</span>
              </div>
              <h3 className="text-lg font-semibold text-slate-800 mb-2">对话记录回顾</h3>
              <p className="text-slate-500 text-sm">
                所有对话自动保存，随时回顾历史记录，分析对话进展和情感变化。
              </p>
            </div>
          </div>
        </div>

        {/* 快速开始步骤 */}
        <div className="bg-slate-100 py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <h2 className="text-2xl font-bold text-slate-800 mb-8 text-center">快速开始</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-pink-500 text-white text-xl font-bold flex items-center justify-center mx-auto mb-4">1</div>
                <h3 className="font-semibold text-slate-800 mb-2">创建角色</h3>
                <p className="text-slate-500 text-sm">添加你要对话的角色信息，设置性格和关系。</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-purple-500 text-white text-xl font-bold flex items-center justify-center mx-auto mb-4">2</div>
                <h3 className="font-semibold text-slate-800 mb-2">开始监听</h3>
                <p className="text-slate-500 text-sm">授权麦克风权限，开始实时语音识别。</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-indigo-500 text-white text-xl font-bold flex items-center justify-center mx-auto mb-4">3</div>
                <h3 className="font-semibold text-slate-800 mb-2">获取建议</h3>
                <p className="text-slate-500 text-sm">AI 会根据对话自动生成回复建议。</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ========== Electron 桌面端布局（保持原有设计）==========
  return (
    <div className="p-8">
      <div className="mx-auto max-w-5xl">
        {/* 欢迎标题 */}
        <header className="mb-8">
          <h1 className="text-text-light dark:text-text-dark text-4xl font-black leading-tight tracking-[-0.033em]">
            欢迎回来！
          </h1>
          <p className="text-text-muted-light dark:text-text-muted-dark text-base font-normal leading-normal">
            这是您的对话项目快照。
          </p>
        </header>

        {/* 统计卡片 */}
        <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {loading ? (
            <div className="col-span-full text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : statistics ? (
            <>
              <StatCard icon="groups" label="攻略对象" value={statistics.characterCount || 0} />
              <StatCard icon="chat_bubble" label="对话" value={statistics.conversationCount || 0} />
              <StatCard icon="account_tree" label="消息" value={statistics.messageCount || 0} />
              <StatCard icon="favorite" label="平均好感度" value={statistics.avgAffinity || 0} />
            </>
          ) : null}
        </div>

        {/* 最近对话 */}
        <div className="mb-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="text-2xl font-bold text-text-light dark:text-text-dark">最近对话</h2>
            <div className="flex items-center gap-2">
              <Link
                to="/live"
                className="flex items-center gap-2 px-5 h-11 border border-primary text-primary rounded-full font-bold text-sm hover:bg-primary/5 transition-colors"
              >
                <span className="material-symbols-outlined text-base">support_agent</span>
                实时助手
              </Link>
              <Link
                to="/conversations"
                className="flex items-center gap-2 px-5 h-11 bg-primary text-white rounded-full font-bold text-sm hover:opacity-90 transition-opacity"
              >
                <span className="material-symbols-outlined text-base">add</span>
                新对话
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {loading ? (
              <div className="col-span-full text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : conversations.length === 0 ? (
              <div className="col-span-full text-center py-12">
                <p className="text-text-muted-light dark:text-text-muted-dark">最近没有对话哦～</p>
              </div>
            ) : (
              conversations.map((conv) => (
                <Link
                  key={conv.id}
                  to={`/conversations?character=${conv.character_id}&conversation=${conv.id}`}
                  className="flex flex-col rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark shadow-sm overflow-hidden hover:shadow-md transition-shadow"
                >
                  <div className="p-6">
                    <h3 className="text-lg font-bold text-text-light dark:text-text-dark mb-1">
                      {conv.title || '无标题对话'}
                    </h3>
                    <p className="text-sm text-text-muted-light dark:text-text-muted-dark">
                      {conv.character_name || '未知角色'} · {formatDate(conv.updated_at || conv.created_at)}
                    </p>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 统计卡片组件
function StatCard({ icon, label, value }) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark p-5 shadow-sm">
      <div className="flex size-12 items-center justify-center rounded-lg bg-primary-subtle-light dark:bg-primary-subtle-dark text-primary">
        <span className="material-symbols-outlined text-3xl">{icon}</span>
      </div>
      <div>
        <p className="text-sm font-medium text-text-muted-light dark:text-text-muted-dark">{label}</p>
        <p className="text-3xl font-bold text-text-light dark:text-text-dark">{value}</p>
      </div>
    </div>
  );
}

export default Overview;
