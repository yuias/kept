import type { ApiErrorBody } from '../../shared/types'
import type { Messages } from '../locales/en'

/**
 * Maps a Worker error code to its localized wording. Codes come from the
 * `onError` status mapping in `src/worker/http.ts`; an unrecognised code
 * (a newer Worker than this build knows about) falls back to the message the
 * Worker sent, which is always English but at least specific.
 */
export function describeApiError(body: ApiErrorBody, messages: Messages): string {
  switch (body.error) {
    case 'bad_request':
      return messages.errors.badRequest
    case 'unauthorized':
      return messages.errors.unauthorized
    case 'session_stale':
      return messages.errors.sessionStale
    case 'not_found':
      return messages.errors.notFound
    case 'conflict':
      return messages.errors.conflict
    case 'payload_too_large':
      return messages.errors.payloadTooLarge
    case 'unsupported_media_type':
      return messages.errors.unsupportedMediaType
    case 'bad_gateway':
      return messages.errors.badGateway
    case 'internal_error':
      return messages.errors.internalError
    default:
      return body.message
  }
}
