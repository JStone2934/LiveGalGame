import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

function Overview() {
  const [statistics, setStatistics] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('Overview component mounted');
    console.log('window.electronAPI:', window.electronAPI);
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      console.log('Loading data...');

      // 检查是否在 Electron 环境中
      const isElectron = window.electronAPI !== undefined;

      if (!isElectron) {
        console.warn('⚠️ 当前不在 Electron 环境中，无法加载数据。请在 Electron 应用中打开此页面。');
        setLoading(false);
        return;
      }

      // 加载统计数据
      if (window.electronAPI?.getStatistics) {
        console.log('Calling getStatistics...');
        const stats = await window.electronAPI.getStatistics();
        console.log('Statistics loaded:', stats);
        setStatistics(stats);
      } else {
        console.log('electronAPI.getStatistics not available');
      }

      // 加载最近对话
      if (window.electronAPI?.getRecentConversations) {
        console.log('Calling getRecentConversations...');
        const recent = await window.electronAPI.getRecentConversations(10);
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const filtered = recent.filter((conv) => {
          const timestamp = new Date(conv.updated_at || conv.created_at || 0).getTime();
          return timestamp >= weekAgo;
        });
        console.log('Filtered recent conversations (1 week):', filtered);
        console.log('Recent conversations loaded:', recent);
        setConversations(filtered);
      } else {
        console.log('electronAPI.getRecentConversations not available');
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
              <p className="mt-4 text-text-muted-light dark:text-text-muted-dark">加载中...</p>
            </div>
          ) : statistics ? (
            <>
              <div className="stat-card flex items-start gap-4 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark p-5 shadow-sm">
                <div className="stat-icon flex size-12 items-center justify-center rounded-lg bg-primary-subtle-light dark:bg-primary-subtle-dark text-primary">
                  <span className="material-symbols-outlined text-3xl">groups</span>
                </div>
                <div>
                  <p className="stat-label text-sm font-medium text-text-muted-light dark:text-text-muted-dark">
                    攻略对象
                  </p>
                  <p className="stat-value text-3xl font-bold text-text-light dark:text-text-dark">
                    {statistics.characterCount || 0}
                  </p>
                </div>
              </div>
              <div className="stat-card flex items-start gap-4 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark p-5 shadow-sm">
                <div className="stat-icon flex size-12 items-center justify-center rounded-lg bg-primary-subtle-light dark:bg-primary-subtle-dark text-primary">
                  <span className="material-symbols-outlined text-3xl">chat_bubble</span>
                </div>
                <div>
                  <p className="stat-label text-sm font-medium text-text-muted-light dark:text-text-muted-dark">
                    对话
                  </p>
                  <p className="stat-value text-3xl font-bold text-text-light dark:text-text-dark">
                    {statistics.conversationCount || 0}
                  </p>
                </div>
              </div>
              <div className="stat-card flex items-start gap-4 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark p-5 shadow-sm">
                <div className="stat-icon flex size-12 items-center justify-center rounded-lg bg-primary-subtle-light dark:bg-primary-subtle-dark text-primary">
                  <span className="material-symbols-outlined text-3xl">account_tree</span>
                </div>
                <div>
                  <p className="stat-label text-sm font-medium text-text-muted-light dark:text-text-muted-dark">
                    消息
                  </p>
                  <p className="stat-value text-3xl font-bold text-text-light dark:text-text-dark">
                    {statistics.messageCount || 0}
                  </p>
                </div>
              </div>
              <div className="stat-card flex items-start gap-4 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark p-5 shadow-sm">
                <div className="stat-icon flex size-12 items-center justify-center rounded-lg bg-primary-subtle-light dark:bg-primary-subtle-dark text-primary">
                  <span className="material-symbols-outlined text-3xl">favorite</span>
                </div>
                <div>
                  <p className="stat-label text-sm font-medium text-text-muted-light dark:text-text-muted-dark">
                    平均好感度
                  </p>
                  <p className="stat-value text-3xl font-bold text-text-light dark:text-text-dark">
                    {statistics.avgAffinity || 0}
                  </p>
                </div>
              </div>
            </>
          ) : window.electronAPI === undefined ? (
            <div className="col-span-full text-center py-8">
              <div className="inline-flex flex-col items-center gap-4 max-w-md mx-auto">
                <div className="text-6xl">⚠️</div>
                <div>
                  <p className="text-lg font-semibold text-text-light dark:text-text-dark mb-2">
                    请在 Electron 应用中打开
                  </p>
                  <p className="text-sm text-text-muted-light dark:text-text-muted-dark">
                    当前页面在普通浏览器中打开，无法访问 Electron API。
                    <br />
                    请在 LiveGalGame Desktop 应用中查看数据。
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="col-span-full text-center py-8">
              <p className="text-red-500">加载失败</p>
            </div>
          )}
        </div>

        {/* 最近对话标题 */}
        <div className="mb-6">
          <div className="flex items-center justify-between gap-4 mb-2">
            <div className="flex items-center gap-1">
              <h2 className="text-2xl font-bold text-text-light dark:text-text-dark">最近对话</h2>
              <div className="relative group">
                <sup className="text-text-muted-light dark:text-text-muted-dark text-xs cursor-help" style={{ fontSize: '10px', lineHeight: 0 }}>
                  ①
                </sup>
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-10">
                  只展示最近一星期的对话
                  <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900 dark:border-t-gray-700"></div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to="/live"
                className="btn-hud flex min-w-[84px] items-center justify-center gap-2 overflow-hidden rounded-full h-11 px-5 border border-primary text-primary text-sm font-bold leading-normal tracking-[0.015em] hover:bg-primary-subtle-light/50 dark:hover:bg-primary-subtle-dark/50 transition-colors"
              >
                <span className="material-symbols-outlined text-base">support_agent</span>
                <span className="truncate">实时助手</span>
              </Link>
              <Link
                to="/conversations"
                className="btn-new-conversation flex min-w-[84px] items-center justify-center gap-2 overflow-hidden rounded-full h-11 px-5 bg-primary text-white text-sm font-bold leading-normal tracking-[0.015em] hover:opacity-90 transition-opacity"
              >
                <span className="material-symbols-outlined text-base">add</span>
                <span className="truncate">新对话</span>
              </Link>
            </div>
          </div>
          <p className="text-text-muted-light dark:text-text-muted-dark text-xs">
            ① 最近一星期内的对话
          </p>
        </div>

        {/* 最近对话列表 */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {loading ? (
            <div className="col-span-full text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="mt-4 text-text-muted-light dark:text-text-muted-dark">加载中...</p>
            </div>
          ) : conversations.length === 0 ? (
            <div className="col-span-full text-center py-12">
              <p className="text-text-muted-light dark:text-text-muted-dark">最近没有对话哦～</p>
            </div>
          ) : (
            <>
              {conversations.map((conv) => (
                <Link
                  key={conv.id}
                  to={`/conversations?character=${conv.character_id}&conversation=${conv.id}`}
                  className="conversation-card flex flex-col rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark shadow-sm overflow-hidden group hover:shadow-md transition-shadow cursor-pointer"
                >
                  <div className="p-6 flex-grow">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h3 className="text-lg font-bold text-text-light dark:text-text-dark mb-1">
                          {conv.title || '无标题对话'}
                        </h3>
                        <div className="flex items-center gap-2 mb-2">
                          <div
                            className="bg-center bg-no-repeat aspect-square bg-cover rounded-full size-6 border-2 border-surface-light dark:border-surface-dark"
                            style={{
                              backgroundColor: conv.character_avatar_color || '#ff6b6b',
                            }}
                          />
                          <span className="text-sm text-text-muted-light dark:text-text-muted-dark">
                            与 {conv.character_name || '未知角色'} 的对话
                          </span>
                        </div>
                      </div>
                      <div className="flex -space-x-2">
                        <div
                          className="bg-center bg-no-repeat aspect-square bg-cover rounded-full size-8 border-2 border-surface-light dark:border-surface-dark"
                          style={{
                            backgroundColor: conv.character_avatar_color || '#ff6b6b',
                          }}
                        />
                      </div>
                    </div>
                    <p className="text-text-muted-light dark:text-text-muted-dark text-sm line-clamp-2">
                      {conv.summary || '暂无摘要'}
                    </p>
                  </div>
                  <div className="px-6 py-4 border-t border-border-light dark:border-border-dark bg-primary-subtle-light/50 dark:bg-primary-subtle-dark/50">
                    <p className="text-xs text-text-muted-light dark:text-text-muted-dark">
                      最后编辑：{formatDate(conv.updated_at)}
                    </p>
                  </div>
                </Link>
              ))}
              <Link
                to="/conversations"
                className="group flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border-light dark:border-border-dark p-6 text-center transition-colors hover:border-primary/50 hover:bg-primary-subtle-light/50 dark:hover:border-primary/50 dark:hover:bg-primary-subtle-dark/50"
              >
                <span className="material-symbols-outlined text-4xl text-text-muted-light dark:text-text-muted-dark group-hover:text-primary transition-colors">
                  add_circle
                </span>
                <h3 className="font-bold text-text-light dark:text-text-dark">创建新对话</h3>
                <p className="text-sm text-text-muted-light dark:text-text-muted-dark">从头开始一段新对话。</p>
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default Overview;

