// Audio Manager & Model Cache Controller.
// Configures on-device neural TTS models (Kokoro FP32, Q8, Q4, or Web Speech API fallback)
// and manages offline storage, IndexedDB audio caching, and cache clearing.

import { voiceForPart, NARRATOR_VOICE, type VoiceMapEntry } from './voices.ts';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DB_NAME = 'ielts_studio_audio_db';
const DB_VERSION = 1;
const STORE_NAME = 'audio_clips';

export type TtsModelType =
  | 'kokoro-fp32'
  | 'kokoro-fp16'
  | 'kokoro-q4f16'
  | 'kokoro-q8'
  | 'kokoro-q4'
  | 'webspeech';

export type TtsModelInfo = {
  id: TtsModelType;
  name: string;
  badge: string;
  badgeColor: string;
  dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';
  downloadSize: string;
  storageEstimate: string;
  minRam: string;
  recRam: string;
  minCpu: string;
  recCpu: string;
  description: string;
  bestFor: string;
};

export const TTS_MODELS: Record<TtsModelType, TtsModelInfo> = {
  'kokoro-fp32': {
    id: 'kokoro-fp32',
    name: 'Kokoro-82M (FP32 Full Precision)',
    badge: '32-Bit Studio Master',
    badgeColor: '#1d4ed8',
    dtype: 'fp32',
    downloadSize: '326 MB',
    storageEstimate: '~350 MB',
    minRam: '4 GB (~1.5 GB free heap)',
    recRam: '8 GB+ RAM',
    minCpu: '64-bit multi-core (x86-64 / ARM64)',
    recCpu: 'Apple Silicon (M-series) or 4+ cores 2.0GHz+',
    description: 'Full 32-bit floating point weights with zero quantization. Highest vocal fidelity, Cambridge nuances, and flawless prosody.',
    bestFor: 'Modern desktops and high-performance laptops with fast internet.',
  },
  'kokoro-fp16': {
    id: 'kokoro-fp16',
    name: 'Kokoro-82M (FP16 16-Bit Half Precision)',
    badge: '16-Bit High Fidelity',
    badgeColor: '#0284c7',
    dtype: 'fp16',
    downloadSize: '163 MB',
    storageEstimate: '~175 MB',
    minRam: '3 GB (~800 MB free heap)',
    recRam: '4 GB+ RAM',
    minCpu: '64-bit multi-core (x86-64 / ARM64)',
    recCpu: 'Apple Silicon or quad-core 2.0GHz+',
    description: 'Exact 16-bit floating point precision. Cuts download in half (163 MB vs 326 MB) with virtually indistinguishable sound quality and no quantization noise.',
    bestFor: 'Recommended sweet spot: Studio-grade audio with 50% lower download & memory.',
  },
  'kokoro-q4f16': {
    id: 'kokoro-q4f16',
    name: 'Kokoro-82M (Q4F16 Mixed Precision)',
    badge: 'Fast Mixed Precision',
    badgeColor: '#7c3aed',
    dtype: 'q4f16',
    downloadSize: '154 MB',
    storageEstimate: '~165 MB',
    minRam: '2 GB (~500 MB free heap)',
    recRam: '4 GB+ RAM',
    minCpu: 'Dual-core CPU 1.8GHz+',
    recCpu: 'Quad-core CPU 2.0GHz+',
    description: '4-bit matrix multiplication paired with 16-bit weight precision for accelerated inference and reduced memory pressure.',
    bestFor: 'Laptops looking for fast generation with 16-bit vocal clarity.',
  },
  'kokoro-q8': {
    id: 'kokoro-q8',
    name: 'Kokoro-82M (Q8 8-Bit Quantized)',
    badge: '8-Bit Balanced',
    badgeColor: '#059669',
    dtype: 'q8',
    downloadSize: '92.4 MB',
    storageEstimate: '~100 MB',
    minRam: '2 GB (~400 MB free heap)',
    recRam: '4 GB+ RAM',
    minCpu: 'Dual-core CPU 1.8GHz+',
    recCpu: 'Quad-core CPU 2.0GHz+',
    description: '8-bit quantized weights offering small download and low RAM consumption while preserving strong neural intelligibility.',
    bestFor: 'Everyday laptops, metered Wi-Fi, and quick downloads.',
  },
  'kokoro-q4': {
    id: 'kokoro-q4',
    name: 'Kokoro-82M (Q4 4-Bit Matmul)',
    badge: '4-Bit Compact',
    badgeColor: '#d97706',
    dtype: 'q4',
    downloadSize: '305 MB',
    storageEstimate: '~320 MB',
    minRam: '2 GB (~500 MB free heap)',
    recRam: '4 GB+ RAM',
    minCpu: 'Any 64-bit multi-core CPU',
    recCpu: 'Dual-core 1.8GHz+',
    description: '4-bit integer weights designed for low CPU compute overhead.',
    bestFor: 'Devices with limited CPU compute power.',
  },
  webspeech: {
    id: 'webspeech',
    name: 'Web Speech API (Native OS Engine)',
    badge: 'Instant / Zero Download',
    badgeColor: '#475569',
    downloadSize: '0 MB (None)',
    storageEstimate: '0 MB',
    minRam: 'Any (0 MB extra)',
    recRam: 'Any',
    minCpu: 'Any CPU',
    recCpu: 'Any CPU',
    description: 'Uses your operating system\'s native speech engine (Siri, Microsoft Natural, or Chrome TTS). Zero download and instant playback.',
    bestFor: 'Immediate practice with no network download or memory overhead.',
  },
};

const TTS_MODEL_PREF_KEY = 'ielts_tts_model_preference';
let inMemoryModelPref: TtsModelType = 'kokoro-fp32';

export type TtsDeviceType = 'webgpu' | 'cpu';
export const TTS_DEVICE_PREF_KEY = 'ielts_tts_device_preference';
let inMemoryDevicePref: TtsDeviceType = 'webgpu';

export function getTtsDevicePreference(): TtsDeviceType {
  if (typeof localStorage !== 'undefined') {
    try {
      const val = localStorage.getItem(TTS_DEVICE_PREF_KEY);
      if (val === 'webgpu' || val === 'cpu') {
        return val;
      }
    } catch {
      // ignore
    }
  }
  return inMemoryDevicePref;
}

export function setTtsDevicePreference(device: TtsDeviceType): void {
  inMemoryDevicePref = device;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(TTS_DEVICE_PREF_KEY, device);
    } catch {
      // ignore
    }
  }
  if (loadedDevice !== device) {
    modelInstance = null;
    downloadPromise = null;
    loadedDevice = null;
  }
}

export function getTtsModelPreference(): TtsModelType {
  if (typeof localStorage !== 'undefined') {
    try {
      const val = localStorage.getItem(TTS_MODEL_PREF_KEY) as TtsModelType;
      if (val && val in TTS_MODELS) {
        return val;
      }
    } catch {
      // ignore
    }
  }
  return inMemoryModelPref;
}

export function setTtsModelPreference(modelId: TtsModelType): void {
  inMemoryModelPref = modelId;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(TTS_MODEL_PREF_KEY, modelId);
    } catch {
      // ignore
    }
  }
  const targetDtype = TTS_MODELS[modelId]?.dtype;
  if (loadedDtype !== targetDtype) {
    modelInstance = null;
    downloadPromise = null;
    loadedDtype = null;
  }
}

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
let loadedDtype: string | null = null;
let loadedDevice: string | null = null;
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

function storageFlagFor(modelId: TtsModelType): string {
  const info = TTS_MODELS[modelId];
  return info?.dtype ? `ielts_audio_model_cached_${info.dtype}` : 'ielts_audio_model_cached_fp32';
}

/** Check whether the chosen audio model is already cached locally */
export async function isAudioModelCached(targetModel?: TtsModelType): Promise<boolean> {
  const modelId = targetModel || getTtsModelPreference();
  if (modelId === 'webspeech') return true;
  if (typeof window === 'undefined') return false;

  const flagKey = storageFlagFor(modelId);
  if (localStorage.getItem(flagKey) === 'true') {
    return true;
  }

  // Check CacheStorage API
  if ('caches' in window) {
    try {
      const keys = await window.caches.keys();
      const hasTransformersCache = keys.some((k) => k.includes('transformers') || k.includes('kokoro'));
      if (hasTransformersCache) {
        localStorage.setItem(flagKey, 'true');
        return true;
      }
    } catch {
      // Ignore cache query errors
    }
  }

  return false;
}

/**
 * Downloads and initializes the neural audio model once with progress tracking,
 * using the configured precision (FP32, FP16, Q8, or Q4) and compute device (WebGPU by default, or CPU/WASM).
 */
export async function downloadAudioModelOnce(
  onProgress?: (progress: number, message: string) => void,
  forcedModel?: TtsModelType,
  forcedDevice?: TtsDeviceType,
): Promise<unknown> {
  const selectedModelId = forcedModel || getTtsModelPreference();
  if (selectedModelId === 'webspeech') {
    onProgress?.(100, 'Using Native Web Speech API (0 MB download).');
    return null;
  }

  const modelInfo = TTS_MODELS[selectedModelId] || TTS_MODELS['kokoro-fp32'];
  const targetDtype = modelInfo.dtype || 'fp32';
  const targetDevice = forcedDevice || getTtsDevicePreference();

  if (modelInstance && loadedDtype === targetDtype && loadedDevice === targetDevice) {
    onProgress?.(100, `${modelInfo.name} (${targetDevice.toUpperCase()}) already loaded in memory.`);
    return modelInstance;
  }

  if (downloadPromise && loadedDtype === targetDtype && loadedDevice === targetDevice) {
    return downloadPromise;
  }

  const isCached = await isAudioModelCached(selectedModelId);
  notify({
    status: 'downloading',
    progress: isCached ? 90 : 0,
    message: isCached
      ? `Loading ${modelInfo.name} (${targetDevice.toUpperCase()}) from cache...`
      : `Downloading ${modelInfo.name} weights (${modelInfo.downloadSize})...`,
  });

  downloadPromise = (async () => {
    try {
      // Dynamic import of kokoro-js to avoid blocking initial bundle
      const { KokoroTTS } = await import('kokoro-js');

      let deviceToUse: 'webgpu' | 'wasm' = targetDevice === 'webgpu' ? 'webgpu' : 'wasm';
      const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu;
      if (deviceToUse === 'webgpu' && !hasGpu) {
        console.warn('[KokoroTTS] WebGPU not supported on this browser/device; falling back to CPU (WASM).');
        deviceToUse = 'wasm';
      }

      let model;
      try {
        model = await KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: targetDtype,
          device: deviceToUse,
          progress_callback: (item: { progress?: number; status?: string; file?: string }) => {
            const rawPct = typeof item.progress === 'number' ? Math.round(item.progress) : 0;
            const msg = item.file ? `Loading ${item.file}` : `Fetching ${modelInfo.name} weights...`;
            onProgress?.(rawPct, msg);
            notify({
              status: 'downloading',
              progress: rawPct,
              file: item.file,
              message: msg,
            });
          },
        });
      } catch (gpuErr) {
        // If WebGPU was attempted and failed, fallback to CPU (WASM)
        if (deviceToUse === 'webgpu') {
          console.warn('[KokoroTTS] WebGPU initialization failed, falling back to CPU (WASM):', gpuErr);
          deviceToUse = 'wasm';
          model = await KokoroTTS.from_pretrained(MODEL_ID, {
            dtype: targetDtype,
            device: 'wasm',
            progress_callback: (item: { progress?: number; status?: string; file?: string }) => {
              const rawPct = typeof item.progress === 'number' ? Math.round(item.progress) : 0;
              const msg = item.file ? `Loading ${item.file}` : `Fetching ${modelInfo.name} weights (CPU fallback)...`;
              onProgress?.(rawPct, msg);
              notify({
                status: 'downloading',
                progress: rawPct,
                file: item.file,
                message: msg,
              });
            },
          });
        } else {
          throw gpuErr;
        }
      }

      modelInstance = model;
      loadedDtype = targetDtype;
      loadedDevice = targetDevice;

      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(storageFlagFor(selectedModelId), 'true');
      }

      notify({
        status: 'ready',
        progress: 100,
        message: `${modelInfo.name} ready on ${deviceToUse.toUpperCase()} and cached offline.`,
      });

      return model;
    } catch (err) {
      downloadPromise = null;
      notify({
        status: 'error',
        progress: 0,
        message: (err as Error).message || `Failed to download ${modelInfo.name}.`,
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
 * Calculates the exact IndexedDB cache key for a synthesized audio clip.
 */
export function getAudioClipCacheKey(
  text: string,
  voiceId = 'af_heart',
  speed = 1.0,
  forcedModel?: TtsModelType,
): string {
  const modelId = forcedModel || getTtsModelPreference();
  const modelInfo = TTS_MODELS[modelId] || TTS_MODELS['kokoro-fp32'];
  const targetDtype = modelInfo.dtype || 'fp32';
  const clean = text.trim();
  return `kokoro_${targetDtype}_${voiceId}_${speed.toFixed(2)}_${simpleHash(clean)}`;
}

export type TestAudioCacheStatus = {
  isModelCached: boolean;
  totalLines: number;
  cachedLines: number;
  missingVoices: boolean;
  modelType: TtsModelType;
};

/**
 * Checks whether the neural model weights and generated audio clips for a test's
 * listening sections exist in the browser's local cache.
 */
export async function checkTestAudioCacheStatus(
  listeningBlocks: { script?: { speaker?: string; text?: string }[] }[],
  voiceMap?: Record<string, VoiceMapEntry>,
  forcedModel?: TtsModelType,
): Promise<TestAudioCacheStatus> {
  const modelType = forcedModel || getTtsModelPreference();
  if (modelType === 'webspeech') {
    return {
      isModelCached: true,
      totalLines: 0,
      cachedLines: 0,
      missingVoices: false,
      modelType,
    };
  }

  const isModelCachedVal = await isAudioModelCached(modelType);

  let totalLines = 0;
  let cachedLines = 0;

  const validBlocks = (listeningBlocks || []).filter(
    (b) => Array.isArray(b?.script) && b.script.length > 0,
  );

  if (validBlocks.length === 0) {
    return {
      isModelCached: isModelCachedVal,
      totalLines: 0,
      cachedLines: 0,
      missingVoices: !isModelCachedVal,
      modelType,
    };
  }

  const vMap = voiceMap || {};

  for (let bIdx = 0; bIdx < validBlocks.length; bIdx++) {
    const block = validBlocks[bIdx]!;
    const partNum = bIdx + 1;
    const script = (block.script || []).filter((s) => s && s.text && s.text.trim().length > 0);

    for (const item of script) {
      totalLines++;
      const speakerType =
        item.speaker === 'woman' || /female|_f_/i.test(item.speaker || '')
          ? 'woman'
          : item.speaker === 'man' || /male|_m_/i.test(item.speaker || '')
            ? 'man'
            : 'narrator';
      const voiceId = voiceForPart(vMap, partNum, speakerType);
      const key = getAudioClipCacheKey(item.text!, voiceId, 1.0, modelType);
      const cached = await getCachedAudioBlob(key);
      if (cached && cached.size > 0) {
        cachedLines++;
      }
    }
  }

  const missingVoices = !isModelCachedVal || (totalLines > 0 && cachedLines < totalLines);

  return {
    isModelCached: isModelCachedVal,
    totalLines,
    cachedLines,
    missingVoices,
    modelType,
  };
}

/**
 * Downloads the neural model weights and re-synthesizes all listening audio tracks
 * for an entire test, with live progress reporting across both stages.
 */
export async function downloadAndRegenerateAllVoices(
  listeningBlocks: { script?: { speaker?: string; text?: string }[] }[],
  voiceMap: Record<string, VoiceMapEntry>,
  onProgress?: (stage: 'downloading' | 'synthesizing', progress: number, message: string) => void,
  forcedModel?: TtsModelType,
): Promise<void> {
  const modelType = forcedModel || getTtsModelPreference();
  if (modelType === 'webspeech') {
    onProgress?.('synthesizing', 100, 'Using Web Speech API (0 MB download).');
    return;
  }

  const modelInfo = TTS_MODELS[modelType] || TTS_MODELS['kokoro-fp32'];

  // Step 1: Download model weights
  onProgress?.('downloading', 0, `Downloading ${modelInfo.name} weights (${modelInfo.downloadSize})...`);
  await downloadAudioModelOnce((pct, msg) => {
    onProgress?.('downloading', pct, msg);
  }, modelType);

  // Step 2: Regenerate audio clips
  const validBlocks = (listeningBlocks || []).filter(
    (b) => Array.isArray(b?.script) && b.script.length > 0,
  );

  let totalLines = 0;
  validBlocks.forEach((b) => {
    totalLines += (b.script || []).filter((s) => s && s.text && s.text.trim().length > 0).length;
  });

  let processed = 0;

  for (let bIdx = 0; bIdx < validBlocks.length; bIdx++) {
    const block = validBlocks[bIdx]!;
    const partNum = bIdx + 1;
    const cleanScript = (block.script || [])
      .filter((s) => s && s.text && s.text.trim().length > 0)
      .map((s) => ({ speaker: s.speaker, text: s.text }));

    await pregenerateListeningAudio(
      cleanScript,
      partNum,
      voiceMap,
      (done, _partTotal, snippet) => {
        processed++;
        const pct = totalLines > 0 ? Math.round((processed / totalLines) * 100) : 100;
        onProgress?.(
          'synthesizing',
          pct,
          `Part ${partNum} (${done}/${cleanScript.length}): "${snippet.slice(0, 24)}..."`,
        );
      },
      modelType,
    );
  }

  onProgress?.('synthesizing', 100, 'All listening voice tracks synthesized and cached offline!');
}

/**
 * Synthesize speech audio using the active TTS model, with automatic IndexedDB caching.
 * Returns an audio/wav Blob ready for playback.
 */
export async function synthesizeSpeechAudio(
  text: string,
  voiceId = 'af_heart',
  speed = 1.0,
  forcedModel?: TtsModelType,
): Promise<Blob> {
  const clean = text.trim();
  if (!clean) {
    return new Blob([], { type: 'audio/wav' });
  }

  const modelId = forcedModel || getTtsModelPreference();
  if (modelId === 'webspeech') {
    // Return empty blob to instruct player to use native Web Speech API fallback
    return new Blob([], { type: 'audio/wav' });
  }

  const cacheKey = getAudioClipCacheKey(clean, voiceId, speed, modelId);
  const cached = await getCachedAudioBlob(cacheKey);
  if (cached && cached.size > 0) {
    return cached;
  }

  const model = (await downloadAudioModelOnce(undefined, modelId)) as {
    generate: (
      text: string,
      opts: { voice: string; speed: number },
    ) => Promise<{ toBlob: () => Blob }>;
  };

  if (!model || typeof model.generate !== 'function') {
    return new Blob([], { type: 'audio/wav' });
  }

  const rawAudio = await model.generate(clean, {
    voice: voiceId,
    speed,
  });

  const blob = rawAudio.toBlob();
  await setCachedAudioBlob(cacheKey, blob);
  return blob;
}

/**
 * Pre-generate speech audio for an entire listening script and store in IndexedDB.
 * Guarantees zero latency and instantaneous playback in the test player.
 */
export async function pregenerateListeningAudio(
  script: { speaker?: string; text?: string }[],
  partNumber: number,
  voiceMap: Record<string, VoiceMapEntry>,
  onProgress?: (done: number, total: number, snippet: string) => void,
  forcedModel?: TtsModelType,
): Promise<void> {
  if (!script || script.length === 0) return;

  const modelId = forcedModel || getTtsModelPreference();
  if (modelId === 'webspeech') {
    // Web Speech API synthesizes instantaneously on-demand, no pre-render needed
    onProgress?.(script.length, script.length, 'Ready via Web Speech API');
    return;
  }

  const validLines = script.filter((s) => s && s.text && s.text.trim().length > 0);
  const total = validLines.length;

  for (let i = 0; i < total; i++) {
    const line = validLines[i]!;
    const speakerType =
      line.speaker === 'woman' || /female|_f_/i.test(line.speaker || '')
        ? 'woman'
        : line.speaker === 'man' || /male|_m_/i.test(line.speaker || '')
          ? 'man'
          : 'narrator';

    const voiceId = voiceForPart(voiceMap, partNumber, speakerType);
    onProgress?.(i + 1, total, line.text!.slice(0, 30));

    try {
      await synthesizeSpeechAudio(line.text!, voiceId, 1.0, modelId);
    } catch (err) {
      console.warn(`[IELTS Studio] Warning: Pre-rendering voice line ${i + 1} failed:`, err);
    }
  }

  // Pre-generate standard IELTS intro and review prompts for this part
  try {
    await synthesizeSpeechAudio(
      `Section ${partNumber}. You will hear a discussion or monologue. First, you have some time to look at the questions.`,
      NARRATOR_VOICE,
      1.0,
      modelId,
    );
    await synthesizeSpeechAudio(
      'Now listen carefully and answer questions.',
      NARRATOR_VOICE,
      1.0,
      modelId,
    );
    await synthesizeSpeechAudio(
      `That is the end of Part ${partNumber}. You now have half a minute to check your answers.`,
      NARRATOR_VOICE,
      1.0,
      modelId,
    );
  } catch {
    // Non-fatal
  }
}

// ─── IndexedDB Generated Audio Cache & Management ───

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

export type AudioCacheStats = {
  clipCount: number;
  clipBytesEstimate: number;
  isModelCached: boolean;
  selectedModel: TtsModelType;
};

/** Get live audio cache statistics */
export async function getAudioCacheStats(): Promise<AudioCacheStats> {
  let clipCount = 0;
  let clipBytesEstimate = 0;

  try {
    const db = await openAudioDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          clipCount++;
          if (cursor.value instanceof Blob) {
            clipBytesEstimate += cursor.value.size;
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => resolve();
    });
  } catch {
    // ignore
  }

  const selectedModel = getTtsModelPreference();
  const isModelCachedVal = await isAudioModelCached(selectedModel);

  return {
    clipCount,
    clipBytesEstimate,
    isModelCached: isModelCachedVal,
    selectedModel,
  };
}

/**
 * Clear only the synthesized audio clips in IndexedDB.
 * Frees up disk space while preserving downloaded neural model weights.
 */
export async function clearAudioClipsCache(): Promise<number> {
  const db = await openAudioDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const countReq = store.count();
    countReq.onsuccess = () => {
      const count = countReq.result;
      const clearReq = store.clear();
      clearReq.onsuccess = () => resolve(count);
      clearReq.onerror = () => reject(clearReq.error);
    };
    countReq.onerror = () => reject(countReq.error);
  });
}

/**
 * Purge all audio caches: IndexedDB audio clips, CacheStorage ONNX model weights,
 * and localStorage flags. Resets in-memory model instances completely.
 */
export async function clearAllAudioAndModelCaches(): Promise<{ clipsCleared: number; modelsCleared: boolean }> {
  // 1. Clear IndexedDB clips
  let clipsCleared = 0;
  try {
    clipsCleared = await clearAudioClipsCache();
  } catch (e) {
    console.warn('[IELTS Studio] Warning clearing audio clips:', e);
  }

  // 2. Clear CacheStorage
  let modelsCleared = false;
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const keys = await window.caches.keys();
      for (const k of keys) {
        if (k.includes('transformers') || k.includes('kokoro') || k.includes('onnx')) {
          await window.caches.delete(k);
          modelsCleared = true;
        }
      }
    } catch (e) {
      console.warn('[IELTS Studio] Warning clearing CacheStorage:', e);
    }
  }

  // 3. Clear localStorage flags
  if (typeof localStorage !== 'undefined') {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith('ielts_audio_model_cached')) {
          localStorage.removeItem(key);
        }
      }
    } catch {
      // ignore
    }
  }

  // 4. Invalidate memory instance
  modelInstance = null;
  downloadPromise = null;
  loadedDtype = null;

  notify({
    status: 'not_downloaded',
    progress: 0,
    message: 'All audio and neural model caches purged.',
  });

  return { clipsCleared, modelsCleared };
}
