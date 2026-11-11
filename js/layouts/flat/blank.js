import { svg } from '../helpers.js';

export default {
  id: 'blank',
  name: '空白',
  category: 'flat',
  icon: svg('<rect x="5" y="4" width="38" height="22" rx="3" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3"/>'),
  params: [],
  compute: () => ({ items: [], camera: { type: 'ortho' } }),
};
