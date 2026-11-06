// Every string a parent reads, Vietnamese first (section 2.4). Swatch and sticker words live in constants.js and sticker-art.js.
// Imported by boot.js in the reading view, so it stays small and starts nothing until it is first called.
import { emit } from './bus.js?v=1';

const STRINGS = {
  'cta.start': ['Vẽ và viết', 'Draw and write'],
  'cta.resume': ['Vẽ tiếp', 'Keep drawing'],
  'tool.crayon': ['Bút sáp', 'Crayon'],
  'tool.marker': ['Bút dạ', 'Marker'],
  'tool.fill': ['Đổ màu', 'Magic fill'],
  'tool.stickers': ['Hình dán', 'Stickers'],
  'tool.eraser': ['Tẩy', 'Eraser'],
  'tool.more': ['Hộp bút', 'Pencil case'],
  'tool.pencil': ['Bút chì', 'Pencil'],
  'tool.paint': ['Màu nước', 'Watercolor'],
  'tool.stitch': ['Đường may', 'Stitches'],
  'mirror.on': ['Vẽ đối xứng: bật', 'Mirror: on'],
  'mirror.off': ['Vẽ đối xứng: tắt', 'Mirror: off'],
  undo: ['Hoàn tác', 'Undo'],
  redo: ['Làm lại', 'Redo'],
  'size.S': ['Nét nhỏ', 'Small'],
  'size.M': ['Nét vừa', 'Medium'],
  'size.L': ['Nét to', 'Large'],
  palette: ['Bảng màu', 'Colors'],
  'palette.colors': ['Màu sắc', 'Colors'],
  'palette.skin': ['Màu da', 'Skin colors'],
  'palette.fabric': ['Vải', 'Fabrics'],
  'palette.magic': ['Lấp lánh', 'Sparkle'],
  'page.n': ['Trang {n}', 'Page {n}'],
  star: ['Việc tiếp theo', "What's next"],
  'box.zoom': ['Phóng to ô vẽ', 'Zoom to this box'],
  'box.whole': ['Cả trang', 'Whole page'],
  'line.hang': ['Phơi lên dây', 'Hang it up'],
  'line.title': ['Dây phơi', 'Washing line'],
  'line.down': ['Gỡ xuống', 'Take them down'],
  'line.save': ['Lưu ảnh', 'Save picture'],
  'line.empty': ['Vẽ thêm bộ này nhé', 'Draw this one too'],
  'line.prompt': ['Chúng khác nhau như thế nào?', 'How are they different?'],
  'line.hear': ['Nghe bằng tiếng Anh', 'Hear it in English'],
  'line.saved': ['Đã lưu ảnh', 'Picture saved'],
  'line.unsaved': ['Chưa lưu được ảnh', 'Could not save'],
  menu: ['Bố mẹ', 'Parents'],
  'menu.title': ['Dành cho bố mẹ', 'For parents'],
  'menu.lang': ['Ngôn ngữ', 'Language'],
  'menu.voiceOn': ['Bật giọng đọc', 'Turn voice on'],
  'menu.voiceOff': ['Tắt giọng đọc', 'Turn voice off'],
  'menu.speech': ['Nghe bài nói của em', 'Hear my speech'],
  'menu.print': ['In 4 trang', 'Print 4 pages'],
  'menu.copy': ['Lưu bản sao vào máy', 'Save a copy'],
  'menu.clear': ['Xóa trang này', 'Clear this page'],
  'menu.restart': ['Bắt đầu lại từ đầu', 'Start over'],
  'menu.record': ['Quay video', 'Record my video'],
  'menu.exit': ['Thoát chế độ vẽ', 'Exit drawing'],
  'menu.close': ['Đóng', 'Close'],
  saved: ['Đã lưu', 'Saved'],
  saving: ['Đang lưu…', 'Saving…'],
  unsaved: ['Chưa lưu được', 'Not saved'],
  'restart.title': ['Xóa toàn bộ bài của con?', "Delete all of your child's work?"],
  'restart.body': ['Tất cả hình vẽ và câu trả lời trên máy này sẽ mất và không lấy lại được.', 'All drawings and answers on this device will be lost for good.'],
  'restart.hold': ['Giữ 2 giây để xóa', 'Hold 2 seconds to delete'],
  'restart.keep': ['Không xóa', 'Keep it'],
  'card.chips': ['Chọn từ', 'Choose a word'],
  'card.pad': ['Viết tay', 'Write by hand'],
  'card.type': ['Gõ chữ', 'Type'],
  'card.done': ['Xong', 'Done'],
  'card.clear': ['Viết lại', 'Start again'],
  'card.prev': ['Câu trước', 'Previous'],
  'card.next': ['Câu sau', 'Next'],
  'card.hear': ['Nghe câu này', 'Hear this sentence'],
  'card.today': ['Hôm nay', 'Today'],
  'card.close': ['Đóng', 'Close'],
  'card.sign': ['Chữ ký Phụ huynh', "Parent's signature"],
  'card.date': ['Ngày nộp', 'Date sent'],
  'speech.stop': ['Dừng đọc', 'Stop'],
  'note.private': ['Trình duyệt đang không cho lưu bài. Trước khi đóng trang, bố mẹ hãy in hoặc lưu bản sao.', 'This browser is not saving the work. Before closing the page, please print or save a copy.'],
  'note.inapp': ['Bố mẹ vui lòng mở trang này bằng Safari hoặc Chrome để lưu và in được bài của con.', "Please open this page in Safari or Chrome so your child's work can be saved and printed."],
  'note.evict': ['Bài được lưu trên máy này. Safari có thể tự xóa nếu 7 ngày không mở lại, nên bố mẹ hãy in hoặc nộp bài trước buổi học tiếp theo.', 'The work is saved on this device. Safari may delete it after 7 days without a visit, so please print or hand it in before the next lesson.'],
  'note.page': ['Máy này có thể không in đúng 4 trang A4. Nên in từ máy tính.', 'This device may not print exactly 4 A4 pages. A computer is safer.'],
  'note.layout': ['Nội dung tập đã được cập nhật. Hình vẽ của con vẫn còn nhưng có thể lệch một chút.', 'The packet has been updated. The drawings are still here but may sit slightly off.'],
  'note.restored': ['Đã khôi phục bài từ bản lưu gần nhất.', 'Restored from the last save.'],
  'note.tab': ['Bài vẽ đang mở ở một thẻ khác.', 'The work is open in another tab.'],
  'note.useHere': ['Dùng ở thẻ này', 'Use it here'],
  'note.enterFail': ['Chưa mở được chế độ vẽ trên máy này. Bố mẹ vẫn có thể đọc và in tập như bình thường.', 'Drawing could not start on this device. You can still read and print the packet as usual.'],
};

let watching = false;

function watch() {
  if (watching || !window.MutationObserver) return;
  watching = true;
  new MutationObserver(() => emit('lang:change', { lang: lang() }))
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-lang'] });
}

export function lang() {
  return document.documentElement.getAttribute('data-lang') === 'en' ? 'en' : 'vi';
}

// t('page.n', {n:2}). An unknown key comes back as itself, so a typo shows on screen instead of a hole.
export function t(key, vars) {
  watch();
  const row = STRINGS[key];
  let text = row ? row[lang() === 'en' ? 1 : 0] : key;
  if (vars) for (const name of Object.keys(vars)) text = text.replace(`{${name}}`, vars[name]);
  return text;
}

// One row in a given language, for the places that always show or speak the English beside the Vietnamese.
export function tIn(key, l) {
  const row = STRINGS[key];
  return row ? row[l === 'en' ? 1 : 0] : key;
}

// data-l="key" sets the text, data-la="key" sets aria-label and title. data-n fills {n}.
export function applyLabels(root) {
  if (!root) return;
  const vars = el => (el.dataset.n === undefined ? undefined : { n: el.dataset.n });
  const each = (selector, fn) => {
    if (root.matches?.(selector)) fn(root);
    for (const el of root.querySelectorAll(selector)) fn(el);
  };
  each('[data-l]', el => { el.textContent = t(el.dataset.l, vars(el)); });
  each('[data-la]', el => {
    const text = t(el.dataset.la, vars(el));
    el.setAttribute('aria-label', text);
    el.title = text;
  });
}
