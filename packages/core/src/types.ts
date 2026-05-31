export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonSchema = {
  type?: string
  enum?: JsonValue[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  [key: string]: unknown
}

export type WorkflowMeta = {
  name: string
  description: string
  phases: Array<{ title: string }>
}

export type AgentRunInput = {
  prompt: string
  label?: string | undefined
  phase?: string | undefined
  agentType?: string | undefined
  model?: string | undefined
  schema?: JsonSchema | undefined
  cwd?: string | undefined
  skills?: string[] | undefined
  metadata?: Record<string, unknown> | undefined
}

export type AdapterContext = {
  runId: string
  runDir: string
  effectId: string
}

export type AgentRunResult = {
  output: unknown
  transcriptRef?: string | undefined
  usage?: unknown
}

export type AgentAdapter = {
  name: string
  run(input: AgentRunInput, ctx: AdapterContext): Promise<AgentRunResult>
}

export type WorkflowRunResult = {
  status: 'completed' | 'failed' | 'running'
  runId: string
  runDir: string
  eventsPath: string
  statePath: string
  scriptPath: string
  meta: WorkflowMeta
  workflowResult: unknown
}

export type RuntimeOptions = {
  args?: Record<string, unknown>
  adapter: AgentAdapter
  cwd: string
  runsDir: string
  runId?: string
  output?: 'pretty' | 'json'
}
