import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Activity,
  Volume2,
  VolumeX,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Cpu,
  Mic,
  CreditCard,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ArrowDown,
  Code2
} from 'lucide-react';
import { ActivityEvent, ActivityStage, AccessibilityTheme } from '../types';

interface LiveBackendActivityPanelProps {
  events: ActivityEvent[];
  theme: AccessibilityTheme;
  isLiveConnected: boolean;
  onClearEvents: () => void;
}

export const LiveBackendActivityPanel: React.FC<LiveBackendActivityPanelProps> = ({
  events,
  isLiveConnected,
  onClearEvents,
}) => {
  const [activeFilter, setActiveFilter] = useState<'ALL' | ActivityStage>('ALL');
  const [autoAnnounce, setAutoAnnounce] = useState<boolean>(false);
  const [expandedEventIds, setExpandedEventIds] = useState<Record<string, boolean>>({});
  const [autoStick, setAutoStick] = useState<boolean>(true);
  const [unseenCount, setUnseenCount] = useState<number>(0);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const isScrollingProgrammaticallyRef = useRef<boolean>(false);
  const prevEventsLengthRef = useRef<number>(events.length);

  // Chronological order: oldest events at top, newest at bottom
  const chronologicalEvents = useMemo(() => {
    // Deduplicate by eventId and sort ascending by timestamp
    const seen = new Set<string>();
    const unique: ActivityEvent[] = [];
    for (const e of events) {
      if (!seen.has(e.eventId)) {
        seen.add(e.eventId);
        unique.push(e);
      }
    }
    return unique.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [events]);

  const filteredEvents = useMemo(() => {
    return activeFilter === 'ALL'
      ? chronologicalEvents
      : chronologicalEvents.filter((e) => e.stage === activeFilter);
  }, [chronologicalEvents, activeFilter]);

  // Scroll to bottom without scrolling entire page
  const scrollToBottom = (smooth = true) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    isScrollingProgrammaticallyRef.current = true;
    requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
      setTimeout(() => {
        isScrollingProgrammaticallyRef.current = false;
      }, smooth ? 250 : 60);
    });

    setAutoStick(true);
    setUnseenCount(0);
  };

  // Detect user manual scrolling
  const handleScroll = () => {
    if (isScrollingProgrammaticallyRef.current) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    // Check if within 45px of the bottom
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAtBottom = distanceFromBottom <= 45;

    if (isAtBottom) {
      if (!autoStick) {
        setAutoStick(true);
      }
      if (unseenCount > 0) {
        setUnseenCount(0);
      }
    } else {
      if (autoStick) {
        setAutoStick(false);
      }
    }
  };

  // Auto-scroll when new events arrive if autoStick is enabled
  useEffect(() => {
    const isNewEventAdded = filteredEvents.length > prevEventsLengthRef.current;
    prevEventsLengthRef.current = filteredEvents.length;

    if (autoStick) {
      scrollToBottom(false);
    } else if (isNewEventAdded) {
      setUnseenCount((c) => c + 1);
    }
  }, [filteredEvents.length, autoStick]);

  const toggleExpand = (id: string) => {
    setExpandedEventIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const getStageBadge = (stage: ActivityStage) => {
    switch (stage) {
      case 'SPEECH_INPUT':
        return { label: 'Speech', icon: Mic, color: 'text-blue-700 bg-blue-50 border-blue-200' };
      case 'AI_PROCESSING':
        return { label: 'Gemini AI', icon: Sparkles, color: 'text-indigo-700 bg-indigo-50 border-indigo-200' };
      case 'BACKEND_PROCESSING':
        return { label: 'Backend', icon: Cpu, color: 'text-amber-700 bg-amber-50 border-amber-200' };
      case 'PAYPAL_SANDBOX':
        return { label: 'PayPal', icon: CreditCard, color: 'text-[#0070BA] bg-blue-50 border-blue-200' };
      case 'RESPONSE':
        return { label: 'Output', icon: Volume2, color: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
      default:
        return { label: stage, icon: Activity, color: 'text-slate-600 bg-slate-100 border-slate-200' };
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return {
          icon: CheckCircle2,
          color: 'text-emerald-700 bg-emerald-50 border-emerald-200',
          dot: 'bg-emerald-500',
          label: 'Success',
        };
      case 'processing':
      case 'pending':
        return {
          icon: Clock,
          color: 'text-blue-700 bg-blue-50 border-blue-200',
          dot: 'bg-blue-500 animate-pulse',
          label: status === 'processing' ? 'Processing' : 'Pending',
        };
      case 'failed':
        return {
          icon: AlertCircle,
          color: 'text-rose-700 bg-rose-50 border-rose-200',
          dot: 'bg-rose-500',
          label: 'Failed',
        };
      case 'cancelled':
      default:
        return {
          icon: XCircle,
          color: 'text-slate-600 bg-slate-100 border-slate-200',
          dot: 'bg-slate-400',
          label: 'Inactive',
        };
    }
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return '--:--:--';
    }
  };

  return (
    <aside
      aria-label="Live System Technical Audit"
      className="w-full h-full flex flex-col rounded-2xl border border-slate-200/90 bg-white shadow-sm overflow-hidden text-slate-800"
    >
      {/* Compact Top Header */}
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/70 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          {/* Title & PayPal Sandbox Badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-7 h-7 rounded-lg bg-[#0070BA]/10 flex items-center justify-center text-[#0070BA] shrink-0">
              <Activity className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-[#001C3F] tracking-tight">
                  Live System Activity
                </h2>
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-blue-100/70 text-[#003087] border border-blue-200"
                  title="PayPal Sandbox Demonstration environment"
                >
                  PAYPAL SANDBOX
                </span>
              </div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-1.5">
            {/* Auto-stick Toggle */}
            <button
              onClick={() => {
                if (autoStick) {
                  setAutoStick(false);
                } else {
                  scrollToBottom(true);
                }
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider border cursor-pointer transition-colors ${
                autoStick
                  ? 'bg-blue-50 border-blue-200 text-[#0070BA]'
                  : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800'
              }`}
              title={autoStick ? 'Auto-scrolling to newest event' : 'Auto-scrolling paused (Click to resume)'}
            >
              <ArrowDown className={`w-3 h-3 ${autoStick ? 'text-[#0070BA]' : 'text-slate-400'}`} />
              <span>{autoStick ? 'Follow' : 'Paused'}</span>
            </button>

            {/* Screen Reader Voice Announcement Toggle */}
            <button
              onClick={() => setAutoAnnounce(!autoAnnounce)}
              className={`p-1.5 rounded-md border text-xs transition-colors cursor-pointer ${
                autoAnnounce
                  ? 'bg-blue-50 border-blue-300 text-[#0070BA]'
                  : 'bg-white border-slate-200 text-slate-400 hover:text-slate-700'
              }`}
              title="Toggle spoken screen reader announcements for activity events"
              aria-pressed={autoAnnounce}
              aria-label="Toggle spoken event stream"
            >
              {autoAnnounce ? (
                <Volume2 className="w-3.5 h-3.5 text-[#0070BA]" aria-hidden="true" />
              ) : (
                <VolumeX className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              )}
            </button>

            {/* Clear events */}
            <button
              onClick={onClearEvents}
              className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-400 hover:text-rose-600 hover:border-rose-200 cursor-pointer transition-colors"
              title="Clear activity log"
              aria-label="Clear event log"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Status Line & Filter Chips */}
        <div className="flex items-center justify-between gap-2 text-xs pt-0.5">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-medium">
            <span
              className={`w-2 h-2 rounded-full ${
                isLiveConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'
              }`}
            />
            <span>{isLiveConnected ? 'Real-Time SSE' : 'Reconnecting...'}</span>
            <span>•</span>
            <span>{filteredEvents.length} events</span>
          </div>

          {/* Quick Filter */}
          <div className="flex items-center gap-1 text-[11px]">
            <button
              onClick={() => setActiveFilter('ALL')}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                activeFilter === 'ALL'
                  ? 'bg-[#003087] text-white'
                  : 'text-slate-600 hover:bg-slate-200/60'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setActiveFilter('SPEECH_INPUT')}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                activeFilter === 'SPEECH_INPUT'
                  ? 'bg-[#003087] text-white'
                  : 'text-slate-600 hover:bg-slate-200/60'
              }`}
            >
              Speech
            </button>
            <button
              onClick={() => setActiveFilter('AI_PROCESSING')}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                activeFilter === 'AI_PROCESSING'
                  ? 'bg-[#003087] text-white'
                  : 'text-slate-600 hover:bg-slate-200/60'
              }`}
            >
              Gemini
            </button>
            <button
              onClick={() => setActiveFilter('PAYPAL_SANDBOX')}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                activeFilter === 'PAYPAL_SANDBOX'
                  ? 'bg-[#0070BA] text-white'
                  : 'text-slate-600 hover:bg-slate-200/60'
              }`}
            >
              PayPal
            </button>
          </div>
        </div>
      </div>

      {/* Screen Reader Voice Live Region */}
      {autoAnnounce && filteredEvents.length > 0 && (
        <div role="status" aria-live="polite" className="sr-only">
          Activity update: {filteredEvents[filteredEvents.length - 1].service}{' '}
          {filteredEvents[filteredEvents.length - 1].message}
        </div>
      )}

      {/* Independent Scrollable Events Body with Relative Positioning */}
      <div className="flex-1 relative overflow-hidden flex flex-col">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 p-3.5 sm:p-4 overflow-y-auto space-y-2 text-xs focus:outline-none"
          tabIndex={0}
          aria-label="Activity event timeline (Chronological)"
        >
          {filteredEvents.length === 0 ? (
            <div className="py-20 text-center text-slate-400 space-y-2">
              <Activity className="w-7 h-7 mx-auto text-slate-300 opacity-60 animate-pulse" />
              <p className="text-xs font-medium">
                No activity yet. Speak a voice command to see the real-time processing pipeline.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredEvents.map((event, idx) => {
                const stage = getStageBadge(event.stage);
                const status = getStatusBadge(event.status);
                const StageIcon = stage.icon;
                const isExpanded = Boolean(expandedEventIds[event.eventId]);
                const isLast = idx === filteredEvents.length - 1;

                return (
                  <div
                    key={event.eventId}
                    className={`p-2.5 rounded-xl border transition-all ${
                      isLast
                        ? 'border-blue-200 bg-blue-50/20 shadow-xs'
                        : 'border-slate-100 bg-white hover:bg-slate-50/70'
                    }`}
                  >
                    {/* Event Timeline Row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        {/* Timestamp & Status Dot */}
                        <div className="flex items-center gap-1 pt-0.5 text-slate-400 font-mono text-[10px] shrink-0">
                          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                          <span>{formatTime(event.timestamp)}</span>
                        </div>

                        {/* Event Content */}
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border ${stage.color}`}
                            >
                              <StageIcon className="w-2.5 h-2.5" aria-hidden="true" />
                              <span>{event.service}</span>
                            </span>
                            <span className="text-[10px] font-mono text-slate-500 uppercase">
                              {event.eventType}
                            </span>
                            {event.duration !== undefined && (
                              <span className="text-[10px] font-mono text-slate-400">
                                {event.duration}ms
                              </span>
                            )}
                          </div>

                          <p className="text-slate-900 font-medium text-xs leading-snug">
                            {event.message}
                          </p>
                        </div>
                      </div>

                      {/* Status & Technical Expand Trigger */}
                      <div className="flex items-center gap-1 shrink-0">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${status.color}`}
                        >
                          {status.label}
                        </span>
                        <button
                          onClick={() => toggleExpand(event.eventId)}
                          className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer transition-colors"
                          title={isExpanded ? 'Hide technical details' : 'Inspect technical details'}
                          aria-label="Inspect event metadata"
                        >
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Phonetic Correction Comparison Display */}
                    {event.sanitizedMetadata?.originalTranscript &&
                      event.sanitizedMetadata?.interpretedTranscript &&
                      (event.eventType === 'TRANSCRIPT_CORRECTED' || event.sanitizedMetadata?.isCorrected) && (
                        <div className="mt-2 p-2 rounded-lg bg-blue-50/80 border border-blue-200 text-xs space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-mono text-[9px] font-bold uppercase">
                              Original Speech
                            </span>
                            <span className="font-medium text-slate-600 line-through">
                              "{String(event.sanitizedMetadata.originalTranscript)}"
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 rounded bg-[#0070BA] text-white font-mono text-[9px] font-bold uppercase">
                              Interpreted Command
                            </span>
                            <span className="font-bold text-[#001C3F]">
                              "{String(event.sanitizedMetadata.interpretedTranscript)}"
                            </span>
                          </div>
                        </div>
                      )}

                    {/* Metadata Preview Tag */}
                    {event.sanitizedMetadata &&
                      Object.keys(event.sanitizedMetadata).length > 0 &&
                      !isExpanded && (
                        <div className="flex flex-wrap gap-1 pt-1 pl-1 text-[10px] font-mono text-slate-500">
                          {Object.entries(event.sanitizedMetadata)
                            .filter(([k]) => k !== 'originalTranscript' && k !== 'interpretedTranscript')
                            .slice(0, 3)
                            .map(([k, v]) => (
                              <span
                                key={k}
                                className="px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200/80"
                              >
                                <span className="text-slate-400">{k}:</span> {String(v)}
                              </span>
                            ))}
                        </div>
                      )}

                    {/* Expanded Technical Inspection Drawer */}
                    {isExpanded && (
                      <div className="mt-2 pt-2 border-t border-slate-100 space-y-1.5 bg-slate-50/80 p-2.5 rounded-lg text-[11px] font-mono">
                        <div className="flex items-center justify-between text-slate-500 text-[10px] pb-1 border-b border-slate-200/60">
                          <span className="flex items-center gap-1 text-[#0070BA] font-semibold">
                            <Code2 className="w-3 h-3" />
                            <span>Technical Payload Metadata</span>
                          </span>
                          <span>Event ID: {event.eventId}</span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-slate-700 text-[10px]">
                          <div>
                            <span className="text-slate-400 block">Stage:</span>
                            <span className="font-semibold">{event.stage}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block">Status:</span>
                            <span className="font-semibold capitalize">{event.status}</span>
                          </div>
                          {event.duration !== undefined && (
                            <div>
                              <span className="text-slate-400 block">Execution Latency:</span>
                              <span className="font-semibold">{event.duration}ms</span>
                            </div>
                          )}
                          <div>
                            <span className="text-slate-400 block">Timestamp:</span>
                            <span className="truncate block font-semibold">{event.timestamp}</span>
                          </div>
                        </div>

                        {event.sanitizedMetadata &&
                          Object.keys(event.sanitizedMetadata).length > 0 && (
                            <div className="mt-1.5 pt-1.5 border-t border-slate-200/60">
                              <span className="text-slate-400 block mb-1 text-[10px]">
                                Sanitized Details:
                              </span>
                              <pre className="p-2 rounded bg-white text-slate-800 text-[10px] overflow-x-auto whitespace-pre-wrap leading-tight border border-slate-200">
                                {JSON.stringify(event.sanitizedMetadata, null, 2)}
                              </pre>
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Bottom Sentinel Element for Automatic Scrolling */}
              <div ref={bottomSentinelRef} className="h-px w-full" aria-hidden="true" />
            </div>
          )}
        </div>

        {/* Floating "Jump to Latest" & "New Events" Indicator */}
        {(!autoStick || unseenCount > 0) && (
          <div className="absolute bottom-3 right-4 z-20">
            <button
              onClick={() => scrollToBottom(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0070BA] text-white shadow-md hover:bg-[#003087] transition-all text-xs font-semibold cursor-pointer animate-fadeIn"
              aria-label="Scroll to newest events"
            >
              <ArrowDown className="w-3.5 h-3.5" />
              <span>
                {unseenCount > 0
                  ? `${unseenCount} new event${unseenCount > 1 ? 's' : ''}`
                  : 'Jump to latest'}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Subtle Footer */}
      <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between text-[11px] text-slate-400 font-medium">
        <span>A-Eye Pal Real-Time Telemetry</span>
        <span className="text-[#0070BA] font-semibold">PayPal Sandbox Verified</span>
      </div>
    </aside>
  );
};
