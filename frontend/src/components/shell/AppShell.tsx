import { NavLink, Outlet, Link } from 'react-router-dom';

export const AppShell = () => {
  return (
    <div className="app-container">
      <header className="hud-bar">
        <Link className="hud-logo" to="/" aria-label="回到星空首页">
          AI 导师
        </Link>
        <nav className="hud-nav" aria-label="功能">
          <NavLink to="/explore" className={({ isActive }) => `hud-link${isActive ? ' active' : ''}`}>
            星球探索
          </NavLink>
          <NavLink to="/ask" className={({ isActive }) => `hud-link${isActive ? ' active' : ''}`}>
            知识问答
          </NavLink>
          <Link className="pill hud-pill" to="/chat">
            返回星系
          </Link>
        </nav>
      </header>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
};
