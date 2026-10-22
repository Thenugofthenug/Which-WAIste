export const REQUEST_TIMEOUT_MS = 30_000

export async function api(path, data) {
  const controller = new AbortController()
  let timer
  async function request() {
    const response = await fetch(`/api${path}`, { signal: controller.signal, ...(data === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    }) })
    let body
    try { body = await response.json() }
    catch {
      if (response.ok) throw new Error('The server returned an incomplete response. Please retry.')
      body = {}
    }
    if (!response.ok) {
      const error = new Error(typeof body?.detail === 'string' ? body.detail : 'That request could not be saved. Please retry.')
      error.status = response.status
      throw error
    }
    return body
  }
  try {
    // Bound the whole response, including JSON. A timeout can follow a saved
    // request, so callers decide how to recover rather than repeating a POST.
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('The request took too long. The server may be waking up. Your progress may already be saved; please retry.')
        error.name = 'TimeoutError'
        reject(error)
        controller.abort()
      }, REQUEST_TIMEOUT_MS)
    })
    return await Promise.race([request(), timeout])
  } finally { clearTimeout(timer) }
}
