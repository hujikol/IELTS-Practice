import { useState, useEffect, useRef, useCallback } from 'react';
import type { ScriptLine } from '../lib/types.ts';
import { Button } from './ui/button.tsx';
import {
  isAudioModelCached,
  downloadAudioModelOnce,
  subscribeAudioProgress,
  synthesizeSpeechAudio,
  type AudioProgressEvent,
} from '../lib/audio-manager.ts';
import {
  randomizeVoiceMap,
  voiceDisplayName,
  voiceForPart,
  type VoiceMapEntry,
} from '../lib/voices.ts';

interface ListeningAudioPlayerProps {
  partNumber: number;
  script: (
    | ScriptLine
    | { speaker: string; text: string; intro?: boolean }
    | { type: string; text?: string; seconds?: number; name?: string; speaker_id?: string; voice?: string }
  )[];
  onPlayStateChange?: (playing: boolean) => void;
  timed?: boolean;
}

export function ListeningAudioPlayer({
  partNumber,
  script,
  onPlayStateChange,
  timed = false,
}: ListeningAudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [stage, setStage] = useState<'idle' | 'countdown_intro' | 'playing_script' | 'countdown_review' | 'finished'>('idle');
  const [countdownRemaining, setCountdownRemaining] = useState<number>(30);
  const [currentLineIndex, setCurrentLineIndex] = useState<number>(0);
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const [modelCached, setModelCached] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<AudioProgressEvent | null>(null);
  const [showInfoPopover, setShowInfoPopover] = useState(false);
  const [hasPlayedInTimedMode, setHasPlayedInTimedMode] = useState(false);
  const [activeVoiceMap, setActiveVoiceMap] = useState<Record<string, VoiceMapEntry>>(() => randomizeVoiceMap());
  const [currentSpeakerInfo, setCurrentSpeakerInfo] = useState<{ label: string; voiceName: string } | null>(null);

  const synthRef = useRef<SpeechSynthesis | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const isPausedRef = useRef<boolean>(false);
  const stageRef = useRef<'idle' | 'countdown_intro' | 'playing_script' | 'countdown_review' | 'finished'>('idle');
  const currentLineIndexRef = useRef<number>(0);
  const countdownRemainingRef = useRef<number>(30);

  stageRef.current = stage;
  currentLineIndexRef.current = currentLineIndex;
  countdownRemainingRef.current = countdownRemaining;

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;
    }
    void isAudioModelCached().then(setModelCached);

    const unsubscribe = subscribeAudioProgress((event) => {
      setDownloadProgress(event);
      if (event.status === 'ready') {
        setModelCached(true);
      }
    });

    return () => {
      unsubscribe();
      isPausedRef.current = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (synthRef.current) synthRef.current.cancel();
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current = null;
      }
    };
  }, []);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleRandomizeVoices = () => {
    const fresh = randomizeVoiceMap();
    setActiveVoiceMap(fresh);
  };

  const fallbackSpeechSynthesis = useCallback(
    (text: string, voiceType: 'narrator' | 'woman' | 'man', onEnd?: () => void) => {
      if (isPausedRef.current) return;

      if (!synthRef.current) {
        const durationMs = Math.max(1200, text.split(' ').length * 280);
        const to = setTimeout(() => {
          if (!isPausedRef.current) onEnd?.();
        }, durationMs);
        return () => clearTimeout(to);
      }

      synthRef.current.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.rate = speechRate;
      utt.pitch = voiceType === 'woman' ? 1.15 : voiceType === 'man' ? 0.9 : 1.0;

      const voices = synthRef.current.getVoices();
      if (voices.length > 0) {
        const enVoices = voices.filter((v) => v.lang.startsWith('en'));
        if (voiceType === 'woman') {
          utt.voice = enVoices.find((v) => /female|woman|samantha|karen|victoria/i.test(v.name)) || enVoices[0] || null;
        } else if (voiceType === 'man') {
          utt.voice = enVoices.find((v) => /male|man|daniel|alex|george/i.test(v.name)) || enVoices[1] || enVoices[0] || null;
        } else {
          utt.voice = enVoices.find((v) => /uk|british|serena|oliver/i.test(v.name)) || enVoices[0] || null;
        }
      }

      utt.onend = () => {
        if (!isPausedRef.current) {
          onEnd?.();
        }
      };

      utt.onerror = (e) => {
        if (!isPausedRef.current && (e as SpeechSynthesisErrorEvent).error !== 'canceled') {
          onEnd?.();
        }
      };

      utteranceRef.current = utt;
      synthRef.current.speak(utt);
    },
    [speechRate],
  );

  const playSpeechLine = useCallback(
    (text: string, voiceType: 'narrator' | 'woman' | 'man', onEnd?: () => void) => {
      if (isPausedRef.current) return;

      const voiceId = voiceForPart(activeVoiceMap, partNumber, voiceType);
      const speakerName = voiceDisplayName(voiceId);
      setCurrentSpeakerInfo({
        label: voiceType === 'narrator' ? 'Narrator' : voiceType === 'woman' ? 'Speaker 1 (Woman)' : 'Speaker 2 (Man)',
        voiceName: speakerName,
      });

      // Attempt Kokoro FP32 high quality speech synthesis first
      synthesizeSpeechAudio(text, voiceId, speechRate)
        .then((blob) => {
          if (isPausedRef.current) return;
          if (!blob || blob.size === 0) {
            fallbackSpeechSynthesis(text, voiceType, onEnd);
            return;
          }

          if (audioElRef.current) {
            audioElRef.current.pause();
            audioElRef.current = null;
          }

          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.playbackRate = speechRate;
          audioElRef.current = audio;

          audio.onended = () => {
            URL.revokeObjectURL(url);
            audioElRef.current = null;
            if (!isPausedRef.current) onEnd?.();
          };

          audio.onerror = () => {
            URL.revokeObjectURL(url);
            audioElRef.current = null;
            fallbackSpeechSynthesis(text, voiceType, onEnd);
          };

          audio.play().catch(() => {
            URL.revokeObjectURL(url);
            audioElRef.current = null;
            fallbackSpeechSynthesis(text, voiceType, onEnd);
          });
        })
        .catch(() => {
          fallbackSpeechSynthesis(text, voiceType, onEnd);
        });
    },
    [activeVoiceMap, partNumber, speechRate, fallbackSpeechSynthesis],
  );

  const playBeep = useCallback((onEnd?: () => void) => {
    if (isPausedRef.current) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) {
        onEnd?.();
        return;
      }
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
      setTimeout(() => {
        void ctx.close().catch(() => {});
        if (!isPausedRef.current) onEnd?.();
      }, 260);
    } catch {
      onEnd?.();
    }
  }, []);

  const playNextTurn = useCallback(
    (lineIdx: number) => {
      if (isPausedRef.current) return;

      if (lineIdx >= script.length) {
        setStage('countdown_review');
        setCountdownRemaining(30);
        countdownRemainingRef.current = 30;

        playSpeechLine(
          `That is the end of Part ${partNumber}. You now have half a minute to check your answers.`,
          'narrator',
          () => {
            if (isPausedRef.current) return;
            let sec = 30;
            clearTimer();
            timerRef.current = window.setInterval(() => {
              if (isPausedRef.current) return;
              sec -= 1;
              setCountdownRemaining(sec);
              countdownRemainingRef.current = sec;
              if (sec <= 0) {
                clearTimer();
                setStage('finished');
                setIsPlaying(false);
                if (timed) setHasPlayedInTimedMode(true);
                onPlayStateChange?.(false);
              }
            }, 1000);
          },
        );
        return;
      }

      setCurrentLineIndex(lineIdx);
      currentLineIndexRef.current = lineIdx;

      const rawItem = script[lineIdx];
      if (!rawItem) return;

      const event = rawItem as {
        type?: string;
        speaker?: string;
        speaker_id?: string;
        text?: string;
        seconds?: number;
        name?: string;
      };

      // 1. Audio pause event (e.g. 30-second prep or review)
      if (event.type === 'pause' || typeof event.seconds === 'number') {
        const sec = event.seconds ?? 30;
        setStage('countdown_intro');
        setCountdownRemaining(sec);
        countdownRemainingRef.current = sec;
        let remain = sec;
        clearTimer();
        timerRef.current = window.setInterval(() => {
          if (isPausedRef.current) return;
          remain -= 1;
          setCountdownRemaining(remain);
          countdownRemainingRef.current = remain;
          if (remain <= 0) {
            clearTimer();
            setStage('playing_script');
            playNextTurn(lineIdx + 1);
          }
        }, 1000);
        return;
      }

      // 2. Audio chime / beep sound
      if (event.type === 'sound' || event.name === 'beep') {
        playBeep(() => {
          if (!isPausedRef.current) playNextTurn(lineIdx + 1);
        });
        return;
      }

      // 3. Spoken dialogue or narrator line
      const text = event.text || '';
      const speakerType =
        event.type === 'narrator'
          ? 'narrator'
          : event.speaker === 'woman' || /female|_f_/i.test(event.speaker_id || '')
            ? 'woman'
            : event.speaker === 'man' || /male|_m_/i.test(event.speaker_id || '')
              ? 'man'
              : 'narrator';

      playSpeechLine(text, speakerType, () => {
        if (!isPausedRef.current) {
          playNextTurn(lineIdx + 1);
        }
      });
    },
    [script, partNumber, onPlayStateChange, playSpeechLine, playBeep, timed],
  );

  const startCountdownIntro = useCallback((initialSec = 30) => {
    setStage('countdown_intro');
    setCountdownRemaining(initialSec);
    countdownRemainingRef.current = initialSec;

    playSpeechLine(
      initialSec === 30
        ? `Section ${partNumber}. You will hear a discussion or monologue. First, you have some time to look at the questions.`
        : '',
      'narrator',
      () => {
        if (isPausedRef.current) return;
        let sec = initialSec;
        clearTimer();
        timerRef.current = window.setInterval(() => {
          if (isPausedRef.current) return;
          sec -= 1;
          setCountdownRemaining(sec);
          countdownRemainingRef.current = sec;
          if (sec <= 0) {
            clearTimer();
            setStage('playing_script');
            playSpeechLine('Now listen carefully and answer questions.', 'narrator', () => {
              if (!isPausedRef.current) playNextTurn(0);
            });
          }
        }, 1000);
      },
    );
  }, [partNumber, playSpeechLine, playNextTurn]);

  const handleTogglePlay = () => {
    // In timed mode, track can only be played once!
    if (timed && hasPlayedInTimedMode) {
      return;
    }

    if (isPlaying) {
      // Pause
      isPausedRef.current = true;
      clearTimer();
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current = null;
      }
      if (synthRef.current) synthRef.current.cancel();
      setIsPlaying(false);
      onPlayStateChange?.(false);
      return;
    }

    // Play / Resume
    isPausedRef.current = false;
    setIsPlaying(true);
    onPlayStateChange?.(true);

    if (timed) {
      setHasPlayedInTimedMode(true);
    }

    const currentStage = stageRef.current;
    if (currentStage === 'idle' || currentStage === 'finished') {
      setCurrentLineIndex(0);
      currentLineIndexRef.current = 0;
      startCountdownIntro(30);
    } else if (currentStage === 'countdown_intro') {
      // Resume intro countdown
      let sec = Math.max(1, countdownRemainingRef.current);
      clearTimer();
      timerRef.current = window.setInterval(() => {
        if (isPausedRef.current) return;
        sec -= 1;
        setCountdownRemaining(sec);
        countdownRemainingRef.current = sec;
        if (sec <= 0) {
          clearTimer();
          setStage('playing_script');
          playSpeechLine('Now listen carefully and answer questions.', 'narrator', () => {
            if (!isPausedRef.current) playNextTurn(currentLineIndexRef.current);
          });
        }
      }, 1000);
    } else if (currentStage === 'countdown_review') {
      // Resume review countdown
      let sec = Math.max(1, countdownRemainingRef.current);
      clearTimer();
      timerRef.current = window.setInterval(() => {
        if (isPausedRef.current) return;
        sec -= 1;
        setCountdownRemaining(sec);
        countdownRemainingRef.current = sec;
        if (sec <= 0) {
          clearTimer();
          setStage('finished');
          setIsPlaying(false);
          onPlayStateChange?.(false);
        }
      }, 1000);
    } else if (currentStage === 'playing_script') {
      // Resume script turn
      playNextTurn(currentLineIndexRef.current);
    }
  };

  const handleSkipCountdown = () => {
    clearTimer();
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current = null;
    }
    if (synthRef.current) synthRef.current.cancel();
    setStage('playing_script');
    stageRef.current = 'playing_script';
    playSpeechLine('Now listen carefully and answer questions.', 'narrator', () => {
      if (!isPausedRef.current) playNextTurn(currentLineIndexRef.current);
    });
  };

  const handleDownloadModel = async () => {
    try {
      await downloadAudioModelOnce();
      setModelCached(true);
    } catch {
      // handled via event listener
    }
  };

  const currentWomanVoice = voiceDisplayName(voiceForPart(activeVoiceMap, partNumber, 'woman'));
  const currentManVoice = voiceDisplayName(voiceForPart(activeVoiceMap, partNumber, 'man'));

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid #cbd5e1',
        borderRadius: '8px',
        padding: '14px 18px',
        marginBottom: '16px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        {/* Play / Pause / Replay Primary Action */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <Button
            variant={isPlaying ? 'secondary' : timed && hasPlayedInTimedMode && stage === 'finished' ? 'ghost' : 'primary'}
            size="md"
            disabled={timed && hasPlayedInTimedMode && stage === 'finished'}
            onClick={handleTogglePlay}
            title={
              timed && hasPlayedInTimedMode && stage === 'finished'
                ? 'Exam Condition: Recording is played once only in timed mode'
                : isPlaying
                  ? 'Pause audio'
                  : 'Start listening audio track'
            }
          >
            {timed && hasPlayedInTimedMode && stage === 'finished'
              ? '✓ Track Completed (Played 1/1)'
              : isPlaying
                ? '⏸ Pause Audio'
                : stage === 'finished' && !timed
                  ? '↺ Replay Audio'
                  : '▶ Start Listening Track'}
          </Button>

          {/* Voices Pill with Randomize Action */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              padding: '4px 8px',
              fontSize: '11px',
              color: '#334155',
            }}
          >
            <span style={{ fontWeight: 600, color: '#0f172a' }}>🎙️ Voices:</span>
            <span>👩 {currentWomanVoice} · 👨 {currentManVoice}</span>
            <button
              type="button"
              onClick={handleRandomizeVoices}
              style={{
                marginLeft: '4px',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '4px',
                padding: '2px 6px',
                fontSize: '10px',
                fontWeight: 700,
                color: '#2563eb',
                cursor: 'pointer',
              }}
              title="Randomize speakers for natural accent variation"
            >
              🔀 Randomize
            </button>
          </div>

          {/* Speed Presets (Only in untimed practice mode) */}
          {!timed && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
                backgroundColor: '#f1f5f9',
                padding: '2px',
                borderRadius: '6px',
                border: '1px solid #e2e8f0',
              }}
              aria-label="Audio playback speed"
            >
              {[0.85, 1.0, 1.15].map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => setSpeechRate(rate)}
                  style={{
                    background: speechRate === rate ? '#0f172a' : 'transparent',
                    color: speechRate === rate ? '#ffffff' : '#64748b',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '3px 8px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                  title={`Play at ${rate}x speed`}
                >
                  {rate}x
                </button>
              ))}
            </div>
          )}

          {/* Live Audio Status */}
          {isPlaying && (
            <span
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#2563eb',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#2563eb',
                  display: 'inline-block',
                  animation: 'pulse 1.5s infinite',
                }}
              />
              {stage === 'countdown_intro'
                ? `Preparation: ${countdownRemaining}s`
                : stage === 'countdown_review'
                  ? `Check answers: ${countdownRemaining}s`
                  : `Playing Audio (${currentLineIndex + 1}/${script.length})`}
            </span>
          )}
        </div>

        {/* Informational Tooltip / Popover Toggle (Hides technical clutter behind hover icon) */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {timed && (
            <span
              style={{
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
                backgroundColor: '#fef3c7',
                color: '#92400e',
              }}
              title="Official IELTS rule: Audio track plays once only"
            >
              Plays Once (Timed)
            </span>
          )}

          <button
            type="button"
            aria-label="Audio player information and neural voice status"
            onClick={() => setShowInfoPopover(!showInfoPopover)}
            onMouseEnter={() => setShowInfoPopover(true)}
            onMouseLeave={() => setShowInfoPopover(false)}
            style={{
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              border: '1px solid #cbd5e1',
              backgroundColor: '#f8fafc',
              color: '#64748b',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ℹ
          </button>

          {/* Hover / Click Info Popover */}
          {showInfoPopover && (
            <div
              style={{
                position: 'absolute',
                top: '32px',
                right: 0,
                width: '280px',
                padding: '12px',
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                fontSize: '11px',
                color: '#334155',
                zIndex: 50,
                lineHeight: 1.4,
              }}
            >
              <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                Audio System Information
              </div>
              <div>
                • Model: Kokoro-82M (FP32 Full-Precision) via ONNX WebAssembly.
              </div>
              <div style={{ marginTop: '4px' }}>
                • Neural TTS Cache: {modelCached ? '✓ Cached offline in browser storage.' : 'Ready on-demand / Web Speech fallback.'}
              </div>
              {!modelCached && (
                <div style={{ marginTop: '8px' }}>
                  {downloadProgress?.status === 'downloading' ? (
                    <div>Downloading Neural TTS (FP32): {downloadProgress.progress}%</div>
                  ) : (
                    <Button variant="outline" size="sm" onClick={handleDownloadModel}>
                      Pre-cache Neural TTS FP32
                    </Button>
                  )}
                </div>
              )}
              {timed && (
                <div style={{ marginTop: '6px', color: '#92400e', fontWeight: 600 }}>
                  • Timed Mock Condition: In genuine Cambridge testing, the recording is heard once only.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Live Dialogue Speaker Pill */}
      {isPlaying && currentSpeakerInfo && stage === 'playing_script' && (
        <div
          style={{
            marginTop: '10px',
            padding: '6px 12px',
            backgroundColor: '#f0fdf4',
            borderRadius: '6px',
            border: '1px solid #bbf7d0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: '#166534',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#22c55e', display: 'inline-block' }} />
            <strong>Speaking:</strong> {currentSpeakerInfo.label} · Voice: <strong>{currentSpeakerInfo.voiceName}</strong>
          </div>
          <span style={{ fontSize: '10px', color: '#15803d', fontWeight: 600 }}>
            {modelCached ? '✨ Kokoro FP32 High-Quality Audio' : 'Speech Engine Active'}
          </span>
        </div>
      )}

      {/* Intro Preparation Countdown Banner (Minimal, quiet, and easily skippable) */}
      {stage === 'countdown_intro' && isPlaying && (
        <div
          style={{
            marginTop: '10px',
            padding: '8px 12px',
            backgroundColor: '#eff6ff',
            borderRadius: '6px',
            border: '1px solid #bfdbfe',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#1e40af' }}>
            <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>⏱ {countdownRemaining}s</span>
            <span>Preparation time: Read questions 1 to {Math.min(5, script.length)}.</span>
          </div>
          <button
            type="button"
            onClick={handleSkipCountdown}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#2563eb',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Skip countdown ⏭
          </button>
        </div>
      )}
    </div>
  );
}
