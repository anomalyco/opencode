import { test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { Image } from "../src/image"
import { Instance } from "../src/instance"
import { Location } from "../src/location"
import { AbsolutePath } from "../src/schema"

class External extends Context.Service<External, string>()("test/InstanceExternal") {}
class BootError {
  readonly _tag = "InstanceBootError"
}

const check = () => {
  const ref = Location.Ref.make({ directory: AbsolutePath.make("/") })
  const open = Instance.compose(ref)
  const honest: Layer.Layer<Instance.Services, Instance.Error, Instance.Globals> = open
  // @ts-expect-error Shared infrastructure is required, not secretly booted.
  const closed: Layer.Layer<Instance.Services, Instance.Error> = open
  const replacement = Layer.effect(Image.Service, External.pipe(Effect.andThen(Effect.fail(new BootError()))))
  const advanced = Instance.compose(ref, { replacements: [[Image.node, replacement]] })
  const requirements: Layer.Layer<Instance.Services, Instance.Error | BootError, Instance.Globals | External> = advanced
  // @ts-expect-error Raw replacement layers retain their external requirements.
  const missing: Layer.Layer<Instance.Services, Instance.Error | BootError, Instance.Globals> = advanced
  // @ts-expect-error Raw replacement layers retain their acquisition errors.
  const errors: Layer.Layer<Instance.Services, Instance.Error, Instance.Globals | External> = advanced
  // @ts-expect-error Raw replacements must still provide the original service.
  Instance.compose(ref, { replacements: [[Image.node, Layer.succeed(External, "wrong output")]] })
  void [honest, closed, requirements, missing, errors]
}
void check

test("instance composition types compile", () => {})
