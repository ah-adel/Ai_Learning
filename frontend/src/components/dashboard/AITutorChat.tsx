import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  Bot,
  ChevronDown,
  MessageSquareText,
  SendHorizonal,
  Sparkles,
  Wand2,
} from 'lucide-react';

type ModelProfile = {
  id: string;
  name: string;
  role: string;
  accent: string;
  prompt: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
};

const MODEL_PROFILES: ModelProfile[] = [
  {
    id: 'tutor-1',
    name: 'Coach Pro',
    role: 'Study coach',
    accent: 'from-violet-500 to-indigo-600',
    prompt:
      'You are a helpful student learning coach. Explain concepts clearly, give examples, and break steps into practical actions.',
  },
  {
    id: 'tutor-2',
    name: 'Code Mentor',
    role: 'Software mentor',
    accent: 'from-cyan-500 to-blue-600',
    prompt:
      'You are a code mentor who explains logic, patterns, and debugging steps. Use precise examples and concise guidance.',
  },
  {
    id: 'tutor-3',
    name: 'Project Planner',
    role: 'Strategy coach',
    accent: 'from-emerald-500 to-teal-600',
    prompt:
      'You are a project planning coach. Turn learning goals into checklists, milestones, and clear next steps.',
  },
];

const STORAGE_KEY = 'eduplatform_ai_tutor_chat_history';
const MODEL_KEY = 'eduplatform_ai_tutor_selected_model';

function getDefaultMessages(): ChatMessage[] {
  return [
    {
      id: 'welcome-message',
      role: 'assistant',
      model: 'tutor-1',
      content: `Hi! I can help with course concepts, project planning, and coding practice. Ask me to explain a topic, outline a study plan, or review a snippet of code.`,
    },
  ];
}

function buildTutorResponse(modelId: string, prompt: string): string {
  const selectedModel = MODEL_PROFILES.find((model) => model.id === modelId) ?? MODEL_PROFILES[0];
  const normalizedPrompt = prompt.trim();

  if (!normalizedPrompt) {
    return `I’m ready to help with your learning plan. Try asking, “Can you explain the key idea behind this lesson?”`;
  }

  const lowerPrompt = normalizedPrompt.toLowerCase();
  const asksForCode = /code|snippet|function|component|javascript|typescript|python|react|css|html/i.test(lowerPrompt);
  const asksForPlan = /plan|roadmap|schedule|study plan|next steps|milestone/i.test(lowerPrompt);

  if (asksForCode) {
    return `## ${selectedModel.name} guidance

Here’s a practical way to think about it:

1. Define the goal of the code you want to build.
2. Break the problem into small steps.
3. Write the simplest version first and test it.
4. Improve readability and edge cases after the first pass.

### Example
\`\`\`tsx
const studyPlan = [
  'Review concept notes',
  'Try a small practice exercise',
  'Reflect on mistakes and retry',
];

console.log('Today\'s focus:', studyPlan[0]);
\`\`\`

If you want, send the exact code or error and I can walk through it step by step.`;
  }

  if (asksForPlan) {
    return `## Recommended study plan

For this topic, I’d structure it like this:

- **Step 1:** Understand the core concept and the key vocabulary.
- **Step 2:** Review one concrete example or mini exercise.
- **Step 3:** Practice with one hands-on task.
- **Step 4:** Reflect on mistakes and summarize what changed.

### Example checklist
- [ ] Read the lesson summary
- [ ] Complete one guided exercise
- [ ] Write 3 notes about what you learned
- [ ] Review the toughest concept before the next session

This keeps learning focused without overwhelming you.`;
  }

  return `## ${selectedModel.role}

${selectedModel.prompt}

Here’s the most useful way to approach your question:

- Start with the core concept rather than the full implementation.
- Identify the smallest example that demonstrates the idea.
- Test one assumption at a time.
- Summarize the lesson in your own words.

### Example response pattern
> The key idea is to focus on the underlying behavior first, then connect it to the actual tooling or code.

That lets you learn more quickly without memorizing steps blindly.`;
}

export const AITutorChat = memo(function AITutorChat() {
  const [selectedModelId, setSelectedModelId] = useState<string>(() => {
    if (typeof window === 'undefined') return MODEL_PROFILES[0].id;
    return localStorage.getItem(MODEL_KEY) ?? MODEL_PROFILES[0].id;
  });

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window === 'undefined') return getDefaultMessages();

    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (!cached) return getDefaultMessages();
      const parsed = JSON.parse(cached) as ChatMessage[];
      return parsed.length > 0 ? parsed : getDefaultMessages();
    } catch {
      return getDefaultMessages();
    }
  });

  const [draft, setDraft] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const endOfMessagesRef = useRef<HTMLDivElement | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const selectedModel = useMemo(
    () => MODEL_PROFILES.find((model) => model.id === selectedModelId) ?? MODEL_PROFILES[0],
    [selectedModelId],
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(MODEL_KEY, selectedModelId);
    }
  }, [selectedModelId]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    }
  }, [messages]);

  const handleSend = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed || isStreaming) return;

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
    };

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      model: selectedModelId,
    };

    const fullResponse = buildTutorResponse(selectedModelId, trimmed);

    if (!isMountedRef.current) return;

    setMessages((current) => [...current, userMessage, assistantMessage]);
    setDraft('');
    setIsStreaming(true);

    let index = 0;
    const tick = () => {
      if (!isMountedRef.current) return;

      index += 1;
      const partial = fullResponse.slice(0, index);

      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessage.id ? { ...message, content: partial } : message,
        ),
      );

      if (index < fullResponse.length) {
        timeoutRef.current = window.setTimeout(tick, 16);
        return;
      }

      setIsStreaming(false);
    };

    timeoutRef.current = window.setTimeout(tick, 25);
  }, [draft, isStreaming, selectedModelId]);

  const handleModelSelect = useCallback((modelId: string) => {
    setSelectedModelId(modelId);
  }, []);

  const handleDraftChange = useCallback((value: string) => {
    setDraft(value);
  }, []);

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-gray-200 bg-gradient-to-r from-primary-50 via-white to-violet-50 px-5 py-4 dark:border-gray-800 dark:from-primary-950/20 dark:via-gray-900 dark:to-violet-950/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-600 text-white shadow-lg shadow-primary-600/20">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-300">
                AI Tutor
              </p>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Student learning assistant</h2>
            </div>
          </div>

          <div className="relative">
            <label className="sr-only" htmlFor="ai-model-select">
              Select AI model
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <Wand2 className="h-4 w-4 text-primary-500" />
              <select
                id="ai-model-select"
                value={selectedModelId}
                onChange={(event) => handleModelSelect(event.target.value)}
                className="bg-transparent pr-7 text-sm font-medium text-gray-700 outline-none dark:text-gray-200"
              >
                {MODEL_PROFILES.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="h-4 w-4 text-gray-400" />
            </div>
          </div>
        </div>
      </div>

      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/60">
        <div className="flex flex-wrap gap-2">
          {MODEL_PROFILES.map((model) => {
            const active = model.id === selectedModelId;
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => handleModelSelect(model.id)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-800 dark:bg-primary-950/30 dark:text-primary-300'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                {model.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex h-[420px] flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto bg-white p-4 dark:bg-gray-950">
          {messages.map((message) => {
            const isUser = message.role === 'user';
            return (
              <div
                key={message.id}
                className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    isUser
                      ? 'bg-primary-600 text-white'
                      : 'border border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100'
                  }`}
                >
                  {!isUser && (
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-300">
                      <MessageSquareText className="h-3.5 w-3.5" />
                      {MODEL_PROFILES.find((model) => model.id === message.model)?.name ?? selectedModel.name}
                    </div>
                  )}

                  <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({ className, children, ...props }) {
                          const match = /language-(\w+)/.exec(className || '');
                          const code = String(children).replace(/\n$/, '');

                          if (!match) {
                            return (
                              <code className={className} {...props}>
                                {children}
                              </code>
                            );
                          }

                          return (
                            <SyntaxHighlighter
                              style={oneDark}
                              language={match[1]}
                              PreTag="div"
                              customStyle={{
                                margin: '0.75rem 0',
                                borderRadius: '0.8rem',
                                fontSize: '0.8rem',
                              }}
                            >
                              {code}
                            </SyntaxHighlighter>
                          );
                        },
                      }}
                    >
                      {message.content || (isUser ? message.content : '...')}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={endOfMessagesRef} />
        </div>

        <div className="border-t border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-end gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-2 dark:border-gray-800 dark:bg-gray-900">
            <textarea
              value={draft}
              onChange={(event) => handleDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
              placeholder={`Ask ${selectedModel.name} about your lesson...`}
              className="max-h-28 min-h-[52px] flex-1 resize-none border-0 bg-transparent px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-white"
            />

            <button
              type="button"
              onClick={handleSend}
              disabled={!draft.trim() || isStreaming}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-600 text-white transition-opacity hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Send message"
            >
              <SendHorizonal className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
});
