// The words of the Sentence Card and of Hear my speech. English and Vietnamese glosses are copied from the packet
// (index.html, sheet 3), so that page and Card always say the same thing. The teacher approves this English before launch.
import { swatch } from './constants.js?v=1';

// Every line of the speech in packet order. {f} is a blank. opt: a line that is left out when its blank is empty.
const SPEECH = [
  { part: 1, say: ['Hello everyone! My name is ', { f: 'p3-name' }, '. This is my clothes poster.'],
    vi: 'Xin chào mọi người! Tên em là … Đây là áp phích về quần áo của em.' },
  { part: 2, say: ['Today, I am wearing a ', { f: 'p3-now-color' }, ' ', { f: 'p3-now-clothes' }, '.'],
    vi: 'Hôm nay, em đang mặc một … (màu sắc + quần áo).' },
  { part: 3, say: ['My favorite clothes are my ', { f: 'p3-fav-clothes' }, '.'],
    vi: 'Quần áo em thích nhất là …' },
  { part: 3, say: ['I like them because they are ', { f: 'p3-fav-why' }, '.'],
    vi: 'Em thích chúng vì chúng …' },
  { part: 4, say: ['At school, I wear my uniform.'],
    vi: 'Ở trường, em mặc đồng phục.' },
  { part: 4, say: ['My uniform has a ', { f: 'p3-shirt-color' }, ' shirt and ', { f: 'p3-bottom-color' }, ' shorts / skirt.'],
    vi: 'Đồng phục của em có áo sơ mi màu … và quần đùi / váy màu …' },
  { part: 4, say: ['My uniform helps me feel ready to learn.'],
    vi: 'Đồng phục giúp em cảm thấy sẵn sàng học tập.' },
  { part: 5, say: ['On the weekend, I wear ', { f: 'p3-weekend-wear' }, '.'],
    vi: 'Vào cuối tuần, em mặc …' },
  { part: 5, say: ['I wear them because I like to ', { f: 'p3-weekend-like' }, '.'],
    vi: 'Em mặc chúng vì em thích …' },
  { part: 6, say: ['My uniform and my weekend clothes are different. My uniform is ', { f: 'p3-uniform-is' },
    ', but my weekend clothes are ', { f: 'p3-weekend-are' }, '.'],
    vi: 'Đồng phục và quần áo cuối tuần của em khác nhau. Đồng phục thì …, nhưng quần áo cuối tuần thì …',
    // Too long for a phone with its chips: the Card shows only the sentence that has the blanks, still the packet's own words.
    card: { say: ['My uniform is ', { f: 'p3-uniform-is' }, ', but my weekend clothes are ', { f: 'p3-weekend-are' }, '.'],
      vi: 'Đồng phục thì …, nhưng quần áo cuối tuần thì …' } },
  { part: 6, say: ['I wear different clothes because at school I ', { f: 'p3-at-school' }, ', and at home I ', { f: 'p3-at-home' }, '.'],
    vi: 'Em mặc quần áo khác nhau vì ở trường em …, còn ở nhà em …' },
  { part: 6, opt: true, say: ['My clothes tell you that I am ', { f: 'p3-superstar' }, '.'],
    vi: 'Quần áo cho mọi người biết rằng em là … (học sinh · thích thể thao · vui vẻ · …)' },
  { part: 7, say: ['Thank you for watching my video! Goodbye!'],
    vi: 'Cảm ơn mọi người đã xem video của em! Tạm biệt!' },
];

// One entry per part: {part, lines:[{say, opt?}]}, say being text and {f:id} placeholders.
export const SCRIPT = [1, 2, 3, 4, 5, 6, 7].map(part => ({
  part,
  lines: SPEECH.filter(l => l.part === part).map(({ say, opt }) => (opt ? { say, opt } : { say })),
}));

const blanksIn = say => say.filter(t => typeof t !== 'string').map(t => t.f);
const flatten = say => say.map(t => (typeof t === 'string' ? t : '___')).join('');

// {[id]:{en, vi, part, blanks}}. en has ___ for each blank, in the order of blanks. A sentence with two blanks is
// shared by both. label: the Card shows that label instead of a sentence (signature and date).
export const SENTENCES = {
  'p1-name': { en: 'This story belongs to ___.', vi: 'Câu chuyện này là của', part: null, blanks: ['p1-name'] },
  'p4-sign': { en: '', vi: '', part: null, blanks: ['p4-sign'], label: 'card.sign' },
  'p4-date': { en: '', vi: '', part: null, blanks: ['p4-date'], label: 'card.date' },
};
for (const { part, say, vi, card } of SPEECH) {
  const blanks = blanksIn(say);
  for (const id of blanks) SENTENCES[id] = { en: flatten(card?.say ?? say), vi: card?.vi ?? vi, part, blanks, quoted: true };
}

// pic is dot:#hex (two with a slash), st:<stickerId> or em:<emoji>. fb: the emoji to show if the sticker art is missing.
// stickers: the sticker ids that make this chip one the child "has used". page: the word list printed in the packet.
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const chip = (en, vi, pic, more) => ({ id: slug(en), en, vi, pic, ...more });
const dot = id => 'dot:' + swatch(id).hex;

const BLACK = 'dot:#23262F', GRAY = 'dot:#9AA1B2';
const TSHIRT = { fb: '👕', stickers: ['tshirt'] }, SHIRT = { fb: '👔', stickers: ['shirt', 'polo'] };
const DRESS = { fb: '👗', stickers: ['dress', 'aodai'] }, SKIRT = { fb: '👗', stickers: ['skirt'] };
const JACKET = { fb: '🧥', stickers: ['jacket', 'raincoat'] }, JEANS = { fb: '👖', stickers: ['trousers'] };
const SHORTS = { fb: '🩳', stickers: ['shorts'] }, SHOES = { stickers: ['sandals'] };
const page = { page: true };

export const CHIPS = {
  'p3-now-color': [
    chip('blue', 'xanh dương', dot('blue')), chip('red', 'đỏ', dot('red')), chip('white', 'trắng', dot('white')),
    chip('black', 'đen', BLACK), chip('yellow', 'vàng', dot('yellow')), chip('green', 'xanh lá', dot('green')),
    chip('pink', 'hồng', dot('pink')),
  ],
  'p3-now-clothes': [
    chip('T-shirt', 'áo phông', 'st:tshirt', TSHIRT), chip('shirt', 'áo sơ mi', 'st:shirt', SHIRT),
    chip('dress', 'váy liền', 'st:dress', DRESS), chip('skirt', 'chân váy', 'st:skirt', SKIRT),
    chip('jacket', 'áo khoác', 'st:jacket', JACKET), chip('uniform', 'đồng phục', 'em:🏫'),
  ],
  'p3-fav-clothes': [
    chip('T-shirts', 'áo phông', 'st:tshirt', TSHIRT), chip('dresses', 'váy liền', 'st:dress', DRESS),
    chip('jeans', 'quần bò', 'st:trousers', JEANS), chip('shorts', 'quần đùi', 'st:shorts', SHORTS),
    chip('jackets', 'áo khoác', 'st:jacket', JACKET), chip('skirts', 'chân váy', 'st:skirt', SKIRT),
    chip('shoes', 'giày', 'em:👟', SHOES),
  ],
  'p3-fav-why': [
    chip('soft', 'mềm', 'em:☁️', page), chip('colorful', 'nhiều màu sắc', 'em:🌈', page),
    chip('comfortable', 'thoải mái', 'em:😊', page), chip('cool', 'đẹp, ngầu', 'em:😎', page),
  ],
  'p3-shirt-color': [
    chip('white', 'trắng', dot('white')), chip('blue', 'xanh dương', dot('blue')), chip('yellow', 'vàng', dot('yellow')),
    chip('pink', 'hồng', dot('pink')), chip('red', 'đỏ', dot('red')), chip('navy', 'xanh tím than', dot('navy')),
  ],
  'p3-bottom-color': [
    chip('navy', 'xanh tím than', dot('navy')), chip('blue', 'xanh dương', dot('blue')), chip('black', 'đen', BLACK),
    chip('white', 'trắng', dot('white')), chip('red', 'đỏ', dot('red')), chip('gray', 'xám', GRAY),
  ],
  'p3-weekend-wear': [
    chip('a T-shirt', 'áo phông', 'st:tshirt', TSHIRT), chip('a dress', 'váy liền', 'st:dress', DRESS),
    chip('shorts', 'quần đùi', 'st:shorts', SHORTS), chip('jeans', 'quần bò', 'st:trousers', JEANS),
    chip('sports clothes', 'đồ thể thao', 'em:⚽'), chip('my favorite clothes', 'quần áo em thích nhất', 'st:heart', { fb: '❤️' }),
  ],
  'p3-weekend-like': [
    chip('run', 'chạy', 'em:🏃', page), chip('play', 'chơi', 'em:🎈', page), chip('relax', 'thư giãn', 'em:😌', page),
  ],
  'p3-uniform-is': [
    chip('neat', 'gọn gàng', 'em:👌'), chip('clean', 'sạch sẽ', 'em:🧼'), chip('smart', 'lịch sự', 'em:👔'),
    chip('white and blue', 'trắng và xanh', `dot:${swatch('white').hex}/${swatch('blue').hex}`),
    chip('the same for everyone', 'giống nhau cho mọi bạn', 'em:👥'),
  ],
  'p3-weekend-are': [
    chip('colorful', 'nhiều màu sắc', 'em:🌈'), chip('comfortable', 'thoải mái', 'em:😊'), chip('soft', 'mềm', 'em:☁️'),
    chip('cool', 'đẹp, ngầu', 'em:😎'), chip('fun', 'vui', 'em:🎉'),
  ],
  'p3-at-school': [
    chip('learn', 'học', 'em:🎓'), chip('study', 'học bài', 'em:✏️'), chip('read', 'đọc sách', 'em:📚'),
    chip('write', 'viết bài', 'em:📝'), chip('listen to my teacher', 'nghe cô giáo', 'em:👂'),
  ],
  'p3-at-home': [
    chip('play', 'chơi', 'em:🎈'), chip('relax', 'thư giãn', 'em:😌'), chip('rest', 'nghỉ ngơi', 'em:😴'),
    chip('draw', 'vẽ', 'em:🎨'), chip('help my family', 'giúp đỡ gia đình', 'em:🏠'),
  ],
  'p3-superstar': [
    chip('a student', 'học sinh', 'em:🎒', page), chip('sporty', 'thích thể thao', 'em:⚽', page), chip('happy', 'vui vẻ', 'em:😄', page),
  ],
};

// The page remembers: which drawings lead which list (section 6.4).
const REMEMBER = {
  'p3-shirt-color': { colors: ['p1-uniform'] },
  'p3-bottom-color': { colors: ['p1-uniform'] },
  'p3-weekend-wear': { stickers: ['p1-weekend'] },
  'p3-now-clothes': { stickers: ['p1-uniform', 'p1-weekend'] },
  'p3-fav-clothes': { stickers: ['p1-uniform', 'p1-weekend'] },
};

function usedList(usage, boxes, key) {
  const list = [];
  for (const box of boxes ?? []) {
    const items = usage?.[box]?.[key];
    if (Array.isArray(items)) list.push(...items);
  }
  return list;
}

function todayChip(now) {
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const text = `${dd}/${mm}/${now.getFullYear()}`;
  return { id: 'today', en: text, vi: '', pic: 'em:📅', today: true, text };
}

// The chips for a blank, used ones first in the order the child used them, each marked used:true.
export function chipsFor(id, usage = {}) {
  if (id === 'p4-date') return [todayChip(new Date())];
  const list = CHIPS[id];
  if (!list) return [];
  const rule = REMEMBER[id];
  const colors = usedList(usage, rule?.colors, 'colors');
  const stickers = usedList(usage, rule?.stickers, 'stickers');
  const rankOf = c => {
    const hits = [colors.indexOf(c.en), ...(c.stickers ?? []).map(s => stickers.indexOf(s))].filter(i => i >= 0);
    return hits.length ? Math.min(...hits) : Infinity;
  };
  return list
    .map((c, order) => ({ c, order, rank: rankOf(c) }))
    .sort((a, b) => (a.rank - b.rank) || (a.order - b.order))
    .map(({ c, rank }) => (rank === Infinity ? { ...c } : { ...c, used: true }));
}
