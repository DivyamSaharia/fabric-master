import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/preact';
import { App } from './app.jsx';
import { SCREEN_TOPIC, TOPICS, WHATS_NEW, WORDS, searchTopics, topicById, wordFor } from './guide/topics.js';
import { APP_VERSION } from './screens/settings.jsx';
import { resetListState } from './listState.js';

beforeAll(() => {
  window.scrollTo = () => {};
});
beforeEach(() => {
  cleanup();
  localStorage.clear();
  resetListState();
});

async function open(hash) {
  window.location.hash = hash;
  render(<App />);
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
}

const sentences = (s) => String(s).replace(/\*\*|\[\[|\]\]/g, '').split(/(?<=[.!?])\s+/).filter(Boolean);
const words = (s) => s.split(/\s+/).filter(Boolean).length;

describe('guide content', () => {
  it('every screen with a ? button has a topic', () => {
    for (const screenId of ['fabrics', 'fabric', 'yarns', 'units', 'ranking', 'planner', 'settings']) {
      expect(topicById(SCREEN_TOPIC[screenId]), screenId).toBeTruthy();
    }
  });

  it('keeps sentences short and plain', () => {
    const long = [];
    for (const t of TOPICS) {
      for (const line of [t.purpose, ...(t.intro || []), ...(t.steps || []), ...(t.tips || []), ...(t.faq || []).flat()]) {
        for (const s of sentences(line)) if (words(s) > 18) long.push(`${t.id}: ${s}`);
      }
    }
    expect(long).toEqual([]);
  });

  it('every [[word]] has a meaning, every related topic exists, every screenshot is there', () => {
    for (const t of TOPICS) {
      const text = [t.purpose, ...(t.intro || []), ...(t.steps || []), ...(t.tips || []), ...(t.faq || []).flat()].join('\n');
      for (const m of text.matchAll(/\[\[(.+?)\]\]/g)) expect(wordFor(m[1]), `${t.id}: ${m[1]}`).toBeTruthy();
      for (const id of t.related || []) expect(topicById(id), `${t.id} → ${id}`).toBeTruthy();
      if (t.shot) expect(fs.existsSync(`public/guide/${t.shot}`), `${t.id}: ${t.shot}`).toBe(true);
    }
    expect(new Set(WORDS.map(([w]) => w.toLowerCase())).size).toBe(WORDS.length);
  });

  it("What's new starts with this version", () => {
    expect(WHATS_NEW[0][0]).toBe(APP_VERSION);
  });

  it('search matches every word given', () => {
    expect(searchTopics('').length).toBe(TOPICS.length);
    expect(searchTopics('enter rpm').map((t) => t.id)).toContain('trouble');
    expect(searchTopics('zzzz')).toEqual([]);
  });
});

describe('guide screens', () => {
  it('opens from the ? button on the planner, shows steps and a word meaning', async () => {
    await open('#/planner');
    await screen.findByRole('heading', { name: 'Planner' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Guide' })[0]);
    await waitFor(() => expect(window.location.hash).toBe('#/guide/planner'));
    await screen.findByText('Steps');
    expect(screen.getByText('Good to know')).toBeTruthy();
    expect(screen.getByText('How it is worked out')).toBeTruthy();
  });

  it('lists topics, searches, and explains a word', async () => {
    await open('#/guide');
    await screen.findByText('Start here');
    expect(screen.getByText('Words used in this app')).toBeTruthy();
    fireEvent.input(screen.getByLabelText('Search the guide'), { target: { value: 'loom group' } });
    await screen.findByText(/topics?$/);
    expect(screen.getByText('Units')).toBeTruthy();
    cleanup();
    await open('#/guide/find');
    fireEvent.click(await screen.findByRole('button', { name: 'realisation' }));
    expect(await screen.findByText(/What a fabric earns after yarn and finishing costs/)).toBeTruthy();
  });

  it('shows the first-visit card once, and Settings links to the Guide', async () => {
    await open('#/fabrics');
    await screen.findByText('New here? Read Start here');
    fireEvent.click(screen.getByRole('button', { name: 'Close guide hint' }));
    await waitFor(() => expect(screen.queryByText('New here? Read Start here')).toBeNull());
    cleanup();
    await open('#/fabrics');
    await screen.findByText('Poly Crepe 60 (RFD)');
    expect(screen.queryByText('New here? Read Start here')).toBeNull();
    cleanup();
    await open('#/settings');
    fireEvent.click(await screen.findByText("What's new"));
    await screen.findByText(WHATS_NEW[0][1].slice(0, 30), { exact: false });
  });
});
