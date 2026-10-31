// Speaking Section Voice Recording, Web Audio Level Meter, VAD and Audio Persistence Service.
// Supports MediaRecorder (WebM/Opus or MP4), Web Audio AnalyserNode, and IndexedDB storage.

import { synthesizeSpeechAudio } from './audio-manager.ts';

const SPEAKING_DB_NAME = 'ielts_studio_speaking_db';
const SPEAKING_STORE_NAME = 'recordings';
const SPEAKING_DB_VERSION = 1;

export interface AudioMeterController {
  stop: () => void;
}

export interface RecorderController {
  stop: (endReason?: 'learner_next' | 'silence' | 'hard_cap' | 'timer') => Promise<{
    blob: Blob;
    durationS: number;
    endReason: 'learner_next' | 'silence' | 'hard_cap' | 'timer';
  }>;
  cancel: () => void;
}

/** Check whether user media recording is supported in current browser */
export function isAudioRecordingSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return Boolean(
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof window.MediaRecorder !== 'undefined',
  );
}

/** Check microphone permission status */
export async function queryMicrophonePermission(): Promise<'granted' | 'prompt' | 'denied' | 'unknown'> {
  if (typeof navigator === 'undefined' || !navigator.permissions) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
}

/** Request mic stream with noise suppression & echo cancellation */
export async function getMicrophoneStream(): Promise<MediaStream> {
  if (!isAudioRecordingSupported()) {
    throw new Error('Microphone recording is not supported in this browser.');
  }

  return await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });
}

/**
 * Creates a real-time audio volume level meter (0 to 100) using Web Audio AnalyserNode.
 */
export function createAudioLevelMeter(
  stream: MediaStream,
  onLevel: (level: number) => void,
): AudioMeterController {
  let active = true;
  let audioCtx: AudioContext | null = null;
  let animFrameId: number | null = null;

  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AudioContextClass();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (!active) return;
      analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i]!;
      }
      const avg = sum / dataArray.length;
      // Scale 0 - 128 to 0 - 100 with friendly response
      const level = Math.min(100, Math.round((avg / 64) * 100));
      onLevel(level);

      animFrameId = requestAnimationFrame(tick);
    };

    tick();
  } catch (err) {
    console.warn('[IELTS Studio] AudioLevelMeter initialization warning:', err);
  }

  return {
    stop: () => {
      active = false;
      if (animFrameId !== null) cancelAnimationFrame(animFrameId);
      if (audioCtx && audioCtx.state !== 'closed') {
        void audioCtx.close();
      }
    },
  };
}

/**
 * Starts recording a voice clip using MediaRecorder.
 * Supports VAD silence detection for exam mode auto-advance.
 */
export function startVoiceRecording(
  stream: MediaStream,
  options?: {
    maxDurationS?: number;
    vadSilenceThresholdS?: number;
    vadMinSpeechS?: number;
    onVolume?: (level: number) => void;
    onAutoStop?: (reason: 'silence' | 'hard_cap') => void;
  },
): RecorderController {
  const chunks: Blob[] = [];
  const startTime = Date.now();
  let stopped = false;
  let hasSpokenMin = false;
  let silenceStartTime: number | null = null;

  // Determine optimal MIME type
  let mimeType = 'audio/webm;codecs=opus';
  if (typeof MediaRecorder !== 'undefined') {
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      mimeType = 'audio/webm;codecs=opus';
    } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
      mimeType = 'audio/mp4';
    } else if (MediaRecorder.isTypeSupported('audio/webm')) {
      mimeType = 'audio/webm';
    } else {
      mimeType = '';
    }
  }

  const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  mediaRecorder.start(1000); // 1-second timeslice for resilience

  // Volume meter & VAD
  const meter = createAudioLevelMeter(stream, (lvl) => {
    options?.onVolume?.(lvl);

    if (stopped) return;
    const elapsedS = (Date.now() - startTime) / 1000;

    // Check hard cap
    if (options?.maxDurationS && elapsedS >= options.maxDurationS) {
      options.onAutoStop?.('hard_cap');
      return;
    }

    // VAD silence detection
    const isSpeaking = lvl >= 12;
    if (isSpeaking) {
      silenceStartTime = null;
      if (elapsedS >= (options?.vadMinSpeechS ?? 3)) {
        hasSpokenMin = true;
      }
    } else {
      if (!silenceStartTime) {
        silenceStartTime = Date.now();
      } else if (hasSpokenMin && options?.vadSilenceThresholdS) {
        const silenceSec = (Date.now() - silenceStartTime) / 1000;
        if (silenceSec >= options.vadSilenceThresholdS) {
          options.onAutoStop?.('silence');
        }
      }
    }
  });

  return {
    stop: (reason = 'learner_next') => {
      return new Promise((resolve) => {
        if (stopped) {
          const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
          resolve({ blob, durationS: (Date.now() - startTime) / 1000, endReason: reason });
          return;
        }

        stopped = true;
        meter.stop();

        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
          const durationS = Math.max(0.5, (Date.now() - startTime) / 1000);
          resolve({ blob, durationS, endReason: reason });
        };

        if (mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
      });
    },
    cancel: () => {
      stopped = true;
      meter.stop();
      if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    },
  };
}

/** Open or create Speaking IndexedDB database */
function openSpeakingDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported in this browser environment.'));
    }
    const req = indexedDB.open(SPEAKING_DB_NAME, SPEAKING_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SPEAKING_STORE_NAME)) {
        db.createObjectStore(SPEAKING_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Save recorded voice clip into IndexedDB */
export async function saveSpeakingAudioBlob(
  attemptId: string,
  part: number,
  questionId: string,
  take: number,
  blob: Blob,
): Promise<string> {
  const storageKey = `speaking_${attemptId}_p${part}_q${questionId}_take${take}`;
  try {
    const db = await openSpeakingDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SPEAKING_STORE_NAME, 'readwrite');
      const store = tx.objectStore(SPEAKING_STORE_NAME);
      const req = store.put(blob, storageKey);
      req.onsuccess = () => resolve(storageKey);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return storageKey;
  }
}

/** Retrieve recorded voice clip from IndexedDB */
export async function getSpeakingAudioBlob(storageKey: string): Promise<Blob | null> {
  try {
    const db = await openSpeakingDb();
    return new Promise((resolve) => {
      const tx = db.transaction(SPEAKING_STORE_NAME, 'readonly');
      const store = tx.objectStore(SPEAKING_STORE_NAME);
      const req = store.get(storageKey);
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

/**
 * Native SpeechRecognition transcription listener (Web Speech API).
 * Provides live verbatim words with fillers and false starts for immediate feedback.
 */
export function startLiveSpeechRecognition(
  onTranscript: (fullText: string, isFinal: boolean) => void,
): { stop: () => void } | null {
  if (typeof window === 'undefined') return null;

  const SpeechRecognitionClass =
    (window as unknown as { SpeechRecognition?: any }).SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition;

  if (!SpeechRecognitionClass) return null;

  let active = true;
  let recognition: any = null;
  let accumulatedFinal = '';

  try {
    recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-GB';

    recognition.onresult = (event: any) => {
      if (!active) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        if (item.isFinal) {
          accumulatedFinal += (accumulatedFinal ? ' ' : '') + item[0].transcript.trim();
        } else {
          interim += item[0].transcript;
        }
      }

      const combined = (accumulatedFinal + (interim ? ' ' + interim : '')).trim();
      onTranscript(combined, Boolean(accumulatedFinal && !interim));
    };

    recognition.onerror = () => {
      // Speech recognition error (e.g. no speech or network) — graceful silence
    };

    recognition.onend = () => {
      // Auto-restart if still actively recording
      if (active) {
        try {
          recognition.start();
        } catch {
          // ignore restart errors
        }
      }
    };

    recognition.start();
  } catch (err) {
    console.warn('[IELTS Studio] SpeechRecognition not active:', err);
    return null;
  }

  return {
    stop: () => {
      active = false;
      if (recognition) {
        try {
          recognition.stop();
        } catch {
          // ignore
        }
      }
    },
  };
}

/**
 * Speaks an examiner question aloud.
 * First attempts neural Kokoro TTS; falls back gracefully to Web Speech API `speechSynthesis`.
 */
export async function speakExaminerQuestion(
  text: string,
  onStart?: () => void,
  onEnd?: () => void,
): Promise<{ cancel: () => void }> {
  let isCancelled = false;
  let currentAudioElem: HTMLAudioElement | null = null;

  const cancel = () => {
    isCancelled = true;
    if (currentAudioElem) {
      currentAudioElem.pause();
      currentAudioElem.src = '';
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  // Try Kokoro TTS first
  try {
    const blob = await synthesizeSpeechAudio(text, 'bm_george', 1.0);
    if (!isCancelled && blob && blob.size > 0) {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioElem = audio;

      audio.onplay = () => onStart?.();
      audio.onended = () => {
        URL.revokeObjectURL(url);
        onEnd?.();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        // Fallback to Web Speech API
        speakWithBrowserTts(text, onStart, onEnd);
      };

      await audio.play();
      return { cancel };
    }
  } catch {
    // Kokoro TTS model not ready or unavailable — use browser SpeechSynthesis
  }

  if (!isCancelled) {
    speakWithBrowserTts(text, onStart, onEnd);
  }

  return { cancel };
}

function speakWithBrowserTts(text: string, onStart?: () => void, onEnd?: () => void): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onEnd?.();
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95; // Natural measured IELTS examiner speaking cadence
  utterance.pitch = 1.0;
  utterance.lang = 'en-GB';

  // Attempt to select a British or English voice if available
  const voices = window.speechSynthesis.getVoices();
  const britishVoice = voices.find((v) => v.lang.includes('en-GB') || v.name.includes('UK') || v.name.includes('British'));
  if (britishVoice) {
    utterance.voice = britishVoice;
  }

  utterance.onstart = () => onStart?.();
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();

  window.speechSynthesis.speak(utterance);
}

