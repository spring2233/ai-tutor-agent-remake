import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCosmos } from '../cosmos/CosmosContext';
import { OrbitModes } from '../components/shell/OrbitModes';
import './landing.css';
import './galaxy.css';

export const OrbitStage = ({ children }: { children: ReactNode }) => {
  const { loaded } = useCosmos();
  const [params] = useSearchParams();
  const documentId = params.get('document') || localStorage.getItem('ai-tutor-current-document-v2');
  return (
    <div className="landing-root orbit-stage">
      <div className="landing-ui on">
        <header className="landing-header">
          <Link className="landing-logo" to="/chat" aria-label="返回星系">
            Starlore 知识星典
          </Link>
          <OrbitModes documentId={documentId} />
        </header>
        <div className="orbit-hud">{children}</div>
      </div>
      <div className={`landing-loader${loaded ? ' gone' : ''}`}>
        <span />
      </div>
    </div>
  );
};
