import { env, pipeline } from '@huggingface/transformers'

/** Quantized: 279 MB. It ranked French paraphrases better than the 118 MB models and keeps noise under a clear bound. */
const MODEL = 'Xenova/paraphrase-multilingual-mpnet-base-v2'

type Extractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>

interface Progress {
  status: string
  file?: string
  progress?: number
}

env.allowLocalModels = false

let extractor: Promise<Extractor> | null = null

function load() {
  extractor ??= pipeline('feature-extraction', MODEL, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p: Progress) => {
      if (p.status === 'progress' && p.file?.endsWith('.onnx')) postMessage({ progress: p.progress })
    },
  }) as unknown as Promise<Extractor>
  return extractor
}

self.onmessage = async ({ data }: MessageEvent<{ id: number; texts: string[] }>) => {
  try {
    const embed = await load()
    const output = await embed(data.texts, { pooling: 'mean', normalize: true })
    const vectors = output.data.slice()
    postMessage({ id: data.id, vectors, size: output.dims[1] }, { transfer: [vectors.buffer] })
  } catch (e) {
    extractor = null
    postMessage({ id: data.id, error: String(e) })
  }
}
