'use client';

import { useState, useRef } from 'react';

const PRESET_PROMPTS = [
  {
    label: 'Capital of France (User Test)',
    prompt: 'What is the capital of France?',
    category: 'Basic Sanity',
  },
  {
    label: 'BOLA in Core Banking APIs',
    prompt:
      'Analyze the systemic risk of Broken Object Level Authorization (BOLA) in Nigerian retail payment switches and suggest 3 defensive controls.',
    category: 'Fintech Security',
  },
  {
    label: 'CVSS v4.0 vs Contextual Banking Risk',
    prompt:
      'Explain the supervisory distinction between technical CVSS v4.0 base scoring and contextual banking impact in central bank cyber assessments.',
    category: 'Supervisory Risk',
  },
  {
    label: 'SWIFT CSCF v2024 Remediation',
    prompt:
      'Draft a remediation and verification roadmap for a failed SWIFT CSCF mandatory control in a tier-1 commercial bank.',
    category: 'Compliance',
  },
];

export function AiAnalystPanel({ hasHfToken }: { hasHfToken: boolean }) {
  const [prompt, setPrompt] = useState('What is the capital of France?');
  const [model, setModel] = useState('inclusionAI/Ling-3.0-flash-Fin:novita');
  const [output, setOutput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'console' | 'code'>('console');
  const [charCount, setCharCount] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  async function handleRun() {
    if (!prompt.trim() || streaming) return;
    setOutput('');
    setError(null);
    setStreaming(true);
    setCharCount(0);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          model,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${response.status}: Failed to reach inference service`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Response body stream is not available');

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.error) {
                setError(parsed.error);
              }
              if (parsed.content) {
                accumulated += parsed.content;
                setOutput(accumulated);
                setCharCount(accumulated.length);
              }
            } catch {
              // Ignore malformed chunks
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Stream connection failed');
      }
    } finally {
      setStreaming(false);
      abortControllerRef.current = null;
    }
  }

  function handleStop() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setStreaming(false);
    }
  }

  function handleCopy() {
    if (output) {
      navigator.clipboard.writeText(output);
    }
  }

  return (
    <div className="space-y-4">
      {/* Configuration Status Card */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--ficap-border)] bg-white p-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-navy-950">
            <span className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
            Model: <code className="font-mono text-seal-700">{model}</code>
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium border ${
              hasHfToken
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}
          >
            {hasHfToken ? '✓ HF_TOKEN Configured' : '⚠ HF_TOKEN Not Set (Using Simulation Fallback)'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-2xs text-[var(--ficap-muted)]">
          <span>Engine: <strong className="text-navy-900">@huggingface/inference</strong></span>
          <span>·</span>
          <span>Provider: <strong className="text-navy-900">Novita / Ling-3.0</strong></span>
        </div>
      </div>

      {/* Preset Prompts */}
      <div className="space-y-1.5">
        <p className="text-2xs font-semibold uppercase tracking-wider text-[var(--ficap-muted)]">
          Quick Preset Prompts:
        </p>
        <div className="flex flex-wrap gap-2">
          {PRESET_PROMPTS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setPrompt(preset.prompt)}
              className="rounded-md border border-[var(--ficap-border)] bg-white px-2.5 py-1.5 text-left text-xs font-medium text-navy-900 shadow-2xs hover:border-seal-600 hover:bg-seal-50/50 hover:text-seal-800 transition"
            >
              <span className="font-semibold">{preset.label}</span>
              <span className="ml-1.5 text-[10px] text-[var(--ficap-muted)]">({preset.category})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Query Input */}
      <div className="rounded-lg border border-[var(--ficap-border)] bg-white p-3.5 shadow-xs space-y-3">
        <div>
          <label htmlFor="prompt-input" className="label block text-xs font-semibold text-navy-950">
            Prompt / User Message
          </label>
          <textarea
            id="prompt-input"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter question or cyber risk scenario..."
            className="input mt-1.5 font-sans text-xs leading-relaxed"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2">
            <span className="text-2xs text-[var(--ficap-muted)]">Inference Model:</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded border border-[var(--ficap-border)] bg-slate-50 px-2 py-1 text-xs font-mono text-navy-900"
            >
              <option value="inclusionAI/Ling-3.0-flash-Fin:novita">
                inclusionAI/Ling-3.0-flash-Fin:novita
              </option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            {streaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="btn btn-secondary btn-sm text-rose-700 hover:bg-rose-50"
              >
                ■ Stop Generation
              </button>
            ) : (
              <button
                type="button"
                onClick={handleRun}
                disabled={!prompt.trim()}
                className="btn btn-primary btn-sm flex items-center gap-1.5 shadow-sm"
              >
                <span>⚡ Run Streaming Inference</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[var(--ficap-border)] flex items-center justify-between">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('console')}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 transition ${
              activeTab === 'console'
                ? 'border-seal-600 text-seal-700 font-semibold'
                : 'border-transparent text-[var(--ficap-muted)] hover:text-navy-900'
            }`}
          >
            Live Output Console {streaming && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-blue-600 animate-ping" />}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('code')}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 transition ${
              activeTab === 'code'
                ? 'border-seal-600 text-seal-700 font-semibold'
                : 'border-transparent text-[var(--ficap-muted)] hover:text-navy-900'
            }`}
          >
            Code Implementation (SDK Spec)
          </button>
        </div>

        {output && activeTab === 'console' ? (
          <button
            type="button"
            onClick={handleCopy}
            className="text-2xs text-seal-700 hover:underline px-2 py-1"
          >
            Copy text
          </button>
        ) : null}
      </div>

      {/* Tab Panels */}
      {activeTab === 'console' ? (
        <div className="rounded-lg border border-[var(--ficap-border)] bg-navy-950 p-4 text-white font-mono text-xs shadow-inner min-h-[220px]">
          <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-2 text-[10px] text-navy-200">
            <span>
              Status: {streaming ? '⚡ Receiving stream chunks...' : output ? '✓ Generation completed' : 'Ready'}
            </span>
            <span>{charCount > 0 ? `${charCount} characters` : ''}</span>
          </div>

          {error ? (
            <div className="rounded border border-rose-500/30 bg-rose-950/40 p-3 text-rose-200 text-xs">
              <strong>Error:</strong> {error}
            </div>
          ) : null}

          {output ? (
            <div className="whitespace-pre-wrap leading-relaxed text-slate-100 font-sans text-xs">
              {output}
              {streaming && <span className="inline-block h-4 w-1.5 bg-seal-400 ml-1 animate-pulse" />}
            </div>
          ) : !error ? (
            <div className="flex h-32 items-center justify-center text-center text-xs text-navy-400">
              Select a preset prompt above or enter a question, then click &ldquo;Run Streaming Inference&rdquo;.
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--ficap-border)] bg-slate-900 p-4 font-mono text-xs text-slate-100 shadow-inner overflow-x-auto">
          <div className="mb-2 text-[10px] text-slate-400">
            Hugging Face Inference Implementation in FICAP:
          </div>
          <pre className="text-[11px] leading-relaxed text-emerald-300">
{`import { InferenceClient } from "@huggingface/inference";

const client = new InferenceClient(process.env.HF_TOKEN);

let out = "";

const stream = client.chatCompletionStream({
    model: "inclusionAI/Ling-3.0-flash-Fin:novita",
    messages: [
        {
            role: "user",
            content: "${prompt.replace(/"/g, '\\"')}",
        },
    ],
});

for await (const chunk of stream) {
    if (chunk.choices && chunk.choices.length > 0) {
        const newContent = chunk.choices[0].delta.content;
        out += newContent;
        console.log(newContent);
    }
}`}
          </pre>
        </div>
      )}
    </div>
  );
}
