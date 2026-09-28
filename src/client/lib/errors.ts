import type { Messages } from '../locales/en'
import { ApiError } from './api'

/**
 * Maps an `ApiError` to its localized wording. Codes come either from the
 * `onError` status mapping in `src/worker/http.ts`, from a specific
 * `ApiException` thrown by a route, or from `request()` itself when the
 * response never reached the Worker (Access redirects, network failures). An
 * unrecognised code (a newer Worker than this build knows about) falls back
 * to the message the Worker sent, which is always English but at least
 * specific.
 */
export function describeApiError(error: unknown, messages: Messages): string {
  if (!(error instanceof ApiError)) return messages.errors.internalError

  switch (error.code) {
    case 'bad_request':
      return messages.errors.badRequest
    case 'bad_query':
      return messages.errors.badQuery
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
    case 'invalid_url':
      return messages.errors.invalidUrl
    case 'blocked_host':
      return messages.errors.blockedHost
    case 'internal_error':
      return messages.errors.internalError
    case 'folder_not_found':
      return messages.errors.folderNotFound
    case 'folder_too_deep':
      return messages.errors.folderTooDeep
    case 'folder_cycle':
      return messages.errors.folderCycle
    case 'format_locked':
      return messages.errors.formatLocked
    case 'note_trashed':
      return messages.errors.noteTrashed
    case 'note_not_trashed':
      return messages.errors.noteNotTrashed
    case 'network':
      return messages.errors.network
    case 'session_expired':
      return messages.errors.sessionStale
    case 'unexpected_response':
      return messages.errors.internalError
    default:
      return error.message
  }
}
