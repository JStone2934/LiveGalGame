// 渲染进程脚本
console.log('Renderer process loaded');

// 当前选中的对话
let currentConversation = null;

// 对话数据（将从数据库加载）
let conversations = {};

// DOM加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded');
  initializeApp();
});

// 初始化应用
function initializeApp() {
  setupEventListeners();
  setupNavigation();
  setupHUDControl();
  console.log('App initialized');
}

// 设置HUD控制
function setupHUDControl() {
  const showHUDBtn = document.getElementById('btn-show-hud');
  if (showHUDBtn) {
    showHUDBtn.addEventListener('click', () => {
      console.log('Show HUD button clicked');
      if (window.electronAPI && window.electronAPI.showHUD) {
        window.electronAPI.showHUD();
      } else {
        console.error('electronAPI.showHUD not available');
        alert('electronAPI.showHUD 不可用');
      }
    });
  }

  console.log('HUD control setup');
}

// 设置导航事件
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      const href = item.getAttribute('href');

      // 如果是外部链接（不是 #），允许默认跳转
      if (href && href !== '#' && !href.startsWith('#')) {
        console.log(`Navigating to: ${href}`);
        return; // 允许默认行为
      }

      // 阻止默认行为，处理内部导航
      e.preventDefault();
      const page = item.dataset.page;

      // 更新导航激活状态
      navItems.forEach(nav => nav.classList.remove('bg-white/20'));
      navItems.forEach(nav => nav.classList.add('text-white/80'));
      item.classList.add('bg-white/20');
      item.classList.remove('text-white/80');

      console.log(`Navigate to: ${page}`);

      // 显示即将推出的提示
      if (page === 'characters') {
        alert('攻略对象管理功能即将推出！');
      } else if (page === 'settings') {
        alert('设置功能即将推出！');
      }
    });
  });
}

// 设置事件监听器
function setupEventListeners() {
  // 对话列表点击事件
  const conversationItems = document.querySelectorAll('.conversation-item');
  conversationItems.forEach(item => {
    item.addEventListener('click', () => {
      const conversationId = item.dataset.conversationId;
      selectConversation(conversationId);
    });
  });

  // "新对话"按钮
  const newConversationBtns = document.querySelectorAll('.btn-create-conversation');
  newConversationBtns.forEach(btn => {
    btn.addEventListener('click', createNewConversation);
  });

  // "添加消息"按钮
  const addMessageBtn = document.querySelector('.btn-add-message');
  if (addMessageBtn) {
    addMessageBtn.addEventListener('click', addNewMessage);
  }

  // "保存对话"按钮
  const saveBtn = document.querySelector('.btn-save-conversation');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveConversation);
  }

  console.log('Event listeners attached');
}

// 选择对话
function selectConversation(conversationId) {
  currentConversation = conversationId;

  // 更新UI
  updateConversationListUI(conversationId);
  showConversation(conversationId);

  console.log(`Selected conversation: ${conversationId}`);
}

// 更新对话列表UI
function updateConversationListUI(selectedId) {
  const items = document.querySelectorAll('.conversation-item');
  items.forEach(item => {
    item.classList.remove('bg-surface-light', 'dark:bg-surface-dark');
    item.classList.add('hover:bg-surface-light', 'dark:hover:bg-surface-dark');
  });

  const selectedItem = document.querySelector(`[data-conversation-id="${selectedId}"]`);
  if (selectedItem) {
    selectedItem.classList.remove('hover:bg-surface-light', 'dark:hover:bg-surface-dark');
    selectedItem.classList.add('bg-surface-light', 'dark:bg-surface-dark');
  }
}

// 显示对话详情
function showConversation(conversationId) {
  const conversation = conversations[conversationId];
  if (!conversation) return;

  // 隐藏欢迎页，显示对话页
  document.getElementById('welcome-page').classList.add('hidden');
  document.getElementById('conversation-page').classList.remove('hidden');

  // 更新对话头部信息
  updateConversationHeader(conversation);

  // 渲染消息列表
  renderMessages(conversation.messages);

  // 更新AI洞察
  updateAIInsights(conversationId);

  console.log(`Showing conversation: ${conversation.name}`);
}

// 更新对话头部
function updateConversationHeader(conversation) {
  const avatar = document.querySelector('.conversation-avatar');
  const title = document.querySelector('.conversation-title');
  const tags = document.querySelector('.conversation-tags');

  if (avatar) avatar.style.backgroundColor = conversation.avatarColor;
  if (title) title.innerHTML = `与 ${conversation.name} 的对话<span class="text-primary">*</span>`;

  if (tags) {
    tags.innerHTML = conversation.tags.map(tag => `
      <span class="inline-flex items-center gap-1.5 bg-blue-100 dark:bg-blue-900/40
                 text-blue-700 dark:text-blue-300 text-xs font-medium px-2 py-0.5 rounded-full">
        <span class="material-symbols-outlined text-sm">mood</span><span>${tag}</span>
      </span>
    `).join('');
  }
}

// 渲染消息列表
function renderMessages(messages) {
  const container = document.querySelector('.conversation-messages');
  if (!container) return;

  container.innerHTML = messages.map(msg => {
    const isUser = msg.sender === 'user';
    return `
      <div class="flex items-end gap-3 ${isUser ? 'justify-end ml-auto' : ''} max-w-xl">
        ${!isUser ? `
          <div class="bg-center bg-no-repeat aspect-square bg-cover rounded-full w-10 shrink-0"
               style="background-color: #ff6b6b;"></div>
        ` : ''}
        <div class="flex flex-col gap-1 items-${isUser ? 'end' : 'start'}">
          <p class="text-text-muted-light dark:text-text-muted-dark text-sm font-medium leading-normal px-1">
            ${isUser ? '我' : '攻略对象'}
          </p>
          <div class="relative group">
            <p class="text-base font-normal leading-normal rounded-2xl ${isUser ? 'rounded-br-md' : 'rounded-bl-md'}
                       px-4 py-3 ${isUser ? 'bg-primary text-white' : 'bg-surface-light dark:bg-surface-dark text-text-light dark:text-text-dark'}">
              ${msg.content || msg.text || ''}
            </p>
            <div class="absolute ${isUser ? '-left-2' : '-right-2'} top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button class="p-1.5 rounded-full bg-background-light dark:bg-background-dark hover:bg-primary/20">
                <span class="material-symbols-outlined text-lg">edit</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// 创建新对话
function createNewConversation() {
  console.log('Create new conversation');
  alert('新对话功能即将推出！');
}

// 添加新消息
function addNewMessage() {
  console.log('Add new message');
  alert('添加消息功能即将推出！');
}

// 保存对话
function saveConversation() {
  console.log('Save conversation');
  alert('对话已保存！');
}

// 移除标签
window.removeTag = function(button) {
  const tagElement = button.parentElement;
  tagElement.remove();
  console.log('Tag removed');
}

// 添加标签
function addTag(tagName) {
  const selectedTagsContainer = document.getElementById('selected-tags');

  // 检查是否已存在
  const existingTags = Array.from(selectedTagsContainer.children);
  const exists = existingTags.some(tag => tag.textContent.includes(tagName));
  if (exists) {
    console.log(`Tag already exists: ${tagName}`);
    return;
  }

  // 创建新标签
  const tagElement = document.createElement('span');
  tagElement.className = 'inline-flex items-center gap-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-semibold px-2.5 py-1 rounded-full';
  tagElement.innerHTML = `
    ${tagName}
    <button class="ml-1 hover:text-red-500" onclick="removeTag(this)">
      <span class="material-symbols-outlined text-sm">close</span>
    </button>
  `;

  selectedTagsContainer.appendChild(tagElement);
  console.log(`Tag added: ${tagName}`);
}

// 设置AI面板事件监听器
function setupAIPanelEvents() {
  // 建议标签点击事件
  const suggestedTags = document.querySelectorAll('.suggested-tag');
  suggestedTags.forEach(btn => {
    btn.addEventListener('click', () => {
      const tagName = btn.dataset.tag;
      addTag(tagName);
    });
  });

  // 更新消息按钮
  const updateMessageBtn = document.getElementById('btn-update-message');
  if (updateMessageBtn) {
    updateMessageBtn.addEventListener('click', () => {
      const messageContent = document.getElementById('message-content').value;
      console.log('Update message:', messageContent);
      alert('消息已更新！');
    });
  }

  console.log('AI panel events attached');
}

// 更新对话时更新AI分析
function updateAIInsights(conversationId) {
  const insights = {
    miyu: [
      {
        icon: 'auto_awesome',
        color: 'text-yellow-600 dark:text-yellow-400',
        text: '这个回应非常有效。通过提出一起散步的建议，你主动推进了关系。这是一个关键的积极转折点。'
      },
      {
        icon: 'thumb_up',
        color: 'text-green-600 dark:text-green-400',
        text: '建议：继续保持主动，可以提出一个具体的见面地点，展现你的体贴。'
      }
    ],
    akira: [
      {
        icon: 'warning',
        color: 'text-orange-600 dark:text-orange-400',
        text: '对方提到了约定，这是一个重要的承诺节点，需要认真对待。'
      },
      {
        icon: 'help',
        color: 'text-blue-600 dark:text-blue-400',
        text: '建议：确认具体约定内容，展现你的可靠性和记忆力。'
      }
    ],
    hana: [
      {
        icon: 'auto_awesome',
        color: 'text-yellow-600 dark:text-yellow-400',
        text: '对方在分享日常生活，这是建立亲密感的好机会。'
      },
      {
        icon: 'favorite',
        color: 'text-pink-600 dark:text-pink-400',
        text: '建议：表现出对对方生活的兴趣，可以询问咖啡馆的细节。'
      }
    ]
  };

  const conversationInsights = insights[conversationId] || [];
  const container = document.getElementById('ai-insights');

  if (container && conversationInsights.length > 0) {
    const insightsHTML = conversationInsights.map(insight => `
      <div class="insight-item flex items-start gap-2.5">
        <span class="material-symbols-outlined text-lg ${insight.color} mt-0.5">${insight.icon}</span>
        <p class="insight-text text-text-muted-light dark:text-text-muted-dark">${insight.text}</p>
      </div>
    `).join('');

    container.innerHTML = `
      <h3 class="block text-base font-semibold text-text-light dark:text-text-dark mb-3">复盘分析</h3>
      <div class="flex flex-col gap-2 text-sm p-4 rounded-lg bg-surface-light dark:bg-surface-dark">
        ${insightsHTML}
      </div>
    `;
  }
}

// 暴露全局函数供HTML调用
window.LiveGalGame = {
  toggleDarkMode: () => {
    document.documentElement.classList.toggle('dark');
  }
};

// 初始化时设置AI面板事件
setupAIPanelEvents();
