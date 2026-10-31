import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { SpeakingPart, SpeakingMode, Recording } from '../lib/types.ts';
import {
  isAudioRecordingSupported,
  getMicrophoneStream,
  createAudioLevelMeter,
  startVoiceRecording,
  saveSpeakingAudioBlob,
  startLiveSpeechRecognition,
  speakExaminerQuestion,
} from '../lib/speaking-recorder.ts';
import {
  getExaminerForAttempt,
  getRandomExaminerGreeting,
  filterAndPreparePart1Questions,
  cleanSpeakingQuestion,
} from '../lib/examiners.ts';
import { Button } from './ui/button.tsx';

interface SpeakingSectionProps {
  attemptId: string;
  speakingParts: SpeakingPart[];
  initialMode?: 'timed' | 'untimed';
  initialNotes?: string[];
  onSaveAnswers: (transcripts: string[], recordings: Record<string, Recording>) => void;
  onFinish: () => void;
  onExit?: () => void;
}

type Step =
  | 'overview'
  | 'mic-check'
  | 'intro'
  | 'part1'
  | 'part2-intro'
  | 'part2-prep'
  | 'part2-speak'
  | 'part2-roundoff'
  | 'part3-intro'
  | 'part3'
  | 'finished';

export function SpeakingSection({
  attemptId,
  speakingParts,
  initialMode = 'untimed',
  initialNotes = [],
  onSaveAnswers,
  onFinish,
  onExit,
}: SpeakingSectionProps) {
  // Mode is predetermined by the attempt mode picked at test generation
  const mode: SpeakingMode = initialMode === 'timed' ? 'exam' : 'practice';
  const [step, setStep] = useState<Step>('overview');

  // Media & stream state
  const streamRef = useRef<MediaStream | null>(null);
  const [micLevel, setMicLevel] = useState<number>(0);
  const [micReady, setMicReady] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  // Test recording for mic-check
  const [testRecordingBlob, setTestRecordingBlob] = useState<Blob | null>(null);
  const [isTestRecording, setIsTestRecording] = useState(false);
  const [testCountdown, setTestCountdown] = useState<number>(3);

  // Active recording controller
  const recorderRef = useRef<ReturnType<typeof startVoiceRecording> | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isExaminerSpeaking, setIsExaminerSpeaking] = useState(false);
  const examinerSpeechCancelRef = useRef<(() => void) | null>(null);

  // Current indices
  const [part1Index, setPart1Index] = useState(0);
  const [part2RoundoffIndex, setPart2RoundoffIndex] = useState(0);
  const [part3Index, setPart3Index] = useState(0);

  // Repeats used (in exam mode max 1 allowed)
  const [repeatsUsed, setRepeatsUsed] = useState<Record<string, number>>({});

  // Answers, Transcripts, and Notes
  const [transcriptsByQuestion, setTranscriptsByQuestion] = useState<Record<string, string>>({});
  const [liveTranscript, setLiveTranscript] = useState('');
  const [speechRecognitionError, setSpeechRecognitionError] = useState<string | null>(null);
  const [currentQuestionKey, setCurrentQuestionKey] = useState<string>('');
  const [savedCurrentAudioDuration, setSavedCurrentAudioDuration] = useState<number | null>(null);
  const recognitionRef = useRef<ReturnType<typeof startLiveSpeechRecognition> | null>(null);

  // Part 2 Prep & Notes
  const [prepNotes, setPrepNotes] = useState(initialNotes[0] || '');
  const [prepSecondsLeft, setPrepSecondsLeft] = useState(60);
  const [speakingElapsedS, setSpeakingElapsedS] = useState(0);
  const [questionElapsedS, setQuestionElapsedS] = useState(0);

  // Summary of recorded answers
  const recordingsMapRef = useRef<Record<string, Recording>>({});
  const allTranscriptsListRef = useRef<string[]>([]);

  // Parse Speaking parts
  const part1Data = speakingParts.find((p) => p.part === 1) || {
    part: 1,
    prompt: "Let's talk about where you live or what you do.",
    questions: [
      'Do you work or are you a student?',
      'What do you enjoy most about your work or studies?',
      'Where is your hometown located?',
      'What do you like most about living there?',
    ],
  };

  const part2Data = speakingParts.find((p) => p.part === 2) || {
    part: 2,
    prompt: 'Describe a memorable journey you took by public transport.',
    cue: [
      'Where you went',
      'What kind of transport you used',
      'Who was with you',
      'And explain why this journey was memorable to you',
    ],
    questions: ['Do you still make this journey?', 'Would you recommend this transport to others?'],
  };

  const part3Data = speakingParts.find((p) => p.part === 3) || {
    part: 3,
    prompt: "We've been talking about travel and transport, and now I'd like to discuss broader transportation issues.",
    questions: [
      'How has public transport changed in your country over recent decades?',
      'Do you think governments should invest more in trains rather than building more roads?',
      'What environmental problems are caused by the increase in private car ownership?',
      'How might technology change the way people commute in the future?',
    ],
  };

  // Examiner Profile (randomized by attempt seed, matching authentic Cambridge Examiners)
  const examiner = useMemo(() => getExaminerForAttempt(attemptId), [attemptId]);
  const [examinerGreeting] = useState(() => getRandomExaminerGreeting(examiner, attemptId));

  // Filtered and de-duplicated Part 1 questions (never repeating candidate identity or warmup)
  const filteredPart1Questions = useMemo(() => {
    return filterAndPreparePart1Questions(part1Data.questions || []);
  }, [part1Data.questions]);

  // Clean prompt text removing "Examiner:" prefixes and notes
  const cleanText = (t: string) => cleanSpeakingQuestion(t);

  // Stop any active examiner speech
  const stopExaminerAudio = useCallback(() => {
    if (examinerSpeechCancelRef.current) {
      examinerSpeechCancelRef.current();
      examinerSpeechCancelRef.current = null;
    }
    setIsExaminerSpeaking(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopExaminerAudio();
      if (recorderRef.current) recorderRef.current.cancel();
      if (recognitionRef.current) recognitionRef.current.stop();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((tr) => tr.stop());
      }
    };
  }, [stopExaminerAudio]);

  // Request mic on step === 'mic-check'
  const initMic = async () => {
    setMicError(null);
    try {
      if (!isAudioRecordingSupported()) {
        throw new Error('Your browser does not support audio recording. Please use modern Chrome, Safari, or Edge.');
      }
      const stream = await getMicrophoneStream();
      streamRef.current = stream;
      setMicReady(true);

      // Meter for mic check
      createAudioLevelMeter(stream, (lvl) => {
        setMicLevel(lvl);
      });
    } catch (e) {
      setMicError((e as Error).message || 'Could not access your microphone.');
    }
  };

  // Perform 3-second test recording in mic check
  const startTestRecord = () => {
    if (!streamRef.current) return;
    setIsTestRecording(true);
    setTestRecordingBlob(null);
    setTestCountdown(3);

    const rec = startVoiceRecording(streamRef.current, {
      maxDurationS: 3.2,
      onVolume: (lvl) => setMicLevel(lvl),
      onAutoStop: () => {
        void rec.stop('timer').then(({ blob }) => {
          setIsTestRecording(false);
          setTestRecordingBlob(blob);
        });
      },
    });

    const interval = setInterval(() => {
      setTestCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Playback test recording
  const playTestClip = () => {
    if (!testRecordingBlob) return;
    const url = URL.createObjectURL(testRecordingBlob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    audio.play();
  };

  // Speak a question and then start recording candidate answer
  const playQuestionAndListen = useCallback(
    async (text: string, questionKey: string, onSpeechDone?: () => void) => {
      stopExaminerAudio();
      if (recorderRef.current) recorderRef.current.cancel();
      if (recognitionRef.current) recognitionRef.current.stop();

      setIsExaminerSpeaking(true);
      setIsRecording(false);
      setLiveTranscript('');
      setQuestionElapsedS(0);
      setCurrentQuestionKey(questionKey);
      setSavedCurrentAudioDuration(null);
      setSpeechRecognitionError(null);

      const controller = await speakExaminerQuestion(
        text,
        () => setIsExaminerSpeaking(true),
        () => {
          setIsExaminerSpeaking(false);
          // 0.5s pause before learner speaks per spec §6.7
          setTimeout(() => {
            startLearnerRecording(questionKey, onSpeechDone);
          }, 500);
        },
        examiner.voiceId,
      );

      examinerSpeechCancelRef.current = controller.cancel;
    },
    [stopExaminerAudio, examiner.voiceId],
  );

  // Start recording the candidate's answer
  const startLearnerRecording = (questionKey: string, onAutoAdvance?: () => void) => {
    if (!streamRef.current) return;
    setIsRecording(true);
    setQuestionElapsedS(0);
    setCurrentQuestionKey(questionKey);
    setSavedCurrentAudioDuration(null);

    // Live speech recognition for transcript
    const recognizer = startLiveSpeechRecognition(
      (text, isFinal) => {
        setLiveTranscript(text);
        if (isFinal) {
          setTranscriptsByQuestion((prev) => ({ ...prev, [questionKey]: text }));
        }
      },
      (err) => {
        setSpeechRecognitionError(err);
      },
    );
    recognitionRef.current = recognizer;

    // MediaRecorder
    const rec = startVoiceRecording(streamRef.current, {
      maxDurationS: mode === 'exam' ? (step === 'part1' ? 45 : 75) : 180,
      vadSilenceThresholdS: mode === 'exam' ? (step === 'part1' ? 3 : 4) : undefined,
      vadMinSpeechS: 3,
      onVolume: (lvl) => setMicLevel(lvl),
      onAutoStop: (reason) => {
        void rec.stop(reason).then(async ({ blob, durationS }) => {
          setIsRecording(false);
          if (recognizer) recognizer.stop();

          // Save clip in IndexedDB
          await saveSpeakingAudioBlob(attemptId, 1, questionKey, 1, blob);
          recordingsMapRef.current[questionKey] = {
            key: `speaking_${questionKey}`,
            duration: durationS,
            createdAt: Date.now(),
          };
          setSavedCurrentAudioDuration(durationS);

          if (onAutoAdvance) {
            onAutoAdvance();
          }
        });
      },
    });

    recorderRef.current = rec;
  };

  // Stop recording and save answer
  const stopLearnerRecording = async (questionKey: string): Promise<{ transcript: string; duration: number }> => {
    setIsRecording(false);
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    if (recorderRef.current) {
      const { blob, durationS } = await recorderRef.current.stop('learner_next');
      recorderRef.current = null;

      await saveSpeakingAudioBlob(attemptId, 1, questionKey, 1, blob);
      recordingsMapRef.current[questionKey] = {
        key: `speaking_${questionKey}`,
        duration: durationS,
        createdAt: Date.now(),
      };

      const finalTxt = liveTranscript.trim() || transcriptsByQuestion[questionKey] || '';
      setTranscriptsByQuestion((prev) => ({ ...prev, [questionKey]: finalTxt }));
      setSavedCurrentAudioDuration(durationS);
      return { transcript: finalTxt, duration: durationS };
    }

    return { transcript: liveTranscript, duration: savedCurrentAudioDuration || 0 };
  };

  // Explicitly finish speaking & stop recording early for the current question
  const handleStopRecordingCurrent = async () => {
    if (!currentQuestionKey || !isRecording) return;
    await stopLearnerRecording(currentQuestionKey);
  };

  // Timer for question elapsed
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (isRecording) {
      timer = setInterval(() => {
        setQuestionElapsedS((s) => s + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isRecording]);

  // Repeat question ("Could you repeat that?")
  const handleRepeatQuestion = (text: string, questionKey: string) => {
    if (mode === 'exam' && (repeatsUsed[questionKey] || 0) >= 1) return;
    setRepeatsUsed((prev) => ({ ...prev, [questionKey]: (prev[questionKey] || 0) + 1 }));
    void playQuestionAndListen(text, questionKey);
  };

  // ─── STEP PROGRESSION ───

  // Intro Step
  const startIntro = () => {
    setStep('intro');
    void playQuestionAndListen(examinerGreeting, 'intro');
  };

  // Part 1 Step
  const startPart1 = () => {
    setStep('part1');
    setPart1Index(0);
    const q1 = filteredPart1Questions[0] || 'Do you work or are you a student?';
    const text = `Thank you, that's fine. Now, in this first part, I'd like to ask you some questions about yourself. ${cleanText(q1)}`;
    void playQuestionAndListen(text, `p1_q0`);
  };

  const advancePart1 = async () => {
    const qKey = `p1_q${part1Index}`;
    const { transcript } = await stopLearnerRecording(qKey);
    if (transcript) allTranscriptsListRef.current.push(transcript);

    const nextIdx = part1Index + 1;
    if (nextIdx < filteredPart1Questions.length) {
      setPart1Index(nextIdx);
      const text = cleanText(filteredPart1Questions[nextIdx]!);
      void playQuestionAndListen(text, `p1_q${nextIdx}`);
    } else {
      // Transition to Part 2 Intro
      setStep('part2-intro');
      stopExaminerAudio();
      const p2Intro =
        "Now, I am going to give you a topic, and I'd like you to talk about it for one to two minutes. Before you talk, you'll have one minute to think about what you are going to say. You can make some notes if you wish. Here is your cue card.";
      void playQuestionAndListen(p2Intro, 'p2_intro', () => {
        startPart2Prep();
      });
    }
  };

  // Part 2 Prep Countdown
  const startPart2Prep = () => {
    stopExaminerAudio();
    setStep('part2-prep');
    setPrepSecondsLeft(60);
  };

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (step === 'part2-prep') {
      timer = setInterval(() => {
        setPrepSecondsLeft((sec) => {
          if (sec <= 1) {
            clearInterval(timer!);
            startPart2Speaking();
            return 0;
          }
          return sec - 1;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [step]);

  // Part 2 Speaking (2 minutes)
  const startPart2Speaking = () => {
    setStep('part2-speak');
    setSpeakingElapsedS(0);
    const cueSpeech = "All right. Remember, you have one to two minutes for this, so don't worry if I stop you. Please start speaking now.";
    void playQuestionAndListen(cueSpeech, 'p2_speech');
  };

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (step === 'part2-speak' && isRecording) {
      timer = setInterval(() => {
        setSpeakingElapsedS((s) => {
          // Exam mode auto-stop at 2:00 (120 s)
          if (mode === 'exam' && s >= 120) {
            clearInterval(timer!);
            finishPart2Speaking();
            return 120;
          }
          return s + 1;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [step, isRecording, mode]);

  const finishPart2Speaking = async () => {
    const { transcript } = await stopLearnerRecording('p2_speech');
    if (transcript) allTranscriptsListRef.current.push(transcript);

    // Check round-off questions
    const roundOff = part2Data.questions || [];
    if (roundOff.length > 0) {
      setStep('part2-roundoff');
      setPart2RoundoffIndex(0);
      const text = cleanText(roundOff[0]!);
      void playQuestionAndListen(text, 'p2_roundoff_0');
    } else {
      startPart3Intro();
    }
  };

  const advancePart2Roundoff = async () => {
    const qKey = `p2_roundoff_${part2RoundoffIndex}`;
    const { transcript } = await stopLearnerRecording(qKey);
    if (transcript) allTranscriptsListRef.current.push(transcript);

    const nextIdx = part2RoundoffIndex + 1;
    const roundOff = part2Data.questions || [];
    if (nextIdx < roundOff.length) {
      setPart2RoundoffIndex(nextIdx);
      const text = cleanText(roundOff[nextIdx]!);
      void playQuestionAndListen(text, `p2_roundoff_${nextIdx}`);
    } else {
      startPart3Intro();
    }
  };

  // Part 3 Intro & Questions
  const startPart3Intro = () => {
    setStep('part3-intro');
    stopExaminerAudio();
    const p3Intro =
      cleanText(part3Data.prompt) ||
      "We've been talking about this topic, and now I'd like to discuss one or two more general questions related to this.";
    void playQuestionAndListen(p3Intro, 'p3_intro', () => {
      startPart3();
    });
  };

  const startPart3 = () => {
    setStep('part3');
    setPart3Index(0);
    const q1 = part3Data.questions?.[0] || 'How has technology changed this area in recent years?';
    const text = cleanText(q1);
    void playQuestionAndListen(text, 'p3_q0');
  };

  const advancePart3 = async () => {
    const qKey = `p3_q${part3Index}`;
    const { transcript } = await stopLearnerRecording(qKey);
    if (transcript) allTranscriptsListRef.current.push(transcript);

    const nextIdx = part3Index + 1;
    const questions = part3Data.questions || [];
    if (nextIdx < questions.length) {
      setPart3Index(nextIdx);
      const text = cleanText(questions[nextIdx]!);
      void playQuestionAndListen(text, `p3_q${nextIdx}`);
    } else {
      completeInterview();
    }
  };

  // Final Completion & Saving
  const completeInterview = () => {
    setStep('finished');
    stopExaminerAudio();
    if (recorderRef.current) recorderRef.current.cancel();

    // Consolidate transcripts per Part
    // Part 1
    const p1Answers = (part1Data.questions || [])
      .map((_, i) => transcriptsByQuestion[`p1_q${i}`] || '')
      .filter(Boolean)
      .join(' ');
    // Part 2
    const p2Answer = transcriptsByQuestion['p2_speech'] || '';
    // Part 3
    const p3Answers = (part3Data.questions || [])
      .map((_, i) => transcriptsByQuestion[`p3_q${i}`] || '')
      .filter(Boolean)
      .join(' ');

    const finalTranscripts = [p1Answers, p2Answer, p3Answers];

    onSaveAnswers(finalTranscripts, recordingsMapRef.current);
  };

  // Format MM:SS
  const fmtTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        maxWidth: 960,
        margin: '0 auto',
        padding: '24px 20px',
        boxSizing: 'border-box',
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* ─── SCREEN 1: SPEAKING TEST OVERVIEW & START ─── */}
      {step === 'overview' && (
        <section
          aria-labelledby="speaking-overview-title"
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 16,
            padding: '32px 36px',
            boxShadow: '0 2px 8px rgba(15, 23, 42, 0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: '#eff6ff',
                color: '#2563eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.6rem',
                flexShrink: 0,
                border: '1px solid #bfdbfe',
              }}
            >
              🗣️
            </div>
            <div>
              <h2 id="speaking-overview-title" style={{ margin: 0, fontSize: '1.45rem', fontWeight: 800, color: '#0f172a' }}>
                IELTS Speaking Interview
              </h2>
              <p style={{ margin: '3px 0 0', fontSize: '0.9rem', color: '#64748b' }}>
                11 to 14 minutes · 3-Part authentic 1-on-1 interview with examiner audio simulation.
              </p>
            </div>
          </div>

          {/* Test Mode Card (Inherited automatically from test generation settings) */}
          <div
            style={{
              background: mode === 'exam' ? '#eff6ff' : '#f0fdf4',
              border: `1px solid ${mode === 'exam' ? '#bfdbfe' : '#bbf7d0'}`,
              borderRadius: 12,
              padding: '16px 20px',
              marginBottom: 18,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '1.1rem' }}>{mode === 'exam' ? '⏱' : '∞'}</span>
                <strong style={{ fontSize: '1rem', color: mode === 'exam' ? '#1e40af' : '#166534' }}>
                  {mode === 'exam' ? 'Official Exam Simulation Mode' : 'Self-Paced Practice Mode (Untimed)'}
                </strong>
              </div>
              <span
                style={{
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  padding: '2px 10px',
                  borderRadius: 9999,
                  backgroundColor: mode === 'exam' ? '#dbeafe' : '#dcfce7',
                  color: mode === 'exam' ? '#1e40af' : '#166534',
                  border: `1px solid ${mode === 'exam' ? '#bfdbfe' : '#bbf7d0'}`,
                }}
              >
                Active Test Mode
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '0.84rem', color: mode === 'exam' ? '#1e3a8a' : '#14532d', lineHeight: 1.5 }}>
              {mode === 'exam'
                ? 'Authentic Cambridge examination conditions: Audio-only questions (prompts hidden during playback), single take, strict 60s Part 2 preparation with 2:00 auto-stop, and official Cambridge rubric scoring.'
                : 'Learning & rehearsal mode: Prompt text is visible, replay questions anytime, unlimited retakes, live transcript previews, and notepad available throughout all parts.'}
            </p>
          </div>

          {/* Assigned Examiner Card */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              padding: '16px 20px',
              marginBottom: 18,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: '#2563eb',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.25rem',
                flexShrink: 0,
              }}
            >
              👤
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '0.98rem', color: '#0f172a' }}>{examiner.name}</strong>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 9999,
                    backgroundColor: '#e2e8f0',
                    color: '#334155',
                  }}
                >
                  {examiner.title}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  • {examiner.accent} Accent (Local Neural Voice)
                </span>
              </div>
              <p style={{ margin: '3px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
                Your interviewer will guide you through Part 1 (Introduction), Part 2 (Long Turn), and Part 3 (Two-way Discussion).
              </p>
            </div>
          </div>

          {/* Test Checklist */}
          <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 20px', marginBottom: 24 }}>
            <strong style={{ fontSize: '0.85rem', color: '#334155', display: 'block', marginBottom: 8 }}>
              🎧 Before You Begin Checklist:
            </strong>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.82rem', color: '#64748b', lineHeight: 1.6 }}>
              <li>Find a quiet environment without background talking or loud fans.</li>
              <li>Headphones or a headset are recommended to prevent microphone echo.</li>
              <li>Clicking <strong>Start Speaking Test</strong> will check your microphone before the examiner begins speaking.</li>
            </ul>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            {onExit && (
              <Button variant="outline" size="md" onClick={onExit}>
                Exit Section
              </Button>
            )}
            <Button
              variant="primary"
              size="lg"
              icon="🎙️"
              onClick={() => {
                setStep('mic-check');
                void initMic();
              }}
            >
              Start Speaking Test →
            </Button>
          </div>
        </section>
      )}

      {/* ─── SCREEN 2: MIC CHECK ─── */}
      {step === 'mic-check' && (
        <section
          aria-labelledby="mic-check-title"
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 16,
            padding: '32px 36px',
            boxShadow: '0 2px 8px rgba(15, 23, 42, 0.05)',
          }}
        >
          <h2 id="mic-check-title" style={{ margin: '0 0 6px', fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>
            Microphone Check &amp; Sound Test
          </h2>
          <p style={{ margin: '0 0 24px', fontSize: '0.88rem', color: '#64748b' }}>
            Verify that your microphone captures clear voice audio before starting the interview.
          </p>

          {micError ? (
            <div role="alert" style={{ background: '#fff1f2', border: '1px solid #fecdd3', color: '#be123c', padding: 16, borderRadius: 10, marginBottom: 20 }}>
              <strong>⚠️ Microphone access required:</strong>
              <p style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>{micError}</p>
              <div style={{ marginTop: 12 }}>
                <Button variant="danger" size="sm" onClick={() => void initMic()}>
                  Retry Microphone Access
                </Button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 28 }}>
              {/* Live Volume Meter Bar */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: 6 }}>
                  <span>Live Input Signal:</span>
                  <span>{micLevel > 15 ? '🟢 Voice Detected' : '⚪ Speak to test level'}</span>
                </div>
                <div style={{ width: '100%', height: 16, background: '#f1f5f9', borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${micLevel}%`,
                      background: micLevel > 60 ? '#2563eb' : '#059669',
                      transition: 'width 0.08s ease-out',
                    }}
                  />
                </div>
              </div>

              {/* 3-Second Test Clip */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '18px 20px' }}>
                <strong style={{ fontSize: '0.9rem', color: '#0f172a', display: 'block', marginBottom: 6 }}>
                  Quick 3-Second Test Clip:
                </strong>
                <p style={{ margin: '0 0 14px', fontSize: '0.82rem', color: '#64748b' }}>
                  Record a 3-second sample (e.g., &ldquo;Testing one two three&rdquo;) to verify audio playback.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <Button
                    variant={isTestRecording ? 'danger' : 'primary'}
                    size="md"
                    icon={isTestRecording ? '⏹' : '🎙️'}
                    onClick={startTestRecord}
                    disabled={isTestRecording}
                  >
                    {isTestRecording ? `Recording... (${testCountdown}s)` : 'Record 3s Test Sample'}
                  </Button>

                  {testRecordingBlob && (
                    <Button variant="secondary" size="md" icon="▶" onClick={playTestClip}>
                      Play Back My Voice
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
            <Button variant="outline" size="sm" onClick={() => setStep('overview')}>
              ← Back to Overview
            </Button>
            <Button
              variant="success"
              size="lg"
              icon="✓"
              disabled={!micReady}
              onClick={startIntro}
            >
              Begin Interview with Examiner →
            </Button>
          </div>
        </section>
      )}

      {/* ─── ACTIVE INTERVIEW STAGES (INTRO, PART 1, PART 2, PART 3) ─── */}
      {step !== 'overview' && step !== 'mic-check' && step !== 'finished' && (
        <section
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 16,
            padding: '24px 28px',
            boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
            overflowY: 'auto',
          }}
        >
          {/* Header Status Bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
              paddingBottom: 16,
              borderBottom: '1px solid #f1f5f9',
              marginBottom: 20,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: 9999,
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  background: mode === 'exam' ? '#eff6ff' : '#f0fdf4',
                  color: mode === 'exam' ? '#1d4ed8' : '#15803d',
                  border: `1px solid ${mode === 'exam' ? '#bfdbfe' : '#bbf7d0'}`,
                }}
              >
                {mode === 'exam' ? '⏱ Exam Simulation' : '∞ Practice Mode'}
              </span>
              <strong style={{ fontSize: '1.05rem', color: '#0f172a' }}>
                {step === 'intro'
                  ? 'Introduction & ID Check'
                  : step === 'part1'
                    ? `Part 1: Questions (${part1Index + 1} of ${part1Data.questions?.length || 4})`
                    : step === 'part2-prep'
                      ? 'Part 2: 1-Minute Preparation'
                      : step === 'part2-speak'
                        ? 'Part 2: 1-2 Minute Individual Long Turn'
                        : step === 'part2-roundoff'
                          ? 'Part 2: Rounding-Off Questions'
                          : step === 'part3-intro' || step === 'part3'
                            ? `Part 3: Discussion (${part3Index + 1} of ${part3Data.questions?.length || 4})`
                            : 'Speaking Interview'}
              </strong>
            </div>

            {/* Speaking Level Meter & Timers */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {/* Volume Indicator */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>Mic:</span>
                <div style={{ width: 44, height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${micLevel}%`, background: '#059669', transition: 'width 0.08s ease' }} />
                </div>
              </div>

              {/* Timer Pill */}
              <span
                style={{
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  color: isRecording ? '#be123c' : '#475569',
                  background: isRecording ? '#fff1f2' : '#f1f5f9',
                  padding: '3px 10px',
                  borderRadius: 6,
                }}
              >
                {step === 'part2-prep'
                  ? `Prep: ${fmtTime(prepSecondsLeft)}`
                  : step === 'part2-speak'
                    ? `Speaking: ${fmtTime(speakingElapsedS)}`
                    : `Time: ${fmtTime(questionElapsedS)}`}
              </span>
            </div>
          </div>

          {/* Examiner Avatar & Speech Status Line */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              background: isExaminerSpeaking ? '#eff6ff' : isRecording ? '#f0fdf4' : '#f8fafc',
              border: '1px solid',
              borderColor: isExaminerSpeaking ? '#bfdbfe' : isRecording ? '#bbf7d0' : '#e2e8f0',
              borderRadius: 12,
              padding: '16px 20px',
              marginBottom: 20,
              transition: 'all 0.2s ease',
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: isExaminerSpeaking ? '#2563eb' : isRecording ? '#059669' : '#64748b',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.25rem',
                flexShrink: 0,
                boxShadow: isRecording ? '0 0 0 4px rgba(5, 150, 105, 0.2)' : 'none',
              }}
            >
              {isExaminerSpeaking ? '🗣️' : isRecording ? '🎙️' : '👤'}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: isExaminerSpeaking ? '#1d4ed8' : isRecording ? '#15803d' : '#64748b' }}>
                  {isExaminerSpeaking ? 'Examiner Speaking' : isRecording ? 'Your Turn — Speak Now' : 'Examiner Ready'}
                </span>
                <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>•</span>
                <span style={{ fontSize: '0.72rem', color: '#475569', fontWeight: 600 }}>{examiner.name} ({examiner.title})</span>
              </div>

              {/* In Practice Mode or Part 2: Show question text */}
              {(mode === 'practice' || step === 'part2-prep' || step === 'part2-speak') && (
                <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', marginTop: 4 }}>
                  {step === 'intro'
                    ? examinerGreeting
                    : step === 'part1'
                      ? cleanText(filteredPart1Questions[part1Index] || '')
                      : step === 'part2-prep' || step === 'part2-speak'
                        ? cleanText(part2Data.prompt)
                        : step === 'part2-roundoff'
                          ? cleanText(part2Data.questions?.[part2RoundoffIndex] || '')
                          : step === 'part3'
                            ? cleanText(part3Data.questions?.[part3Index] || '')
                            : 'Please listen to the examiner.'}
                </div>
              )}

              {/* In Exam Mode: Keep question text hidden per spec §3 */}
              {mode === 'exam' && step !== 'part2-prep' && step !== 'part2-speak' && (
                <div style={{ fontSize: '0.88rem', color: '#64748b', fontStyle: 'italic', marginTop: 4 }}>
                  [Exam Mode: Audio Active] Listen carefully to {examiner.name}&apos;s question.
                </div>
              )}
            </div>

            {/* Repeat Audio Button (Allowed anytime in practice, 1 repeat in exam) */}
            <div>
              {mode === 'practice' ? (
                <Button
                  variant="outline"
                  size="sm"
                  icon="↺"
                  onClick={() => {
                    const text =
                      step === 'intro'
                        ? examinerGreeting
                        : step === 'part1'
                          ? cleanText(filteredPart1Questions[part1Index] || '')
                          : step === 'part2-roundoff'
                            ? cleanText(part2Data.questions?.[part2RoundoffIndex] || '')
                            : step === 'part3'
                              ? cleanText(part3Data.questions?.[part3Index] || '')
                              : '';
                    if (text) handleRepeatQuestion(text, `repeat_${Date.now()}`);
                  }}
                >
                  Replay Audio
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  icon="↺"
                  onClick={() => {
                    const qKey =
                      step === 'intro'
                        ? 'intro'
                        : step === 'part1'
                          ? `p1_q${part1Index}`
                          : `p3_q${part3Index}`;
                    const text =
                      step === 'intro'
                        ? examinerGreeting
                        : step === 'part1'
                          ? cleanText(filteredPart1Questions[part1Index] || '')
                          : cleanText(part3Data.questions?.[part3Index] || '');
                    handleRepeatQuestion(text, qKey);
                  }}
                  disabled={
                    (repeatsUsed[
                      step === 'intro'
                        ? 'intro'
                        : step === 'part1'
                          ? `p1_q${part1Index}`
                          : `p3_q${part3Index}`
                    ] || 0) >= 1
                  }
                  title="Official candidate repeat request (1 allowed in exam mode)"
                >
                  Could you repeat that?
                </Button>
              )}
            </div>
          </div>

          {/* ─── PART 2 CUE CARD SPECIAL RENDERING ─── */}
          {(step === 'part2-prep' || step === 'part2-speak') && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 0.8fr)', gap: 18, flex: 1, minHeight: 0, marginBottom: 16 }}>
              {/* Laminated IELTS Cue Card */}
              <div
                style={{
                  background: '#fffdf5',
                  border: '2px solid #cbd5e1',
                  borderRadius: 12,
                  padding: '24px 28px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.06em', marginBottom: 6 }}>
                    Cambridge IELTS Candidate Cue Card
                  </div>
                  <h3 style={{ margin: '0 0 16px', fontSize: '1.2rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.4 }}>
                    {cleanText(part2Data.prompt)}
                  </h3>

                  <strong style={{ fontSize: '0.92rem', color: '#334155', display: 'block', marginBottom: 8 }}>
                    You should say:
                  </strong>
                  <ul style={{ margin: 0, paddingLeft: 22, fontSize: '0.92rem', color: '#1e293b', lineHeight: 1.7 }}>
                    {(part2Data.cue || []).map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>

                <div style={{ paddingTop: 16, borderTop: '1px dashed #cbd5e1', fontSize: '0.85rem', color: '#64748b' }}>
                  ⏱ 1 minute preparation · Speak for 1 to 2 minutes
                </div>
              </div>

              {/* Prep Notes Area */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <label htmlFor="cue-notes" style={{ fontSize: '0.88rem', fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                  {step === 'part2-prep' ? '📝 Scratch Notes (Allowed during 1 min prep):' : '📝 Your Notes (Read-only reference):'}
                </label>
                <textarea
                  id="cue-notes"
                  rows={8}
                  readOnly={step === 'part2-speak' && mode === 'exam'}
                  placeholder="Jot down bullet points, key keywords, or storytelling ideas..."
                  value={prepNotes}
                  onChange={(e) => setPrepNotes(e.target.value)}
                  style={{
                    flex: 1,
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem',
                    lineHeight: 1.5,
                    resize: 'none',
                    boxSizing: 'border-box',
                    backgroundColor: step === 'part2-speak' && mode === 'exam' ? '#f8fafc' : '#ffffff',
                  }}
                />
              </div>
            </div>
          )}

          {/* Practice Mode Live Transcript / Hints Preview */}
          {mode === 'practice' && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isRecording && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#16a34a' }} />}
                  Live Transcript Preview (Practice Mode)
                </span>
                <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Real-time verbatim recognition</span>
              </div>
              {isExaminerSpeaking ? (
                <div style={{ fontSize: '0.88rem', color: '#64748b', fontStyle: 'italic' }}>
                  ⏳ Examiner is speaking... recording will begin automatically when the question finishes.
                </div>
              ) : speechRecognitionError ? (
                <div style={{ fontSize: '0.84rem', color: '#475569', lineHeight: 1.5 }}>
                  <div style={{ color: '#b45309', fontWeight: 600, marginBottom: 2 }}>
                    ℹ️ Real-time speech preview unavailable (
                    {speechRecognitionError === 'unsupported'
                      ? 'Browser does not support SpeechRecognition'
                      : speechRecognitionError === 'network'
                        ? 'Requires network connection to Google Speech API'
                        : speechRecognitionError === 'not-allowed'
                          ? 'Microphone permission blocked for speech recognition'
                          : speechRecognitionError}
                    )
                  </div>
                  <div style={{ color: '#15803d', fontWeight: 500, fontSize: '0.8rem' }}>
                    ✅ Your actual microphone voice audio is still actively recording and will be saved!
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '0.88rem', color: liveTranscript ? '#0f172a' : '#94a3b8', fontStyle: liveTranscript ? 'normal' : 'italic' }}>
                  {liveTranscript || (isRecording ? 'Listening... start speaking and your words will appear here.' : 'Your spoken words will appear here as you speak...')}
                </div>
              )}
            </div>
          )}

          {/* Action Footer Navigation */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingTop: 16,
              borderTop: '1px solid #f1f5f9',
              marginTop: 'auto',
            }}
          >
            <div>
              {onExit && (
                <Button variant="ghost" size="sm" onClick={onExit}>
                  Exit Interview
                </Button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {isRecording && !isExaminerSpeaking && (
                <Button
                  variant="outline"
                  size="md"
                  icon="⏹"
                  onClick={() => void handleStopRecordingCurrent()}
                  title="Finish speaking for this question and save audio to storage"
                >
                  Done Speaking (Stop)
                </Button>
              )}

              {savedCurrentAudioDuration !== null && !isRecording && (
                <span style={{ fontSize: '0.8rem', color: '#16a34a', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span>✅</span> Audio saved ({savedCurrentAudioDuration}s)
                </span>
              )}

              {savedCurrentAudioDuration === null && isRecording && (
                <span style={{ fontSize: '0.78rem', color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: 4 }} title="Clicking Next automatically saves your voice recording">
                  <span>💾</span> Auto-saves on Next
                </span>
              )}

              {step === 'intro' && (
                <Button variant="primary" size="md" icon="→" onClick={startPart1}>
                  Start Part 1 Questions →
                </Button>
              )}

              {step === 'part1' && (
                <Button variant="primary" size="md" icon="→" onClick={advancePart1}>
                  {part1Index + 1 < (part1Data.questions?.length || 4) ? 'Next Question →' : 'Complete Part 1 & Go to Part 2 →'}
                </Button>
              )}

              {step === 'part2-prep' && mode === 'practice' && (
                <Button variant="primary" size="md" icon="▶" onClick={startPart2Speaking}>
                  Start Speaking Now (Skip Prep) →
                </Button>
              )}

              {step === 'part2-speak' && (
                <Button
                  variant={speakingElapsedS < 60 ? 'outline' : 'primary'}
                  size="md"
                  icon="✓"
                  onClick={finishPart2Speaking}
                >
                  {speakingElapsedS < 60 ? 'Finish Long Turn (Under 1 min)' : 'Finish Long Turn →'}
                </Button>
              )}

              {step === 'part2-roundoff' && (
                <Button variant="primary" size="md" icon="→" onClick={advancePart2Roundoff}>
                  {part2RoundoffIndex + 1 < (part2Data.questions?.length || 2) ? 'Next Round-off Question →' : 'Go to Part 3 Discussion →'}
                </Button>
              )}

              {step === 'part3-intro' && (
                <Button variant="primary" size="md" icon="→" onClick={startPart3}>
                  Begin Part 3 Questions →
                </Button>
              )}

              {step === 'part3' && (
                <Button variant="primary" size="md" icon="✓" onClick={advancePart3}>
                  {part3Index + 1 < (part3Data.questions?.length || 4) ? 'Next Discussion Question →' : 'Finish Speaking Test →'}
                </Button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ─── SCREEN 3: FINISHED ─── */}
      {step === 'finished' && (
        <section
          aria-labelledby="finished-title"
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 16,
            padding: '36px 36px',
            textAlign: 'center',
            boxShadow: '0 2px 8px rgba(15, 23, 42, 0.05)',
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🎓</div>
          <h2 id="finished-title" style={{ margin: '0 0 8px', fontSize: '1.5rem', fontWeight: 800, color: '#0f172a' }}>
            Speaking Interview Complete!
          </h2>
          <p style={{ margin: '0 auto 24px', fontSize: '0.92rem', color: '#64748b', maxWidth: 520, lineHeight: 1.5 }}>
            All answers, recordings, and speech timestamps have been stored securely. Your fluency, lexical resource, grammar, and pronunciation analysis have been queued.
          </p>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 14 }}>
            <Button variant="success" size="lg" icon="📊" onClick={onFinish}>
              View Speaking Scores &amp; Review →
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
