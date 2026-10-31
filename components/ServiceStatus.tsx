'use client';

import type { Capabilities } from '@/domain/types';
import { Dialog } from './Dialog';
import { StateAvatar } from './StateAvatar';
import { formatBytes } from './labels';

export type TextSize = 'm' | 'l' | 'xl';

export function agentSummary(caps: Capabilities | null): { short: string; tone: 'checking' | 'mock' | 'real' } {
  if (!caps) return { short: '检查中', tone: 'checking' };
  if (caps.agent.mode === 'mock') return { short: '演示', tone: 'mock' };
  return { short: '真实模型', tone: 'real' };
}

/** The small stamp next to the name: always says it's an AI and whether replies are a demo. */
export function AiStamp({ caps, onClick }: { caps: Capabilities | null; onClick: () => void }) {
  const agent = agentSummary(caps);
  return (
    <button
      type="button"
      className={`ai-stamp ai-stamp--${agent.tone}`}
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={`关于面包：AI，${caps ? (caps.agent.mode === 'mock' ? '规则演示' : '真实模型') : '正在检查服务'}`}
    >
      <span className="ai-stamp__ai">AI</span>
      <span className="ai-stamp__mode">{agent.short}</span>
    </button>
  );
}

interface AboutSheetProps {
  open: boolean;
  onClose: () => void;
  caps: Capabilities | null;
  textSize: TextSize;
  setTextSize: (s: TextSize) => void;
}

/** Everything about identity, services and data, one tap away instead of on screen all the time. */
export function AboutSheet({ open, onClose, caps, textSize, setTextSize }: AboutSheetProps) {
  return (
    <Dialog open={open} onClose={onClose} title="关于面包" className="about">
      <div className="about__who">
        <StateAvatar state="idle" size="md" decorative />
        <div>
          <p className="about__lede">面包是一个 AI 程序，不是真人，也没有人在后台看着这段对话。</p>
          <p className="small muted">
            它可以陪你说说话、帮你留个记号、在你想要时一起看一段回答或练一题。它不做心理诊断，也不知道招聘方没有公开的决定原因——不知道的，它会说不知道。
          </p>
        </div>
      </div>

      <section className="about__section" aria-labelledby="about-svc">
        <h3 id="about-svc">这次用到的服务</h3>
        {!caps ? (
          <p className="muted">正在检查…检查完成前，语音按钮不可用。</p>
        ) : (
          <dl className="about__list">
            <div>
              <dt>回复</dt>
              <dd>
                {caps.agent.mode === 'mock' ? (
                  <>
                    <strong>规则演示</strong>：按预设规则回应，不是真实大模型，也不会假装听懂任意话题。
                  </>
                ) : (
                  <>
                    <strong>真实模型</strong>：由服务端调用模型生成，核对格式和引用后才显示。
                  </>
                )}
                {caps.agent.label && <span className="about__meta">{caps.agent.label}</span>}
              </dd>
            </div>
            <div>
              <dt>说给它听</dt>
              <dd>
                <strong>{caps.asr.available ? '可以，点麦克风才开始录' : '现在不可用'}</strong>
                <span className="about__meta">
                  {caps.asr.label}
                  {caps.asr.reason ? ` · ${caps.asr.reason}` : ''}
                </span>
              </dd>
            </div>
            <div>
              <dt>念给你听</dt>
              <dd>
                <strong>{caps.tts.available ? '可以，点“听”才播放，不会自动响' : '现在不可用，读文字就好'}</strong>
                <span className="about__meta">
                  {caps.tts.label}
                  {caps.tts.reason ? ` · ${caps.tts.reason}` : ''}
                </span>
              </dd>
            </div>
            <div>
              <dt>上限</dt>
              <dd>
                一次说 {caps.limits.maxInputChars} 字以内 · 一段材料 {caps.limits.maxSourceChars} 字以内 · 一段录音最长{' '}
                {caps.limits.maxRecordingSeconds} 秒（{formatBytes(caps.limits.maxAudioBytes)}）
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="about__section" aria-labelledby="about-data">
        <h3 id="about-data">你说的话去了哪里</h3>
        {caps?.processingNotice && <p className="prewrap">{caps.processingNotice}</p>}
        <ul className="about__points">
          <li>默认不保存：结束会清掉聊天和完整材料，只留下已经展示的有效卡片供你选择；刷新后，未保存的内容也会消失。</li>
          <li>只有你点了“就留下这些”的那张卡片，才会存到<strong>这台设备的这个浏览器</strong>里。它不是云备份，不能跨设备；清理浏览器数据会一起清掉；别人用这台设备的这个浏览器也可能看到。</li>
          <li>导出的文件直接下载到这台设备，不会发到任何地方。</li>
        </ul>
      </section>

      <section className="about__section" aria-labelledby="about-size">
        <h3 id="about-size">字号</h3>
        <div className="segmented" role="radiogroup" aria-labelledby="about-size">
          {(
            [
              ['m', '标准'],
              ['l', '大'],
              ['xl', '特大'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="segmented__item">
              <input type="radio" name="text-size" value={value} checked={textSize === value} onChange={() => setTextSize(value)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p className="muted small">只对这次打开的页面有效，不写入存储。</p>
      </section>

      <section className="about__section" aria-labelledby="about-keys">
        <h3 id="about-keys">键盘</h3>
        <ul className="about__keys">
          <li>
            <kbd>Esc</kbd> 停止正在进行的回应、播放或转写
          </li>
          <li>
            <kbd>Enter</kbd> 发出，<kbd>Shift</kbd> + <kbd>Enter</kbd> 换行（输入法组字时不会发出）
          </li>
          <li>顶栏右侧始终是“停止”和“结束”</li>
        </ul>
      </section>
    </Dialog>
  );
}
