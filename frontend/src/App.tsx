import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';

import { LayoutEditor } from './components/layout/LayoutEditor';
import { Landing } from './pages/Landing';
import { QuestStage } from './pages/QuestStage';

function App() {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'cosmos');
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/layout" element={<LayoutEditor />} />
        <Route path="/" element={<Landing />} />
        <Route path="/quest" element={<QuestStage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
