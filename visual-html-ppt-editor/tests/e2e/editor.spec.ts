import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("edits text, moves an element, and exports HTML", async ({ page }) => {
  await page.goto("/");

  const canvas = page.getByTestId("slide-canvas");
  await expect(canvas).toContainText("AI 生成后");

  const headline = canvas.locator("h1");
  await headline.click();
  await expect(page.getByTestId("selection-overlay")).toBeVisible();

  await page.getByTestId("selected-text").fill("交付版 HTML PPT 编辑器");
  await page.getByTestId("selected-text").blur();
  await expect(canvas).toContainText("交付版 HTML PPT 编辑器");

  const boxBefore = await headline.boundingBox();
  expect(boxBefore).not.toBeNull();
  await page.mouse.move((boxBefore?.x ?? 0) + 20, (boxBefore?.y ?? 0) + 20);
  await page.mouse.down();
  await page.mouse.move((boxBefore?.x ?? 0) + 120, (boxBefore?.y ?? 0) + 80, { steps: 6 });
  await page.mouse.up();
  const boxAfter = await headline.boundingBox();
  expect(boxAfter).not.toBeNull();
  expect(Math.abs((boxAfter?.x ?? 0) - (boxBefore?.x ?? 0))).toBeGreaterThan(10);

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-html").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.html$/);
});

test("imports pasted HTML as editable slides", async ({ page }) => {
  await page.goto("/");

  await page.locator("summary").click();
  await page.getByTestId("paste-html").fill(`
    <!doctype html>
    <html>
      <head><title>Imported Deck</title></head>
      <body>
        <section style="background:#f8fafc"><h1 style="position:absolute;left:80px;top:80px;">Imported Headline</h1></section>
        <section><p>Second slide</p></section>
      </body>
    </html>
  `);
  await page.getByRole("button", { name: "Import pasted HTML" }).click();

  await expect(page.getByTestId("slide-canvas")).toContainText("Imported Headline");
  await expect(page.getByText("Imported Deck")).toBeVisible();
});

test("imports multiple HTML files, reorders previews, and exports one ordered deck", async ({ page }) => {
  await page.goto("/");

  const firstHtml = `
    <!doctype html>
    <html>
      <head>
        <title>First File</title>
        <style>.slide { width: 1280px; height: 720px; position: relative; background: #f8fafc; }</style>
      </head>
      <body>
        <section class="slide"><h1 style="position:absolute;left:80px;top:80px;font-size:56px;">First imported slide</h1></section>
      </body>
    </html>
  `;
  const secondHtml = `
    <!doctype html>
    <html>
      <head>
        <title>Second File</title>
        <style>.slide { width: 1280px; height: 720px; position: relative; background: #fff7ed; }</style>
      </head>
      <body>
        <section class="slide"><h1 style="position:absolute;left:90px;top:90px;font-size:56px;">Second imported slide</h1></section>
      </body>
    </html>
  `;

  await page.getByTestId("import-file-input").setInputFiles([
    { name: "01-first.html", mimeType: "text/html", buffer: Buffer.from(firstHtml) },
    { name: "02-second.html", mimeType: "text/html", buffer: Buffer.from(secondHtml) },
  ]);

  await expect(page.getByTestId("slide-count")).toHaveText("2");
  await expect(page.getByTestId("slide-title-0")).toContainText("01-first");
  await expect(page.getByTestId("slide-title-1")).toContainText("02-second");
  await expect(page.getByTestId("slide-canvas")).toContainText("First imported slide");

  await page.getByTestId("slide-thumb-1").click();
  await expect(page.getByTestId("slide-canvas")).toContainText("Second imported slide");

  await page.getByTestId("move-slide-up-1").click();
  await expect(page.getByTestId("slide-title-0")).toContainText("02-second");
  await expect(page.getByTestId("slide-title-1")).toContainText("01-first");
  await expect(page.getByTestId("slide-canvas")).toContainText("Second imported slide");

  const htmlPromise = page.waitForEvent("download");
  await page.getByTestId("export-html").click();
  const htmlDownload = await htmlPromise;
  const htmlPath = path.join(test.info().outputDir, htmlDownload.suggestedFilename());
  await htmlDownload.saveAs(htmlPath);
  const exportedHtml = await fs.readFile(htmlPath, "utf8");
  expect(exportedHtml.indexOf("Second imported slide")).toBeLessThan(exportedHtml.indexOf("First imported slide"));

  const pptxPromise = page.waitForEvent("download");
  await page.getByTestId("export-pptx").click();
  const pptxDownload = await pptxPromise;
  const pptxPath = path.join(test.info().outputDir, pptxDownload.suggestedFilename());
  await pptxDownload.saveAs(pptxPath);
  expect((await fs.readFile(pptxPath)).subarray(0, 2).toString()).toBe("PK");
});

test("appends newly imported HTML files to the existing deck", async ({ page }) => {
  await page.goto("/");

  const createHtml = (title: string, label: string) => `
    <!doctype html>
    <html>
      <head>
        <title>${title}</title>
        <style>.slide { width: 1280px; height: 720px; position: relative; background: #ffffff; }</style>
      </head>
      <body>
        <section class="slide"><h1 style="position:absolute;left:80px;top:80px;font-size:56px;">${label}</h1></section>
      </body>
    </html>
  `;

  await page.getByTestId("import-file-input").setInputFiles([
    { name: "01-first.html", mimeType: "text/html", buffer: Buffer.from(createHtml("First File", "First imported slide")) },
    { name: "02-second.html", mimeType: "text/html", buffer: Buffer.from(createHtml("Second File", "Second imported slide")) },
  ]);

  await expect(page.getByTestId("slide-count")).toHaveText("2");

  await page.getByTestId("import-file-input").setInputFiles({
    name: "03-third.html",
    mimeType: "text/html",
    buffer: Buffer.from(createHtml("Third File", "Third imported slide")),
  });

  await expect(page.getByTestId("slide-count")).toHaveText("3");
  await expect(page.getByTestId("slide-title-0")).toContainText("01-first");
  await expect(page.getByTestId("slide-title-1")).toContainText("02-second");
  await expect(page.getByTestId("slide-title-2")).toContainText("Third imported slide");
  await expect(page.getByTestId("slide-canvas")).toContainText("Third imported slide");

  await page.getByTestId("slide-thumb-0").click();
  await expect(page.getByTestId("slide-canvas")).toContainText("First imported slide");
  await page.getByTestId("slide-thumb-1").click();
  await expect(page.getByTestId("slide-canvas")).toContainText("Second imported slide");
});

test("plays the deck in a PPT-like presentation mode", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("slide-thumb-1").click();
  await page.getByTestId("start-presentation").click();

  await expect(page.getByTestId("presentation-mode")).toBeVisible();
  await expect(page.getByTestId("presentation-counter")).toHaveText("2 / 2");
  await expect(page.getByTestId("presentation-slide")).toContainText("第一版覆盖核心动作");
  await expect(page.getByTestId("presentation-next")).toBeDisabled();

  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("presentation-counter")).toHaveText("1 / 2");
  await expect(page.getByTestId("presentation-slide")).toContainText("AI 生成后");

  await page.keyboard.press(" ");
  await expect(page.getByTestId("presentation-counter")).toHaveText("2 / 2");

  await page.getByTestId("presentation-prev").click();
  await expect(page.getByTestId("presentation-counter")).toHaveText("1 / 2");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("presentation-mode")).toBeHidden();
  await expect(page.getByTestId("slide-canvas")).toContainText("AI 生成后");
});

test("inserts images and tables into the editable HTML slide", async ({ page }) => {
  await page.goto("/");

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lWf9WQAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.getByTestId("insert-image-input").setInputFiles({
    name: "sample.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByTestId("slide-canvas").locator('img[alt="sample"]')).toHaveCount(1);

  await page.getByTestId("insert-table").click();
  await expect(page.getByTestId("slide-canvas").locator("table")).toHaveCount(1);
  await expect(page.getByTestId("slide-canvas")).toContainText("标题 1");

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-html").click();
  const download = await downloadPromise;
  const savePath = path.join(test.info().outputDir, download.suggestedFilename());
  await download.saveAs(savePath);
  const html = await fs.readFile(savePath, "utf8");
  expect(html).toContain("data:image/png");
  expect(html).toContain("<table");
});

test("pastes image files and delimited tables into the current HTML page", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("slide-canvas");
  await canvas.click();

  await page.evaluate(() => {
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lWf9WQAAAABJRU5ErkJggg==";
    const bytes = Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0));
    const file = new File([bytes], "pasted.png", { type: "image/png" });
    const clipboard = new DataTransfer();
    clipboard.items.add(file);
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
  });

  await expect(canvas.locator('img[alt="pasted"]')).toHaveCount(1);

  await page.evaluate(() => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "Alpha\tBeta\n10\t20");
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
  });

  await expect(canvas.locator("table")).toHaveCount(1);
  await expect(canvas).toContainText("Alpha");
});

test("adds and deletes HTML pages from the left preview panel", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("slide-count")).toHaveText("2");
  await page.getByTestId("add-slide").click();
  await expect(page.getByTestId("slide-count")).toHaveText("3");
  await expect(page.getByTestId("slide-canvas")).toContainText("新页面 2");

  await page.getByTestId("delete-slide-1").click();
  await expect(page.getByTestId("slide-count")).toHaveText("2");
  await expect(page.getByTestId("slide-canvas")).toContainText("第一版覆盖核心动作");
});

test("exports an image-based PPTX deck", async ({ page }) => {
  await page.goto("/");

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-pptx").click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.pptx$/);
  const savePath = path.join(test.info().outputDir, download.suggestedFilename());
  await download.saveAs(savePath);
  expect(await download.failure()).toBeNull();
  expect(savePath).toMatch(/\.pptx$/);
  const header = await fs.readFile(savePath, { encoding: null });
  expect(header.subarray(0, 2).toString()).toBe("PK");
});

test("exports a real PDF file", async ({ page }) => {
  await page.goto("/");

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-pdf").click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const savePath = path.join(test.info().outputDir, download.suggestedFilename());
  await download.saveAs(savePath);
  expect(await download.failure()).toBeNull();
  const header = await fs.readFile(savePath, { encoding: null });
  expect(header.subarray(0, 4).toString()).toBe("%PDF");
});

test("selecting inherited text does not mutate its original formatting", async ({ page }) => {
  await page.goto("/");

  await page.locator("summary").click();
  await page.getByTestId("paste-html").fill(`
    <!doctype html>
    <html>
      <head>
        <title>Inherited Style Deck</title>
        <style>
          .slide { width: 1024px; height: 768px; background: #fff; }
          .headline-wrap { position:absolute; left:80px; top:90px; width:720px; color:#8b1e3f; font-family: Georgia, serif; }
          .headline-wrap h1 { margin:0; font-size:56px; line-height:1.1; font-weight:400; }
        </style>
      </head>
      <body>
        <section class="slide"><div class="headline-wrap"><h1>Inherited Headline</h1></div></section>
      </body>
    </html>
  `);
  await page.getByRole("button", { name: "Import pasted HTML" }).click();

  const headline = page.getByTestId("slide-canvas").locator("h1");
  const before = await headline.evaluate((element) => ({
    parentClass: element.parentElement?.className,
    style: element.getAttribute("style") || "",
    color: getComputedStyle(element).color,
    family: getComputedStyle(element).fontFamily,
  }));

  await headline.click();
  await expect(page.getByTestId("selection-overlay")).toBeVisible();

  const after = await headline.evaluate((element) => ({
    parentClass: element.parentElement?.className,
    style: element.getAttribute("style") || "",
    color: getComputedStyle(element).color,
    family: getComputedStyle(element).fontFamily,
  }));

  expect(after).toEqual(before);
});

test("exports non-16:9 HTML as PPTX and PDF", async ({ page }) => {
  await page.goto("/");

  await page.locator("summary").click();
  await page.getByTestId("paste-html").fill(`
    <!doctype html>
    <html>
      <head>
        <title>Four Three Deck</title>
        <style>.slide { width: 1024px; height: 768px; position: relative; background: #f8fafc; }</style>
      </head>
      <body>
        <section class="slide"><h1 style="position:absolute;left:90px;top:80px;font-size:54px;">4:3 Slide</h1></section>
      </body>
    </html>
  `);
  await page.getByRole("button", { name: "Import pasted HTML" }).click();
  await expect(page.locator(".status-pill")).toContainText("1024x768");

  const pptxPromise = page.waitForEvent("download");
  await page.getByTestId("export-pptx").click();
  const pptxDownload = await pptxPromise;
  const pptxPath = path.join(test.info().outputDir, pptxDownload.suggestedFilename());
  await pptxDownload.saveAs(pptxPath);
  expect((await fs.readFile(pptxPath)).subarray(0, 2).toString()).toBe("PK");

  const pdfPromise = page.waitForEvent("download");
  await page.getByTestId("export-pdf").click();
  const pdfDownload = await pdfPromise;
  const pdfPath = path.join(test.info().outputDir, pdfDownload.suggestedFilename());
  await pdfDownload.saveAs(pdfPath);
  expect((await fs.readFile(pdfPath)).subarray(0, 4).toString()).toBe("%PDF");
});

test("keeps 1600x900 source slide dimensions and supports marquee multi-select", async ({ page }) => {
  await page.goto("/");
  const samplePath = "/Users/weiweizeng/Desktop/htmltoppt/第二部分_01_总体架构.html";
  await page.getByTestId("import-file-input").setInputFiles(samplePath);

  await expect(page.locator(".status-pill")).toContainText("1600x900");
  const canvas = page.getByTestId("slide-canvas");
  await expect(canvas).toContainText("总体架构");

  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.mouse.move((canvasBox?.x ?? 0) + 40, (canvasBox?.y ?? 0) + 40);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move((canvasBox?.x ?? 0) + 700, (canvasBox?.y ?? 0) + 500, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Alt");

  await expect(page.getByTestId("selection-overlay")).toBeVisible();
  await expect(page.getByTestId("selected-text")).toHaveValue(/elements selected/);
});
