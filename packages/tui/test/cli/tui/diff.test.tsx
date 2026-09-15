import { afterEach, expect, test } from "bun:test"
import { DiffRenderable, type BoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { DiffView } from "../../../src/component/diff"

let app: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  app?.renderer.destroy()
  app = undefined
})

const header = "--- a/file.txt\n+++ b/file.txt\n"
const first = `@@ -203,3 +203,3 @@
 beforeFirst
-oldFirst
+newFirst
 afterFirst
`
const second = `@@ -501,2 +501,2 @@
 beforeSecond
-oldSecond
+newSecond
\\ No newline at end of file
`

test.each(["unified", "split"] as const)("separates diff hunks in %s view", async (view) => {
  let root: BoxRenderable | undefined
  app = await testRender(
    () => (
      <DiffView
        ref={(element) => (root = element)}
        diff={header + first.replace("beforeFirst", "beforeFirst " + "long content ".repeat(8)) + second}
        view={view}
        separatorColor="#808080"
        showLineNumbers={true}
        width="100%"
        wrapMode="word"
      />
    ),
    { width: 90, height: 20 },
  )
  await app.waitForFrame((frame) => frame.includes("newSecond"))
  const lines = app.captureCharFrame().split("\n")
  const divider = lines.findIndex((line) => line.includes("\u2500"))
  expect(lines.filter((line) => line.includes("\u2500"))).toHaveLength(1)
  expect(lines[divider].trim()).toBe("\u2500".repeat(90))
  expect(lines[divider - 1]).toContain("205")
  expect(lines[divider - 1]).toContain("afterFirst")
  expect(lines[divider + 1]).toContain("501")
  expect(lines[divider + 1]).toContain("beforeSecond")
  expect(lines.join("\n")).toContain("oldFirst")
  expect(lines.join("\n")).toContain("newFirst")
  expect(lines.join("\n")).not.toContain("No newline")
  expect(root!.getChildren().filter((child) => child instanceof DiffRenderable)).toHaveLength(2)

  app.resize(50, 40)
  await app.flush()
  const resized = app.captureCharFrame().split("\n")
  const next = resized.findIndex((line) => line.includes("\u2500"))
  expect(next).toBeGreaterThan(divider)
  expect(resized[next].trim()).toBe("\u2500".repeat(50))
  expect(resized[next - 1]).toContain("afterFirst")
  expect(resized[next + 1]).toContain("beforeSecond")
})

test("updates separators when the diff changes without adding a border to a single hunk", async () => {
  const [diff, setDiff] = createSignal(header + first)
  app = await testRender(() => <DiffView diff={diff()} separatorColor="#808080" />, { width: 50, height: 20 })
  await app.waitForFrame((frame) => frame.includes("newFirst"))
  expect(app.captureCharFrame()).not.toContain("\u2500")

  setDiff(header + first + second)
  await app.waitForFrame((frame) => frame.includes("newSecond"))
  expect(app.captureCharFrame()).toContain("\u2500".repeat(50))

  setDiff(header + second)
  await app.waitForFrame((frame) => !frame.includes("newFirst"))
  expect(app.captureCharFrame()).not.toContain("\u2500")
  expect(app.captureCharFrame()).toContain("newSecond")
})
