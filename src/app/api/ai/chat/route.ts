import { NextRequest, NextResponse } from 'next/server';
import { InferenceClient } from '@huggingface/inference';
import { getRequestContext } from '@/lib/db/context';

export const dynamic = 'force-dynamic';

const DEFAULT_MODEL = 'inclusionAI/Ling-3.0-flash-Fin:novita';

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext({ required: false });
    if (!ctx) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const userMessages = Array.isArray(body.messages) ? body.messages : null;
    const model = (typeof body.model === 'string' && body.model.trim()) || DEFAULT_MODEL;
    const wantStream = body.stream !== false;

    const messages = userMessages && userMessages.length > 0
      ? userMessages
      : [
          {
            role: 'user',
            content: prompt || 'What is the capital of France?',
          },
        ];

    const hfToken = process.env.HF_TOKEN;

    // Check if token is available for real Hugging Face cloud inference
    if (!hfToken) {
      const fallbackText =
        `[HF_TOKEN environment variable is not configured]\n\n` +
        `Offline Simulated Response for query: "${messages[messages.length - 1]?.content ?? ''}"\n\n` +
        (messages[messages.length - 1]?.content?.toLowerCase().includes('capital of france')
          ? 'The capital of France is Paris.'
          : 'For financial institution cybersecurity assessments, please ensure HF_TOKEN is defined in .env to access live cloud inference on ' + model + '.');

      if (wantStream) {
        const encoder = new TextEncoder();
        const customStream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: fallbackText, done: false })}\n\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '', done: true })}\n\n`));
            controller.close();
          },
        });
        return new Response(customStream, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
          },
        });
      }

      return NextResponse.json({
        model,
        text: fallbackText,
        warning: 'HF_TOKEN not set in environment.',
      });
    }

    const client = new InferenceClient(hfToken);

    if (wantStream) {
      const encoder = new TextEncoder();
      const stream = client.chatCompletionStream({
        model,
        messages,
      });

      const responseStream = new ReadableStream({
        async start(controller) {
          let out = '';
          try {
            for await (const chunk of stream) {
              if (chunk.choices && chunk.choices.length > 0) {
                const newContent = chunk.choices[0].delta.content ?? '';
                if (newContent) {
                  out += newContent;
                  if (process.env.NODE_ENV !== 'production') {
                    console.log(newContent);
                  }
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ content: newContent, done: false })}\n\n`),
                  );
                }
              }
            }
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ content: '', done: true, fullText: out })}\n\n`),
            );
            controller.close();
          } catch (err: any) {
            console.error('Hugging Face stream error:', err);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ error: err?.message || 'Inference stream error', done: true })}\n\n`,
              ),
            );
            controller.close();
          }
        },
      });

      return new Response(responseStream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      });
    }

    // Non-streaming completion
    let out = '';
    const stream = client.chatCompletionStream({
      model,
      messages,
    });

    for await (const chunk of stream) {
      if (chunk.choices && chunk.choices.length > 0) {
        const newContent = chunk.choices[0].delta.content;
        if (newContent) {
          out += newContent;
          if (process.env.NODE_ENV !== 'production') {
            console.log(newContent);
          }
        }
      }
    }

    return NextResponse.json({
      model,
      text: out,
    });
  } catch (error: any) {
    console.error('Inference error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to complete inference request' },
      { status: 500 },
    );
  }
}
