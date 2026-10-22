// A stand-in for the Scriptable app, enough to run all-day/widget/btown-widget.js
// under node: ListWidget, WidgetStack, WidgetText, WidgetImage, Font, Color,
// Size, Point, LinearGradient, SFSymbol, Request, FileManager, config, Script.
//
// It is STRICT: every object only takes the properties and methods the real
// API has (scriptable.app/docs), so a typo like `lineLimt` or a method that
// does not exist throws here instead of failing silently on a phone.
//
// runWidget() runs the script the way Scriptable does, wrapped in an async
// function so its top-level await works, and returns what it drew.
// toHTML() draws that tree as a page, for a screenshot of the layout.

import vm from 'node:vm';

const RAW = Symbol('raw');
const raw = (n) => (n && n[RAW]) || n;
function strict(obj, props, label) {
  const allowed = new Set(props);
  return new Proxy(obj, {
    set(target, key, value) {
      if (!allowed.has(key)) throw new TypeError(label + ' has no property ' + String(key));
      target[key] = value;
      return true;
    },
    get(target, key) {
      if (key === RAW) return target;
      if (typeof key === 'symbol' || key in target || allowed.has(key) || key === 'then' || key === 'toJSON') return target[key];
      throw new TypeError(label + ' has no ' + String(key));
    },
  });
}

class Color { constructor(hex, alpha) { this.hex = hex; this.alpha = alpha == null ? 1 : alpha; } }
Color.dynamic = (light, dark) => Object.assign(new Color(light.hex), { dark });
class Size { constructor(width, height) { this.width = width; this.height = height; } }
class Point { constructor(x, y) { this.x = x; this.y = y; } }
const font = (weight) => (size) => ({ weight, size });
const Font = {};
['ultraLight', 'thin', 'light', 'regular', 'medium', 'semibold', 'bold', 'heavy', 'black'].forEach((w) => {
  Font[(w === 'regular' ? 'system' : w + 'System') + 'Font'] = font(w);
  Font[w + 'RoundedSystemFont'] = font(w);
});
Font.systemFont = font('regular');

const TEXT_PROPS = ['text', 'font', 'textColor', 'textOpacity', 'lineLimit', 'minimumScaleFactor', 'shadowColor', 'shadowRadius',
  'shadowOffset', 'url', 'align', 'leftAlignText', 'centerAlignText', 'rightAlignText', 'kind'];
const IMAGE_PROPS = ['image', 'imageSize', 'tintColor', 'imageOpacity', 'cornerRadius', 'borderWidth', 'borderColor',
  'containerRelativeShape', 'resizable', 'url', 'kind', 'leftAlignImage', 'centerAlignImage', 'rightAlignImage',
  'applyFittingContentMode', 'applyFillingContentMode'];
const STACK_PROPS = ['kind', 'children', 'layout', 'align', 'pad', 'backgroundColor', 'backgroundImage', 'backgroundGradient',
  'spacing', 'size', 'cornerRadius', 'borderWidth', 'borderColor', 'url', 'addText', 'addDate', 'addImage', 'addSpacer',
  'addStack', 'setPadding', 'useDefaultPadding', 'topAlignContent', 'centerAlignContent', 'bottomAlignContent',
  'layoutHorizontally', 'layoutVertically'];
const WIDGET_PROPS = ['kind', 'children', 'layout', 'align', 'pad', 'backgroundColor', 'backgroundImage', 'backgroundGradient',
  'spacing', 'url', 'refreshAfterDate', 'addText', 'addDate', 'addImage', 'addSpacer', 'addStack', 'setPadding',
  'useDefaultPadding', 'presentSmall', 'presentMedium', 'presentLarge', 'presentExtraLarge', 'presented'];

function textNode(str) {
  const n = { kind: 'text', text: String(str), align: 'left' };
  n.leftAlignText = () => { n.align = 'left'; };
  n.centerAlignText = () => { n.align = 'center'; };
  n.rightAlignText = () => { n.align = 'right'; };
  return strict(n, TEXT_PROPS, 'WidgetText');
}

function imageNode(image) {
  const n = { kind: 'image', image };
  ['leftAlignImage', 'centerAlignImage', 'rightAlignImage', 'applyFittingContentMode', 'applyFillingContentMode'].forEach((m) => { n[m] = () => {}; });
  return strict(n, IMAGE_PROPS, 'WidgetImage');
}

function container(n) {
  n.children = [];
  n.layout = n.kind === 'widget' ? 'v' : 'h';
  n.align = 'top';
  n.addText = (s) => { if (typeof s !== 'string') throw new TypeError('addText takes a string'); const t = textNode(s); n.children.push(t); return t; };
  n.addDate = () => { throw new TypeError('addDate is not used'); };
  n.addImage = (img) => { const i = imageNode(img); n.children.push(i); return i; };
  n.addSpacer = (length) => { const s = { kind: 'spacer', length: length == null ? null : length }; n.children.push(s); return s; };
  n.addStack = () => { const s = stackNode(); n.children.push(s); return s; };
  n.setPadding = (t, l, b, r) => { n.pad = [t, l, b, r]; };
  n.useDefaultPadding = () => { n.pad = null; };
  return n;
}

function stackNode() {
  const n = container({ kind: 'stack' });
  n.layoutHorizontally = () => { n.layout = 'h'; };
  n.layoutVertically = () => { n.layout = 'v'; };
  n.topAlignContent = () => { n.align = 'top'; };
  n.centerAlignContent = () => { n.align = 'center'; };
  n.bottomAlignContent = () => { n.align = 'bottom'; };
  return strict(n, STACK_PROPS, 'WidgetStack');
}

class LinearGradient { constructor() { return strict({ colors: [], locations: [], startPoint: null, endPoint: null }, ['colors', 'locations', 'startPoint', 'endPoint'], 'LinearGradient'); } }

/* opts: respond(url) -> JSON or throws; cache: a prior copy on the phone;
   family; runsInWidget (default true) */
export function scriptable(opts = {}) {
  const files = new Map();
  if (opts.cache) files.set('/docs/btown-brief-widget.json', JSON.stringify(opts.cache));
  const log = { requests: [], set: [], completed: 0, presented: [], files };
  function ListWidget() {
    const n = container({ kind: 'widget' });
    n.presented = null;
    ['Small', 'Medium', 'Large', 'ExtraLarge'].forEach((s) => { n['present' + s] = async () => { n.presented = s.toLowerCase(); log.presented.push(s.toLowerCase()); }; });
    return strict(n, WIDGET_PROPS, 'ListWidget');
  }
  class Request {
    constructor(url) { this.url = url; this.method = 'GET'; this.headers = {}; this.timeoutInterval = 60; log.requests.push(url); return strict(this, ['url', 'method', 'headers', 'body', 'timeoutInterval', 'loadJSON', 'loadString'], 'Request'); }
    async loadJSON() { if (!opts.respond) throw new Error('The Internet connection appears to be offline.'); return opts.respond(this.url); }
    async loadString() { return JSON.stringify(await this.loadJSON()); }
  }
  const fm = {
    documentsDirectory: () => '/docs',
    cacheDirectory: () => '/cache',
    joinPath: (a, b) => a.replace(/\/$/, '') + '/' + b,
    fileExists: (p) => files.has(p),
    readString: (p) => { if (!files.has(p)) throw new Error('no file'); return files.get(p); },
    writeString: (p, s) => { if (typeof s !== 'string') throw new TypeError('writeString takes a string'); files.set(p, s); },
  };
  const ctx = {
    Color, Size, Point, Font, LinearGradient, ListWidget, Request,
    SFSymbol: { named: (name) => ({ name, image: { symbol: name }, applyFont() {} }) },
    FileManager: { local: () => fm, iCloud: () => fm },
    config: { runsInWidget: opts.runsInWidget !== false, runsInApp: opts.runsInWidget === false, widgetFamily: opts.family || 'medium', widgetParameter: null },
    Script: { setWidget: (w) => log.set.push(w), complete: () => { log.completed++; }, name: () => 'Btown Brief' },
    console, Date, JSON, Math, Number, String, Array, Object, Promise, Error, TypeError, isFinite, Intl, RegExp,
    module: { exports: {} },
  };
  return { ctx, log };
}

export async function runWidget(src, opts = {}) {
  const { ctx, log } = scriptable(opts);
  if (opts.noMain) ctx.__BTOWN_NO_MAIN__ = true;
  vm.createContext(ctx);
  await vm.runInContext('(async () => {\n' + src + '\n})()', ctx, { filename: 'btown-widget.js' });
  return { log, api: ctx.module.exports, widget: log.set[0] || null };
}

/* every text in the tree, in order */
export function texts(node) {
  node = raw(node);
  if (!node) return [];
  if (node.kind === 'text') return [node.text];
  return (node.children || []).flatMap(texts);
}
/* every url set on the widget or a stack */
export function urls(node) {
  node = raw(node);
  if (!node || !node.children) return [];
  return (node.url ? [node.url] : []).concat(node.children.flatMap(urls));
}

/* ------------------------------------------------------------ the picture */
const SIZES = { small: [170, 170], medium: [364, 170], large: [364, 382] };   // iPhone 16 Pro, points
const GLYPH = { 'sun.max.fill': '☀️', 'moon.stars.fill': '🌙', 'cloud.sun.fill': '⛅', 'cloud.moon.fill': '☁️', 'cloud.fill': '☁️',
  'cloud.rain.fill': '🌧️', 'cloud.snow.fill': '🌨️', 'cloud.bolt.rain.fill': '⛈️', 'cloud.fog.fill': '🌫️' };
const W = { regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800, black: 900 };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function nodeHTML(n, parentLayout) {
  n = raw(n);
  if (n.kind === 'text') {
    const f = n.font || { size: 17, weight: 'regular' };
    const clamp = n.lineLimit ? 'display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:' + n.lineLimit + ';overflow:hidden;' : '';
    return '<div style="font-size:' + f.size + 'px;font-weight:' + (W[f.weight] || 400) + ';color:' + (n.textColor ? n.textColor.hex : '#fff') +
      ';line-height:1.2;text-align:' + n.align + ';min-width:0;' + clamp + (n.lineLimit === 1 ? 'white-space:nowrap;text-overflow:ellipsis;display:block;' : '') + '">' + esc(n.text) + '</div>';
  }
  if (n.kind === 'image') {
    const s = n.imageSize ? n.imageSize.width : 20;
    return '<div style="font-size:' + Math.round(s * 0.85) + 'px;width:' + s + 'px;height:' + s + 'px;line-height:' + s + 'px;text-align:center;flex:none">' + (GLYPH[n.image.symbol] || '◻') + '</div>';
  }
  if (n.kind === 'spacer') {
    return n.length == null ? '<div style="flex:1 1 0"></div>' : '<div style="flex:none;' + (parentLayout === 'h' ? 'width:' : 'height:') + n.length + 'px"></div>';
  }
  const dir = n.layout === 'h' ? 'row' : 'column';
  const align = n.layout === 'h' ? ({ top: 'flex-start', center: 'center', bottom: 'flex-end' }[n.align]) : 'flex-start';
  const size = n.size ? (n.size.width ? 'width:' + n.size.width + 'px;flex:none;' : '') + (n.size.height ? 'height:' + n.size.height + 'px;' : '') : '';
  const pad = n.pad ? 'padding:' + n.pad.map((p) => p + 'px').join(' ') + ';' : '';
  const grow = n.layout === 'v' && parentLayout === 'h' && !(n.size && n.size.width) ? 'flex:1 1 0;' : '';
  const tall = n.layout === 'v' && parentLayout === 'h' ? 'align-self:stretch;' : '';
  return '<div title="' + esc(n.url || '') + '" style="display:flex;flex-direction:' + dir + ';align-items:' + align + ';gap:' + (n.spacing || 0) + 'px;min-width:0;' + size + pad + grow + tall + '">' +
    n.children.map((c) => nodeHTML(c, n.layout)).join('') + '</div>';
}

export function toHTML(widget, family, caption) {
  widget = raw(widget);
  const [w, h] = SIZES[family] || SIZES.medium;
  const g = widget.backgroundGradient;
  const bg = g && g.colors.length ? 'linear-gradient(135deg,' + g.colors.map((c) => c.hex).join(',') + ')' : (widget.backgroundColor ? widget.backgroundColor.hex : '#0E2A47');
  const pad = (widget.pad || [16, 16, 16, 16]).map((p) => p + 'px').join(' ');
  return '<figure style="margin:0;display:flex;flex-direction:column;align-items:center;gap:10px">' +
    '<div style="width:' + w + 'px;height:' + h + 'px;box-sizing:border-box;border-radius:22px;overflow:hidden;background:' + bg + ';padding:' + pad +
    ';display:flex;flex-direction:column;font-family:-apple-system,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25)">' +
    widget.children.map((c) => nodeHTML(c, 'v')).join('') + '</div>' +
    (caption ? '<figcaption style="font:13px -apple-system,system-ui,sans-serif;color:#555">' + esc(caption) + '</figcaption>' : '') + '</figure>';
}
