const t = new EventTarget();
export const on = (name, fn) => { const h = e => fn(e.detail); t.addEventListener(name, h); return () => t.removeEventListener(name, h); };
export const emit = (name, detail) => t.dispatchEvent(new CustomEvent(name, { detail }));
