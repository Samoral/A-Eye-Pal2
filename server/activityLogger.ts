export type ActivityStage =
  | 'SPEECH_INPUT'
  | 'AI_PROCESSING'
  | 'BACKEND_PROCESSING'
  | 'PAYPAL_SANDBOX'
  | 'RESPONSE';

export type ActivityStatus =
  | 'pending'
  | 'processing'
  | 'success'
  | 'failed'
  | 'cancelled';

export interface ActivityEvent {
  eventId: string;
  timestamp: string; // ISO string
  stage: ActivityStage;
  service: string; // e.g. 'MICROPHONE', 'SPEECH_RECOGNITION', 'GEMINI_AI', 'BACKEND', 'PAYPAL_SANDBOX', 'ASSISTANT'
  eventType: string; // e.g. 'INPUT_RECEIVED', 'TRANSCRIPT_PARSED', 'INTENT_DETECTED', 'DRAFT_CREATED', etc.
  message: string;
  status: ActivityStatus;
  duration?: number; // milliseconds
  correlationId?: string;
  sanitizedMetadata?: Record<string, any>;
}

class ActivityEventBus {
  private events: ActivityEvent[] = [];
  private maxEvents: number = 100;
  private listeners: ((event: ActivityEvent) => void)[] = [];

  constructor() {
    // Initial welcome system event
    this.emit({
      stage: 'BACKEND_PROCESSING',
      service: 'BACKEND',
      eventType: 'SYSTEM_READY',
      message: 'A-Eye Pal backend services initialized and ready.',
      status: 'success',
      sanitizedMetadata: { environment: 'Node.js Express + PayPal Sandbox' },
    });
  }

  public emit(params: Omit<ActivityEvent, 'eventId' | 'timestamp'>): ActivityEvent {
    // Deduplicate rapid identical events (e.g. repeated microphone listening restarts)
    const latest = this.events[0];
    if (
      latest &&
      latest.eventType === params.eventType &&
      latest.service === params.service &&
      latest.message === params.message &&
      Date.now() - new Date(latest.timestamp).getTime() < 2500
    ) {
      return latest;
    }

    const event: ActivityEvent = {
      eventId: `act-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...params,
    };

    this.events.unshift(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(0, this.maxEvents);
    }

    // Notify active SSE or callback listeners
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn('Listener error in ActivityEventBus:', err);
      }
    }

    return event;
  }

  public getRecentEvents(limit: number = 50): ActivityEvent[] {
    return this.events.slice(0, limit);
  }

  public subscribe(listener: (event: ActivityEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public clear(): void {
    this.events = [];
  }
}

export const activityLogger = new ActivityEventBus();
