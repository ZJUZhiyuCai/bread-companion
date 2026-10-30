'use client';

import type { Capabilities } from '@/domain/types';
import { Dialog } from './Dialog';
import { formatBytes } from './labels';

export type TextSize = 'm' | 'l' | 'xl';

export function agentSummary(caps: Capabilities | null): { short: string; tone: 'checking' | 'mock' | 'real' } {
  if (!caps) return { short: '检查服务中…', tone: 'checking' };
  if (caps.agent.mode === 'mock') return { short: '规则演示', tone: 'mock' };
  return { short: '真实 AI', tone: 'real' };
}

/** Compact chips used on the entry screen and in the top bar dialog trigger. */
export function ServiceChips({ caps }: { caps: Capabilities | null }) {
  const agent = agentSummary(caps);
  return (
    <ul className="svc-chips" aria-label="服务状态">
      <li className={`svc-chip svc-chip--${agent.tone}`}>
        <span className="svc-chip__dot" aria-hidden="true" />
        文本：{agent.short}
      </li>
      <li className={`svc-chip ${caps?.asr.available ? 'svc-chip--ok' : 'svc-chip--off'}`}>
        <span className="svc-chip__dot" aria-hidden="true" />
        语音识别：{!caps ? '检查中' : caps.asr.available ? '可用' : '不可用'}
      </li>
      <li className={`svc-chip ${caps?.tts.available ? 'svc-chip--ok' : 'svc-chip--off'}`}>
        <span className="svc-chip__dot" aria-hidden="true" />
        语音播报：{!caps ? '检查中' : caps.tts.available ? '可用' : '不可用'}
      </li>
    </ul>
  );
}

interface StatusDialogProps {
  open: boolean;
  onClose: () => void;
  caps: Capabilities | null;
  textSize: TextSize;
  setTextSize: (s: TextSize) => void;
}

export function StatusDialog({ open, onClose, caps, textSize, setTextSize }: StatusDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="服务与数据" subtitle="这次会话实际用到了什么，内容会去哪里。">
      {!caps ? (
        <p className="muted">正在检查服务能力…检查完成前，语音按钮保持不可用。</p>
      ) : (
        <dl className="status-list">
          <div>
            <dt>文本回应</dt>
            <dd>
              {caps.agent.mode === 'mock' ? (
                <>
                  <strong>规则演示</strong>：按预设规则回应，不是真实 AI，也不会假装理解任意话题。
                </>
              ) : (
                <>
                  <strong>真实 AI</strong>：由服务端调用模型生成，结果核对后才显示。
                </>
              )}
              <span className="status-list__meta">{caps.agent.label}</span>
            </dd>
          </div>
          <div>
            <dt>语音识别</dt>
            <dd>
              {caps.asr.available ? <strong>可用</strong> : <strong>不可用</strong>}
              <span className="status-list__meta">
                {caps.asr.label}
                {caps.asr.reason ? ` · ${caps.asr.reason}` : ''}
              </span>
            </dd>
          </div>
          <div>
            <dt>语音播报</dt>
            <dd>
              {caps.tts.available ? <strong>可用，点击才播放</strong> : <strong>不可用</strong>}
              <span className="status-list__meta">
                {caps.tts.label}
                {caps.tts.reason ? ` · ${caps.tts.reason}` : ''}
              </span>
            </dd>
          </div>
          <div>
            <dt>上限</dt>
            <dd>
              单条输入 {caps.limits.maxInputChars} 字 · 单段材料 {caps.limits.maxSourceChars} 字 · 录音最长{' '}
              {caps.limits.maxRecordingSeconds} 秒 / {formatBytes(caps.limits.maxAudioBytes)}
            </dd>
          </div>
        </dl>
      )}

      <section className="status-section">
        <h3>数据怎么处理</h3>
        {caps ? <p className="prewrap">{caps.processingNotice}</p> : <p className="muted">检查中…</p>}
        <p>
          默认是临时会话：聊天和材料只在这个页面里，刷新或结束后就没有了。只有你确认、并且在保存预览里点了“保存”的那一版卡片，才会存到<strong>本设备的当前浏览器</strong>。
          它不是云备份，不能跨设备，清理浏览器数据会一起删除；如果这台设备有别人用，他们也可能看到。
        </p>
      </section>

      <section className="status-section">
        <h3 id="text-size-label">字号</h3>
        <div className="segmented" role="radiogroup" aria-labelledby="text-size-label">
          {(
            [
              ['m', '标准'],
              ['l', '大'],
              ['xl', '特大'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="segmented__item">
              <input
                type="radio"
                name="text-size"
                value={value}
                checked={textSize === value}
                onChange={() => setTextSize(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p className="muted small">只对这次打开的页面有效，不会写入存储。</p>
      </section>

      <section className="status-section">
        <h3>键盘</h3>
        <ul className="keys">
          <li>
            <kbd>Esc</kbd> 停止当前的回应、播放或转写
          </li>
          <li>
            <kbd>Enter</kbd> 发送，<kbd>Shift</kbd> + <kbd>Enter</kbd> 换行（输入法组字时不会发送）
          </li>
          <li>
            <kbd>Tab</kbd> 在按钮之间移动，顶栏右侧固定是“停止”和“结束”
          </li>
        </ul>
      </section>
    </Dialog>
  );
}
