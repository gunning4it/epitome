import DocPage from '@/components/docs/DocPage';
import { CodeBlock } from '@/components/CodeBlock';

const headings = [
  { id: 'what-it-is', text: 'What It Is', level: 2 },
  { id: 'install', text: 'Install', level: 2 },
  { id: 'generate-text', text: 'generateText Example', level: 2 },
  { id: 'stream-text', text: 'streamText Example', level: 2 },
  { id: 'tool-behavior', text: 'Tool Behavior', level: 2 },
];

export default function JavaScriptSdkAiTools() {
  return (
    <DocPage
      title="JavaScript SDK + AI SDK Tools"
      description="Use @epitomefyi/sdk with Vercel AI SDK tool calling."
      headings={headings}
    >
      <p className="text-muted-foreground mb-6">
        The SDK ships an AI SDK adapter at
        <code className="text-foreground bg-muted px-1 rounded mx-1">@epitomefyi/sdk/ai-sdk</code>
        so you can expose Epitome memory tools directly in model tool-calling flows.
      </p>

      <h2 id="what-it-is" className="text-xl font-semibold mt-8 mb-4">What It Is</h2>
      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-2 mb-6 ml-2">
        <li><code className="text-foreground bg-muted px-1 rounded">searchMemory</code>: semantic retrieval.</li>
        <li><code className="text-foreground bg-muted px-1 rounded">saveMemory</code>: write new memory entries.</li>
        <li><code className="text-foreground bg-muted px-1 rounded">getUserContext</code>: structured context snapshot.</li>
      </ul>

      <h2 id="install" className="text-xl font-semibold mt-10 mb-4">Install</h2>
      <CodeBlock
        language="bash"
        code={`npm install @epitomefyi/sdk ai @ai-sdk/openai`}
      />
      <p className="text-muted-foreground mt-3 mb-4">
        SDK package page:{' '}
        <a
          href="https://www.npmjs.com/package/@epitomefyi/sdk"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:underline"
        >
          npmjs.com/package/@epitomefyi/sdk
        </a>
      </p>

      <h2 id="generate-text" className="text-xl font-semibold mt-10 mb-4">generateText Example</h2>
      <CodeBlock
        language="ts"
        code={`import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { epitomeTools } from '@epitomefyi/sdk/ai-sdk';

const tools = epitomeTools({
  apiKey: process.env.EPITOME_API_KEY!,
  // Optional:
  // baseUrl: 'http://localhost:3000',
  collectionDefaults: {
    searchMemory: 'memories',
    saveMemory: 'memories',
  },
});

const result = await generateText({
  model: openai('gpt-4o-mini'),
  tools,
  prompt: 'What do you know about my project priorities?',
});

console.log(result.text);`}
      />

      <h2 id="stream-text" className="text-xl font-semibold mt-10 mb-4">streamText Example</h2>
      <CodeBlock
        language="ts"
        code={`import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { epitomeTools } from '@epitomefyi/sdk/ai-sdk';

const { textStream } = streamText({
  model: openai('gpt-4o-mini'),
  tools: epitomeTools({ apiKey: process.env.EPITOME_API_KEY! }),
  prompt: 'Save that I prefer short updates, then summarize what you stored.',
});

for await (const chunk of textStream) {
  process.stdout.write(chunk);
}`}
      />

      <h2 id="tool-behavior" className="text-xl font-semibold mt-10 mb-4">Tool Behavior</h2>
      <p className="text-muted-foreground mb-4">
        If you pass an existing
        <code className="text-foreground bg-muted px-1 rounded mx-1">EpitomeClient</code>,
        the tool adapter uses that instance. Otherwise it creates one from `apiKey`/`baseUrl`.
      </p>
      <CodeBlock
        language="ts"
        code={`import { EpitomeClient } from '@epitomefyi/sdk';
import { epitomeTools } from '@epitomefyi/sdk/ai-sdk';

const client = new EpitomeClient({ apiKey: process.env.EPITOME_API_KEY! });
const tools = epitomeTools({ client });`}
      />
    </DocPage>
  );
}
