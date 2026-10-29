// The Guide: plain-English how-to for every screen. Content lives in src/guide/topics.js; screenshots in public/guide.
import { useState } from 'preact/hooks';
import { back, go } from '../router.js';
import { local } from '../storage.js';
import { Empty, Icon, IconButton, NavBar, SearchBox, Section, Sheet } from '../ui.jsx';
import { SCREEN_TOPIC, TOPICS, WHATS_NEW, WORDS, searchTopics, topicById, wordFor } from '../guide/topics.js';

const HINT_KEY = 'fm.guideHint.v1';

// "?" in a screen's top bar: opens the Guide at that screen's topic.
export function HelpButton({ screen, topic }) {
  const id = topic || SCREEN_TOPIC[screen] || '';
  return (
    <IconButton label="Guide" onClick={() => go(id ? `/guide/${id}` : '/guide')}>
      <Icon.help />
    </IconButton>
  );
}

// First visit only: a small card pointing at Start here. Closing it hides it for good on this device.
export function GuideHint() {
  const [hidden, setHidden] = useState(() => !!local.get(HINT_KEY, false));
  if (hidden) return null;
  const close = () => {
    local.set(HINT_KEY, true);
    setHidden(true);
  };
  return (
    <div class="guide-hint" role="note">
      <button type="button" class="guide-hint-main" onClick={() => { close(); go('/guide/start'); }}>
        <span class="guide-hint-icon"><Icon.help size={20} /></span>
        <span>
          <span class="guide-hint-title">New here? Read Start here</span>
          <span class="guide-hint-sub">A short guide to every screen</span>
        </span>
      </button>
      <button type="button" class="x-btn" aria-label="Close guide hint" onClick={close}><Icon.close size={12} /></button>
    </div>
  );
}

// **bold** and [[word]] (tappable, opens its meaning).
function Rich({ text, onWord }) {
  const out = [];
  const re = /\*\*(.+?)\*\*|\[\[(.+?)\]\]/g;
  let last = 0;
  let m;
  const s = String(text || '');
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] !== undefined) out.push(<b>{m[1]}</b>);
    else {
      const w = wordFor(m[2]);
      out.push(w ? <button type="button" class="term" onClick={() => onWord(w)}>{m[2]}</button> : m[2]);
    }
    last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return <>{out}</>;
}

export function Guide({ topic }) {
  const [q, setQ] = useState('');
  const [word, setWord] = useState(null);
  const t = topic ? topicById(topic) : null;
  const wordSheet = (
    <Sheet open={!!word} onClose={() => setWord(null)} title={word ? word[0] : ''}>
      <p class="confirm-text">{word ? word[1] : ''}</p>
    </Sheet>
  );

  if (topic && !t) {
    return (
      <div class="guide">
        <NavBar title="Guide" backLabel="Guide" onBack={() => back('/guide')} />
        <Empty title="Topic not found" text="Go back to the Guide to see every topic." />
      </div>
    );
  }

  if (t) {
    return (
      <div class="guide">
        <NavBar title={t.title} backLabel="Guide" onBack={() => back('/guide')} />
        <div class="guide-page">
          <h1 class="guide-h1">{t.title}</h1>
          <p class="guide-purpose"><Rich text={t.purpose} onWord={setWord} /></p>
          {t.intro ? t.intro.map((p) => <p class="guide-p"><Rich text={p} onWord={setWord} /></p>) : null}
          {t.shot ? (
            <figure class="guide-shot">
              <img src={`./guide/${t.shot}`} alt={`The ${t.title} screen`} loading="lazy" onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }} />
            </figure>
          ) : null}
          {t.steps ? (
            <>
              <h2 class="guide-h2">Steps</h2>
              <ol class="guide-steps">{t.steps.map((s) => <li><Rich text={s} onWord={setWord} /></li>)}</ol>
            </>
          ) : null}
          {t.tips ? (
            <>
              <h2 class="guide-h2">Good to know</h2>
              <ul class="guide-tips">{t.tips.map((s) => <li><Rich text={s} onWord={setWord} /></li>)}</ul>
            </>
          ) : null}
          {t.faq ? (
            <div class="guide-faq">
              {t.faq.map(([qq, a]) => (
                <div class="guide-faq-item">
                  <div class="guide-faq-q">{qq}</div>
                  <div class="guide-faq-a"><Rich text={a} onWord={setWord} /></div>
                </div>
              ))}
            </div>
          ) : null}
          {t.words ? (
            <dl class="guide-words">
              {WORDS.map(([w, d]) => (
                <div class="guide-word"><dt>{w}</dt><dd>{d}</dd></div>
              ))}
            </dl>
          ) : null}
          {t.news ? (
            <dl class="guide-words">
              {WHATS_NEW.map(([v, d]) => (
                <div class="guide-word"><dt>{v}</dt><dd>{d}</dd></div>
              ))}
            </dl>
          ) : null}
          {t.how ? (
            <details class="guide-how">
              <summary>How it is worked out</summary>
              <ul>{t.how.map((s) => <li>{s}</li>)}</ul>
            </details>
          ) : null}
          {t.related && t.related.length ? (
            <>
              <h2 class="guide-h2">Related</h2>
              <div class="chips guide-related">
                {t.related.map((id) => {
                  const r = topicById(id);
                  return r ? <button type="button" class="chip" onClick={() => go(`/guide/${id}`)}>{r.title}</button> : null;
                })}
              </div>
            </>
          ) : null}
        </div>
        {wordSheet}
      </div>
    );
  }

  const list = searchTopics(q);
  return (
    <div class="guide">
      <NavBar large title="Guide" backLabel="Back" onBack={() => back('/fabrics')} />
      <div class="stack" style={{ padding: 0, gap: '10px', marginTop: '10px' }}>
        <SearchBox value={q} onInput={setQ} placeholder="Search the guide" />
      </div>
      {!q ? (
        <button type="button" class="guide-start" onClick={() => go('/guide/start')}>
          <span class="guide-start-title">Start here</span>
          <span class="guide-start-sub">{topicById('start').purpose}</span>
        </button>
      ) : null}
      {list.length ? (
        <Section header={q ? `${list.length} ${list.length === 1 ? 'topic' : 'topics'}` : 'Topics'}>
          {list.filter((x) => q || x.id !== 'start').map((x) => (
            <button type="button" class="row" onClick={() => go(`/guide/${x.id}`)}>
              <div class="row-main">
                <div class="row-label">{x.title}</div>
                <div class="row-sub">{x.purpose}</div>
              </div>
              <span class="row-chevron"><Icon.chevron size={13} /></span>
            </button>
          ))}
        </Section>
      ) : (
        <Empty title="Nothing found" text="Try another word, like planner, RPM or price." />
      )}
    </div>
  );
}

export const GUIDE_TOPIC_COUNT = TOPICS.length;
