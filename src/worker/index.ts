import { app } from './app'
import type { AppEnv } from './http'

export default { fetch: app.fetch } satisfies ExportedHandler<AppEnv>
