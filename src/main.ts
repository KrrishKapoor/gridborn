import { mountApp } from './runtime/app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing application root.');
const dispose = mountApp(root);
if (import.meta.hot) import.meta.hot.dispose(dispose);
