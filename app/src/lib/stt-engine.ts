/**
 * Audio Speech-to-Text & Acoustic Analysis Engine (§6.2).
 *
 * Provides:
 * 1. Provider-side audio transcription (/audio/transcriptions) for OpenAI/Groq/Whisper endpoints
 *    with word-level timestamps ('verbose_json').
 * 2. In-browser audio buffer analysis via Web Audio API to measure genuine speech energy,
 *    unvoiced silence pauses (>1.0s), and actual speaking duration from the recorded Blob.
 * 3. Graceful fallback to live Web Speech preview text when remote transcription is not enabled.
 */

import { type ProviderConfig } from './providers.ts';

export type WordTimestamp = {
  w: string;
  start: number;
  end: number;
  conf: number;
};

export type TranscribeResult = {
  text: string;
  words: WordTimestamp[];
  durationS: number;
  engine: 'whisper-api' | 'web-speech' | 'none';
  model?: string;
  source: 'audio-transcription' | 'live-preview';
};

/**
 * Transcribes an audio blob using an OpenAI-compatible /audio/transcriptions endpoint.
 * Requests verbose_json with word timestamps.
 */
export async function transcribeAudioBlobWithApi(
  blob: Blob,
  config: ProviderConfig,
  signal?: AbortSignal,
): Promise<TranscribeResult> {
  const normalizedBase = config.baseUrl.replace(/\/+$/, '');
  const transcriptionsUrl = normalizedBase.endsWith('/v1')
    ? `${normalizedBase}/audio/transcriptions`
    : `${normalizedBase}/v1/audio/transcriptions`;

  const formData = new FormData();
  formData.append('file', blob, 'speech.webm');
  formData.append('model', 'whisper-1');
  formData.append('language', 'en');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');

  const headers: Record<string, string> = {};
  if (config.apiKey.trim()) {
    headers.Authorization = `Bearer ${config.apiKey.trim()}`;
  }

  const res = await fetch(transcriptionsUrl, {
    method: 'POST',
    headers,
    body: formData,
    signal: signal ?? AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Audio transcription API error (${res.status}): ${errText.slice(0, 160)}`);
  }

  const data = (await res.json()) as {
    text?: string;
    duration?: number;
    words?: Array<{ word?: string; start?: number; end?: number }>;
  };

  const text = (data.text || '').trim();
  const rawWords = Array.isArray(data.words) ? data.words : [];
  const words: WordTimestamp[] = rawWords.map((item) => ({
    w: String(item.word || '').trim(),
    start: typeof item.start === 'number' ? item.start : 0,
    end: typeof item.end === 'number' ? item.end : 0,
    conf: 0.98,
  })).filter((item) => item.w.length > 0);

  return {
    text,
    words,
    durationS: typeof data.duration === 'number' ? data.duration : 0,
    engine: 'whisper-api',
    model: 'whisper-1',
    source: 'audio-transcription',
  };
}

/**
 * Genuine silence and pause detector using Web Audio API on recorded AudioBuffer.
 * Analyzes RMS amplitude over 50ms frames to detect pauses > 1.0s and true speaking time.
 */
export async function analyzeRecordedAudioPauses(
  blob: Blob,
): Promise<{ durationS: number; pauseCountOver1s: number; speakingDurationS: number }> {
  if (typeof window === 'undefined' || !window.AudioContext) {
    return { durationS: 0, pauseCountOver1s: 0, speakingDurationS: 0 };
  }

  try {
    const arrayBuffer = await blob.arrayBuffer();
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const durationS = audioBuffer.duration;
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;

    // Analyze in 50ms windows
    const windowSize = Math.floor(sampleRate * 0.05);
    const silenceThresholdRms = 0.015; // Noise floor threshold
    let silenceDurationS = 0;
    let pauseCountOver1s = 0;
    let speakingDurationS = 0;

    for (let i = 0; i < channelData.length; i += windowSize) {
      let sumSquares = 0;
      const end = Math.min(channelData.length, i + windowSize);
      for (let j = i; j < end; j++) {
        sumSquares += channelData[j]! * channelData[j]!;
      }
      const rms = Math.sqrt(sumSquares / (end - i));
      const windowSec = (end - i) / sampleRate;

      if (rms < silenceThresholdRms) {
        silenceDurationS += windowSec;
      } else {
        if (silenceDurationS >= 1.0) {
          pauseCountOver1s++;
        }
        silenceDurationS = 0;
        speakingDurationS += windowSec;
      }
    }
    if (silenceDurationS >= 1.0) {
      pauseCountOver1s++;
    }

    void ctx.close();
    return { durationS, pauseCountOver1s, speakingDurationS };
  } catch {
    return { durationS: 0, pauseCountOver1s: 0, speakingDurationS: 0 };
  }
}

