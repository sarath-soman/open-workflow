export const meta = {
  name: 'error-path',
  description: 'a single agent effect — driven to fail via an invalid model to prove clean failure',
  phases: [],
}

const r = await agent('Reply with the word ok.', { label: 'will-fail' })

return { r }
