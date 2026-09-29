import { app } from './app'
import type { AppEnv } from './http'
import { runScheduled } from './scheduled'

const scheduled: ExportedHandlerScheduledHandler<AppEnv> = (controller, env) =>
  runScheduled(controller.cron, env, controller.scheduledTime)

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<AppEnv>
