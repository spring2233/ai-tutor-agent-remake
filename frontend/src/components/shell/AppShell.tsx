import { NavLink, Outlet, Link } from 'react-router-dom';

export const AppShell = () => {
  return (
    <div className="app-container">
      <header className="hud-bar">
        <Link className="hud-logo" to="/" aria-label="回到星空首页">
          AI 导师
        </Link>
        <nav className="hud-nav" aria-label="功能">
          <NavLink to="/chat" end className={({ isActive }) => `hud-link${isActive ? ' active' : ''}`}>
            问答
          </NavLink>
          <NavLink to="/flashcards" className={({ isActive }) => `hud-link${isActive ? ' active' : ''}`}>
            闪卡
          </NavLink>
          <NavLink to="/quest" className={({ isActive }) => `hud-link${isActive ? ' active' : ''}`}>
            闯关
          </NavLink>
          <NavLink to="/game" className={({ isActive }) => `hud-link${isActive ? ' active' : ''}`}>
            记忆配对
          </NavLink>
          <Link className="pill hud-pill" to="/chat?shelf=1">
            上传与书架
          </Link>
        </nav>
      </header>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
};
