/**
 * Voice-First Speech-to-Text and Text-to-Speech Engine with Continuous Interaction.
 * Features an 8-state voice machine, automatic resumption after TTS, loopback immunity,
 * spoken accessibility announcements, and audio earcons.
 */

import { soundService } from './soundService';
import { VoiceState } from '../types';

type SpeechCallback = (text: string, isFinal?: boolean) => void;
type StatusCallback = (status: 'idle' | 'listening' | 'processing' | 'speaking') => void;
type StateCallback = (state: VoiceState, message?: string) => void;

class SpeechService {
  private recognition: any = null;
  private isRecognitionSupported: boolean = false;
  private currentState: VoiceState = 'INITIALIZING';
  private isListening: boolean = false;
  private isSpeaking: boolean = false;
  private isPaused: boolean = false;
  private isAutoListenEnabled: boolean = true;
  private lastSpokenText: string = '';
  private speechRate: number = 1.0;
  private speechPitch: number = 1.0;
  private restartTimeout: NodeJS.Timeout | null = null;
  private isRestarting: boolean = false;

  private onTranscriptCallbacks: SpeechCallback[] = [];
  private onStatusCallbacks: StatusCallback[] = [];
  private onStateCallbacks: StateCallback[] = [];
  private onSpokenCallbacks: ((text: string) => void)[] = [];

  constructor() {
    if (typeof window !== 'undefined') {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        this.isRecognitionSupported = true;
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false; // Turn-based segmenting is most reliable across mobile & desktop browsers
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        // Web Speech API Context Biasing via SpeechGrammarList where supported
        try {
          const SpeechGrammarList =
            (window as any).SpeechGrammarList || (window as any).webkitSpeechGrammarList;
          if (SpeechGrammarList) {
            const vocabulary = [
              'pay',
              'payment',
              'paypal',
              'transfer',
              'send',
              'authorize',
              'approve',
              'confirm',
              'capture',
              'cancel',
              'recipient',
              'amount',
              'balance',
              'budget',
              'transaction',
              'currency',
              'dollars',
              'naira',
              'euros',
              'pounds',
              'cents',
            ];
            const grammar = `#JSGF V1.0; grammar financial; public <financial> = ${vocabulary.join(' | ')} ;`;
            const speechRecognitionList = new SpeechGrammarList();
            speechRecognitionList.addFromString(grammar, 1);
            this.recognition.grammars = speechRecognitionList;
          }
        } catch {
          // Gracefully continue if SpeechGrammarList is unavailable in current engine
        }

        this.recognition.onstart = () => {
          this.isListening = true;
          this.isRestarting = false;
          if (this.currentState !== 'SPEECH_DETECTED') {
            this.setState('LISTENING');
          }
          this.notifyStatus('listening');
        };

        this.recognition.onresult = (event: any) => {
          // Strict loopback protection: Never record assistant's voice
          if (this.isSpeaking) return;

          let interimTranscript = '';
          let finalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript;
            } else {
              interimTranscript += transcript;
            }
          }

          const combined = (finalTranscript || interimTranscript).trim();
          if (combined) {
            if (this.currentState !== 'SPEECH_DETECTED') {
              this.setState('SPEECH_DETECTED');
              soundService.playSpeechDetected();
            }
            this.notifyTranscript(combined, Boolean(finalTranscript));
          }
        };

        this.recognition.onerror = (event: any) => {
          const errorType = event.error;
          console.warn('[A-Eye Pal Speech] Recognition event error:', errorType);
          this.isListening = false;

          if (errorType === 'not-allowed' || errorType === 'service-not-allowed') {
            this.setState('ERROR', 'Microphone access is unavailable. Please enable microphone permission in your browser settings.');
            soundService.playError();
            this.notifyStatus('idle');
            return;
          }

          if (errorType === 'no-speech') {
            // Silence / timeout: do not alert user, cleanly transition back
            this.notifyStatus('idle');
            this.scheduleAutoRestart(300);
            return;
          }

          // Transient network or audio-capture error
          if (this.isAutoListenEnabled && !this.isPaused && !this.isSpeaking) {
            this.scheduleAutoRestart(500);
          } else {
            this.notifyStatus('idle');
          }
        };

        this.recognition.onend = () => {
          this.isListening = false;

          // If we are not currently processing a completed command or speaking,
          // and auto-listening is enabled, seamlessly restart recognition after brief grace period
          if (!this.isSpeaking && !this.isPaused && this.isAutoListenEnabled) {
            if (this.currentState === 'LISTENING' || this.currentState === 'WAITING_FOR_USER') {
              this.scheduleAutoRestart(250);
            }
          }
        };
      }
    }
  }

  public getIsSupported(): boolean {
    return this.isRecognitionSupported;
  }

  public getIsListening(): boolean {
    return this.isListening;
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  public getIsPaused(): boolean {
    return this.isPaused;
  }

  public getState(): VoiceState {
    return this.currentState;
  }

  public getLastSpokenText(): string {
    return this.lastSpokenText;
  }

  public setSpeechRate(rate: number) {
    this.speechRate = Math.min(2.0, Math.max(0.5, rate));
  }

  public getSpeechRate(): number {
    return this.speechRate;
  }

  public setAutoListen(enabled: boolean) {
    this.isAutoListenEnabled = enabled;
  }

  /**
   * Request microphone permission explicitly via browser mediaDevices.
   */
  public async requestMicrophonePermission(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop media tracks immediately after checking permission
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (err: any) {
      console.warn('Microphone permission request error:', err);
      this.setState('ERROR', 'Microphone access is unavailable. Please enable microphone permission in your browser settings.');
      soundService.playError();
      return false;
    }
  }

  /**
   * Start microphone listening session with loopback safety and debounce protection.
   */
  public startListening() {
    if (this.isSpeaking || this.isPaused) {
      return;
    }

    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    if (this.recognition && !this.isListening && !this.isRestarting) {
      try {
        this.isRestarting = true;
        this.recognition.start();
        soundService.playListeningStarted();
      } catch (err: any) {
        this.isRestarting = false;
        // Recognition might already be starting or running
        if (err.name !== 'InvalidStateError') {
          console.warn('Speech recognition start failed:', err);
        }
      }
    }
  }

  /**
   * Stop active microphone recognition.
   */
  public stopListening() {
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch (err) {
        console.warn('Speech recognition stop error:', err);
      }
    }
    this.isListening = false;
    this.isRestarting = false;
  }

  /**
   * Pause automatic continuous listening (e.g. user voice command "Pause listening").
   */
  public pauseListening(speakFeedback: boolean = true) {
    this.isPaused = true;
    this.stopListening();
    soundService.playListeningPaused();
    this.setState('PAUSED');
    this.notifyStatus('idle');

    if (speakFeedback) {
      this.speak('Voice listening is paused.');
    }
  }

  /**
   * Resume automatic continuous listening (e.g. user voice command "Resume listening" or "Start listening").
   */
  public resumeListening(speakFeedback: boolean = true) {
    this.isPaused = false;
    soundService.playListeningStarted();

    if (speakFeedback) {
      this.speak('A-Eye Pal is listening. You can speak now.', () => {
        this.startListening();
      });
    } else {
      this.startListening();
    }
  }

  /**
   * Toggle between paused and active listening.
   */
  public toggleListening() {
    if (this.isPaused || !this.isListening) {
      this.resumeListening(false);
    } else {
      this.pauseListening(false);
    }
  }

  /**
   * Speak a response aloud using Web Speech API with strict loopback prevention
   * and automatic continuous resumption once playback finishes.
   */
  public speak(text: string, onEnd?: () => void): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        resolve();
        return;
      }

      // CRITICAL: Stop microphone immediately before speaking to prevent loopback recording
      this.stopListening();
      if (this.restartTimeout) {
        clearTimeout(this.restartTimeout);
        this.restartTimeout = null;
      }

      window.speechSynthesis.cancel();

      this.lastSpokenText = text;
      this.notifySpoken(text);
      this.isSpeaking = true;
      this.setState('ASSISTANT_SPEAKING');
      this.notifyStatus('speaking');

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = this.speechRate;
      utterance.pitch = this.speechPitch;
      utterance.lang = 'en-US';

      // Pick natural sounding voice if available
      const voices = window.speechSynthesis.getVoices();
      const naturalVoice = voices.find(
        (v) =>
          v.lang.startsWith('en') &&
          (v.name.includes('Natural') ||
            v.name.includes('Google') ||
            v.name.includes('Premium') ||
            v.name.includes('Samantha') ||
            v.name.includes('Daniel'))
      );
      if (naturalVoice) {
        utterance.voice = naturalVoice;
      }

      const finishSpeech = () => {
        this.isSpeaking = false;
        this.notifyStatus('idle');

        if (onEnd) onEnd();
        resolve();

        // AUTOMATIC CONTINUOUS LISTENING:
        // Automatically resume microphone listening once assistant finishes speaking
        if (!this.isPaused && this.isAutoListenEnabled) {
          this.setState('WAITING_FOR_USER');
          this.scheduleAutoRestart(350);
        }
      };

      utterance.onend = finishSpeech;
      utterance.onerror = (e) => {
        console.warn('SpeechSynthesis playback warning:', e);
        finishSpeech();
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  /**
   * Immediate silence / interrupt command.
   */
  public stopSpeech() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      this.isSpeaking = false;
      this.notifyStatus('idle');

      if (!this.isPaused && this.isAutoListenEnabled) {
        this.scheduleAutoRestart(200);
      }
    }
  }

  /**
   * Repeat last spoken assistant message.
   */
  public repeatLastSpeech() {
    if (this.lastSpokenText) {
      this.speak(this.lastSpokenText);
    } else {
      this.speak('There is no previous message to repeat.');
    }
  }

  /**
   * Set state machine state and notify listeners.
   */
  public setState(state: VoiceState, message?: string) {
    this.currentState = state;
    this.onStateCallbacks.forEach((cb) => cb(state, message));
  }

  private scheduleAutoRestart(delayMs: number = 300) {
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
    }
    if (this.isSpeaking || this.isPaused || !this.isAutoListenEnabled) {
      return;
    }

    this.restartTimeout = setTimeout(() => {
      this.restartTimeout = null;
      if (!this.isSpeaking && !this.isPaused && this.isAutoListenEnabled && !this.isListening) {
        this.startListening();
      }
    }, delayMs);
  }

  // Event Subscriptions
  public onTranscript(cb: SpeechCallback) {
    this.onTranscriptCallbacks.push(cb);
    return () => {
      this.onTranscriptCallbacks = this.onTranscriptCallbacks.filter((c) => c !== cb);
    };
  }

  public onStatus(cb: StatusCallback) {
    this.onStatusCallbacks.push(cb);
    return () => {
      this.onStatusCallbacks = this.onStatusCallbacks.filter((c) => c !== cb);
    };
  }

  public onStateChange(cb: StateCallback) {
    this.onStateCallbacks.push(cb);
    return () => {
      this.onStateCallbacks = this.onStateCallbacks.filter((c) => c !== cb);
    };
  }

  public onSpoken(cb: (text: string) => void) {
    this.onSpokenCallbacks.push(cb);
    return () => {
      this.onSpokenCallbacks = this.onSpokenCallbacks.filter((c) => c !== cb);
    };
  }

  private notifyTranscript(text: string, isFinal: boolean) {
    this.onTranscriptCallbacks.forEach((cb) => cb(text, isFinal));
  }

  private notifyStatus(status: 'idle' | 'listening' | 'processing' | 'speaking') {
    this.onStatusCallbacks.forEach((cb) => cb(status));
  }

  private notifySpoken(text: string) {
    this.onSpokenCallbacks.forEach((cb) => cb(text));
  }
}

export const speechService = new SpeechService();
