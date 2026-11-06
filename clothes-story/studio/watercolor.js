// "It dries": the post-stroke bake for the paint brush, loaded on first use (section 4.6). The stroke paints a flat wash
// on live; this turns its polygons into a wet edge, blooms and granulation, split into stages so no one task is long.
// Multiply on a transparent canvas only darkens where paint already is, so paper never enters the math.
import { mk } from './textures.js?v=1';

const WASH = 0.46;
const LARGE = 900000; // above this many px a bake composes at half size, and a wash that big is soft anyway

export function makeBake({ paths, rect, hex, grain, cloud, lean, seed = 1 }) {
  const q = 2, mw = Math.max(2, rect.w >> 1), mh = Math.max(2, rect.h >> 1);
  const scale = rect.w * rect.h > LARGE ? 2 : 1;
  const ow = Math.ceil(rect.w / scale), oh = Math.ceil(rect.h / scale);
  let mask = null, rim = null, out = null;

  // Half-size mask, and the rim: the mask minus a shrunk copy of itself, dark where pigment gathers at the edge.
  function stageMask() {
    mask = mk(mw, mh);
    const mx = mask.getContext('2d');
    mx.setTransform(mw / rect.w, 0, 0, mh / rect.h, -rect.x * mw / rect.w, -rect.y * mh / rect.h);
    mx.fillStyle = '#000';
    for (const p of paths) mx.fill(p);
    const small = mk(Math.max(2, mw >> 2), Math.max(2, mh >> 2)), sx = small.getContext('2d');
    sx.imageSmoothingQuality = 'high';
    sx.drawImage(mask, 0, 0, small.width, small.height);
    rim = mk(mw, mh);
    const rx = rim.getContext('2d');
    rx.drawImage(mask, 0, 0);
    rx.globalCompositeOperation = 'destination-out';
    rx.drawImage(small, 0, 0, mw, mh);
    small.width = small.height = 1;
  }

  function stageCompose() {
    out = mk(ow, oh);
    const x = out.getContext('2d');
    x.globalAlpha = WASH;
    x.drawImage(mask, 0, 0, ow, oh);
    x.globalAlpha = 1;
    x.drawImage(rim, 0, 0, ow, oh);
    x.drawImage(rim, 0, 0, ow, oh);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = hex;
    x.fillRect(0, 0, ow, oh);
    x.globalCompositeOperation = 'destination-out';
    if (!lean) {
      // Blooms, somewhere new on the cloud for every wash, so washes laid over each other do not line up
      x.globalAlpha = 0.5;
      const blooms = x.createPattern(cloud, 'repeat');
      const sx = (seed * 53) % 256, sy = (seed * 97) % 256;
      blooms.setTransform(new DOMMatrix([1.5 / scale, 0, 0, 1.5 / scale, -sx, -sy]));
      x.fillStyle = blooms;
      x.fillRect(0, 0, ow, oh);
      // Granulation stays on the paper: pigment settles in the tooth
      x.globalAlpha = 0.16;
      const tooth = x.createPattern(grain, 'repeat');
      tooth.setTransform(new DOMMatrix([1 / scale, 0, 0, 1 / scale, -rect.x / scale, -rect.y / scale]));
      x.fillStyle = tooth;
      x.fillRect(0, 0, ow, oh);
    }
    mask.width = mask.height = 1;
    rim.width = rim.height = 1;
  }

  return { stages: [stageMask, stageCompose], output: () => out, q };
}
