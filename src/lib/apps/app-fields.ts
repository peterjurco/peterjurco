export interface AppFields {
  name?: string
  url?: string
  iconKey?: string | null
  sortOrder?: number
}

/**
 * Validates any app fields present on a request body — shared by the create
 * (POST /api/apps) and patch (PATCH /api/apps/:id) handlers. Returns the
 * fields, or an error string naming the bad one.
 */
export function parseAppFields(
  body: Record<string, unknown>,
): AppFields | string {
  const fields: AppFields = {}
  if ('name' in body) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return 'name must be a non-empty string'
    }
    fields.name = body.name.trim()
  }
  if ('url' in body) {
    if (typeof body.url !== 'string' || !body.url.startsWith('https://')) {
      return 'url must start with https://'
    }
    fields.url = body.url
  }
  if ('iconKey' in body) {
    if (body.iconKey !== null && typeof body.iconKey !== 'string') {
      return 'iconKey must be a string or null'
    }
    fields.iconKey = body.iconKey as string | null
  }
  if ('sortOrder' in body) {
    if (
      typeof body.sortOrder !== 'number' ||
      !Number.isInteger(body.sortOrder)
    ) {
      return 'sortOrder must be an integer'
    }
    fields.sortOrder = body.sortOrder
  }
  return fields
}
