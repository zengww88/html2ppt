import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Code2,
  Copy,
  Download,
  FileDown,
  FileInput,
  ImagePlus,
  ImageDown,
  Italic,
  Layers,
  Play,
  Plus,
  Printer,
  Redo2,
  RotateCcw,
  Save,
  Table2,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import pptxgen from "pptxgenjs";
import { toPng } from "html-to-image";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { clearStoredDeck, loadStoredDeck, storeDeck } from "./storage";
import { cloneDeck, createExportHtml, DEFAULT_DECK, DEFAULT_SLIDE_HEIGHT, DEFAULT_SLIDE_WIDTH, normalizeDeckEditorIds, parseHtmlDeck, replaceSlideHtml } from "./deck";
import { downloadText, safeFilename } from "./download";
import type { Deck, ImportedFileHandle, Rect, SelectionInfo, Slide } from "./types";

const MIN_SIZE = 24;
const HANDLE_SIZE = 12;
const HISTORY_LIMIT = 80;
const THUMBNAIL_WIDTH = 168;
const THUMBNAIL_HEIGHT = 94;
const IMAGE_LOAD_TIMEOUT_MS = 2500;
const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

type ResizeHandle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

interface PointerSession {
  mode: "move" | "resize" | "marquee";
  handle?: ResizeHandle;
  elementId?: string;
  elementIds: string[];
  startX: number;
  startY: number;
  startRect: Rect;
  startRects: Record<string, Rect>;
  currentRect?: Rect;
  started: boolean;
  moved: boolean;
}

interface HtmlImportSource {
  name: string;
  text: string;
  handle?: FileSystemFileHandle;
}

export default function App() {
  const [deck, setDeck] = useState<Deck>(() => normalizeDeckEditorIds(loadStoredDeck() ?? cloneDeck(DEFAULT_DECK)));
  const [past, setPast] = useState<Deck[]>([]);
  const [future, setFuture] = useState<Deck[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [selectionRect, setSelectionRect] = useState<Rect | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null);
  const [draggingSlideIndex, setDraggingSlideIndex] = useState<number | null>(null);
  const [dragOverSlideIndex, setDragOverSlideIndex] = useState<number | null>(null);
  const [isPresenting, setIsPresenting] = useState(false);
  const [presentationSlideIndex, setPresentationSlideIndex] = useState(0);
  const [scale, setScale] = useState(0.72);
  const [pasteHtml, setPasteHtml] = useState("");
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingPptx, setIsExportingPptx] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [fileHandle, setFileHandle] = useState<ImportedFileHandle | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const stageShellRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const idCounterRef = useRef(1);
  const pointerSessionRef = useRef<PointerSession | null>(null);
  const inspectorEditBaseRef = useRef<Deck | null>(null);
  const selectedTextAreaRef = useRef<HTMLTextAreaElement | null>(null);

  const currentSlide = deck.slides[currentSlideIndex] ?? deck.slides[0];
  const slideWidth = currentSlide?.width ?? DEFAULT_SLIDE_WIDTH;
  const slideHeight = currentSlide?.height ?? DEFAULT_SLIDE_HEIGHT;

  const commitDeck = useCallback(
    (nextDeck: Deck, nextStatus?: string) => {
      setPast((items) => [...items.slice(-HISTORY_LIMIT + 1), cloneDeck(deck)]);
      setFuture([]);
      setDeck(nextDeck);
      if (nextStatus) setStatus(nextStatus);
    },
    [deck],
  );

  const serializeCurrentSlide = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !currentSlide) return deck;
    return replaceSlideHtml(deck, currentSlideIndex, stage.innerHTML);
  }, [currentSlide, currentSlideIndex, deck]);

  const commitStage = useCallback(
    (nextStatus?: string) => {
      commitDeck(serializeCurrentSlide(), nextStatus ?? "Saved");
    },
    [commitDeck, serializeCurrentSlide],
  );

  useEffect(() => {
    storeDeck(deck);
  }, [deck]);

  useEffect(() => {
    if (currentSlideIndex > deck.slides.length - 1) {
      setCurrentSlideIndex(Math.max(0, deck.slides.length - 1));
    }
  }, [currentSlideIndex, deck.slides.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isPresenting) return;
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (isTyping) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        nudgeSelected(dx, dy);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deck, past, future, selectedIds, currentSlideIndex, isPresenting]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isPresenting) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (isEditingTarget(target)) return;
      const clipboard = event.clipboardData;
      if (!clipboard) return;

      const imageFiles = Array.from(clipboard.items)
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));

      if (imageFiles.length > 0) {
        event.preventDefault();
        void insertImageFiles(imageFiles);
        return;
      }

      const tableHtml = extractFirstTableHtml(clipboard.getData("text/html"));
      if (tableHtml) {
        event.preventDefault();
        insertTableFromHtml(tableHtml, "Table pasted");
        return;
      }

      const delimitedTable = createTableHtmlFromDelimitedText(clipboard.getData("text/plain"));
      if (delimitedTable) {
        event.preventDefault();
        insertTableFromHtml(delimitedTable, "Table pasted");
      }
    };

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  useEffect(() => {
    if (!isPresenting) return;

    const onPresentationKeyDown = (event: KeyboardEvent) => {
      const key = event.key;
      if (key === "Escape") {
        event.preventDefault();
        closePresentation();
        return;
      }
      if (key === "ArrowRight" || key === "PageDown" || key === " " || key === "Enter") {
        event.preventDefault();
        showNextPresentationSlide();
        return;
      }
      if (key === "ArrowLeft" || key === "PageUp") {
        event.preventDefault();
        showPreviousPresentationSlide();
        return;
      }
      if (key === "Home") {
        event.preventDefault();
        setPresentationSlideIndex(0);
        return;
      }
      if (key === "End") {
        event.preventDefault();
        setPresentationSlideIndex(Math.max(0, deck.slides.length - 1));
      }
    };

    window.addEventListener("keydown", onPresentationKeyDown);
    return () => window.removeEventListener("keydown", onPresentationKeyDown);
  }, [deck.slides.length, isPresenting, presentationSlideIndex]);

  useLayoutEffect(() => {
    const shell = stageShellRef.current;
    if (!shell) return;

    const updateScale = () => {
      const rect = shell.getBoundingClientRect();
      const width = currentSlide?.width ?? DEFAULT_SLIDE_WIDTH;
      const height = currentSlide?.height ?? DEFAULT_SLIDE_HEIGHT;
      const nextScale = Math.min(rect.width / width, rect.height / height, 1);
      setScale(Math.max(0.28, Number(nextScale.toFixed(3))));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [currentSlide?.width, currentSlide?.height]);

  useLayoutEffect(() => {
    ensureEditorIds();
    if (selectedIds.length > 0) {
      refreshSelection(selectedIds);
    } else {
      setSelection(null);
      setSelectionRect(null);
    }
  }, [currentSlideIndex, deck, selectedIds]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;

      if (target === stage || event.altKey) {
        const rect = readPointFromEvent(event);
        pointerSessionRef.current = {
          mode: "marquee",
          elementIds: [],
          startX: event.clientX,
          startY: event.clientY,
          startRect: { x: rect.x, y: rect.y, width: 0, height: 0 },
          startRects: {},
          started: true,
          moved: false,
        };
        setSelectedIds([]);
        setMarqueeRect({ x: rect.x, y: rect.y, width: 0, height: 0 });
        window.addEventListener("pointermove", onWindowPointerMove);
        window.addEventListener("pointerup", onWindowPointerUp, { once: true });
        return;
      }

      const element = target.closest<HTMLElement>("[data-editor-id]");
      if (!element || !stage.contains(element) || element.isContentEditable) return;

      event.preventDefault();
      applyInspectorTextDraft();
      finishInspectorEdit("Text updated");
      const rect = readElementRect(element);
      const id = element.dataset.editorId ?? "";
      const ids = event.shiftKey || event.metaKey || event.ctrlKey
        ? selectedIds.includes(id)
          ? selectedIds.filter((item) => item !== id)
          : [...selectedIds, id]
        : selectedIds.includes(id)
          ? selectedIds
          : [id];
      if (ids.length === 0) {
        setSelectedIds([]);
        setSelection(null);
        setSelectionRect(null);
        return;
      }
      if (!sameStringArray(selectedIds, ids)) {
        setSelectedIds(ids);
        refreshSelection(ids);
      }
      const elements = ids.map((item) => (item === id ? element : getSelectedElement(item))).filter((item): item is HTMLElement => Boolean(item));
      const startRects = Object.fromEntries(elements.map((item) => [item.dataset.editorId ?? "", readElementRect(item)]));
      pointerSessionRef.current = {
        mode: "move",
        elementId: id,
        elementIds: ids,
        startX: event.clientX,
        startY: event.clientY,
        startRect: rect,
        startRects,
        started: false,
        moved: false,
      };
      window.addEventListener("pointermove", onWindowPointerMove);
      window.addEventListener("pointerup", onWindowPointerUp, { once: true });
    };

    stage.addEventListener("pointerdown", handlePointerDown, true);
    return () => stage.removeEventListener("pointerdown", handlePointerDown, true);
  });

  const slideStyle = useMemo(() => parseInlineStyle(currentSlide?.style ?? ""), [currentSlide?.style]);

  function ensureEditorIds() {
    const stage = stageRef.current;
    if (!stage) return;
    stage.querySelectorAll<HTMLElement>("*").forEach((element) => {
      if (!element.dataset.editorId) {
        element.dataset.editorId = `el-${Date.now().toString(36)}-${idCounterRef.current++}`;
      }
    });
  }

  function getSelectedElement(id = selectedIds[0]): HTMLElement | null {
    const stage = stageRef.current;
    if (!stage || !id) return null;
    return stage.querySelector<HTMLElement>(`[data-editor-id="${cssEscape(id)}"]`);
  }

  function getSelectedElements(ids = selectedIds): HTMLElement[] {
    return ids.map((id) => getSelectedElement(id)).filter((element): element is HTMLElement => Boolean(element));
  }

  function refreshSelection(ids = selectedIds) {
    const elements = getSelectedElements(ids);
    if (elements.length === 0) {
      setSelection(null);
      setSelectionRect(null);
      return;
    }

    const element = elements[0];
    const computed = window.getComputedStyle(element);
    const text = element.innerText || element.textContent || "";
    setSelection({
      ids,
      id: ids[0] ?? "",
      tag: element.tagName.toLowerCase(),
      text: elements.length === 1 ? text : `${elements.length} elements selected`,
      fontSize: computed.fontSize,
      color: rgbToHex(computed.color) ?? "#111827",
      backgroundColor: rgbToHex(computed.backgroundColor) ?? "#ffffff",
      fontWeight: computed.fontWeight,
      fontStyle: computed.fontStyle,
      textAlign: computed.textAlign,
      zIndex: computed.zIndex === "auto" ? "0" : computed.zIndex,
    });
    setSelectionRect(getUnionRect(elements.map((item) => readElementRect(item))));
  }

  function selectElement(element: HTMLElement | null, additive = false) {
    if (!element || element === stageRef.current) {
      setSelectedIds([]);
      return;
    }
    ensureEditorIds();
    const id = element.dataset.editorId;
    if (!id) return;
    const nextIds = additive
      ? selectedIds.includes(id)
        ? selectedIds.filter((item) => item !== id)
        : [...selectedIds, id]
      : [id];
    if (sameStringArray(selectedIds, nextIds) && selection) return;
    setSelectedIds(nextIds);
    refreshSelection(nextIds);
  }

  function readElementRect(element: HTMLElement): Rect {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0, width: 0, height: 0 };
    const stageRect = stage.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const stageScale = stageRect.width / slideWidth;
    return {
      x: round((elementRect.left - stageRect.left) / stageScale),
      y: round((elementRect.top - stageRect.top) / stageScale),
      width: round(elementRect.width / stageScale),
      height: round(elementRect.height / stageScale),
    };
  }

  function readElementRectById(id: string): Rect {
    const element = getSelectedElement(id);
    return element ? readElementRect(element) : { x: 0, y: 0, width: 0, height: 0 };
  }

  function readPointFromEvent(event: PointerEvent): { x: number; y: number } {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const stageRect = stage.getBoundingClientRect();
    const stageScale = stageRect.width / slideWidth;
    return {
      x: (event.clientX - stageRect.left) / stageScale,
      y: (event.clientY - stageRect.top) / stageScale,
    };
  }

  function ensureAbsoluteGeometry(element: HTMLElement, preserveFlow = false): Rect {
    const stage = stageRef.current;
    const rect = readElementRect(element);
    const computed = window.getComputedStyle(element);
    if (stage && element.parentElement !== stage) {
      if (preserveFlow) {
        insertFlowPlaceholder(element);
      }
      stage.append(element);
    }
    freezeVisualStyle(element, computed);
    element.style.position = "absolute";
    element.style.left = `${rect.x}px`;
    element.style.top = `${rect.y}px`;
    element.style.width = `${Math.max(rect.width, MIN_SIZE)}px`;
    element.style.height = `${Math.max(rect.height, MIN_SIZE)}px`;
    element.style.margin = "0";
    element.style.boxSizing = "border-box";
    return rect;
  }

  function freezeVisualStyle(element: HTMLElement, computed: CSSStyleDeclaration) {
    const copiedProperties = [
      "display",
      "font-family",
      "font-size",
      "font-weight",
      "font-style",
      "font-variant",
      "line-height",
      "letter-spacing",
      "word-spacing",
      "text-align",
      "text-decoration",
      "text-transform",
      "white-space",
      "color",
      "background-color",
      "border",
      "border-radius",
      "box-shadow",
      "opacity",
      "padding",
    ];

    for (const property of copiedProperties) {
      const value = computed.getPropertyValue(property);
      if (value) element.style.setProperty(property, property === "display" && value === "inline" ? "inline-block" : value);
    }
  }

  function insertFlowPlaceholder(element: HTMLElement) {
    const parent = element.parentElement;
    if (!parent || parent === stageRef.current || element.dataset.editorId === undefined) return;
    if (parent.querySelector(`[data-editor-placeholder-for="${cssEscape(element.dataset.editorId)}"]`)) return;

    const computed = window.getComputedStyle(element);
    const placeholder = document.createElement(computed.display === "inline" ? "span" : "div");
    placeholder.dataset.editorPlaceholderFor = element.dataset.editorId;
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.style.display = computed.display === "inline" ? "inline-block" : "block";
    placeholder.style.width = `${element.offsetWidth}px`;
    placeholder.style.height = `${element.offsetHeight}px`;
    placeholder.style.margin = computed.margin;
    placeholder.style.visibility = "hidden";
    placeholder.style.pointerEvents = "none";
    parent.insertBefore(placeholder, element);
  }

  function getSelectableElements(): HTMLElement[] {
    const stage = stageRef.current;
    if (!stage) return [];
    return Array.from(stage.querySelectorAll<HTMLElement>("[data-editor-id]")).filter(
      (element) => !element.matches("br,script,style") && !element.dataset.editorPlaceholderFor,
    );
  }

  function applyRect(element: HTMLElement, rect: Rect, updateOverlay = true) {
    element.style.position = "absolute";
    element.style.left = `${round(rect.x)}px`;
    element.style.top = `${round(rect.y)}px`;
    element.style.width = `${round(Math.max(rect.width, MIN_SIZE))}px`;
    element.style.height = `${round(Math.max(rect.height, MIN_SIZE))}px`;
    if (updateOverlay) {
      setSelectionRect(readElementRect(element));
    }
  }

  function mutateSelected(mutator: (element: HTMLElement) => void, nextStatus = "Saved") {
    const element = getSelectedElement();
    if (!element) return;
    mutator(element);
    ensureEditorIds();
    refreshSelection(element.dataset.editorId ? [element.dataset.editorId] : []);
    commitStage(nextStatus);
  }

  function updateSelectedInDeck(mutator: (element: HTMLElement) => void) {
    const selectedId = selectedIds[0];
    if (!selectedId) return;
    setDeck((currentDeck) => {
      const slide = currentDeck.slides[currentSlideIndex];
      if (!slide) return currentDeck;

      const template = document.createElement("template");
      template.innerHTML = slide.html;
      const element = template.content.querySelector<HTMLElement>(`[data-editor-id="${cssEscape(selectedId)}"]`);
      if (!element) return currentDeck;

      mutator(element);
      return replaceSlideHtml(currentDeck, currentSlideIndex, template.innerHTML);
    });
  }

  function beginInspectorEdit() {
    if (!inspectorEditBaseRef.current) {
      inspectorEditBaseRef.current = cloneDeck(deck);
    }
  }

  function finishInspectorEdit(nextStatus = "Updated") {
    const baseDeck = inspectorEditBaseRef.current;
    if (!baseDeck) return;
    const latestDeck = serializeCurrentSlide();
    inspectorEditBaseRef.current = null;
    flushSync(() => {
      setDeck(latestDeck);
      setPast((items) => [...items.slice(-HISTORY_LIMIT + 1), baseDeck]);
      setFuture([]);
      setStatus(nextStatus);
    });
  }

  function applyInspectorTextDraft() {
    if (selectedIds.length !== 1) return;
    const textArea = selectedTextAreaRef.current;
    const element = getSelectedElement();
    if (!textArea || !element) return;
    if ((element.innerText || element.textContent || "") === textArea.value) return;
    beginInspectorEdit();
    element.textContent = textArea.value;
    setSelection((current) => (current ? { ...current, text: textArea.value } : current));
  }

  function onWindowPointerMove(event: PointerEvent) {
    const session = pointerSessionRef.current;
    if (!session) return;

    const dx = (event.clientX - session.startX) / scale;
    const dy = (event.clientY - session.startY) / scale;
    if (session.mode === "marquee") {
      const point = readPointFromEvent(event);
      const rect = normalizeRect({
        x: session.startRect.x,
        y: session.startRect.y,
        width: point.x - session.startRect.x,
        height: point.y - session.startRect.y,
      });
      session.currentRect = rect;
      session.moved = true;
      setMarqueeRect(rect);
      return;
    }

    const elements = getSelectedElements(session.elementIds);
    if (elements.length === 0) return;
    if (!session.started) {
      if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < 4) return;
      session.startRects = Object.fromEntries(
        elements.map((element) => [element.dataset.editorId ?? "", ensureAbsoluteGeometry(element, true)]),
      );
      session.started = true;
    }

    session.moved = true;
    if (session.mode === "move") {
      for (const element of elements) {
        const id = element.dataset.editorId ?? "";
        const startRect = session.startRects[id] ?? readElementRect(element);
        applyRect(element, { ...startRect, x: startRect.x + dx, y: startRect.y + dy }, false);
      }
      setSelectionRect(getUnionRect(elements.map((element) => readElementRect(element))));
    } else {
      const element = elements[0];
      const startRect = session.startRects[element.dataset.editorId ?? ""] ?? session.startRect;
      const nextRect = resizeRect(startRect, session.handle ?? "se", dx, dy);
      applyRect(element, nextRect, false);
      setSelectionRect(readElementRect(element));
    }
  }

  function onWindowPointerUp() {
    window.removeEventListener("pointermove", onWindowPointerMove);
    const session = pointerSessionRef.current;
    pointerSessionRef.current = null;
    if (!session) return;

    if (session.mode === "marquee") {
      const rect = session.currentRect ?? marqueeRect ?? session.startRect;
      const selected = getSelectableElements().filter((element) => intersects(readElementRect(element), rect));
      const ids = selected.map((element) => element.dataset.editorId).filter((id): id is string => Boolean(id));
      setSelectedIds(ids);
      refreshSelection(ids);
      setMarqueeRect(null);
      setStatus(ids.length > 0 ? `${ids.length} selected` : "Ready");
      return;
    }

    const elements = getSelectedElements(session.elementIds);
    if (elements.length > 0) {
      if (session.moved) {
        commitStage("Layout updated");
      } else {
        refreshSelection(session.elementIds);
        setStatus("Element selected");
      }
      setSelectedIds(session.elementIds);
    }
  }

  function beginResize(handle: ResizeHandle, event: React.PointerEvent<HTMLButtonElement>) {
    const element = getSelectedElement();
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = ensureAbsoluteGeometry(element, true);
    pointerSessionRef.current = {
      mode: "resize",
      handle,
      elementId: element.dataset.editorId ?? "",
      elementIds: [element.dataset.editorId ?? ""],
      startX: event.clientX,
      startY: event.clientY,
      startRect: rect,
      startRects: { [element.dataset.editorId ?? ""]: rect },
      started: true,
      moved: false,
    };
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp, { once: true });
  }

  function onStageDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const element = target.closest<HTMLElement>("[data-editor-id]");
    if (!element || !stageRef.current?.contains(element)) return;
    selectElement(element);
    if (!isTextLike(element)) return;
    event.preventDefault();
    element.contentEditable = "true";
    element.focus();
    document.getSelection()?.selectAllChildren(element);

    const finish = () => {
      element.contentEditable = "false";
      element.removeEventListener("blur", finish);
      element.removeEventListener("keydown", onKeyDown);
      refreshSelection(element.dataset.editorId ? [element.dataset.editorId] : []);
      commitStage("Text updated");
    };

    const onKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") {
        element.contentEditable = "false";
        element.blur();
      }
      if ((keyboardEvent.metaKey || keyboardEvent.ctrlKey) && keyboardEvent.key === "Enter") {
        element.blur();
      }
    };

    element.addEventListener("blur", finish);
    element.addEventListener("keydown", onKeyDown);
  }

  function importDeckFromHtml(source: string, nextStatus = "Imported") {
    replaceDeckWithHtmlSources([{ name: "", text: source }], nextStatus);
  }

  async function onFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    const sources = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        text: await file.text(),
      })),
    );
    addHtmlSources(sources);
    event.target.value = "";
  }

  async function importWithFilePicker() {
    if (!window.showOpenFilePicker) {
      fileInputRef.current?.click();
      return;
    }
    const handles = await window.showOpenFilePicker({
      multiple: true,
      types: [{ description: "HTML", accept: { "text/html": [".html", ".htm"] } }],
    });
    if (handles.length === 0) return;
    const sources = await Promise.all(
      handles.map(async (handle) => {
        const file = await handle.getFile();
        return {
          name: file.name,
          text: await file.text(),
          handle,
        };
      }),
    );
    addHtmlSources(sources);
  }

  function replaceDeckWithHtmlSources(sources: HtmlImportSource[], nextStatus?: string) {
    if (sources.length === 0) return;
    const parsedDecks = sources.map((source) => parseHtmlDeck(source.text, source.name));
    const combinedDeck = normalizeDeckEditorIds(createDeckFromSources(sources, parsedDecks));
    commitDeck(combinedDeck, nextStatus ?? `Imported ${sources.length} HTML file${sources.length === 1 ? "" : "s"}`);
    setFileHandle(sources.length === 1 && sources[0].handle ? { name: sources[0].name, handle: sources[0].handle } : null);
    setCurrentSlideIndex(0);
    setSelectedIds([]);
    setPasteHtml("");
  }

  function addHtmlSources(sources: HtmlImportSource[]) {
    if (sources.length === 0) return;
    const parsedDecks = sources.map((source) => parseHtmlDeck(source.text, source.name));
    const importedDeck = createDeckFromSources(sources, parsedDecks);
    const liveDeck = serializeCurrentSlide();

    if (isUnmodifiedDefaultDeck(liveDeck)) {
      replaceDeckWithHtmlSources(sources);
      return;
    }

    const appendStartIndex = liveDeck.slides.length;
    const nextDeck = normalizeDeckEditorIds({
      ...liveDeck,
      sourceName: undefined,
      globalStyles: mergeGlobalStyles(liveDeck.globalStyles, importedDeck.globalStyles),
      slides: [...liveDeck.slides, ...importedDeck.slides],
    });

    commitDeck(nextDeck, `Added ${sources.length} HTML file${sources.length === 1 ? "" : "s"}`);
    setFileHandle(null);
    setCurrentSlideIndex(appendStartIndex);
    setSelectedIds([]);
    setSelection(null);
    setSelectionRect(null);
    setPasteHtml("");
  }

  async function saveHtml(overwrite = true) {
    const html = createExportHtml(deck);
    const filename = fileHandle?.name || safeFilename(deck.title, "html");

    if (overwrite && fileHandle?.handle) {
      const writable = await fileHandle.handle.createWritable();
      await writable.write(html);
      await writable.close();
      setStatus(`Saved ${filename}`);
      return;
    }

    if (!overwrite && window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "HTML", accept: { "text/html": [".html", ".htm"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(html);
      await writable.close();
      setFileHandle({ name: handle.name, handle });
      setStatus(`Saved ${handle.name}`);
      return;
    }

    downloadText(filename, html);
    setStatus(overwrite ? "Downloaded HTML copy" : "Saved as HTML");
  }

  async function exportPdf() {
    setIsExportingPdf(true);
    setStatus("Rendering PDF");
    try {
      const { jsPDF } = await import("jspdf");
      const firstSlide = deck.slides[0] ?? { width: DEFAULT_SLIDE_WIDTH, height: DEFAULT_SLIDE_HEIGHT };
      const pdf = new jsPDF({
        orientation: getPageOrientation(firstSlide.width, firstSlide.height),
        unit: "px",
        format: [firstSlide.width, firstSlide.height],
        compress: true,
      });

      for (const [index, slide] of deck.slides.entries()) {
        if (index > 0) {
          pdf.addPage([slide.width, slide.height], getPageOrientation(slide.width, slide.height));
        }
        const image = await renderSlideToPng(deck, slide);
        pdf.addImage(image, "PNG", 0, 0, slide.width, slide.height, undefined, "FAST");
      }

      pdf.save(safeFilename(deck.title, "pdf"));
      setStatus("PDF exported");
    } catch (error) {
      console.error(error);
      setStatus("PDF export failed");
    } finally {
      setIsExportingPdf(false);
    }
  }

  async function exportPptx() {
    setIsExportingPptx(true);
    setStatus("Rendering PPTX");
    try {
      const pptx = new pptxgen();
      pptx.layout = "LAYOUT_WIDE";
      pptx.author = "Visual HTML PPT Editor";
      pptx.subject = deck.title;
      pptx.title = deck.title;

      const firstSlide = deck.slides[0] ?? { width: DEFAULT_SLIDE_WIDTH, height: DEFAULT_SLIDE_HEIGHT };
      const pptWidth = 13.333;
      const pptHeight = pptWidth * (firstSlide.height / firstSlide.width);
      pptx.defineLayout({ name: "HTML_DECK", width: pptWidth, height: pptHeight });
      pptx.layout = "HTML_DECK";

      for (const slide of deck.slides) {
        const image = await renderSlideToPng(deck, slide);
        const placement = fitInto(slide.width, slide.height, pptWidth, pptHeight);
        pptx.addSlide().addImage({ data: image, x: placement.x, y: placement.y, w: placement.width, h: placement.height });
      }

      await pptx.writeFile({ fileName: safeFilename(deck.title, "pptx") });
      setStatus("PPTX exported");
    } catch (error) {
      console.error(error);
      setStatus("PPTX export failed");
    } finally {
      setIsExportingPptx(false);
    }
  }

  function undo() {
    const previous = past[past.length - 1];
    if (!previous) return;
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [cloneDeck(deck), ...items]);
    setDeck(previous);
    setSelectedIds([]);
    setStatus("Undo");
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    setFuture((items) => items.slice(1));
    setPast((items) => [...items, cloneDeck(deck)]);
    setDeck(next);
    setSelectedIds([]);
    setStatus("Redo");
  }

  function resetDeck() {
    clearStoredDeck();
    commitDeck(normalizeDeckEditorIds(cloneDeck(DEFAULT_DECK)), "Reset");
    setCurrentSlideIndex(0);
    setSelectedIds([]);
    setFileHandle(null);
  }

  function addTextBox() {
    const stage = stageRef.current;
    if (!stage) return;
    const element = document.createElement("div");
    element.dataset.editorId = `el-${Date.now().toString(36)}-${idCounterRef.current++}`;
    element.textContent = "双击或在右侧改文字";
    element.style.cssText =
      "position:absolute;left:120px;top:120px;width:360px;height:72px;font-size:30px;line-height:1.25;color:#111827;font-weight:700;";
    stage.append(element);
    selectElement(element);
    commitStage("Text box added");
  }

  function addShape() {
    const stage = stageRef.current;
    if (!stage) return;
    const element = document.createElement("div");
    element.dataset.editorId = `el-${Date.now().toString(36)}-${idCounterRef.current++}`;
    element.style.cssText =
      "position:absolute;left:180px;top:180px;width:240px;height:140px;border-radius:8px;background:#dff7ef;border:2px solid #0f766e;";
    stage.append(element);
    selectElement(element);
    commitStage("Shape added");
  }

  function getDefaultInsertPosition(offsetIndex = 0) {
    const existingInsertions = stageRef.current?.querySelectorAll('[data-editor-inserted="true"]').length ?? 0;
    const slot = existingInsertions + offsetIndex;
    const baseLeft = Math.min(Math.max(80, Math.round(slideWidth * 0.1)), Math.max(80, slideWidth - 360));
    const baseTop = Math.min(Math.max(200, Math.round(slideHeight * 0.34)), Math.max(80, slideHeight - 180));
    const left = Math.min(baseLeft + (slot % 3) * 32, Math.max(80, slideWidth - 360));
    const top = Math.min(baseTop + slot * 240, Math.max(80, slideHeight - 180));
    return { left, top };
  }

  async function onImageInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      await insertImageFiles(files);
    }
    event.target.value = "";
  }

  async function insertImageFiles(files: File[]) {
    const stage = stageRef.current;
    if (!stage || files.length === 0) return;
    const inserted: HTMLElement[] = [];

    for (const [index, file] of files.entries()) {
      const dataUrl = await readFileAsDataUrl(file);
      const dimensions = await readImageDimensions(dataUrl);
      const fitted = fitImageSize(dimensions.width, dimensions.height, slideWidth * 0.42, slideHeight * 0.42);
      const position = getDefaultInsertPosition(index);
      const image = document.createElement("img");
      image.dataset.editorId = `el-${Date.now().toString(36)}-${idCounterRef.current++}`;
      image.dataset.editorInserted = "true";
      image.src = dataUrl;
      image.alt = file.name.replace(/\.[^.]+$/, "") || "Inserted image";
      image.draggable = false;
      image.style.cssText =
        `position:absolute;left:${position.left}px;top:${position.top}px;width:${fitted.width}px;height:${fitted.height}px;object-fit:contain;`;
      stage.append(image);
      inserted.push(image);
    }

    if (inserted.length > 0) {
      selectElement(inserted[inserted.length - 1]);
      commitStage(inserted.length === 1 ? "Image inserted" : `${inserted.length} images inserted`);
    }
  }

  function insertDefaultTable() {
    insertTableFromHtml(createDefaultTableHtml(4, 3), "Table inserted");
  }

  function insertTableFromHtml(tableHtml: string, nextStatus = "Table inserted") {
    const stage = stageRef.current;
    if (!stage) return;
    const template = document.createElement("template");
    template.innerHTML = tableHtml;
    const sourceTable = template.content.querySelector("table");
    if (!sourceTable) return;

    sourceTable.querySelectorAll("script,style,iframe,object,embed").forEach((node) => node.remove());
    const table = sourceTable.cloneNode(true) as HTMLTableElement;
    const position = getDefaultInsertPosition();
    table.dataset.editorId = `el-${Date.now().toString(36)}-${idCounterRef.current++}`;
    table.dataset.editorInserted = "true";
    table.style.position = "absolute";
    table.style.left = `${position.left}px`;
    table.style.top = `${position.top}px`;
    table.style.width = table.style.width || `${Math.min(640, Math.max(360, slideWidth * 0.5))}px`;
    table.style.borderCollapse = table.style.borderCollapse || "collapse";
    table.style.backgroundColor = table.style.backgroundColor || "#ffffff";
    table.style.color = table.style.color || "#111827";
    table.style.fontSize = table.style.fontSize || "20px";

    table.querySelectorAll<HTMLTableCellElement>("th,td").forEach((cell) => {
      cell.style.border = cell.style.border || "1px solid #94a3b8";
      cell.style.padding = cell.style.padding || "10px 12px";
      cell.style.minWidth = cell.style.minWidth || "96px";
      cell.style.verticalAlign = cell.style.verticalAlign || "middle";
    });

    stage.append(table);
    ensureEditorIds();
    selectElement(table);
    commitStage(nextStatus);
  }

  function duplicateSelected() {
    const elements = getSelectedElements();
    if (elements.length === 0) return;
    const clones = elements.map((element) => {
      const clone = element.cloneNode(true) as HTMLElement;
      clone.dataset.editorId = `el-${Date.now().toString(36)}-${idCounterRef.current++}`;
      const rect = ensureAbsoluteGeometry(element);
      clone.style.left = `${rect.x + 28}px`;
      clone.style.top = `${rect.y + 28}px`;
      element.after(clone);
      return clone;
    });
    setSelectedIds(clones.map((clone) => clone.dataset.editorId).filter((id): id is string => Boolean(id)));
    commitStage("Duplicated");
  }

  function deleteSelected() {
    const elements = getSelectedElements();
    if (elements.length === 0) return;
    elements.forEach((element) => element.remove());
    setSelectedIds([]);
    commitStage("Deleted");
  }

  function nudgeSelected(dx: number, dy: number) {
    const elements = getSelectedElements();
    if (elements.length === 0) return;
    elements.forEach((element) => {
      const rect = ensureAbsoluteGeometry(element, true);
      applyRect(element, { ...rect, x: rect.x + dx, y: rect.y + dy }, false);
    });
    commitStage("Nudged");
  }

  function nudgeZIndex(direction: "front" | "back") {
    mutateSelected((element) => {
      const current = Number.parseInt(window.getComputedStyle(element).zIndex, 10);
      const base = Number.isFinite(current) ? current : 0;
      element.style.zIndex = String(direction === "front" ? base + 1 : base - 1);
    }, "Layer updated");
  }

  function addBlankSlide() {
    const liveDeck = serializeCurrentSlide();
    const insertIndex = Math.min(currentSlideIndex + 1, liveDeck.slides.length);
    const baseSlide = liveDeck.slides[currentSlideIndex] ?? currentSlide;
    const nextSlide = createBlankSlide(insertIndex + 1, baseSlide?.width ?? DEFAULT_SLIDE_WIDTH, baseSlide?.height ?? DEFAULT_SLIDE_HEIGHT);
    const slides = [...liveDeck.slides];
    slides.splice(insertIndex, 0, nextSlide);
    commitDeck({ ...liveDeck, slides }, "Slide added");
    setCurrentSlideIndex(insertIndex);
    setSelectedIds([]);
    setSelection(null);
    setSelectionRect(null);
  }

  function deleteSlide(index: number) {
    if (deck.slides.length <= 1) {
      setStatus("Keep at least one slide");
      return;
    }
    const liveDeck = serializeCurrentSlide();
    const slides = liveDeck.slides.filter((_, slideIndex) => slideIndex !== index);
    commitDeck({ ...liveDeck, slides }, "Slide deleted");
    setCurrentSlideIndex(getIndexAfterDelete(currentSlideIndex, index, slides.length));
    setSelectedIds([]);
    setSelection(null);
    setSelectionRect(null);
  }

  function selectSlide(index: number) {
    if (index === currentSlideIndex) return;
    setCurrentSlideIndex(index);
    setSelectedIds([]);
    setSelection(null);
    setSelectionRect(null);
  }

  function moveSlide(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= deck.slides.length || toIndex >= deck.slides.length) {
      return;
    }

    const liveDeck = serializeCurrentSlide();
    const nextDeck = moveSlideInDeck(liveDeck, fromIndex, toIndex);
    commitDeck(nextDeck, "Slides reordered");
    setCurrentSlideIndex(getIndexAfterMove(currentSlideIndex, fromIndex, toIndex));
    setSelectedIds([]);
    setSelection(null);
    setSelectionRect(null);
  }

  function startPresentation() {
    applyInspectorTextDraft();
    const liveDeck = serializeCurrentSlide();
    const editBase = inspectorEditBaseRef.current;
    if (editBase) {
      inspectorEditBaseRef.current = null;
      setPast((items) => [...items.slice(-HISTORY_LIMIT + 1), editBase]);
      setFuture([]);
    }
    setDeck(liveDeck);
    setSelectedIds([]);
    setSelection(null);
    setSelectionRect(null);
    setMarqueeRect(null);
    setPresentationSlideIndex(Math.min(currentSlideIndex, Math.max(0, liveDeck.slides.length - 1)));
    setIsPresenting(true);
    setStatus("Presenting");
  }

  function closePresentation() {
    const nextIndex = Math.min(presentationSlideIndex, Math.max(0, deck.slides.length - 1));
    setIsPresenting(false);
    setCurrentSlideIndex(nextIndex);
    setSelectedIds([]);
    setSelection(null);
    setSelectionRect(null);
    setStatus("Ready");
  }

  function showPreviousPresentationSlide() {
    setPresentationSlideIndex((index) => Math.max(0, index - 1));
  }

  function showNextPresentationSlide() {
    setPresentationSlideIndex((index) => Math.min(Math.max(0, deck.slides.length - 1), index + 1));
  }

  const hasSelection = selectedIds.length > 0;
  const isSingleSelection = selectedIds.length === 1;

  return (
    <main className="app-shell">
      <style>{deck.globalStyles}</style>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">H2P</div>
          <div>
            <h1>Visual HTML PPT Editor</h1>
            <p>{deck.title}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            multiple
            accept=".html,.htm,text/html"
            onChange={onFileInputChange}
            data-testid="import-file-input"
          />
          <ToolbarButton label="导入 HTML" icon={<FileInput />} onClick={importWithFilePicker} testId="import-html" />
          <ToolbarButton label="播放" icon={<Play />} onClick={startPresentation} testId="start-presentation" />
          <ToolbarButton label="保存原文件" icon={<Save />} onClick={() => void saveHtml(true)} testId="export-html" />
          <ToolbarButton label="另存 HTML" icon={<Download />} onClick={() => void saveHtml(false)} testId="save-as-html" />
          <ToolbarButton label="导出 PDF" icon={<Printer />} onClick={exportPdf} disabled={isExportingPdf} testId="export-pdf" />
          <ToolbarButton label="导出 PPTX" icon={<FileDown />} onClick={exportPptx} disabled={isExportingPptx} testId="export-pptx" />
        </div>
      </header>

      <section className="editor-grid">
        <aside className="slides-panel" aria-label="Slides">
          <div className="panel-title">
            <span>Slides</span>
            <div className="panel-title-actions">
              <span data-testid="slide-count">{deck.slides.length}</span>
              <button className="panel-icon-button" title="新增页" aria-label="新增页" data-testid="add-slide" onClick={addBlankSlide}>
                <Plus size={14} />
              </button>
            </div>
          </div>
          <div className="slide-list" data-testid="slide-list">
            {deck.slides.map((slide, index) => (
              <div
                key={slide.id}
                className={`slide-thumb ${index === currentSlideIndex ? "active" : ""} ${dragOverSlideIndex === index ? "drag-over" : ""}`}
                draggable
                onDragStart={() => {
                  setDraggingSlideIndex(index);
                  setDragOverSlideIndex(index);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOverSlideIndex(index);
                }}
                onDragLeave={() => {
                  if (dragOverSlideIndex === index) setDragOverSlideIndex(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggingSlideIndex !== null) {
                    moveSlide(draggingSlideIndex, index);
                  }
                  setDraggingSlideIndex(null);
                  setDragOverSlideIndex(null);
                }}
                onDragEnd={() => {
                  setDraggingSlideIndex(null);
                  setDragOverSlideIndex(null);
                }}
              >
                <button className="slide-thumb-main" onClick={() => selectSlide(index)} data-testid={`slide-thumb-${index}`}>
                  <span className="slide-number">{index + 1}</span>
                  <strong data-testid={`slide-title-${index}`}>{slide.title}</strong>
                  <SlideThumbnail slide={slide} />
                </button>
                <div className="slide-reorder" aria-label="Slide order">
                  <button
                    type="button"
                    className="slide-order-button"
                    title="上移"
                    aria-label={`上移第 ${index + 1} 页`}
                    data-testid={`move-slide-up-${index}`}
                    disabled={index === 0}
                    onClick={() => moveSlide(index, index - 1)}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="slide-order-button"
                    title="下移"
                    aria-label={`下移第 ${index + 1} 页`}
                    data-testid={`move-slide-down-${index}`}
                    disabled={index >= deck.slides.length - 1}
                    onClick={() => moveSlide(index, index + 1)}
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    type="button"
                    className="slide-order-button danger"
                    title="删除页"
                    aria-label={`删除第 ${index + 1} 页`}
                    data-testid={`delete-slide-${index}`}
                    disabled={deck.slides.length <= 1}
                    onClick={() => deleteSlide(index)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="slide-nav">
            <ToolbarButton
              label="上一页"
              icon={<ChevronLeft />}
              onClick={() => setCurrentSlideIndex((index) => Math.max(0, index - 1))}
              disabled={currentSlideIndex === 0}
            />
            <ToolbarButton
              label="下一页"
              icon={<ChevronRight />}
              onClick={() => setCurrentSlideIndex((index) => Math.min(deck.slides.length - 1, index + 1))}
              disabled={currentSlideIndex >= deck.slides.length - 1}
            />
          </div>
        </aside>

        <section className="workspace">
          <div className="commandbar">
            <div className="tool-cluster">
              <input
                ref={imageInputRef}
                className="sr-only"
                type="file"
                accept="image/*"
                multiple
                onChange={onImageInputChange}
                data-testid="insert-image-input"
              />
              <ToolbarButton label="撤销" icon={<Undo2 />} onClick={undo} disabled={past.length === 0} testId="undo" />
              <ToolbarButton label="重做" icon={<Redo2 />} onClick={redo} disabled={future.length === 0} testId="redo" />
              <ToolbarButton label="文字" icon={<Type />} onClick={addTextBox} testId="add-text" />
              <ToolbarButton label="形状" icon={<Box />} onClick={addShape} />
              <ToolbarButton label="图片" icon={<ImagePlus />} onClick={() => imageInputRef.current?.click()} testId="insert-image" />
              <ToolbarButton label="表格" icon={<Table2 />} onClick={insertDefaultTable} testId="insert-table" />
              <ToolbarButton label="复制" icon={<Copy />} onClick={duplicateSelected} disabled={!hasSelection} />
              <ToolbarButton label="删除" icon={<Trash2 />} onClick={deleteSelected} disabled={!hasSelection} testId="delete-selected" />
            </div>
            <div className="status-pill">{isExportingPdf || isExportingPptx ? "Exporting" : `${status} · ${slideWidth}x${slideHeight}`}</div>
          </div>

          <div className="stage-shell" ref={stageShellRef}>
            <div
              className="stage-viewport"
              style={{
                width: slideWidth * scale,
                height: slideHeight * scale,
              }}
            >
              <SlideCanvas
                ref={stageRef}
                html={currentSlide?.html ?? ""}
                slideStyle={slideStyle}
                width={slideWidth}
                height={slideHeight}
                scale={scale}
                onDoubleClick={onStageDoubleClick}
              />
              {selectionRect && (
                <SelectionOverlay rect={selectionRect} scale={scale} onResizeStart={beginResize} />
              )}
              {marqueeRect && <MarqueeOverlay rect={marqueeRect} scale={scale} />}
            </div>
          </div>
        </section>

        <aside className="inspector-panel" aria-label="Inspector">
          <div className="panel-title">
            <span>Inspector</span>
            <span>{selection?.tag ?? "none"}</span>
          </div>

          {selection ? (
            <div className="inspector-stack">
              <label className="field">
                <span>Text</span>
                <textarea
                  key={selection.id}
                  ref={selectedTextAreaRef}
                  data-testid="selected-text"
                  defaultValue={selection.text}
                  disabled={!isSingleSelection}
                  onBlur={() => {
                    applyInspectorTextDraft();
                    finishInspectorEdit("Text updated");
                  }}
                />
              </label>

              <div className="field-row">
                <label className="field compact">
                  <span>Size</span>
                  <input
                    data-testid="font-size"
                    type="number"
                    min={8}
                    max={180}
                    value={Number.parseFloat(selection.fontSize) || 24}
                    onChange={(event) => {
                      beginInspectorEdit();
                      const element = getSelectedElement();
                      if (element) {
                        element.style.fontSize = `${event.target.value}px`;
                        refreshSelection(element.dataset.editorId ? [element.dataset.editorId] : []);
                      }
                    }}
                    onBlur={() => finishInspectorEdit("Text resized")}
                  />
                </label>
                <label className="field compact">
                  <span>Z</span>
                  <input
                    type="number"
                    value={Number.parseInt(selection.zIndex, 10) || 0}
                    onChange={(event) => {
                      beginInspectorEdit();
                      const element = getSelectedElement();
                      if (element) {
                        element.style.zIndex = event.target.value;
                        refreshSelection(element.dataset.editorId ? [element.dataset.editorId] : []);
                      }
                    }}
                    onBlur={() => finishInspectorEdit("Layer updated")}
                  />
                </label>
              </div>

              <div className="field-row">
                <label className="field color-field">
                  <span>Text</span>
                  <input
                    data-testid="text-color"
                    type="color"
                    value={selection.color}
                    onChange={(event) => {
                      beginInspectorEdit();
                      const element = getSelectedElement();
                      if (element) {
                        element.style.color = event.target.value;
                        refreshSelection(element.dataset.editorId ? [element.dataset.editorId] : []);
                      }
                    }}
                    onBlur={() => finishInspectorEdit("Color updated")}
                  />
                </label>
                <label className="field color-field">
                  <span>Fill</span>
                  <input
                    type="color"
                    value={selection.backgroundColor}
                    onChange={(event) => {
                      beginInspectorEdit();
                      const element = getSelectedElement();
                      if (element) {
                        element.style.backgroundColor = event.target.value;
                        refreshSelection(element.dataset.editorId ? [element.dataset.editorId] : []);
                      }
                    }}
                    onBlur={() => finishInspectorEdit("Fill updated")}
                  />
                </label>
              </div>

              <div className="segmented">
                <ToolbarButton
                  label="加粗"
                  icon={<Bold />}
                  onClick={() =>
                    mutateSelected((element) => {
                      element.style.fontWeight = Number.parseInt(selection.fontWeight, 10) >= 700 ? "400" : "700";
                    }, "Weight updated")
                  }
                  active={Number.parseInt(selection.fontWeight, 10) >= 700}
                />
                <ToolbarButton
                  label="斜体"
                  icon={<Italic />}
                  onClick={() =>
                    mutateSelected((element) => {
                      element.style.fontStyle = selection.fontStyle === "italic" ? "normal" : "italic";
                    }, "Style updated")
                  }
                  active={selection.fontStyle === "italic"}
                />
              </div>

              <div className="segmented">
                <ToolbarButton
                  label="左对齐"
                  icon={<AlignLeft />}
                  onClick={() =>
                    mutateSelected((element) => {
                      element.style.textAlign = "left";
                    }, "Aligned")
                  }
                  active={selection.textAlign === "left" || selection.textAlign === "start"}
                />
                <ToolbarButton
                  label="居中"
                  icon={<AlignCenter />}
                  onClick={() =>
                    mutateSelected((element) => {
                      element.style.textAlign = "center";
                    }, "Aligned")
                  }
                  active={selection.textAlign === "center"}
                />
                <ToolbarButton
                  label="右对齐"
                  icon={<AlignRight />}
                  onClick={() =>
                    mutateSelected((element) => {
                      element.style.textAlign = "right";
                    }, "Aligned")
                  }
                  active={selection.textAlign === "right" || selection.textAlign === "end"}
                />
              </div>

              <div className="segmented">
                <ToolbarButton label="前移" icon={<Layers />} onClick={() => nudgeZIndex("front")} />
                <ToolbarButton label="后移" icon={<Layers />} onClick={() => nudgeZIndex("back")} />
              </div>

              <div className="geometry-readout">
                <span>X {selectionRect?.x.toFixed(0)}</span>
                <span>Y {selectionRect?.y.toFixed(0)}</span>
                <span>W {selectionRect?.width.toFixed(0)}</span>
                <span>H {selectionRect?.height.toFixed(0)}</span>
              </div>
            </div>
          ) : (
            <div className="empty-inspector">
              <Code2 />
              <span>No element selected</span>
            </div>
          )}

          <details className="html-importer">
            <summary>
              <Code2 size={16} />
              Paste HTML
            </summary>
            <textarea
              value={pasteHtml}
              onChange={(event) => setPasteHtml(event.target.value)}
              placeholder="<!doctype html>..."
              data-testid="paste-html"
            />
            <button className="primary-button" disabled={!pasteHtml.trim()} onClick={() => importDeckFromHtml(pasteHtml, "HTML pasted")}>
              <Download size={16} />
              Import pasted HTML
            </button>
          </details>

          <div className="danger-zone">
            <ToolbarButton label="载入示例" icon={<RotateCcw />} onClick={resetDeck} />
            <ToolbarButton label="当前页 PNG" icon={<ImageDown />} onClick={() => exportCurrentSlidePng(deck, currentSlide)} />
          </div>
        </aside>
      </section>
      {isPresenting && (
        <PresentationMode
          deck={deck}
          slideIndex={presentationSlideIndex}
          onPrevious={showPreviousPresentationSlide}
          onNext={showNextPresentationSlide}
          onExit={closePresentation}
        />
      )}
    </main>
  );
}

function SlideThumbnail({ slide }: { slide: Slide }) {
  const thumbnailScale = Math.min(THUMBNAIL_WIDTH / slide.width, THUMBNAIL_HEIGHT / slide.height);
  const previewWidth = slide.width * thumbnailScale;
  const previewHeight = slide.height * thumbnailScale;
  const offsetX = (THUMBNAIL_WIDTH - previewWidth) / 2;
  const offsetY = (THUMBNAIL_HEIGHT - previewHeight) / 2;

  return (
    <div className="slide-thumb-preview" aria-hidden="true">
      <div
        className="slide-thumb-canvas"
        style={{
          ...parseInlineStyle(slide.style),
          width: slide.width,
          height: slide.height,
          transform: `translate(${offsetX}px, ${offsetY}px) scale(${thumbnailScale})`,
        }}
        dangerouslySetInnerHTML={{ __html: slide.html }}
      />
    </div>
  );
}

function PresentationMode({
  deck,
  slideIndex,
  onPrevious,
  onNext,
  onExit,
}: {
  deck: Deck;
  slideIndex: number;
  onPrevious: () => void;
  onNext: () => void;
  onExit: () => void;
}) {
  const slide = deck.slides[slideIndex] ?? deck.slides[0];
  const slideWidth = slide?.width ?? DEFAULT_SLIDE_WIDTH;
  const slideHeight = slide?.height ?? DEFAULT_SLIDE_HEIGHT;
  const [presentationScale, setPresentationScale] = useState(1);
  const slideAreaRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const area = slideAreaRef.current;
    if (!area) return;

    const updateScale = () => {
      const rect = area.getBoundingClientRect();
      const computed = window.getComputedStyle(area);
      const availableWidth =
        rect.width - Number.parseFloat(computed.paddingLeft || "0") - Number.parseFloat(computed.paddingRight || "0");
      const availableHeight =
        rect.height - Number.parseFloat(computed.paddingTop || "0") - Number.parseFloat(computed.paddingBottom || "0");
      const nextScale = Math.min(availableWidth / slideWidth, availableHeight / slideHeight);
      setPresentationScale(Math.max(0.1, Number(nextScale.toFixed(4))));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(area);
    return () => observer.disconnect();
  }, [slideHeight, slideWidth]);

  if (!slide) return null;

  const canGoPrevious = slideIndex > 0;
  const canGoNext = slideIndex < deck.slides.length - 1;

  return (
    <div className="presenter-mode" data-testid="presentation-mode" role="dialog" aria-modal="true" aria-label="播放幻灯片">
      <div className="presenter-toolbar">
        <div className="presenter-title" data-testid="presentation-title">
          <span>{deck.title}</span>
          <strong>{slide.title}</strong>
        </div>
        <div className="presenter-controls" aria-label="播放控制">
          <button
            className="presenter-button"
            type="button"
            title="上一页"
            aria-label="上一页"
            data-testid="presentation-prev"
            disabled={!canGoPrevious}
            onClick={onPrevious}
          >
            <ChevronLeft size={20} />
          </button>
          <span className="presenter-counter" data-testid="presentation-counter">
            {slideIndex + 1} / {deck.slides.length}
          </span>
          <button
            className="presenter-button"
            type="button"
            title="下一页"
            aria-label="下一页"
            data-testid="presentation-next"
            disabled={!canGoNext}
            onClick={onNext}
          >
            <ChevronRight size={20} />
          </button>
          <button className="presenter-button" type="button" title="退出播放" aria-label="退出播放" data-testid="presentation-exit" onClick={onExit}>
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="presenter-slide-area" ref={slideAreaRef} onClick={canGoNext ? onNext : undefined}>
        <div
          className="presenter-slide-frame"
          style={{
            width: slideWidth * presentationScale,
            height: slideHeight * presentationScale,
          }}
        >
          <div
            className="presenter-slide-canvas"
            data-testid="presentation-slide"
            style={{
              ...parseInlineStyle(slide.style),
              width: slideWidth,
              height: slideHeight,
              transform: `scale(${presentationScale})`,
            }}
            dangerouslySetInnerHTML={{ __html: slide.html }}
          />
        </div>
      </div>
    </div>
  );
}

function SelectionOverlay({
  rect,
  scale,
  onResizeStart,
}: {
  rect: Rect;
  scale: number;
  onResizeStart: (handle: ResizeHandle, event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  const handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  return (
    <div
      className="selection-overlay"
      style={{
        left: rect.x * scale,
        top: rect.y * scale,
        width: rect.width * scale,
        height: rect.height * scale,
      }}
      data-testid="selection-overlay"
    >
      {handles.map((handle) => (
        <button
          key={handle}
          className={`resize-handle handle-${handle}`}
          data-testid={`resize-${handle}`}
          aria-label={`resize ${handle}`}
          onPointerDown={(event) => onResizeStart(handle, event)}
          style={{
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
          }}
        />
      ))}
    </div>
  );
}

function MarqueeOverlay({ rect, scale }: { rect: Rect; scale: number }) {
  return (
    <div
      className="marquee-overlay"
      data-testid="marquee-overlay"
      style={{
        left: rect.x * scale,
        top: rect.y * scale,
        width: rect.width * scale,
        height: rect.height * scale,
      }}
    />
  );
}

const SlideCanvas = forwardRef<
  HTMLDivElement,
  {
    html: string;
    slideStyle: React.CSSProperties;
    width: number;
    height: number;
    scale: number;
    onDoubleClick: React.MouseEventHandler<HTMLDivElement>;
  }
>(function SlideCanvas({ html, slideStyle, width, height, scale, onDoubleClick }, forwardedRef) {
  const localRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(forwardedRef, () => localRef.current as HTMLDivElement, []);

  useLayoutEffect(() => {
    if (localRef.current && localRef.current.innerHTML !== html) {
      localRef.current.innerHTML = html;
    }
  }, [html]);

  return (
    <div
      ref={localRef}
      className="slide-canvas"
      data-testid="slide-canvas"
      tabIndex={0}
      style={{
        ...slideStyle,
        width,
        height,
        transform: `scale(${scale})`,
      }}
      onDoubleClick={onDoubleClick}
    />
  );
});

function ToolbarButton({
  label,
  icon,
  onClick,
  disabled = false,
  active = false,
  testId,
}: {
  label: string;
  icon: React.ReactElement;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  testId?: string;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      data-testid={testId}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function resizeRect(rect: Rect, handle: ResizeHandle, dx: number, dy: number): Rect {
  let { x, y, width, height } = rect;
  if (handle.includes("e")) width += dx;
  if (handle.includes("s")) height += dy;
  if (handle.includes("w")) {
    x += dx;
    width -= dx;
  }
  if (handle.includes("n")) {
    y += dy;
    height -= dy;
  }

  if (width < MIN_SIZE) {
    if (handle.includes("w")) x -= MIN_SIZE - width;
    width = MIN_SIZE;
  }
  if (height < MIN_SIZE) {
    if (handle.includes("n")) y -= MIN_SIZE - height;
    height = MIN_SIZE;
  }

  return { x, y, width, height };
}

function normalizeRect(rect: Rect): Rect {
  const x = rect.width < 0 ? rect.x + rect.width : rect.x;
  const y = rect.height < 0 ? rect.y + rect.height : rect.y;
  return {
    x,
    y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function sameStringArray(first: string[], second: string[]): boolean {
  return first.length === second.length && first.every((item, index) => item === second[index]);
}

function createDeckFromSources(sources: HtmlImportSource[], parsedDecks: Deck[]): Deck {
  const importedAt = Date.now().toString(36);
  const slides = parsedDecks.flatMap((parsedDeck, sourceIndex) =>
    parsedDeck.slides.map((slide, slideIndex) => {
      const fileTitle = stripFileExtension(sources[sourceIndex]?.name || parsedDeck.title);
      const title =
        sources.length === 1
          ? slide.title
          : parsedDeck.slides.length === 1
            ? fileTitle
            : `${fileTitle} · ${slide.title || `Slide ${slideIndex + 1}`}`;

      return {
        ...slide,
        id: `slide-${importedAt}-${sourceIndex + 1}-${slideIndex + 1}`,
        title,
      };
    }),
  );

  return {
    id: `deck-${importedAt}`,
    title: sources.length === 1 ? parsedDecks[0]?.title || stripFileExtension(sources[0].name) : `Merged ${sources.length} HTML files`,
    sourceName: sources.length === 1 ? sources[0].name || undefined : undefined,
    globalStyles: Array.from(new Set(parsedDecks.map((deck) => deck.globalStyles).filter(Boolean))).join("\n\n"),
    slides,
  };
}

function mergeGlobalStyles(...styles: string[]): string {
  return Array.from(new Set(styles.map((style) => style.trim()).filter(Boolean))).join("\n\n");
}

function isUnmodifiedDefaultDeck(deck: Deck): boolean {
  return JSON.stringify(deck) === JSON.stringify(normalizeDeckEditorIds(cloneDeck(DEFAULT_DECK)));
}

function stripFileExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

function moveSlideInDeck(deck: Deck, fromIndex: number, toIndex: number): Deck {
  const slides = [...deck.slides];
  const [moved] = slides.splice(fromIndex, 1);
  if (!moved) return deck;
  slides.splice(toIndex, 0, moved);
  return { ...deck, slides };
}

function getIndexAfterMove(currentIndex: number, fromIndex: number, toIndex: number): number {
  if (currentIndex === fromIndex) return toIndex;
  if (fromIndex < toIndex && currentIndex > fromIndex && currentIndex <= toIndex) return currentIndex - 1;
  if (fromIndex > toIndex && currentIndex >= toIndex && currentIndex < fromIndex) return currentIndex + 1;
  return currentIndex;
}

function getIndexAfterDelete(currentIndex: number, deletedIndex: number, nextLength: number): number {
  if (currentIndex > deletedIndex) return currentIndex - 1;
  if (currentIndex === deletedIndex) return Math.min(deletedIndex, nextLength - 1);
  return currentIndex;
}

function createBlankSlide(index: number, width: number, height: number): Slide {
  return {
    id: `slide-new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title: `新页面 ${index}`,
    width,
    height,
    style: "background:#ffffff;",
    html: `
      <div style="position:absolute;left:88px;top:82px;width:560px;font-size:44px;line-height:1.18;font-weight:800;color:#111827;">
        新页面 ${index}
      </div>
      <div style="position:absolute;left:88px;top:170px;width:620px;font-size:22px;line-height:1.55;color:#64748b;">
        可以插入文字、图片、表格，再按左侧顺序导出。
      </div>
    `,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function readImageDimensions(source: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.addEventListener("load", () => resolve({ width: image.naturalWidth || 480, height: image.naturalHeight || 270 }));
    image.addEventListener("error", () => resolve({ width: 480, height: 270 }));
    image.src = source;
  });
}

function fitImageSize(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(48, Math.round(width * ratio)),
    height: Math.max(48, Math.round(height * ratio)),
  };
}

function createDefaultTableHtml(rows: number, cols: number): string {
  const body = Array.from({ length: rows })
    .map((_, rowIndex) => {
      const tag = rowIndex === 0 ? "th" : "td";
      const cells = Array.from({ length: cols })
        .map((__, colIndex) => `<${tag}>${rowIndex === 0 ? `标题 ${colIndex + 1}` : `内容 ${rowIndex}.${colIndex + 1}`}</${tag}>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<table><tbody>${body}</tbody></table>`;
}

function extractFirstTableHtml(html: string): string | null {
  if (!html.trim()) return null;
  const template = document.createElement("template");
  template.innerHTML = html;
  const table = template.content.querySelector("table");
  return table ? table.outerHTML : null;
}

function createTableHtmlFromDelimitedText(text: string): string | null {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;

  const delimiter = lines.some((line) => line.includes("\t")) ? "\t" : lines.every((line) => line.includes(",")) ? "," : null;
  if (!delimiter) return null;

  const rows = lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
  if (rows.length < 2 || rows.some((row) => row.length < 2)) return null;

  const html = rows
    .map((row, rowIndex) => {
      const tag = rowIndex === 0 ? "th" : "td";
      return `<tr>${row.map((cell) => `<${tag}>${escapeTableCell(cell)}</${tag}>`).join("")}</tr>`;
    })
    .join("");
  return `<table><tbody>${html}</tbody></table>`;
}

function escapeTableCell(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isEditingTarget(target: HTMLElement | null): boolean {
  return Boolean(target && target.closest("input,textarea,select,[contenteditable='true']"));
}

function getPageOrientation(width: number, height: number): "landscape" | "portrait" {
  return width >= height ? "landscape" : "portrait";
}

function fitInto(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): Rect {
  const ratio = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * ratio;
  const height = sourceHeight * ratio;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

function getUnionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function parseInlineStyle(source: string): React.CSSProperties {
  const result: Record<string, string> = {};
  source
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((rule) => {
      const [property, ...valueParts] = rule.split(":");
      if (!property || valueParts.length === 0) return;
      const trimmedProperty = property.trim();
      const key = trimmedProperty.startsWith("--")
        ? trimmedProperty
        : trimmedProperty.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
      result[key] = valueParts.join(":").trim();
    });
  return result as React.CSSProperties;
}

function cssEscape(value: string): string {
  if ("CSS" in window && typeof window.CSS.escape === "function") return window.CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function rgbToHex(value: string): string | null {
  if (value.startsWith("#")) return value;
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match) return null;
  if (match[4] !== undefined && Number.parseFloat(match[4]) === 0) return null;
  return `#${[match[1], match[2], match[3]]
    .map((part) => Number(part).toString(16).padStart(2, "0"))
    .join("")}`;
}

function isTextLike(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  return ["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "strong", "em", "small", "li", "div", "td", "th", "caption"].includes(tag);
}

async function renderSlideToPng(deck: Deck, slide: Slide): Promise<string> {
  const wrapper = document.createElement("div");
  wrapper.style.cssText = `position:fixed;left:-5000px;top:0;width:${slide.width}px;height:${slide.height}px;pointer-events:none;`;
  wrapper.innerHTML = `
    <style>${deck.globalStyles}</style>
    <div style="position:relative;width:${slide.width}px;height:${slide.height}px;overflow:hidden;background:white;${slide.style}">
      ${slide.html}
    </div>
  `;
  document.body.append(wrapper);
  try {
    const node = wrapper.lastElementChild as HTMLElement;
    await settleImages(node);
    return await toPng(node, {
      width: slide.width,
      height: slide.height,
      pixelRatio: 1,
      cacheBust: true,
      imagePlaceholder: TRANSPARENT_PIXEL,
    });
  } finally {
    wrapper.remove();
  }
}

async function settleImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(images.map((image) => settleImage(image)));
}

function settleImage(image: HTMLImageElement): Promise<void> {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();
  if (image.complete && image.naturalWidth === 0) {
    image.src = TRANSPARENT_PIXEL;
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const timeout = window.setTimeout(() => finish(true), IMAGE_LOAD_TIMEOUT_MS);
    const cleanup = () => {
      window.clearTimeout(timeout);
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
    };
    const finish = (useFallback: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (useFallback) image.src = TRANSPARENT_PIXEL;
      resolve();
    };
    const onLoad = () => finish(false);
    const onError = () => finish(true);

    image.addEventListener("load", onLoad);
    image.addEventListener("error", onError);
  });
}

async function exportCurrentSlidePng(deck: Deck, slide: Slide) {
  const data = await renderSlideToPng(deck, slide);
  const anchor = document.createElement("a");
  anchor.href = data;
  anchor.download = safeFilename(slide.title, "png");
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
