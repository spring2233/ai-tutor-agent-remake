import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useCosmos } from '../cosmos/CosmosContext';
import './landing.css';
import './galaxy.css';

export const OrbitStage = ({ children }: { children: ReactNode }) => {
  const { loaded } = useCosmos();
  return (
    <div className="landing-root orbit-stage">
      <div className="landing-ui on">
        <header className="landing-header">
          <Link className="landing-logo" to="/chat" aria-label="返回星系">
            AI 导师
          </Link>
          <Link className="pill hud-pill" to="/chat">
            返回星系
          </Link>
        </header>
        <div className="orbit-hud">{children}</div>
      </div>
      <div className={`landing-loader${loaded ? ' gone' : ''}`}>
        <span />
      </div>
    </div>
  );
};
