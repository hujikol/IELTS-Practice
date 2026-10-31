// Audio Manager & Model Cache Controller.
// Guarantees the neural TTS model (Kokoro fp32 high quality) is downloaded at most once
// and cached locally in the browser's CacheStorage and IndexedDB for permanent offline reuse.

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const STORAGE_FLAG = 'ielts_audio_model_cached_fp32';
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
 * configuring FP32 precision for maximum vocal quality.
 */
export async function downloadAudioModelOnce(
  onProgress?: (progress: number, message: string) => void,
): Promise<unknown> {
  if (modelInstance) {
    onProgress?.(100, 'FP32 Neural model already loaded in memory.');
    return modelInstance;
  }

  if (downloadPromise) {
    return downloadPromise;
  }

  const isCached = await isAudioModelCached();
  notify({
    status: 'downloading',
    progress: isCached ? 90 : 0,
    message: isCached ? 'Loading FP32 high-fidelity model from cache...' : 'Downloading Kokoro FP32 neural weights...',
  });

  downloadPromise = (async () => {
    try {
      // Dynamic import of kokoro-js to avoid blocking initial bundle
      const { KokoroTTS } = await import('kokoro-js');

      // Use fp32 precision for highest quality voice generation
      const model = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'fp32',
        device: 'wasm',
        progress_callback: (item: { progress?: number; status?: string; file?: string }) => {
          const rawPct = typeof item.progress === 'number' ? Math.round(item.progress) : 0;
          const msg = item.file ? `Loading ${item.file}` : 'Fetching FP32 audio neural weights...';
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
        message: 'Kokoro FP32 audio model ready and cached permanently.',
      });

      return model;
    } catch (err) {
      downloadPromise = null;
      notify({
        status: 'error',
        progress: 0,
        message: (err as Error).message || 'Failed to download FP32 audio model.',
      });
      throw err;
    }
  })();

  return downloadPromise;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Synthesize speech audio using the Kokoro FP32 model, with automatic IndexedDB caching.
 * Returns an audio/wav Blob ready for playback.
 */
export async function synthesizeSpeechAudio(
  text: string,
  voiceId = 'af_heart',
  speed = 1.0,
): Promise<Blob> {
  const clean = text.trim();
  if (!clean) {
    return new Blob([], { type: 'audio/wav' });
  }

  const cacheKey = `kokoro_fp32_${voiceId}_${speed.toFixed(2)}_${simpleHash(clean)}`;
  const cached = await getCachedAudioBlob(cacheKey);
  if (cached && cached.size > 0) {
    return cached;
  }

  const model = (await downloadAudioModelOnce()) as {
    generate: (
      text: string,
      opts: { voice: string; speed: number },
    ) => Promise<{ toBlob: () => Blob }>;
  };

  const rawAudio = await model.generate(clean, {
    voice: voiceId,
    speed,
  });

  const blob = rawAudio.toBlob();
  await setCachedAudioBlob(cacheKey, blob);
  return blob;
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

