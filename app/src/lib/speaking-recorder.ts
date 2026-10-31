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

/** Check whether live speech recognition is supported in current browser */
export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    (window as unknown as { SpeechRecognition?: any }).SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition,
  );
}

/**
 * Native SpeechRecognition transcription listener (Web Speech API).
 * Provides live verbatim words with fillers and false starts for immediate feedback.
 */
export function startLiveSpeechRecognition(
  onTranscript: (fullText: string, isFinal: boolean) => void,
  onError?: (errorType: string) => void,
): { stop: () => void } | null {
  if (typeof window === 'undefined') return null;

  const SpeechRecognitionClass =
    (window as unknown as { SpeechRecognition?: any }).SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition;

  if (!SpeechRecognitionClass) {
    if (onError) onError('unsupported');
    return null;
  }

  let active = true;
  let recognition: any = null;

  try {
    recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    // Prefer user's active English dialect or default to en-US for maximum cloud recognizer compatibility
    const preferredLang =
      typeof navigator !== 'undefined' && navigator.language && navigator.language.startsWith('en')
        ? navigator.language
        : 'en-US';
    recognition.lang = preferredLang;

    recognition.onresult = (event: any) => {
      if (!active) return;
      let finalStr = '';
      let interimStr = '';
      for (let i = 0; i < event.results.length; ++i) {
        const item = event.results[i];
        if (item && item[0]) {
          if (item.isFinal) {
            finalStr += (finalStr ? ' ' : '') + item[0].transcript.trim();
          } else {
            interimStr += (interimStr ? ' ' : '') + item[0].transcript.trim();
          }
        }
      }

      const combined = (finalStr + (interimStr ? ' ' + interimStr : '')).trim();
      onTranscript(combined, Boolean(finalStr && !interimStr));
    };

    recognition.onerror = (event: any) => {
      const err = event?.error || 'unknown';
      if (err !== 'no-speech') {
        console.warn('[IELTS Studio] SpeechRecognition error:', err);
        if (onError) onError(err);
      }
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
    if (onError) onError('init_failed');
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

// Module-level single-flight speech tracker to prevent any overlapping speech or choppy audio
let globalExaminerSpeechCancel: (() => void) | null = null;

/** Stop any currently playing examiner speech immediately (both Audio and SpeechSynthesis) */
export function stopAnyActiveExaminerSpeech(): void {
  if (globalExaminerSpeechCancel) {
    globalExaminerSpeechCancel();
    globalExaminerSpeechCancel = null;
  }
}

/**
 * Speaks an examiner question aloud with direct, high-fidelity playback.
 * First checks local IndexedDB neural audio cache (synthesized with the user's chosen TTS model
 * such as Kokoro FP32/FP16/Q8). If cached, starts playback with 0ms delay.
 * If not cached, synthesizes on-device neural audio, falling back gracefully to Web Speech API
 * only if neural synthesis is unavailable.
 */
export async function speakExaminerQuestion(
  text: string,
  onStart?: () => void,
  onEnd?: () => void,
  voiceId = 'bm_george',
): Promise<{ cancel: () => void }> {
  // Cancel any prior active utterance or audio element immediately to prevent overlap/stutter
  stopAnyActiveExaminerSpeech();

  const clean = text.trim();
  if (!clean) {
    onEnd?.();
    return { cancel: () => {} };
  }

  let isCancelled = false;
  let currentAudioElem: HTMLAudioElement | null = null;
  let currentBlobUrl: string | null = null;

  const cancel = () => {
    isCancelled = true;
    if (currentAudioElem) {
      try {
        currentAudioElem.pause();
        currentAudioElem.currentTime = 0;
        currentAudioElem.src = '';
      } catch {
        // ignore audio cancel error
      }
      currentAudioElem = null;
    }
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    if (globalExaminerSpeechCancel === cancel) {
      globalExaminerSpeechCancel = null;
    }
  };

  globalExaminerSpeechCancel = cancel;

  // 1. Try neural Kokoro TTS (instant if pre-cached in IndexedDB)
  try {
    const blob = await synthesizeSpeechAudio(clean, voiceId, 1.0);
    if (isCancelled) return { cancel };

    if (blob && blob.size > 0) {
      const url = URL.createObjectURL(blob);
      currentBlobUrl = url;
      const audio = new Audio(url);
      currentAudioElem = audio;

      let hasStarted = false;
      let hasEnded = false;

      const triggerStart = () => {
        if (!hasStarted && !isCancelled) {
          hasStarted = true;
          onStart?.();
        }
      };

      const triggerEnd = () => {
        if (!hasEnded) {
          hasEnded = true;
          if (currentBlobUrl) {
            URL.revokeObjectURL(currentBlobUrl);
            currentBlobUrl = null;
          }
          currentAudioElem = null;
          if (globalExaminerSpeechCancel === cancel) {
            globalExaminerSpeechCancel = null;
          }
          if (!isCancelled) {
            onEnd?.();
          }
        }
      };

      audio.onplay = triggerStart;
      audio.onended = triggerEnd;
      audio.onerror = () => {
        if (currentBlobUrl) {
          URL.revokeObjectURL(currentBlobUrl);
          currentBlobUrl = null;
        }
        currentAudioElem = null;
        if (!isCancelled && !hasEnded) {
          speakWithBrowserTts(clean, onStart, onEnd);
        }
      };

      try {
        await audio.play();
        triggerStart();
      } catch (playErr) {
        // If play() was aborted by cancel() or browser interaction policy
        if (isCancelled) return { cancel };
        console.warn('[IELTS Studio] Audio play interrupted, using browser TTS fallback:', playErr);
        speakWithBrowserTts(clean, onStart, onEnd);
      }

      return { cancel };
    }
  } catch (err) {
    if (isCancelled) return { cancel };
    console.warn('[IELTS Studio] Neural speech synthesis note:', err);
  }

  // 2. Fallback to Web Speech API if neural audio was unavailable and not cancelled
  if (!isCancelled) {
    speakWithBrowserTts(clean, onStart, onEnd);
  }

  return { cancel };
}

function speakWithBrowserTts(text: string, onStart?: () => void, onEnd?: () => void): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onEnd?.();
    return;
  }

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95; // Natural measured IELTS examiner speaking cadence
    utterance.pitch = 1.0;
    utterance.lang = 'en-GB';

    // Select British or English voice if available
    const voices = window.speechSynthesis.getVoices();
    const britishVoice = voices.find(
      (v) => v.lang.includes('en-GB') || v.name.includes('UK') || v.name.includes('British'),
    );
    if (britishVoice) {
      utterance.voice = britishVoice;
    }

    let started = false;
    let ended = false;

    utterance.onstart = () => {
      if (!started) {
        started = true;
        onStart?.();
      }
    };

    utterance.onend = () => {
      if (!ended) {
        ended = true;
        onEnd?.();
      }
    };

    utterance.onerror = (e) => {
      // Ignore 'interrupted' or 'canceled' errors from normal user navigation
      if (!ended) {
        ended = true;
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
          console.warn('[IELTS Studio] Web Speech error:', e.error);
        }
        onEnd?.();
      }
    };

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('[IELTS Studio] Web Speech API speak failed:', err);
    onEnd?.();
  }
}

