import { emit } from './bus.js?v=1';
const s = { tool:'crayon', lastDraw:'crayon', swatch:'red', drawSwatch:'red', pencilSwatch:'navy', size:'M', page:1, box:null, mirror:false, z:1,
  penMode:false, muted:false, scale:2, lowEnd:false, readOnly:false, mode:'idb', usage:{}, dot6:'denim' };
export const get = k => s[k];
export function set(k, v) { if (s[k] === v) return; const old = s[k]; s[k] = v; emit('state:' + k, { value:v, old }); }
export const snapshot = () => ({ ...s });
