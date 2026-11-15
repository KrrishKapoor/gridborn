import './styles/tokens.css';
import { mountPreview } from './scaffold/preview';

// T4 replaces this bootstrap with the integrated runtime.
const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing application root.');
const dispose = mountPreview(root);
if (import.meta.hot) import.meta.hot.dispose(dispose);
