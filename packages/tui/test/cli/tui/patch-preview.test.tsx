import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { PatchPreview, streamingPatch } from "../../../src/component/patch-preview"

let app: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  app?.renderer.destroy()
  app = undefined
})

test("decodes patch text at every chunk boundary, including incomplete JSON escapes", () => {
  const text = '*** Begin Patch\n*** Add File: test.ts\n+const text = "hello\\world"\n+\t雪\n*** End Patch'
  const raw = JSON.stringify({ patchText: text }).replace("雪", "\\u96ea")
  for (let end = 0; end <= raw.length; end++) {
    expect(text.startsWith(streamingPatch(raw.slice(0, end)))).toBe(true)
  }
  expect(streamingPatch(raw)).toBe(text)
  expect(streamingPatch('{"patchText":"line\\')).toBe("line")
  expect(streamingPatch('{"patchText":"line\\nnext')).toBe("line\nnext")
  expect(streamingPatch('{"patchText":"\\u96')).toBe("")
  expect(streamingPatch('{"patchText":"\\u96ea')).toBe("雪")
  expect(streamingPatch('{"patchText":')).toBe("")
  expect(streamingPatch(text)).toBe(text)
})

test("shows incoming patch lines and keeps the latest lines visible in a bounded preview", async () => {
  const [raw, setRaw] = createSignal('{"patchText":"*** Begin Patch\\n*** Update File: test.ts\\n-old\\n+ne')
  app = await testRender(
    () => (
      <PatchPreview
        text={streamingPatch(raw())}
        colors={{
          text: RGBA.fromHex("#ffffff"),
          textMuted: RGBA.fromHex("#808080"),
          diffAdded: RGBA.fromHex("#00ff00"),
          diffRemoved: RGBA.fromHex("#ff0000"),
        }}
      />
    ),
    { width: 80, height: 28 },
  )
  await app.waitForFrame((frame) => frame.includes("+ne"))
  expect(app.captureCharFrame()).toContain("-old")
  expect(app.captureCharFrame()).toContain("4 lines received")

  setRaw((value) => value + "w\\n" + Array.from({ length: 20 }, (_, i) => `+line ${i}\\n`).join(""))
  await app.waitForFrame((frame) => frame.includes("+line 19"))
  const frame = app.captureCharFrame()
  expect(frame).toContain("Update File: test.ts · 24 lines received")
  expect(frame).toContain("4 earlier lines")
  expect(frame).toContain("+line 0")
  expect(frame).not.toContain("+new")
  expect(frame).not.toContain("-old")
})
