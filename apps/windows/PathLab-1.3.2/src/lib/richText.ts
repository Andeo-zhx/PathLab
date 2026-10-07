/**
 * 轻量富文本排版器：把 Tiptap JSON 排版成可在 Canvas 上绘制的行/片段。
 * 用于「整页图文导出」——全部以矢量方式重绘，任意倍率都保持锐利。
 */

export const CANVAS_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';

export interface RichRun {
  text: string;
  font: string;
  width: number;
  color: string;
}

export interface RichLine {
  runs: RichRun[];
  /** 基线 y（相对排版区域顶部） */
  baseline: number;
  height: number;
  x: number;
}

export interface RichLayout {
  lines: RichLine[];
  height: number;
}

export interface RichLayoutOptions {
  width: number;
  baseFontSize?: number;
  color?: string;
  lineHeight?: number;
}

interface Token {
  text: string;
  font: string;
  width: number;
  color: string;
  space: boolean;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    measureCtx = canvas.getContext('2d');
  }
  if (!measureCtx) throw new Error('无法创建测量用 canvas 上下文');
  return measureCtx;
}

function fontOf(size: number, weight: number, italic: boolean): string {
  return `${italic ? 'italic ' : ''}${weight} ${size}px ${CANVAS_FONT_STACK}`;
}

export function measureText(text: string, font: string): number {
  const ctx = getMeasureCtx();
  ctx.font = font;
  return ctx.measureText(text).width;
}

const CJK_CLASS = '\\u2E80-\\u9FFF\\u3000-\\u303F\\uFF00-\\uFFEF\\uAC00-\\uD7AF';
const TOKEN_RE = new RegExp('[' + CJK_CLASS + ']|[^\\s' + CJK_CLASS + ']+|\\s+', 'gu');

/** 行首禁则：这些字符不允许出现在行首 */
const NO_LINE_START = new Set('，。、；：？！）】》」』”’％…—～·,.;:?!)]}>%'.split(''));

function splitTokens(text: string, font: string, color: string): Token[] {
  const parts = text.match(TOKEN_RE) ?? [];
  return parts.map((p) => ({
    text: p,
    font,
    width: measureText(p, font),
    color,
    space: /^\s+$/.test(p),
  }));
}

function inlineTokens(
  nodes: Record<string, unknown>[] | undefined,
  ctx: { size: number; weight: number; italic: boolean; color: string },
): Token[] {
  if (!nodes) return [];
  const out: Token[] = [];
  for (const node of nodes) {
    const type = node.type as string;
    if (type === 'hardBreak') {
      out.push({
        text: '\n',
        font: fontOf(ctx.size, ctx.weight, ctx.italic),
        width: 0,
        color: ctx.color,
        space: false,
      });
      continue;
    }
    if (type !== 'text') continue;
    const marks = (node.marks ?? []) as { type: string }[];
    const bold = marks.some((m) => m.type === 'bold') || ctx.weight >= 600;
    const italic = marks.some((m) => m.type === 'italic') || ctx.italic;
    const font = fontOf(ctx.size, bold ? 700 : ctx.weight, italic);
    out.push(...splitTokens((node.text as string) ?? '', font, ctx.color));
  }
  return out;
}

const EMPTY_DOC: Record<string, unknown>[] = [];

interface BlockOpts {
  size: number;
  weight: number;
  italic: boolean;
  lineHeight: number;
  spaceBefore: number;
  spaceAfter: number;
  indent: number;
  marker?: string;
}

export function layoutRichText(doc: unknown, options: RichLayoutOptions): RichLayout {
  const width = Math.max(80, options.width);
  const base = options.baseFontSize ?? 17;
  const color = options.color ?? '#1F2937';
  const lineHeightFactor = options.lineHeight ?? 1.68;
  const lines: RichLine[] = [];
  let cursor = 0;

  const root = (doc as { content?: Record<string, unknown>[] } | null)?.content ?? EMPTY_DOC;

  const emitBlock = (tokens: Token[], opts: BlockOpts): number => {
    cursor += opts.spaceBefore;
    const lh = opts.size * opts.lineHeight;
    const maxWidth = width - opts.indent;
    const startIndex = lines.length;
    let lineTokens: Token[] = [];
    let lineWidth = 0;

    const pushLine = (isLast: boolean) => {
      while (lineTokens.length && lineTokens[lineTokens.length - 1].space) {
        const t = lineTokens.pop();
        if (t) lineWidth -= t.width;
      }
      const runs: RichRun[] = [];
      if (isLast && opts.marker) {
        const markerW = measureText(opts.marker, fontOf(opts.size, 600, false));
        runs.push({
          text: opts.marker,
          font: fontOf(opts.size, 600, false),
          width: markerW,
          color,
        });
        runs.push({ text: ' ', font: fontOf(opts.size, 400, false), width: opts.size * 0.5, color });
      }
      runs.push(...mergeRuns(lineTokens));
      lines.push({
        runs,
        baseline: cursor + lh * 0.5 + opts.size * 0.35,
        height: lh,
        x: opts.indent,
      });
      cursor += lh;
      lineTokens = [];
      lineWidth = 0;
    };

    let isFirst = true;
    for (const token of tokens) {
      if (token.text === '\n') {
        pushLine(isFirst);
        isFirst = false;
        continue;
      }
      if (token.space && lineTokens.length === 0) continue;
      const overflow = lineWidth + token.width > maxWidth;
      const firstChar = token.text[0] ?? '';
      if (overflow && lineTokens.length > 0 && !NO_LINE_START.has(firstChar)) {
        pushLine(isFirst);
        isFirst = false;
        if (token.space) continue;
      }
      lineTokens.push(token);
      lineWidth += token.width;
    }
    if (lineTokens.length || lines.length === startIndex) pushLine(isFirst);
    cursor += opts.spaceAfter;
    return startIndex;
  };

  const walkBlocks = (
    nodes: Record<string, unknown>[],
    listCtx?: { ordered: boolean; start: number },
    depth = 0,
  ) => {
    let ordered = listCtx ? listCtx.start : 1;
    for (const node of nodes) {
      const type = node.type as string;
      const content = (node.content as Record<string, unknown>[]) ?? [];
      if (type === 'paragraph') {
        const tokens = inlineTokens(content, { size: base, weight: 400, italic: false, color });
        if (!tokens.length) continue;
        emitBlock(tokens, {
          size: base,
          weight: 400,
          italic: false,
          lineHeight: lineHeightFactor,
          spaceBefore: depth > 0 ? base * 0.1 : 0,
          spaceAfter: base * (depth > 0 ? 0.3 : 0.62),
          indent: depth * base * 1.55,
        });
      } else if (type === 'heading') {
        const level = ((node.attrs as { level?: number } | undefined)?.level ?? 1) as number;
        const size = level === 1 ? base * 1.6 : base * 1.24;
        const weight = level === 1 ? 700 : 650;
        const tokens = inlineTokens(content, { size, weight, italic: false, color: '#111827' });
        if (!tokens.length) continue;
        emitBlock(tokens, {
          size,
          weight,
          italic: false,
          lineHeight: 1.34,
          spaceBefore: level === 1 ? base * 0.95 : base * 0.7,
          spaceAfter: level === 1 ? base * 0.4 : base * 0.3,
          indent: 0,
        });
      } else if (type === 'bulletList' || type === 'orderedList') {
        cursor += base * 0.12;
        walkBlocks(
          content,
          {
            ordered: type === 'orderedList',
            start: ((node.attrs as { start?: number } | undefined)?.start ?? 1) as number,
          },
          depth,
        );
        cursor += base * 0.3;
      } else if (type === 'listItem') {
        const marker = listCtx?.ordered ? `${ordered}.` : '•';
        ordered += 1;
        const para = content.find((c) => c.type === 'paragraph');
        const rest = content.filter((c) => c.type !== 'paragraph');
        if (para) {
          const tokens = inlineTokens((para.content as Record<string, unknown>[]) ?? [], {
            size: base,
            weight: 400,
            italic: false,
            color,
          });
          if (tokens.length) {
            emitBlock(tokens, {
              size: base,
              weight: 400,
              italic: false,
              lineHeight: lineHeightFactor,
              spaceBefore: 0,
              spaceAfter: base * 0.28,
              indent: base * 1.55 * (depth + 1),
              marker,
            });
          }
        }
        if (rest.length) walkBlocks(rest, undefined, depth + 1);
      } else if (content.length) {
        walkBlocks(content, listCtx, depth);
      }
    }
  };

  walkBlocks(root);
  return { lines, height: Math.max(cursor, base * 2) };
}

function mergeRuns(tokens: Token[]): RichRun[] {
  const runs: RichRun[] = [];
  for (const t of tokens) {
    const last = runs[runs.length - 1];
    if (last && last.font === t.font && last.color === t.color) {
      last.text += t.text;
      last.width += t.width;
    } else {
      runs.push({ text: t.text, font: t.font, width: t.width, color: t.color });
    }
  }
  return runs;
}

/** 用 Canvas 把排版结果画出来 */
export function paintRichLayout(
  ctx: CanvasRenderingContext2D,
  layout: RichLayout,
  dx: number,
  dy: number,
): void {
  const prevBaseline = ctx.textBaseline;
  ctx.textBaseline = 'alphabetic';
  for (const line of layout.lines) {
    let x = dx + line.x;
    for (const run of line.runs) {
      ctx.font = run.font;
      ctx.fillStyle = run.color;
      if (run.text.trim().length > 0 || run.text === ' ') ctx.fillText(run.text, x, dy + line.baseline);
      x += run.width;
    }
  }
  ctx.textBaseline = prevBaseline;
}

export function blockCount(doc: unknown): number {
  const root = (doc as { content?: unknown[] } | null)?.content ?? [];
  return root.length;
}
