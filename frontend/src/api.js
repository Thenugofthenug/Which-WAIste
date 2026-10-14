export async function api(path, data) {
  const response = await fetch(`/api${path}`, data === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(typeof body.detail === 'string' ? body.detail : 'That request could not be saved. Please retry.')
    error.status = response.status
    throw error
  }
  return body
}
