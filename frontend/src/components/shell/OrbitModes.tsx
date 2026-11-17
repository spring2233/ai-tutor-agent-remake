import { Link, NavLink } from 'react-router-dom';

/** 轨道态只有两个核心模式：星球探索（主推）与知识问答，外加返回星系。 */
export const OrbitModes = ({ documentId }: { documentId: string | null }) => {
  const query = documentId ? `?document=${documentId}` : '';
  const mode = ({ isActive }: { isActive: boolean }) => `orbit-mode${isActive ? ' active' : ''}`;
  return (
    <nav className="orbit-modes hud-glass" aria-label="星球模式">
      <NavLink to={`/explore${query}`} className={mode}>
        星球探索
      </NavLink>
      <NavLink to={`/ask${query}`} className={mode}>
        知识问答
      </NavLink>
      <Link to="/chat" className="orbit-mode back">
        返回星系
      </Link>
    </nav>
  );
};
