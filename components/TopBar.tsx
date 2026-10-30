'use client';

import { Archive, Moon, NotebookPen, Square } from 'lucide-react';
import type { Capabilities, Mode } from '@/domain/types';
import { StateAvatar } from './StateAvatar';
import { agentSummary } from './ServiceStatus';
import { ACTIVITY_META, MODE_META, type AvatarState } from './labels';

interface TopBarProps {
  avatarState: AvatarState;
  mode: Mode;
  caps: Capabilities | null;
  active: boolean;
  panelOpen: boolean;
  cardFlag: boolean;
  onTogglePanel: () => void;
  onOpenArchive: () => void;
  onOpenStatus: () => void;
  onStop: () => void;
  onEnd: () => void;
}

const QUIET_STATES: AvatarState[] = ['idle', 'paused', 'error', 'ended'];

export function TopBar(props: TopBarProps) {
  const { avatarState, mode, caps, active, panelOpen, cardFlag, onTogglePanel, onOpenArchive, onOpenStatus, onStop, onEnd } =
    props;
  const agent = agentSummary(caps);
  const working = !QUIET_STATES.includes(avatarState);

  return (
    <header className="topbar">
      <div className="topbar__id">
        <StateAvatar state={avatarState} size="sm" />
        <div className="topbar__who">
          <p className="topbar__name">
            面包<span className="topbar__role">面试后交流与整理助手</span>
            <button
              type="button"
              className={`svc-pill svc-pill--${agent.tone}`}
              onClick={onOpenStatus}
              aria-haspopup="dialog"
              title="服务与数据"
            >
              <span className="svc-pill__dot" aria-hidden="true" />
              {agent.short}
              <span className="svc-pill__more">· 服务与数据</span>
            </button>
          </p>
          <p className="topbar__state">
            <span className={`state-dot ${working ? 'is-working' : ''}`} aria-hidden="true" />
            {ACTIVITY_META[avatarState].label}
            <span aria-hidden="true"> · </span>
            <span className="sr-only">当前模式：</span>
            {MODE_META[mode].label}
          </p>
        </div>
      </div>

      <div className="topbar__tools">
        <button
          type="button"
          className={`tool-btn ${panelOpen ? 'is-on' : ''}`}
          onClick={onTogglePanel}
          aria-expanded={panelOpen}
          aria-label={`今晚的材料${cardFlag ? '（有新卡片）' : ''}`}
        >
          <NotebookPen aria-hidden="true" />
          <span className="tool-btn__label">今晚的材料</span>
          {cardFlag && <span className="badge-dot" aria-hidden="true" />}
        </button>
        <button type="button" className="tool-btn" onClick={onOpenArchive} aria-haspopup="dialog" aria-label="本设备档案">
          <Archive aria-hidden="true" />
          <span className="tool-btn__label">本设备档案</span>
        </button>
      </div>

      <div className="topbar__controls" role="group" aria-label="会话控制">
        <button
          type="button"
          className={`btn btn--stop ${working ? 'is-hot' : ''}`}
          onClick={onStop}
          disabled={!active}
          aria-keyshortcuts="Escape"
          title="停止当前的回应、播放、录音或转写（Esc）"
        >
          <Square aria-hidden="true" />
          停止
        </button>
        <button
          type="button"
          className="btn btn--end"
          onClick={onEnd}
          disabled={!active}
          title="结束今晚：停止一切，进入结束页"
        >
          <Moon aria-hidden="true" />
          结束
        </button>
      </div>
    </header>
  );
}
