// Shown instead of the card when HeptaFloat can't reach Heptabase: a checklist of what's missing,
// following https://support.heptabase.com/en/articles/14715462-heptabase-cli.

const GUIDE = 'https://support.heptabase.com/en/articles/14715462-heptabase-cli';

const STEPS = [
  { key: 'install', title: 'Install Heptabase',
    body: 'HeptaFloat works through the Heptabase desktop app (version 1.117 or later).',
    action: { label: 'Download Heptabase', url: 'https://heptabase.com/download' } },
  { key: 'open', title: 'Open Heptabase',
    body: 'Keep it running in the background — HeptaFloat reads and saves through it.',
    action: { label: 'Open Heptabase', open: true } },
  { key: 'enableCLI', title: 'Turn on the Heptabase CLI',
    body: 'In Heptabase, open <b>Settings → AI Features → CLI</b> and turn it on.',
    action: { label: 'Open Heptabase', open: true } },
  { key: 'subscription', title: 'Active Heptabase subscription',
    body: 'Heptabase only lets other apps in for accounts with an active subscription.' },
];

/** Renders the checklist for a { step, version?, message? } status from the app. */
export function renderSetup(el, status, { onOpenURL, onOpenHeptabase, onCheck }) {
  const step = status.step === 'update' ? 'install' : status.step;
  const at = STEPS.findIndex((s) => s.key === step);
  const rows = STEPS.map((s, i) => {
    const state = at < 0 ? 'todo' : i < at ? 'done' : i === at ? 'now' : 'todo';
    let { title, body, action } = s;
    if (s.key === 'install' && status.step === 'update') {
      title = 'Update Heptabase';
      body = `You have version ${status.version}; HeptaFloat needs 1.117 or later.`;
      action = { label: 'Download the latest Heptabase', url: 'https://heptabase.com/download' };
    }
    const button = state === 'now' && action
      ? `<button class="setup-action" data-url="${action.url ?? ''}" data-open="${action.open ? 1 : ''}">${action.label}</button>` : '';
    return `<li class="setup-step ${state}"><span class="setup-mark">${state === 'done' ? '✓' : i + 1}</span>
      <div><div class="setup-title">${title}</div>${state === 'done' ? '' : `<div class="setup-body">${body}</div>`}${button}</div></li>`;
  }).join('');
  const other = status.step === 'other'
    ? `<p class="setup-other">Heptabase said: ${String(status.message ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p>` : '';
  el.innerHTML = `
    <div class="setup-card">
      <h2>Connect HeptaFloat to Heptabase</h2>
      <p class="setup-lede">A few one-time steps, then today's journal appears here.</p>
      <ol class="setup-steps">${rows}</ol>${other}
      <div class="setup-foot">
        <span class="setup-wait">Checking automatically…</span>
        <button class="setup-check">Check again</button>
        <a href="${GUIDE}" class="setup-guide">Setup guide ↗</a>
      </div>
    </div>`;
  el.hidden = false;
  el.querySelector('.setup-action')?.addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (b.dataset.open) onOpenHeptabase(); else onOpenURL(b.dataset.url);
  });
  el.querySelector('.setup-check').addEventListener('click', onCheck);
  el.querySelector('.setup-guide').addEventListener('click', (e) => { e.preventDefault(); onOpenURL(GUIDE); });
}
