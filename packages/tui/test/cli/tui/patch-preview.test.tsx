import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { PatchPreview, streamingPatch } from "../../../src/component/patch-preview"
import { createAppFixture } from "../../fixture/app"
import { directory, json } from "../../fixture/tui-client"

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

test.each([48, 100])("renders streaming patch input in the session at %i columns", async (width) => {
  const session = {
    id: "ses_patch_preview",
    title: "Patch preview",
    projectID: "proj_test",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  await using setup = await createAppFixture({
    width,
    height: 30,
    args: { sessionID: session.id },
    config: { animations: false, tabs: { enabled: false }, session: { verbosity: "high" } },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({
          data: [
            {
              id: "msg_patch_preview",
              type: "assistant",
              agent: "build",
              model: { providerID: "fixture", id: "fixture" },
              time: { created: 1 },
              content: [
                {
                  type: "tool",
                  id: "call_patch",
                  name: "patch",
                  time: { created: 1 },
                  state: {
                    status: "streaming",
                    input: '{"patchText":"*** Begin Patch\\n*** Update File: test.ts\\n-old\\n+new',
                  },
                },
              ],
            },
            { id: "msg_patch_user", type: "user", text: "Patch the file", time: { created: 0 } },
          ],
          cursor: {},
        })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("+new"))
  expect(setup.captureCharFrame()).toContain("4 lines received")
  expect(setup.captureCharFrame()).toContain("-old")
})
