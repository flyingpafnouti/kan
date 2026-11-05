import mermaid from 'mermaid'
import { CHAT_URL, MissingKeyError, getGroqKey } from './transcribe'

/*
 * Experimental, dev only: a sketch turned into Mermaid by a vision model on Groq.
 * The model is small, so the prompt narrows its choices: few diagram types, one template each, a plan before the code.
 * Its code is parsed by Mermaid here, and sent back with the error until it parses.
 */

/** The only vision model of the account's Groq list; another one can be tried from .env.local. */
const MODEL = (import.meta.env.VITE_GROQ_VISION_MODEL as string | undefined) || 'qwen/qwen3.8-27b'
/** Corrections asked after the first answer. */
const MAX_FIXES = 2

const SYSTEM_PROMPT = `You convert a hand drawn sketch into Mermaid code that renders without error.
You receive an IMAGE of the sketch and a TEXT DESCRIPTION extracted from the drawing editor.
The description is exact for "attached" connectors and shape labels: trust it over the image.
The image tells you what the description misses: free hand strokes, handwriting, the overall layout.

STEP 1. Choose ONE diagram type:
- flowchart: boxes joined by arrows or lines. This is the DEFAULT. Choose it when unsure.
- sequenceDiagram: actors side by side at the top with vertical lifelines and horizontal messages between them.
- stateDiagram-v2: states and transitions, with a start dot or the words state/start/idle.
- mindmap: one central idea with branches and no arrow heads.
Never use any other type.

STEP 2. Write a PLAN in plain text:
- the direction: LR if the sketch is wider than tall, else TD;
- every node: its id and its label;
- every edge: from id, to id, arrow or line, label if any.
Node ids are n1, n2, n3... in the order of the description. Keep the labels written in the sketch, same language, same spelling. Do not translate. Do not invent nodes or edges that are not drawn.

STEP 3. Write the code, copying the template of the chosen type.

FLOWCHART TEMPLATE:
flowchart TD
    n1["Start"]
    n2["Read the file"]
    n3{"Valid?"}
    n4(["Done"])
    n1 --> n2
    n2 --> n3
    n3 -->|"yes"| n4
    n3 --- n1
Shapes: rectangle n1["text"], ellipse or circle n1(["text"]), diamond n1{"text"}, cylinder n1[("text")].
Edges: arrow -->, line without head ---, dotted arrow -.->, label on an edge -->|"text"|.

SEQUENCE TEMPLATE:
sequenceDiagram
    participant n1 as Client
    participant n2 as Server
    n1->>n2: request
    n2-->>n1: answer

STATE TEMPLATE:
stateDiagram-v2
    state "Waiting" as n1
    state "Running" as n2
    [*] --> n1
    n1 --> n2: start
    n2 --> [*]

MINDMAP TEMPLATE (hierarchy by indentation, 4 spaces per level, plain words, no brackets):
mindmap
    root((Main idea))
        Branch one
            Detail
        Branch two

RULES. Each one matters, a single mistake breaks the diagram:
1. The first line of the code is the diagram keyword. Nothing before it.
2. Ids are n1, n2, n3... Never a word as an id. Never "end".
3. In a flowchart, EVERY label is in double quotes: n1["text"], -->|"text"|.
4. Never a double quote inside a label: write #quot; instead. No [ ] { } inside a label.
5. A line break inside a label is <br/>. No other HTML.
6. Declare every node once with its label, then write the edges with ids only.
7. One statement per line. Spaces for indentation, never tabs.
8. Only straight ASCII quotes ". Never “ ” « ».
9. No comment, no style, no classDef, no subgraph, no click.
10. A drawn shape without text gets the label " " (a space in quotes).
11. A math formula (TeX) becomes plain text in the label, e.g. "x = a/b".

OUTPUT FORMAT, exactly:
PLAN:
<your plan>
CODE:
\`\`\`mermaid
<the code>
\`\`\``

const FIX_PROMPT = (error: string) => `Mermaid could not parse your code. The error:
${error}

Find the faulty line, check it against the RULES and the template, and answer again in the same OUTPUT FORMAT, with the whole corrected code.`

type Message = { role: 'system' | 'user' | 'assistant'; content: string | object[] }

export type SketchResult = { code: string; model: string; attempts: number; error?: string; plan: string }

async function chat(key: string, messages: Message[]) {
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0,
      // Thinking first helps a small model; parsed keeps the reasoning out of the answer.
      reasoning_effort: 'medium',
      reasoning_format: 'parsed',
      max_completion_tokens: 8192,
    }),
  })
  if (res.status === 401) throw new MissingKeyError()
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const { choices } = (await res.json()) as { choices: { message: { content: string | null } }[] }
  return { text: choices[0]?.message.content ?? '', model: MODEL }
}

/** The code of the answer, cleaned of what small models get wrong without meaning it. */
export function extractCode(answer: string) {
  const fenced = answer.match(/```(?:mermaid)?[ \t]*\n([\s\S]*?)```/)
  let code = fenced ? fenced[1] : (answer.split(/CODE:\s*/i)[1] ?? answer)
  code = code
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[ ​‌‍﻿]/g, ' ')
    .replace(/\t/g, '    ')
    .replace(/^\s*graph\s+(TD|TB|BT|LR|RL)\b/m, 'flowchart $1')
  // Text before the keyword (a stray "mermaid" line, a sentence) breaks detection.
  const lines = code.split('\n')
  const start = lines.findIndex((l) => /^\s*(flowchart|sequenceDiagram|stateDiagram-v2|stateDiagram|mindmap)\b/.test(l))
  return (start > 0 ? lines.slice(start) : lines).join('\n').trim()
}

const planOf = (answer: string) => answer.match(/PLAN:\s*([\s\S]*?)(?:CODE:|```|$)/i)?.[1].trim() ?? ''

async function parseError(code: string) {
  try {
    await mermaid.parse(code)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/** Mermaid code for the sketch, its image a data URL and its description from describeDrawing. */
export async function sketchToMermaid(image: string, description: string): Promise<SketchResult> {
  const key = await getGroqKey()
  if (!key) throw new MissingKeyError()
  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: `TEXT DESCRIPTION:\n${description}\n\nNow follow STEP 1, STEP 2, STEP 3.` },
        { type: 'image_url', image_url: { url: image } },
      ],
    },
  ]
  let result: SketchResult | null = null
  let plan = ''
  for (let attempt = 1; attempt <= MAX_FIXES + 1; attempt++) {
    const { text, model } = await chat(key, messages)
    const code = extractCode(text)
    const error = await parseError(code)
    plan = planOf(text) || plan
    result = { code, model, attempts: attempt, plan, error: error ?? undefined }
    if (!error) break
    messages.push({ role: 'assistant', content: text }, { role: 'user', content: FIX_PROMPT(error) })
  }
  return result!
}
