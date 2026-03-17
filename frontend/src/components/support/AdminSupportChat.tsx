import { useState } from 'react';
import { adminSupportChat, getAuthSession } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function AdminSupportChat() {
  const session = getAuthSession();
  const [prompt, setPrompt] = useState('');
  const [recentError, setRecentError] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  if (session.role !== 'admin' || !session.token) {
    return null;
  }

  const onSend = async () => {
    if (!prompt.trim()) {
      return;
    }
    setLoading(true);
    const userMessage: ChatMessage = { role: 'user', content: prompt.trim() };
    setMessages((prev) => [...prev, userMessage]);
    try {
      const answer = await adminSupportChat({
        prompt: prompt.trim(),
        recentError: recentError.trim() || undefined,
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
      setPrompt('');
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Support agent failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Admin Support Agent (Gemini)</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Ask root-cause and remediation questions for backend or pipeline incidents.
        </p>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Recent Error Context (optional)</label>
        <Textarea
          value={recentError}
          onChange={(e) => setRecentError(e.target.value)}
          placeholder="Paste stack trace, RPC failure, or log snippet"
          className="min-h-20"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Question</label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Why do we see 'program not found' during devnet deploy?"
          className="min-h-24"
        />
      </div>

      <Button onClick={onSend} disabled={loading || !prompt.trim()}>
        {loading ? 'Asking...' : 'Ask Support Agent'}
      </Button>

      {messages.length > 0 && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3 max-h-80 overflow-auto">
          {messages.map((msg, index) => (
            <div key={index} className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{msg.role}</p>
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
