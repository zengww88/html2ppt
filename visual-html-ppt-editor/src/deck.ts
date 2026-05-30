import type { Deck, Slide } from "./types";

export const DEFAULT_SLIDE_WIDTH = 1280;
export const DEFAULT_SLIDE_HEIGHT = 720;

const SLIDE_SELECTOR = [
  "[data-slide]",
  "[data-ppt-slide]",
  ".html-ppt-slide",
  ".ppt-slide",
  ".slide",
  "section",
].join(",");

const BLOCKED_TAGS = ["script", "iframe", "object", "embed", "base", "meta"];
const EDITOR_GLOBAL_STYLE_RULE = `.slide, .ppt-slide, .html-ppt-slide, [data-slide], [data-ppt-slide] {
  max-width: none;
}`;

export const DEFAULT_DECK: Deck = {
  id: "starter-deck",
  title: "AI HTML PPT Demo",
  globalStyles: `
    .metric { display: grid; gap: 8px; padding: 22px; border: 1px solid rgba(20, 40, 60, .14); border-radius: 8px; background: rgba(255,255,255,.84); }
    .metric strong { font-size: 42px; color: #0f766e; }
    .tag { display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: 999px; background: #ecfdf5; color: #047857; font-weight: 700; }
  `,
  slides: [
    {
      id: "slide-1",
      title: "可视化编辑 HTML PPT",
      style: "background: linear-gradient(135deg, #f8fafc 0%, #dff7ef 52%, #fff7ed 100%);",
      width: DEFAULT_SLIDE_WIDTH,
      height: DEFAULT_SLIDE_HEIGHT,
      html: `
        <div style="position:absolute;left:78px;top:72px;width:680px;">
          <span class="tag">LOCAL HTML DECK</span>
          <h1 style="font-size:68px;line-height:1.03;margin:28px 0 18px;color:#10232f;">AI 生成后，直接可视化改版</h1>
          <p style="font-size:24px;line-height:1.55;color:#405263;margin:0;">导入 HTML 幻灯片，像编辑 PPT 一样拖拽、缩放、改文字、调颜色，再导出成 HTML、PDF 或图片版 PPTX。</p>
        </div>
        <div style="position:absolute;right:78px;top:110px;width:340px;height:430px;border-radius:8px;background:#0f172a;color:white;padding:28px;box-shadow:0 26px 70px rgba(15,23,42,.24);">
          <h2 style="font-size:30px;margin:0 0 22px;">编辑闭环</h2>
          <p style="font-size:20px;line-height:1.8;margin:0;color:#cbd5e1;">Import<br/>Select<br/>Drag<br/>Resize<br/>Style<br/>Export</p>
        </div>
      `,
    },
    {
      id: "slide-2",
      title: "可测试能力",
      style: "background:#fffdf7;",
      width: DEFAULT_SLIDE_WIDTH,
      height: DEFAULT_SLIDE_HEIGHT,
      html: `
        <h1 style="position:absolute;left:74px;top:58px;font-size:54px;margin:0;color:#263238;">第一版覆盖核心动作</h1>
        <div style="position:absolute;left:74px;top:180px;width:320px;" class="metric"><span>选中元素</span><strong>Click</strong><small>任意可见 HTML 元素</small></div>
        <div style="position:absolute;left:430px;top:180px;width:320px;" class="metric"><span>布局调整</span><strong>Drag</strong><small>移动和四角缩放</small></div>
        <div style="position:absolute;left:786px;top:180px;width:320px;" class="metric"><span>交付导出</span><strong>Save</strong><small>HTML / PDF / PPTX</small></div>
        <p style="position:absolute;left:78px;bottom:72px;width:880px;font-size:24px;line-height:1.5;color:#475569;">这个 MVP 不追求复刻 PowerPoint，而是解决 AI HTML PPT 后期微调不可视的问题。</p>
      `,
    },
  ],
};

export function parseHtmlDeck(source: string, sourceName?: string): Deck {
  const parser = new DOMParser();
  const doc = parser.parseFromString(source, "text/html");
  sanitizeTree(doc);

  const title = doc.querySelector("title")?.textContent?.trim() || "Imported HTML Deck";
  const globalStyles = Array.from(doc.querySelectorAll("style"))
    .map((style) => style.textContent?.trim())
    .filter(Boolean)
    .join("\n\n");

  const candidates = getSlideCandidates(doc);
  const slides = candidates.map((node, index) => createSlideFromElement(node, index, globalStyles, doc));

  return {
    id: `deck-${Date.now()}`,
    title: sourceName ? sourceName.replace(/\.[^.]+$/, "") : title,
    globalStyles: createEditorGlobalStyles(globalStyles),
    sourceName,
    slides: slides.length > 0 ? slides : [createSlideFromElement(doc.body, 0, globalStyles, doc)],
  };
}

export function createExportHtml(deck: Deck): string {
  const slides = deck.slides
    .map((slide, index) => {
      const html = stripEditorAttributes(slide.html);
      const style = mergeStyleText(slide.style, `--slide-width:${slide.width}px`, `--slide-height:${slide.height}px`);
      return `
        <article class="html-ppt-slide" data-slide="${index + 1}" style="${escapeAttribute(style)}">
          ${html}
        </article>
      `;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(deck.title)}</title>
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; background: #111827; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { display: grid; gap: 24px; justify-items: center; padding: 24px; }
      .html-ppt-slide {
        width: var(--slide-width, ${DEFAULT_SLIDE_WIDTH}px);
        height: var(--slide-height, ${DEFAULT_SLIDE_HEIGHT}px);
        position: relative;
        overflow: hidden;
        background: white;
        color: #111827;
        box-shadow: 0 20px 80px rgba(0,0,0,.28);
      }
      .html-ppt-slide img, .html-ppt-slide video, .html-ppt-slide svg { max-width: 100%; }
      @page { size: 16in 9in; margin: 0; }
      @media print {
        html, body { width: 16in; background: white; display: block; padding: 0; }
        .html-ppt-slide { width: 16in; height: 9in; box-shadow: none; page-break-after: always; break-after: page; }
      }
      ${deck.globalStyles}
    </style>
  </head>
  <body>
    ${slides}
  </body>
</html>`;
}

export function replaceSlideHtml(deck: Deck, index: number, html: string, style?: string): Deck {
  return {
    ...deck,
    slides: deck.slides.map((slide, slideIndex) =>
      slideIndex === index ? { ...slide, html, style: style ?? slide.style } : slide,
    ),
  };
}

export function replaceSlide(deck: Deck, index: number, patch: Partial<Slide>): Deck {
  return {
    ...deck,
    slides: deck.slides.map((slide, slideIndex) =>
      slideIndex === index ? { ...slide, ...patch } : slide,
    ),
  };
}

export function cloneDeck(deck: Deck): Deck {
  return JSON.parse(JSON.stringify(deck)) as Deck;
}

export function normalizeDeckEditorIds(deck: Deck): Deck {
  return {
    ...deck,
    globalStyles: createEditorGlobalStyles(deck.globalStyles),
    slides: deck.slides.map((slide, slideIndex) => ({
      ...slide,
      html: normalizeHtmlEditorIds(slide.html, `s${slideIndex + 1}`),
    })),
  };
}

function getSlideCandidates(doc: Document): HTMLElement[] {
  const all = Array.from(doc.body.querySelectorAll<HTMLElement>(SLIDE_SELECTOR));
  const unique = Array.from(new Set(all));
  return unique.filter((node) => !unique.some((other) => other !== node && other.contains(node)));
}

function createSlideFromElement(node: HTMLElement, index: number, globalStyles: string, doc: Document): Slide {
  const title =
    node.getAttribute("data-title") ||
    node.querySelector("h1,h2,h3")?.textContent?.trim().slice(0, 64) ||
    `Slide ${index + 1}`;

  const inheritedStyle = inferRootStyle(node, globalStyles);
  const dimensions = inferSlideDimensions(node, inheritedStyle, doc, globalStyles);
  const style = mergeStyleText(inheritedStyle, node.getAttribute("style") || "");

  return {
    id: node.id || `slide-${index + 1}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    html: sanitizeHtmlFragment(node.innerHTML),
    style,
    width: dimensions.width,
    height: dimensions.height,
  };
}

function createEditorGlobalStyles(globalStyles: string): string {
  const cleanedStyles = removeEditorHostRules(globalStyles).replace(
    /\.slide,\s*\.ppt-slide,\s*\.html-ppt-slide,\s*\[data-slide\],\s*\[data-ppt-slide\]\s*\{\s*max-width:\s*none;\s*\}/gi,
    "",
  );
  return `${cleanedStyles.trim() ? `${cleanedStyles.trim()}\n\n` : ""}${EDITOR_GLOBAL_STYLE_RULE}\n`;
}

function removeEditorHostRules(cssText: string): string {
  let index = 0;
  let result = "";

  while (index < cssText.length) {
    const openIndex = cssText.indexOf("{", index);
    if (openIndex === -1) {
      result += cssText.slice(index);
      break;
    }

    const closeIndex = findMatchingBrace(cssText, openIndex);
    if (closeIndex === -1) {
      result += cssText.slice(index);
      break;
    }

    const prelude = cssText.slice(index, openIndex).trim();
    const rule = cssText.slice(index, closeIndex + 1);
    const isHostRule = selectorTargetsEditorHost(prelude);
    const isPrintRule = /^@page\b/i.test(prelude) || /^@media\s+print\b/i.test(prelude);

    if (!isHostRule && !isPrintRule) {
      result += `${rule}\n`;
    }

    index = closeIndex + 1;
  }

  return result.trim();
}

function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function selectorTargetsEditorHost(prelude: string): boolean {
  if (prelude.startsWith("@")) return false;
  return prelude
    .split(",")
    .map((selector) => selector.trim())
    .some((selector) => /(^|[\s>+~])(?:html|body)(?=$|[\s.#:[>+~])/i.test(selector));
}

function inferSlideDimensions(
  node: HTMLElement,
  inheritedStyle: string,
  doc: Document,
  globalStyles: string,
): { width: number; height: number } {
  const candidates = [
    node.getAttribute("style") || "",
    inheritedStyle,
    inferRootStyle(doc.body, globalStyles),
    doc.body.getAttribute("style") || "",
  ];

  for (const cssText of candidates) {
    const width = parseCssPixelValue(cssText, "width");
    const height = parseCssPixelValue(cssText, "height");
    if (width && height) return { width, height };
  }

  const widthAttr = parseNumericAttr(node.getAttribute("width"));
  const heightAttr = parseNumericAttr(node.getAttribute("height"));
  if (widthAttr && heightAttr) return { width: widthAttr, height: heightAttr };

  return { width: DEFAULT_SLIDE_WIDTH, height: DEFAULT_SLIDE_HEIGHT };
}

function inferRootStyle(node: HTMLElement, globalStyles: string): string {
  const selectorCandidates = getSelectorCandidates(node);
  const declarations: string[] = [];
  for (const selector of selectorCandidates) {
    declarations.push(...findCssDeclarations(globalStyles, selector));
  }
  return declarations.join(";");
}

function getSelectorCandidates(node: HTMLElement): string[] {
  const tag = node.tagName.toLowerCase();
  const selectors = [tag];
  if (node.id) selectors.push(`#${node.id}`, `${tag}#${node.id}`);
  node.classList.forEach((className) => {
    selectors.push(`.${className}`, `${tag}.${className}`);
  });
  return selectors;
}

function findCssDeclarations(cssText: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|}|,)\\s*${escaped}\\s*(?:,|\\{)([^{}]*)\\}`, "g");
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(cssText))) {
    results.push(match[2].trim());
  }
  return results;
}

function mergeStyleText(...styles: string[]): string {
  const merged = new Map<string, string>();
  styles
    .join(";")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((rule) => {
      const [property, ...valueParts] = rule.split(":");
      if (!property || valueParts.length === 0) return;
      merged.set(property.trim(), valueParts.join(":").trim());
    });
  return Array.from(merged.entries())
    .map(([property, value]) => `${property}:${value}`)
    .join(";");
}

function parseCssPixelValue(cssText: string, property: "width" | "height"): number | null {
  const match = cssText.match(new RegExp(`${property}\\s*:\\s*([\\d.]+)px`, "i"));
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseNumericAttr(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sanitizeHtmlFragment(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  sanitizeTree(template.content);
  return template.innerHTML;
}

function normalizeHtmlEditorIds(html: string, prefix: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  const seen = new Set<string>();
  let index = 1;

  template.content.querySelectorAll<HTMLElement>("*").forEach((node) => {
    const existing = node.dataset.editorId;
    if (existing && !seen.has(existing)) {
      seen.add(existing);
      return;
    }

    let nextId = `${prefix}-el-${index++}`;
    while (seen.has(nextId)) {
      nextId = `${prefix}-el-${index++}`;
    }
    node.dataset.editorId = nextId;
    seen.add(nextId);
  });

  return template.innerHTML;
}

function stripEditorAttributes(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("[data-editor-id]").forEach((node) => {
    node.removeAttribute("data-editor-id");
  });
  template.content.querySelectorAll("[data-editor-placeholder-for]").forEach((node) => {
    node.remove();
  });
  return template.innerHTML;
}

function sanitizeTree(root: ParentNode): void {
  root.querySelectorAll(BLOCKED_TAGS.join(",")).forEach((node) => node.remove());
  root.querySelectorAll<HTMLElement>("*").forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on")) node.removeAttribute(attr.name);
      if ((name === "href" || name === "src") && value.startsWith("javascript:")) {
        node.removeAttribute(attr.name);
      }
    });
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[char];
  });
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
