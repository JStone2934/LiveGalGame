import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import WebLayout from './components/WebLayout';
import Overview from './pages/Overview';
import Characters from './pages/Characters';
import ConversationEditor from './pages/ConversationEditor';
import Settings from './pages/Settings';
import ASRSettings from './pages/ASRSettings';
import StoryTreePage from './pages/StoryTreePage';
import LiveAssistant from './pages/LiveAssistant';

// 检测是否在 Electron 环境中
const isElectron = !!(window.electronAPI?.isElectron);

function App() {
  console.log('App component rendering, isElectron:', isElectron);
  
  // Web 端使用简化布局，Electron 端使用完整布局
  const AppLayout = isElectron ? Layout : WebLayout;
  
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/characters" element={<Characters />} />
        <Route path="/conversations" element={<ConversationEditor />} />
        <Route path="/live" element={<LiveAssistant />} />
        <Route path="/review/:conversationId" element={<StoryTreePage />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/asr-settings" element={<ASRSettings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
}

export default App;

