import { render } from 'preact';
import { App } from './app.jsx';
import './styles.css';

render(<App />, document.getElementById('app'));

// Offline app shell. Skipped in the single-file demo build and in previews.
if ('serviceWorker' in navigator && import.meta.env.MODE !== 'demo' && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
