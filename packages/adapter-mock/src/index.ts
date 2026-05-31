import type {
  AdapterContext,
  AgentAdapter,
  AgentRunInput,
  JsonSchema,
  JsonValue,
} from '@open-workflow/core'

export type MockAdapterConfig = {
  responses?: Record<string, unknown>
}

export function createMockAdapter(config: MockAdapterConfig = {}): AgentAdapter {
  const responses = config.responses || {}
  const adapter: AgentAdapter = {
    name: 'mock',
    async run(input: AgentRunInput, ctx: AdapterContext) {
      const key = input.label || input.agentType || ctx.effectId
      const output =
        key in responses
          ? responses[key]
          : '*' in responses
            ? responses['*']
            : synthesizeOutput(input, key)
      return {
        output,
        transcriptRef: `mock://${ctx.runId}/${ctx.effectId}`,
        usage: { inputTokens: 0, outputTokens: 0 },
      }
    },
  }
  return adapter
}

function synthesizeOutput(input: AgentRunInput, key: string): unknown {
  if (!input.schema) return `mock output for ${key}`
  return synthesizeFromSchema(input.schema)
}

function synthesizeFromSchema(schema: JsonSchema): JsonValue {
  if (schema.enum?.length) return schema.enum[0] ?? null
  if (schema.type === 'object') {
    const out: Record<string, JsonValue> = {}
    for (const [name, child] of Object.entries(schema.properties || {})) {
      if (!schema.required || schema.required.includes(name))
        out[name] = synthesizeFromSchema(child)
    }
    return out
  }
  if (schema.type === 'array') return []
  if (schema.type === 'number' || schema.type === 'integer') return 0
  if (schema.type === 'boolean') return false
  return ''
}
