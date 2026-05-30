import type { Deck } from "./types";

const STORAGE_KEY = "visual-html-ppt-editor.deck.v1";

export function loadStoredDeck(): Deck | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Deck) : null;
  } catch {
    return null;
  }
}

export function storeDeck(deck: Deck): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deck));
}

export function clearStoredDeck(): void {
  localStorage.removeItem(STORAGE_KEY);
}
