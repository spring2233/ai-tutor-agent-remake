import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';

import { LayoutEditor } from './components/layout/LayoutEditor';
import { ChatView } from './components/chat/ChatView';
import { FlashcardsView } from './components/flashcards/FlashcardsView';
import { QuestView } from './components/quest/QuestView';
import { CosmosModeBridge, CosmosProvider } from './cosmos/CosmosContext';
import { Landing } from './pages/Landing';
import { GalaxyArchive } from './pages/GalaxyArchive';
import { OrbitStage } from './pages/OrbitStage';

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
          <Route
            path="/ask"
            element={
              <OrbitStage>
                <ChatView embedded />
              </OrbitStage>
            }
          />
          <Route
            path="/quest"
            element={
              <OrbitStage>
                <QuestView />
              </OrbitStage>
            }
          />
          <Route
            path="/flashcards"
            element={
              <OrbitStage>
                <FlashcardsView />
              </OrbitStage>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </CosmosProvider>
    </BrowserRouter>
  );
}

export default App;
