import * as path from "path"
import Mocha from "mocha"
import { glob } from "glob"

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
  })

  const testsRoot = path.resolve(__dirname, "..")

  return new Promise((resolve, reject) => {
    glob("**/**.test.js", { cwd: testsRoot })
      .then((files) => {
        files.forEach((f: string) => {
          mocha.addFile(path.resolve(testsRoot, f))
        })

        // Also include E2E tests
        glob("**/**.e2e.js", { cwd: testsRoot })
          .then((e2eFiles) => {
            e2eFiles.forEach((f: string) => {
              mocha.addFile(path.resolve(testsRoot, f))
            })

            try {
              mocha.run((failures: number) => {
                if (failures > 0) {
                  reject(new Error(`${failures} tests failed.`))
                } else {
                  resolve()
                }
              })
            } catch (err) {
              reject(err)
            }
          })
          .catch(reject)
      })
      .catch(reject)
  })
}
