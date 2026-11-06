export const VERSION = 1;              // also the ?v= on every import, rewritten by tools/studio-tests/bump.mjs
export const STUDIO_ENABLED = true;    // kill switch for a bad release
export const SHEET_W = 794, SHEET_H = 1122, SHEETS = [1,2,3,4];
export const LAYOUT_V = {1:1, 2:1, 3:1, 4:1};
export const BOXES = {
  'p1-uniform': { sheet:1, rect:{x:54,  y:417, w:328, h:440}, title:{vi:'Đồng phục đi học của em', en:'My school uniform'} },
  'p1-weekend': { sheet:1, rect:{x:412, y:417, w:328, h:440}, title:{vi:'Quần áo cuối tuần của em', en:'My weekend clothes'} },
};
export const BLANK_IDS = ['p3-name','p3-now-color','p3-now-clothes','p3-fav-clothes','p3-fav-why','p3-shirt-color','p3-bottom-color',
  'p3-weekend-wear','p3-weekend-like','p3-uniform-is','p3-weekend-are','p3-at-school','p3-at-home','p3-superstar'];
export const TICK_IDS = ['p2-t1','p2-t2','p2-t3','p4-t1','p4-t2','p4-t3','p4-t4','p4-t5'];
export const FIELD_ALIAS = {'p1-name':'name','p3-name':'name'};
export const QUEST = ['p1-name','box:p1-uniform','box:p1-weekend','line',...BLANK_IDS,'speech','record'];
// Selectors for panels that cover ink. Also walls for Magic Fill. Measured by targets.build().
export const DARK_SELECTORS = ['.crest','.think .ask','.num','.timeline .node.fill','.badge'];

// Tools. kind: brush | fill | sticker | eraser. shelf: main | drawer.
export const TOOLS = {
  crayon:  {kind:'brush',  shelf:'main'},
  marker:  {kind:'brush',  shelf:'drawer'},
  fill:    {kind:'fill',   shelf:'main'},
  stickers:{kind:'sticker',shelf:'main'},
  eraser:  {kind:'eraser', shelf:'main'},
  pencil:  {kind:'brush',  shelf:'main'},
  paint:   {kind:'brush',  shelf:'drawer'},
  stitch:  {kind:'brush',  shelf:'drawer'},
};
export const MAIN_TOOLS = ['crayon','pencil','fill','stickers','eraser'];
export const DRAWER_TOOLS = ['marker','paint','stitch'];

// Brush size in sheet px.
export const BRUSH_D = {
  crayon:{S:9,M:15,L:24}, pencil:{S:4,M:6,L:8}, marker:{S:8,M:14,L:22}, paint:{S:14,M:24,L:38},
  fabric:{S:18,M:30,L:46}, rainbow:{S:16,M:28,L:44}, glitter:{S:10,M:16,L:26}, stitch:{S:.8,M:1,L:1.3}, eraser:{S:14,M:26,L:44},
};
export const MIN_SCREEN = {S:6, M:10, L:16};

export const SWATCHES = [
  {id:'red',    kind:'solid',  hex:'#F2594B', word:{en:'red',vi:'đỏ'}},
  {id:'yellow', kind:'solid',  hex:'#FFE500', word:{en:'yellow',vi:'vàng'}},
  {id:'green',  kind:'solid',  hex:'#3FA34D', word:{en:'green',vi:'xanh lá'}},
  {id:'blue',   kind:'solid',  hex:'#2A5BD7', word:{en:'blue',vi:'xanh dương'}},
  {id:'navy',   kind:'solid',  hex:'#16224A', word:{en:'navy',vi:'xanh tím than'}},
  {id:'white',  kind:'solid',  hex:'#FFFFFF', word:{en:'white',vi:'trắng'}},
  {id:'gold',   kind:'solid',  hex:'#C99A1E', word:{en:'gold',vi:'vàng đồng'}},
  {id:'pink',   kind:'solid',  hex:'#EF7FB2', word:{en:'pink',vi:'hồng'}},
  {id:'orange', kind:'solid',  hex:'#F98F1D', word:{en:'orange',vi:'cam'}},
  {id:'teal',   kind:'solid',  hex:'#12A594', word:{en:'teal',vi:'xanh ngọc'}},
  {id:'sky',    kind:'solid',  hex:'#18A3D0', word:{en:'sky blue',vi:'xanh da trời'}},
  {id:'purple', kind:'solid',  hex:'#7C55C7', word:{en:'purple',vi:'tím'}},
  {id:'brown',  kind:'solid',  hex:'#7A4E2D', word:{en:'brown',vi:'nâu'}},
  {id:'skin1',  kind:'skin',   hex:'#FFE0C7', word:{en:'skin',vi:'màu da'}},
  {id:'skin2',  kind:'skin',   hex:'#F2C29B', word:{en:'skin',vi:'màu da'}},
  {id:'skin3',  kind:'skin',   hex:'#C98F65', word:{en:'skin',vi:'màu da'}},
  {id:'skin4',  kind:'skin',   hex:'#8C5A3C', word:{en:'skin',vi:'màu da'}},
  {id:'denim',  kind:'fabric', fabric:'denim',  thread:'#FFC21A', word:{en:'denim',vi:'vải bò'}},
  {id:'stripe', kind:'fabric', fabric:'stripe', thread:'#FFC21A', word:{en:'stripes',vi:'kẻ sọc'}},
  {id:'gingham',kind:'fabric', fabric:'gingham',thread:'#F2594B', word:{en:'checks',vi:'ca-rô'}},
  {id:'polka',  kind:'fabric', fabric:'polka',  thread:'#FFFFFF', word:{en:'polka dots',vi:'chấm bi'}},
  {id:'stars',  kind:'fabric', fabric:'stars',  thread:'#FFE500', word:{en:'stars',vi:'ngôi sao'}},
  {id:'flower', kind:'fabric', fabric:'flower', thread:'#F2594B', word:{en:'flowers',vi:'hoa'}},
  {id:'rainbow',kind:'rainbow', word:{en:'rainbow',vi:'cầu vồng'}},
  {id:'glitter',kind:'glitter', hex:'#D9A514', word:{en:'gold glitter',vi:'kim tuyến vàng'}},
  {id:'glitterp',kind:'glitter',hex:'#E04D8F', word:{en:'pink glitter',vi:'kim tuyến hồng'}},
];
export const swatch = id => SWATCHES.find(s => s.id === id);
export const DEFAULT_DOTS = ['red','yellow','green','blue','navy']; // sixth dot is state.dot6, default 'denim'

export function resolveBrush(toolId, sw) {
  if (toolId === 'eraser') return 'eraser';
  if (toolId === 'stitch') return 'stitch';
  if (sw.kind === 'fabric') return 'fabric';
  if (sw.kind === 'rainbow') return 'rainbow';
  if (sw.kind === 'glitter') return 'glitter';
  return toolId; // crayon, pencil, marker, paint
}
export const stitchColor = sw => sw.thread || (sw.kind === 'solid' || sw.kind === 'skin' ? sw.hex : '#C99A1E');

// Budgets and thresholds. All in one place so tests can read them.
export const LIMITS = {
  undoBytes: 32e6, undoMinSteps: 5,
  frameBudgetMs: 10, frameLateMs: 16,
  saveIdleMs: 1500, saveIdleSlowMs: 4000, saveIdleVerySlowMs: 8000,
  fieldsDebounceMs: 300, metaDebounceMs: 1000,
  tapMaxMs: 250, tapMaxPx: 8, cancelMaxMs: 200, restMinMs: 300, strayPx: 24, panStartPx: 12, edgePx: 16, penModeMs: 30000,
  fillAlpha: 40, fillDilate: 2, fillSnap: 10, fillEdge: 12, fillMaxArea: .35, fillMinArea: 20, fillRevealMs: 620, regionsPerSheet: 24,
  padMaxBytes: 40000, answerMaxChars: 60, shrinkFloorPx: 11, shrinkStartPx: 22,
};
export const STORAGE = { db:'hec-clothes-studio', dbVersion:1, hasWork:'hec-clothes-has-work', answers:'hec-clothes-answers', lock:'hec-studio' };
// Contract rects as [x, y, w, h] in sheet px. Rewritten by tools/studio-tests/golden.mjs --write.
export const GOLDEN = {
  'p1-name':[317,183,414,32],
  'p1-uniform':[54,417,328,440],
  'p1-weekend':[412,417,328,440],
  'p2-t1':[128,240,622,32],
  'p2-t2':[128,276,622,32],
  'p2-t3':[128,440,622,32],
  'p3-name':[286.9,105,180,30],
  'p3-now-color':[238.8,180,130,30],
  'p3-now-clothes':[373.6,180,170,30],
  'p3-fav-clothes':[277.9,271,220,30],
  'p3-fav-why':[290.2,320,190,30],
  'p3-shirt-color':[200.7,458,140,30],
  'p3-bottom-color':[424.8,458,140,30],
  'p3-weekend-wear':[255,580,240,30],
  'p3-weekend-like':[295.9,629,190,30],
  'p3-uniform-is':[594.6,721,150,30],
  'p3-weekend-are':[284.1,754,190,30],
  'p3-at-school':[414.2,803,190,30],
  'p3-at-home':[44,836,190,30],
  'p3-superstar':[496.6,892.5,170,30],
  'p4-t1':[205,287,528,27],
  'p4-t2':[205,314,528,27],
  'p4-t3':[205,341,528,27],
  'p4-t4':[205,368,528,27],
  'p4-t5':[205,395,528,27],
  'p4-sign':[65,933,320,60],
  'p4-date':[409,933,320,60],
};
// The LAYOUT_V each sheet must be at for the rects above. golden.mjs --write raises a sheet's entry when
// its rects move, and the geometry check fails until LAYOUT_V catches up, so a move cannot ship without a bump.
export const GOLDEN_V = {1:1, 2:1, 3:1, 4:1};
