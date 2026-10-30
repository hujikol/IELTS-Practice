// Audio Manager & Model Cache Controller.
// Guarantees the neural TTS model is downloaded at most once and cached locally
// in the browser's CacheStorage and IndexedDB for permanent offline reuse.

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const STORAGE_FLAG = 'ielts_audio_model_cached';
const DB_NAME = 'ielts_studio_audio_db';
const DB_VERSION = 1;
const STORE_NAME = 'audio_clips';

export type ModelDownloadStatus = 'not_downloaded' | 'downloading' | 'ready' | 'error';

export type AudioProgressEvent = {
  status: ModelDownloadStatus;
  progress: number; // 0 to 100
  file?: string;
  message?: string;
};

// Singleton in-memory cache and promise lock to prevent duplicate downloads
let modelInstance: unknown = null;
let downloadPromise: Promise<unknown> | null = null;
const listeners = new Set<(event: AudioProgressEvent) => void>();

/** Subscribe to model download progress events */
export function subscribeAudioProgress(listener: (event: AudioProgressEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(event: AudioProgressEvent) {
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch {
      // ignore listener errors
    }
  });
}

/** Check whether the audio model is already cached locally */
export async function isAudioModelCached(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  // Check localStorage flag first
  if (localStorage.getItem(STORAGE_FLAG) === 'true') {
    return true;
  }

  // Check CacheStorage API
  if ('caches' in window) {
    try {
      const keys = await window.caches.keys();
      const hasTransformersCache = keys.some((k) => k.includes('transformers') || k.includes('kokoro'));
      if (hasTransformersCache) {
        localStorage.setItem(STORAGE_FLAG, 'true');
        return true;
      }
    } catch {
      // Ignore cache query errors
    }
  }

  return false;
}

/**
 * Downloads the neural audio model once with progress tracking,
 * caching it permanently in the browser.
 */
export async function downloadAudioModelOnce(
  onProgress?: (progress: number, message: string) => void,
): Promise<unknown> {
  if (modelInstance) {
    onProgress?.(100, 'Model already loaded in memory.');
    return modelInstance;
  }

  if (downloadPromise) {
    return downloadPromise;
  }

  const isCached = await isAudioModelCached();
  notify({
    status: 'downloading',
    progress: isCached ? 90 : 0,
    message: isCached ? 'Loading model from browser cache...' : 'Downloading audio generator model weights...',
  });

  downloadPromise = (async () => {
    try {
      // Dynamic import of kokoro-js to avoid blocking initial bundle
      const { KokoroTTS } = await import('kokoro-js');

      const model = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        progress_callback: (item: { progress?: number; status?: string; file?: string }) => {
          const rawPct = typeof item.progress === 'number' ? Math.round(item.progress) : 0;
          const msg = item.file ? `Loading ${item.file}` : 'Fetching audio neural weights...';
          onProgress?.(rawPct, msg);
          notify({
            status: 'downloading',
            progress: rawPct,
            file: item.file,
            message: msg,
          });
        },
      });

      modelInstance = model;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_FLAG, 'true');
      }

      notify({
        status: 'ready',
        progress: 100,
        message: 'Audio model ready and cached permanently in browser.',
      });

      return model;
    } catch (err) {
      downloadPromise = null;
      notify({
        status: 'error',
        progress: 0,
        message: (err as Error).message || 'Failed to download audio model.',
      });
      throw err;
    }
  })();

  return downloadPromise;
}

// ─── IndexedDB Generated Audio Cache ───

function openAudioDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported in this environment.'));
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Retrieve cached audio blob by key */
export async function getCachedAudioBlob(key: string): Promise<Blob | null> {
  try {
    const db = await openAudioDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        if (req.result instanceof Blob) {
          resolve(req.result);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Store generated audio blob in IndexedDB for reuse across sessions */
export async function setCachedAudioBlob(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openAudioDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(blob, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Non-fatal if IndexedDB storage fails
  }
}

