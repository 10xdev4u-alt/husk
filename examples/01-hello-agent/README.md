# Example 01 — Hello Agent

The smallest possible Husk agent. No tools, no memory, no steering.
Just a model and a prompt.

## Run it

```bash
# Set your API key
export ANTHROPIC_API_KEY=sk-...

# From the husk repo root:
bun run examples/01-hello-agent/index.ts
```

You should see a short answer to "What is the capital of France?" plus
token usage and iteration count in the structured log output.

## What this demonstrates

- Importing from the single public API surface
- Constructing an `Agent` with just a model
- Awaiting `agent.run()` for a final `AgentResult`
- Inspecting `result.usage` (token counts) and `result.iterations`
- The default `ConsoleLogger` automatically subscribes to events

## Try changing it

- Swap `AnthropicProvider` for `OpenAIProvider` to verify provider swap is a one-line change.
- Add `temperature: 0.7` to the config to get more creative answers.
- Wrap with `try/catch` and log `result.messages` to see the full conversation.
