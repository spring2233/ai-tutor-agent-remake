import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './index.css';

import { LayoutEditor } from './components/layout/LayoutEditor';
import { ChatView } from './components/chat/ChatView';
import { ZoneExplorer } from './components/explore/ZoneExplorer';
import { CosmosModeBridge, CosmosProvider } from './cosmos/CosmosContext';
import { Landing } from './pages/Landing';
import { GalaxyArchive } from './pages/GalaxyArchive';
import { OrbitStage } from './pages/OrbitStage';
import { StarGallery } from './pages/StarGallery';

/** 旧的 /quest 链接带着 ?document= 转到星球探索。 */
const QuestRedirect = () => {
  const { search } = useLocation();
  return <Navigate to={`/explore${search}`} replace />;
};

function App() {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'cosmos');
  }, []);

  return (
    <BrowserRouter>
      <CosmosProvider>
        <CosmosModeBridge />
        <Routes>
          <Route path="/layout" element={<LayoutEditor />} />
          <Route path="/" element={<Landing />} />
          <Route path="/chat" element={<GalaxyArchive />} />
          <Route path="/gallery" element={<StarGallery />} />
          <Route
            path="/ask"
            element={
              <OrbitStage>
                <ChatView embedded />
              </OrbitStage>
            }
          />
          <Route path="/explore" element={<ZoneExplorer />} />
          <Route path="/quest" element={<QuestRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </CosmosProvider>
    </BrowserRouter>
  );
}

export default App;
