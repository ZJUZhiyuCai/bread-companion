'use client';

import { Archive, Moon, PanelRight, Square } from 'lucide-react';
import type { Capabilities } from '@/domain/types';
import { AiStamp } from './ServiceStatus';
import { ACTIVITY_META, type AvatarState } from './labels';

interface TopBarProps {
  caps: Capabilities | null;
  activity: AvatarState;
  active: boolean;
  working: boolean;
  trayOpen: boolean;
  trayCount: number;
  /** A card is on the table that hasn't been kept yet — a hint, never a blocker. */
  cardWaiting: boolean;
  /** During a call the room has its own pause and hang-up; only 结束 stays up here. */
  inCall?: boolean;
  onToggleTray: () => void;
  onOpenArchive: () => void;
  onOpenAbout: () => void;
  onStop: () => void;
  onEnd: () => void;
}

export function TopBar(props: TopBarProps) {
  const {
    caps,
    activity,
    active,
    working,
    trayOpen,
    trayCount,
    cardWaiting,
    inCall = false,
    onToggleTray,
    onOpenArchive,
    onOpenAbout,
    onStop,
    onEnd,
  } = props;

  if (inCall) {
    return (
      <header className="topbar topbar--call">
        <div className="topbar__id">
          <p className="wordmark wordmark--sm">面包</p>
          <AiStamp caps={caps} onClick={onOpenAbout} />
        </div>
        <div className="topbar__controls" role="group" aria-label="会话控制">
          <button
            type="button"
            className="ctl ctl--end"
            onClick={onEnd}
            disabled={!active}
            title="挂断，并结束今晚的对话"
          >
            <Moon aria-hidden="true" />
            结束
          </button>
        </div>
      </header>
    );
  }

  return (
    <header className="topbar">
      <div className="topbar__id">
        <p className="wordmark wordmark--sm">面包</p>
        <AiStamp caps={caps} onClick={onOpenAbout} />
      </div>

      <nav className="topbar__tools" aria-label="桌上和抽屉">
        <button
          type="button"
          className={`tool-btn ${trayOpen ? 'is-on' : ''}`}
          onClick={onToggleTray}
          aria-expanded={trayOpen}
          aria-label={`今晚的卡片与材料${trayCount > 0 ? `，${trayCount} 样` : ''}`}
        >
          <PanelRight aria-hidden="true" />
          <span className="tool-btn__label">卡片与材料</span>
          {trayCount > 0 && (
            <span className="tool-btn__count" aria-hidden="true">
              {trayCount}
            </span>
          )}
        </button>
        <button type="button" className="tool-btn" onClick={onOpenArchive} aria-haspopup="dialog" aria-label="以前留下的">
          <Archive aria-hidden="true" />
          <span className="tool-btn__label">以前留下的</span>
        </button>
      </nav>

      <div className="topbar__controls" role="group" aria-label="会话控制">
        <button
          type="button"
          className={`ctl ctl--stop ${working ? 'is-hot' : ''}`}
          onClick={onStop}
          disabled={!active}
          aria-keyshortcuts="Escape"
          aria-describedby="stop-desc"
          title="停下（Esc）"
        >
          <Square aria-hidden="true" />
          停止
        </button>
        <span id="stop-desc" className="sr-only">
          {working ? `现在面包${ACTIVITY_META[activity].label}` : '现在没有正在进行的事'}
        </span>
        <button
          type="button"
          className="ctl ctl--end"
          onClick={onEnd}
          disabled={!active}
          title={cardWaiting ? '结束今晚，卡片之后还能留' : '结束今晚'}
        >
          <Moon aria-hidden="true" />
          结束
          {cardWaiting && <span className="ctl__dot" aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}
