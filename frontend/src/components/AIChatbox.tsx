import { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, Loader2, ChevronDown, Minus, Maximize2 } from 'lucide-react';
import { sendChatMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null;

const MIN_WIDTH = 280;
const MIN_HEIGHT = 300;
const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 520;
const EDGE_GAP = 24;
const LAUNCHER_SIZE = 56;
const LAUNCHER_POS_STORAGE_KEY = 'log_guardian_ai_launcher_pos';

function formatMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="bg-muted px-1 rounded text-xs font-mono">$1</code>')
    .replace(/^•\s/gm, '• ')
    .replace(/^-\s/gm, '• ')
    .replace(/\n/g, '<br />');
}

export function AIChatbox() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: 'Hi! I\'m your AI assistant for the log integrity platform. Ask me about log errors, blockchain verification, IPFS issues, or anything else.',
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [top, setTop] = useState(() => {
    if (typeof window === 'undefined') return EDGE_GAP;
    return Math.max(EDGE_GAP, window.innerHeight - DEFAULT_HEIGHT - EDGE_GAP);
  });
  const [right, setRight] = useState(EDGE_GAP);
  const [resizeDir, setResizeDir] = useState<ResizeDirection>(null);
  const [launcherPos, setLauncherPos] = useState(() => {
    if (typeof window === 'undefined') {
      return { left: 0, top: 0 };
    }

    const fallback = {
      left: window.innerWidth - LAUNCHER_SIZE - EDGE_GAP,
      top: window.innerHeight - LAUNCHER_SIZE - EDGE_GAP,
    };

    try {
      const raw = localStorage.getItem(LAUNCHER_POS_STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as { left: number; top: number };
      return {
        left: Number.isFinite(parsed.left) ? parsed.left : fallback.left,
        top: Number.isFinite(parsed.top) ? parsed.top : fallback.top,
      };
    } catch {
      return fallback;
    }
  });
  const [startPos, setStartPos] = useState({
    x: 0,
    y: 0,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    top: EDGE_GAP,
    right: EDGE_GAP,
  });
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherDragStateRef = useRef({
    dragging: false,
    moved: false,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
  });
  const suppressToggleRef = useRef(false);

  const clampBounds = (nextWidth: number, nextHeight: number, nextTop: number, nextRight: number) => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const clampedWidth = Math.max(MIN_WIDTH, Math.min(nextWidth, viewportWidth - EDGE_GAP * 2));
    const clampedHeight = Math.max(MIN_HEIGHT, Math.min(nextHeight, viewportHeight - EDGE_GAP * 2));

    const maxTop = Math.max(EDGE_GAP, viewportHeight - clampedHeight - EDGE_GAP);
    const maxRight = Math.max(EDGE_GAP, viewportWidth - clampedWidth - EDGE_GAP);

    const clampedTop = Math.max(EDGE_GAP, Math.min(nextTop, maxTop));
    const clampedRight = Math.max(EDGE_GAP, Math.min(nextRight, maxRight));

    return {
      width: clampedWidth,
      height: clampedHeight,
      top: clampedTop,
      right: clampedRight,
    };
  };

  const clampLauncherPos = (left: number, top: number) => {
    const maxLeft = Math.max(EDGE_GAP, window.innerWidth - LAUNCHER_SIZE - EDGE_GAP);
    const maxTop = Math.max(EDGE_GAP, window.innerHeight - LAUNCHER_SIZE - EDGE_GAP);

    return {
      left: Math.max(EDGE_GAP, Math.min(left, maxLeft)),
      top: Math.max(EDGE_GAP, Math.min(top, maxTop)),
    };
  };

  useEffect(() => {
    const onResize = () => {
      const clamped = clampBounds(width, height, top, right);
      setWidth(clamped.width);
      setHeight(clamped.height);
      setTop(clamped.top);
      setRight(clamped.right);

      const launcherClamped = clampLauncherPos(launcherPos.left, launcherPos.top);
      setLauncherPos(launcherClamped);
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [width, height, top, right, launcherPos.left, launcherPos.top]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(LAUNCHER_POS_STORAGE_KEY, JSON.stringify(launcherPos));
  }, [launcherPos]);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      inputRef.current?.focus();
    }
  }, [open, messages]);

  const handleResizeStart = (direction: ResizeDirection) => (e: React.MouseEvent) => {
    e.preventDefault();
    setResizeDir(direction);
    setStartPos({
      x: e.clientX,
      y: e.clientY,
      width,
      height,
      top,
      right,
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeDir || !panelRef.current) return;

      const deltaX = e.clientX - startPos.x;
      const deltaY = e.clientY - startPos.y;

      let newWidth = startPos.width;
      let newHeight = startPos.height;
      let newTop = startPos.top;
      let newRight = startPos.right;

      // Handle width changes (east/west)
      if (resizeDir.includes('e')) {
        newWidth = Math.max(MIN_WIDTH, startPos.width + deltaX);
      } else if (resizeDir.includes('w')) {
        const newW = Math.max(MIN_WIDTH, startPos.width - deltaX);
        newRight = startPos.right + (startPos.width - newW);
        newWidth = newW;
      }

      // Handle height changes (north/south)
      if (resizeDir.includes('s')) {
        newHeight = Math.max(MIN_HEIGHT, startPos.height + deltaY);
      } else if (resizeDir.includes('n')) {
        const newH = Math.max(MIN_HEIGHT, startPos.height - deltaY);
        newTop = startPos.top + (startPos.height - newH);
        newHeight = newH;
      }

      const clamped = clampBounds(newWidth, newHeight, newTop, newRight);
      setWidth(clamped.width);
      setHeight(clamped.height);
      setTop(clamped.top);
      setRight(clamped.right);
    };

    const handleMouseUp = () => {
      setResizeDir(null);
    };

    if (resizeDir) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [resizeDir, startPos]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const state = launcherDragStateRef.current;
      if (!state.dragging) return;

      const deltaX = e.clientX - state.startX;
      const deltaY = e.clientY - state.startY;
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        state.moved = true;
        suppressToggleRef.current = true;
      }

      const clamped = clampLauncherPos(state.startLeft + deltaX, state.startTop + deltaY);
      setLauncherPos(clamped);
    };

    const handleMouseUp = () => {
      launcherDragStateRef.current.dragging = false;
      setTimeout(() => {
        suppressToggleRef.current = false;
      }, 0);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleLauncherMouseDown = (e: React.MouseEvent<HTMLButtonElement>) => {
    launcherDragStateRef.current = {
      dragging: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: launcherPos.left,
      startTop: launcherPos.top,
    };
  };

  const toggleOpen = () => {
    if (suppressToggleRef.current) {
      return;
    }

    setOpen((v) => {
      const next = !v;
      if (next) {
        setMinimized(false);
        const desiredTop = launcherPos.top - height - 12;
        const desiredRight = Math.max(
          EDGE_GAP,
          window.innerWidth - launcherPos.left - LAUNCHER_SIZE,
        );
        const clamped = clampBounds(
          width,
          height,
          desiredTop,
          desiredRight,
        );
        setTop(clamped.top);
        setRight(clamped.right);
      }
      return next;
    });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setMessages((prev) => [...prev, { role: 'user', text }]);
    setInput('');
    setLoading(true);

    try {
      const answer = await sendChatMessage(text);
      setMessages((prev) => [...prev, { role: 'assistant', text: answer }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: 'Sorry, I could not reach the AI service right now. Please try again.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const currentPanelHeight = minimized ? 56 : height;

  return (
    <>
      {/* Floating toggle button */}
      <button
        onMouseDown={handleLauncherMouseDown}
        onClick={toggleOpen}
        style={{
          left: `${launcherPos.left}px`,
          top: `${launcherPos.top}px`,
        }}
        className={cn(
          'fixed z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all duration-200 cursor-grab active:cursor-grabbing select-none',
          'bg-primary text-primary-foreground hover:scale-110 hover:shadow-primary/40 hover:shadow-xl',
          open && 'rotate-0',
        )}
        aria-label="Toggle AI assistant"
      >
        {open ? <ChevronDown className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
      </button>

      {/* Chat panel */}
      <div
        ref={panelRef}
        style={{
          width: `${width}px`,
          height: `${currentPanelHeight}px`,
          top: `${top}px`,
          right: `${right}px`,
        }}
        className={cn(
          'fixed z-50 flex flex-col rounded-2xl border border-border bg-card shadow-2xl transition-[opacity,height] duration-200 chatbox-panel overflow-hidden',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2 rounded-t-2xl border-b border-border bg-card/80 px-4 py-3 backdrop-blur flex-shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">AI Assistant</p>
            <p className="text-[10px] text-muted-foreground">Powered by Gemini</p>
          </div>
          <button
            onClick={() => setMinimized((v) => !v)}
            aria-label={minimized ? 'Expand AI assistant' : 'Minimize AI assistant'}
            title={minimized ? 'Expand' : 'Minimize'}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {minimized ? <Maximize2 className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close AI assistant"
            title="Close"
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!minimized && (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin chatbox-messages min-h-0">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                'flex gap-2',
                msg.role === 'user' ? 'justify-end' : 'justify-start',
              )}
            >
              {msg.role === 'assistant' && (
                <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-3 w-3 text-primary" />
                </div>
              )}
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed',
                  msg.role === 'user'
                    ? 'rounded-tr-sm bg-primary text-primary-foreground'
                    : 'rounded-tl-sm bg-muted text-foreground',
                )}
                dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.text) }}
              />
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
                <Bot className="h-3 w-3 text-primary" />
              </div>
              <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-muted px-3 py-2">
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Thinking…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="flex items-end gap-2 rounded-b-2xl border-t border-border bg-card/80 px-3 py-3 backdrop-blur flex-shrink-0">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about logs, errors, verification…"
            rows={1}
            className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 scrollbar-thin chatbox-input"
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            aria-label="Send message"
            title="Send"
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
              input.trim() && !loading
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
          >
            <Send className="h-4 w-4" />
          </button>
            </div>
          </>
        )}

        {/* Resize handles - Corners */}
        <div
          onMouseDown={handleResizeStart('nw')}
          className={cn(
            'absolute top-0 left-0 w-3 h-3 rounded-tl-2xl',
            minimized ? 'pointer-events-none opacity-0' : 'cursor-nw-resize hover:bg-primary/30',
          )}
          title="Drag to resize"
        />
        <div
          onMouseDown={handleResizeStart('ne')}
          className={cn(
            'absolute top-0 right-0 w-3 h-3 rounded-tr-2xl',
            minimized ? 'pointer-events-none opacity-0' : 'cursor-ne-resize hover:bg-primary/30',
          )}
          title="Drag to resize"
        />
        <div
          onMouseDown={handleResizeStart('sw')}
          className={cn(
            'absolute bottom-0 left-0 w-3 h-3 rounded-bl-2xl',
            minimized ? 'pointer-events-none opacity-0' : 'cursor-sw-resize hover:bg-primary/30',
          )}
          title="Drag to resize"
        />
        <div
          onMouseDown={handleResizeStart('se')}
          className={cn(
            'absolute bottom-0 right-0 w-3 h-3 rounded-br-2xl',
            minimized ? 'pointer-events-none opacity-0' : 'cursor-se-resize hover:bg-primary/30',
          )}
          title="Drag to resize"
        />

        {/* Resize handles - Edges */}
        <div
          onMouseDown={handleResizeStart('n')}
          className={cn(
            'absolute top-0 left-3 right-3 h-1',
            minimized ? 'pointer-events-none opacity-0' : 'cursor-n-resize hover:bg-primary/20',
          )}
          title="Drag to resize"
        />
        <div
          onMouseDown={handleResizeStart('s')}
          className={cn(
            'absolute bottom-0 left-3 right-3 h-1',
            minimized ? 'pointer-events-none opacity-0' : 'cursor-s-resize hover:bg-primary/20',
          )}
          title="Drag to resize"
        />
        <div
          onMouseDown={handleResizeStart('w')}
          className={cn(
            'absolute top-3 bottom-3 left-0 w-1',
            minimized ? 'pointer-events-none opacity-0' : 'cursor-w-resize hover:bg-primary/20',
          )}
          title="Drag to resize"
        />
        <div
          onMouseDown={handleResizeStart('e')}
          className={cn(
            'absolute top-3 bottom-3 right-0 w-1',
            minimized ? 'pointer-events-none opacity-0' : 'cursor-e-resize hover:bg-primary/20',
          )}
          title="Drag to resize"
        />
      </div>
    </>
  );
}
