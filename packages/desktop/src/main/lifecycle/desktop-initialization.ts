export * as DesktopInitialization from "./desktop-initialization"

import { app } from "electron"
import { Context, Effect, Layer } from "effect"
import { readdir } from "node:fs/promises"
import { DesktopLogging } from "../native/logging"
import { marks } from "./marks"
import {
  loadProxyEnvironment,
  preferApplicationEnvironment,
  prepareApplicationEnvironment,
  prepareDesktop,
} from "./environment"

export interface Interface {
  readonly version: string
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/DesktopInitialization") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const logging = yield* DesktopLogging.Service
    yield* preferApplicationEnvironment
    // System certificates, the proxy and the net log serve later network work; the first window and
    // its IPC port do not wait for them.
    yield* Effect.forkScoped(
      prepareApplicationEnvironment.pipe(Effect.andThen(loadProxyEnvironment), Effect.andThen(logging.startNetwork)),
    )
    yield* Effect.promise(() => app.whenReady())
    yield* prepareDesktop

    // Reading each protected folder once makes macOS ask for access at launch instead of mid-session.
    if (process.platform === "darwin")
      yield* Effect.forkScoped(
        Effect.forEach(
          ["desktop", "documents", "downloads"] as const,
          (name) => Effect.tryPromise(() => readdir(app.getPath(name))).pipe(Effect.ignore),
          { discard: true },
        ),
      )
    marks.init = Date.now()

    return Service.of({
      version: app.getVersion(),
    })
  }),
)
