import { describe, expect, it } from "vitest";
import { createExportHtml, parseHtmlDeck } from "../src/deck";

describe("HTML deck parsing", () => {
  it("extracts slides from common HTML slide containers", () => {
    const deck = parseHtmlDeck(`
      <!doctype html>
      <html>
        <head>
          <title>Quarterly Update</title>
          <style>.hero { color: red; }</style>
        </head>
        <body>
          <section style="background:#fff"><h1>One</h1></section>
          <section><h1>Two</h1></section>
        </body>
      </html>
    `);

    expect(deck.title).toBe("Quarterly Update");
    expect(deck.globalStyles).toContain(".hero");
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[0].title).toBe("One");
    expect(deck.slides[0].style).toContain("background");
  });

  it("sanitizes script tags and inline event handlers", () => {
    const deck = parseHtmlDeck(`
      <section>
        <script>window.bad = true</script>
        <h1 onclick="alert(1)">Safe</h1>
        <a href="javascript:alert(1)">bad link</a>
      </section>
    `);

    expect(deck.slides[0].html).not.toContain("<script");
    expect(deck.slides[0].html).not.toContain("onclick");
    expect(deck.slides[0].html).not.toContain("javascript:");
  });

  it("keeps imported slide styles from changing the editor host page", () => {
    const deck = parseHtmlDeck(`
      <!doctype html>
      <html>
        <head>
          <style>
            html, body { width: 1600px; height: 900px; overflow: hidden; }
            body { display: grid; padding: 24px; }
            .slide-title { color: #0f766e; }
            @page { size: 16in 9in; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          <section style="width:1600px;height:900px"><h1 class="slide-title">Scoped</h1></section>
        </body>
      </html>
    `);

    expect(deck.globalStyles).not.toContain("body {");
    expect(deck.globalStyles).not.toContain("html, body");
    expect(deck.globalStyles).not.toContain("@page");
    expect(deck.globalStyles).not.toContain("@media print");
    expect(deck.globalStyles).toContain(".slide-title");
    expect(deck.slides[0].width).toBe(1600);
    expect(deck.slides[0].height).toBe(900);
  });
});

describe("HTML export", () => {
  it("creates a standalone printable HTML document", () => {
    const deck = parseHtmlDeck("<section><h1>Hello</h1></section>");
    const html = createExportHtml(deck);

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("html-ppt-slide");
    expect(html).toContain("@media print");
    expect(html).toContain("Hello");
  });
});
