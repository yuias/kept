export interface MeResponse {
  email: string
  name: string
  authenticated: boolean
  stale: boolean
  dev: boolean
}

export interface ApiErrorBody {
  error: string
  message: string
}
