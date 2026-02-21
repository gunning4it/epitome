import DocPage from '@/components/docs/DocPage';
import { CodeBlock } from '@/components/CodeBlock';

const headings = [
  { id: 'what-it-is', text: 'What It Is', level: 2 },
  { id: 'enable-it', text: 'Enable It', level: 2 },
  { id: 'openai', text: 'OpenAI Quickstart', level: 2 },
  { id: 'anthropic', text: 'Anthropic Quickstart', level: 2 },
  { id: 'headers', text: 'Router Headers', level: 2 },
  { id: 'verify', text: 'Verify It Works', level: 2 },
  { id: 'troubleshooting', text: 'Troubleshooting', level: 2 },
];

export default function MemoryRouter() {
  return (
    <DocPage
      title="Memory Router (LLM Proxy)"
      description="Add Epitome memory to existing OpenAI or Anthropic apps by routing model calls through Epitome."
      headings={headings}
    >
      <h2 id="what-it-is" className="text-xl font-semibold mt-8 mb-4">What It Is</h2>
      <p className="text-muted-foreground mb-4">
        Memory Router is an HTTP proxy layer in front of supported LLM APIs. It retrieves relevant
        context before model calls and saves conversation turns asynchronously after responses.
      </p>
      <p className="text-muted-foreground mb-6">
        v1 supports OpenAI chat completions and Anthropic messages. It is designed for fast adoption:
        change base URL + headers, keep the rest of your app flow.
      </p>

      <h2 id="enable-it" className="text-xl font-semibold mt-10 mb-4">Enable It</h2>
      <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-2 mb-6 ml-2">
        <li>Open <strong className="text-foreground">Settings → Memory Router</strong> in the dashboard.</li>
        <li>Toggle <strong className="text-foreground">Enable Memory Router</strong>.</li>
        <li>Set a default collection (for example <code className="text-foreground bg-muted px-1 rounded">memories</code> or <code className="text-foreground bg-muted px-1 rounded">journal</code>).</li>
      </ol>

      <h2 id="openai" className="text-xl font-semibold mt-10 mb-4">OpenAI Quickstart</h2>
      <p className="text-muted-foreground mb-3">
        Use your Epitome key in <code className="text-foreground bg-muted px-1 rounded">X-API-Key</code> and your OpenAI key
        in Authorization.
      </p>
      <CodeBlock
        language="bash"
        code={`curl -X POST "https://epitome.fyi/v1/memory-router/openai/v1/chat/completions" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: epi_live_your_epitome_key" \\
  -H "Authorization: Bearer sk-your-openai-key" \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "What do you know about my project priorities?"}
    ]
  }'`}
      />

      <h2 id="anthropic" className="text-xl font-semibold mt-10 mb-4">Anthropic Quickstart</h2>
      <p className="text-muted-foreground mb-3">
        For Anthropic, pass provider auth via <code className="text-foreground bg-muted px-1 rounded">x-anthropic-api-key</code>.
      </p>
      <CodeBlock
        language="bash"
        code={`curl -X POST "https://epitome.fyi/v1/memory-router/anthropic/v1/messages" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: epi_live_your_epitome_key" \\
  -H "x-anthropic-api-key: sk-ant-your-anthropic-key" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "claude-3-5-sonnet-latest",
    "max_tokens": 512,
    "messages": [
      {"role": "user", "content": "Summarize what you already know about me."}
    ]
  }'`}
      />

      <h2 id="headers" className="text-xl font-semibold mt-10 mb-4">Router Headers</h2>
      <p className="text-muted-foreground mb-3">
        Optional headers for controlling memory behavior per request:
      </p>
      <CodeBlock
        language="text"
        code={`x-epitome-memory-mode: auto | off
x-epitome-memory-collection: <collection-name>
x-epitome-idempotency-key: <unique-key>`}
      />
      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-6 ml-2 mt-3">
        <li><strong className="text-foreground">auto</strong> (default): retrieve + inject context, then async save.</li>
        <li><strong className="text-foreground">off</strong>: raw proxy pass-through (no retrieval, no save).</li>
      </ul>

      <h2 id="verify" className="text-xl font-semibold mt-10 mb-4">Verify It Works</h2>
      <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-2 mb-6 ml-2">
        <li>Enable Memory Router in Settings.</li>
        <li>Send a request that includes personal/project facts.</li>
        <li>Send a follow-up query that depends on prior context.</li>
        <li>Check Memories and Activity pages for write + audit entries.</li>
      </ol>

      <h2 id="troubleshooting" className="text-xl font-semibold mt-10 mb-4">Troubleshooting</h2>
      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-2 mb-2 ml-2">
        <li><strong className="text-foreground">403 FEATURE_DISABLED:</strong> Enable Memory Router in Settings.</li>
        <li><strong className="text-foreground">403 CONSENT_DENIED:</strong> Grant profile/vectors permissions for the calling agent.</li>
        <li><strong className="text-foreground">400 MISSING_PROVIDER_AUTH:</strong> Missing provider key/header for the selected provider.</li>
        <li><strong className="text-foreground">413 PAYLOAD_TOO_LARGE:</strong> Request payload exceeds max proxy size.</li>
      </ul>
    </DocPage>
  );
}
