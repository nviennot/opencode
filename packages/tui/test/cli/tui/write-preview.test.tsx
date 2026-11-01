import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { WritePreview, streamingWrite } from "../../../src/component/write-preview"
import { createAppFixture } from "../../fixture/app"
import { directory, json } from "../../fixture/tui-client"

let app: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  app?.renderer.destroy()
  app = undefined
})

test("decodes Write fields in either order at every chunk boundary", () => {
  const path = "test.ts"
  const content = 'const text = "hello\\world"\n\t雪\n{"path":"not-a-path","content":"nested"}'
  for (const input of [{ path, content }, { content, path }]) {
    const raw = JSON.stringify(input).replace("雪", "\\u96ea")
    for (let end = 0; end <= raw.length; end++) {
      const value = streamingWrite(raw.slice(0, end))
      expect(path.startsWith(value.path ?? "")).toBe(true)
      expect(content.startsWith(value.content ?? "")).toBe(true)
    }
    expect(streamingWrite(raw)).toEqual({ path, content })
  }
  expect(streamingWrite('{"path":"test.ts","content":"line\\')).toEqual({ path, content: "line" })
  expect(streamingWrite('{"content":"line\\nnext')).toEqual({ content: "line\nnext" })
  expect(streamingWrite('{"content":"\\u96')).toEqual({ content: "" })
  expect(streamingWrite('{"content":"\\u96ea')).toEqual({ content: "雪" })
  expect(streamingWrite('{"content":')).toEqual({})
  expect(streamingWrite(' { "path" : "test.ts" , "content" : "text" }')).toEqual({ path, content: "text" })
})

test("shows plain incoming content and keeps the latest 20 lines visible", async () => {
  const [raw, setRaw] = createSignal('{"path":"test.ts","content":"+plain\\n-plain\\nconst val')
  app = await testRender(
    () => (
      <WritePreview
        text={streamingWrite(raw()).content ?? ""}
        colors={{ text: RGBA.fromHex("#ffffff"), textMuted: RGBA.fromHex("#808080") }}
      />
    ),
    { width: 80, height: 28 },
  )
  await app.renderOnce()
  expect(app.captureCharFrame()).toContain("+plain")
  expect(app.captureCharFrame()).toContain("-plain")
  expect(app.captureCharFrame()).toContain("const val")
  expect(app.captureCharFrame()).toContain("3 lines received")

  setRaw((value) => value + "ue = 1\\n" + Array.from({ length: 20 }, (_, i) => `line ${i}\\n`).join(""))
  await app.renderOnce()
  const frame = app.captureCharFrame()
  expect(frame).toContain("23 lines received")
  expect(frame).toContain("3 earlier lines")
  expect(frame).toContain("line 0")
  expect(frame).toContain("line 19")
  expect(frame).not.toContain("const value")
  expect(frame).not.toContain("+plain")
})

test.each([48, 100])("renders streaming Write input in the session at %i columns", async (width) => {
  const session = {
    id: "ses_write_preview",
    title: "Write preview",
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
              id: "msg_write_preview",
              type: "assistant",
              agent: "build",
              model: { providerID: "fixture", id: "fixture" },
              time: { created: 1 },
              content: [
                {
                  type: "tool",
                  id: "call_write",
                  name: "write",
                  time: { created: 1 },
                  state: {
                    status: "streaming",
                    input: '{"path":"test.ts","content":"const first = 1\\nconst second = 2',
                  },
                },
              ],
            },
            { id: "msg_write_user", type: "user", text: "Write the file", time: { created: 0 } },
          ],
          cursor: {},
        })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("const second = 2"))
  const frame = setup.captureCharFrame()
  expect(frame).toContain("Writing")
  expect(frame).toContain("test.ts")
  expect(frame).toContain("2 lines received")
  expect(frame).toContain("const first = 1")
})
