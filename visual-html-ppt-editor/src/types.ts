export interface Slide {
  id: string;
  title: string;
  html: string;
  style: string;
  width: number;
  height: number;
}

export interface Deck {
  id: string;
  title: string;
  globalStyles: string;
  sourceName?: string;
  slides: Slide[];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectionInfo {
  ids: string[];
  id: string;
  tag: string;
  text: string;
  fontSize: string;
  color: string;
  backgroundColor: string;
  fontWeight: string;
  fontStyle: string;
  textAlign: string;
  zIndex: string;
}

export interface ImportedFileHandle {
  name: string;
  handle?: FileSystemFileHandle;
}

export interface ResourceMap {
  [path: string]: string; // path -> content (text for CSS, data URL for images)
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: {
      multiple?: boolean;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<FileSystemFileHandle>;
  }

}
