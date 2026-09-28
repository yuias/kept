import { app } from './app'
import { runBackup } from './backup'
import type { AppEnv } from './http'

const scheduled: ExportedHandlerScheduledHandler<AppEnv> = async (controller, env) => {
  try {
    await runBackup(env, controller.scheduledTime)
  } catch (error) {
    // Nothing notifies on a failed Cron Trigger, so the log and the errored
    // invocation in Cron Events are the only traces a failure leaves behind.
    console.error('backup failed', error)
    throw error
  }
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<AppEnv>
