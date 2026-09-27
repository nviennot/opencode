import type { RGBA } from "@opentui/core"
import { createMemo, Index, Show } from "solid-js"

export function streamingPatch(raw: string): string {
  if (raw.startsWith("*** Begin Patch")) return raw
  // Consume only complete JSON escapes so a chunk ending in a backslash or
  // partial Unicode escape can be displayed safely before the next chunk arrives.
  const match = /^\s*\{\s*"patchText"\s*:\s*"((?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*)/.exec(raw)
  return match ? JSON.parse('"' + match[1] + '"') : ""
}

export function PatchPreview(props: {
  text: string
  colors: { text: RGBA; textMuted: RGBA; diffAdded: RGBA; diffRemoved: RGBA }
}) {
  const lines = createMemo(() => props.text.trimEnd().split("\n"))
  const file = createMemo(() =>
    lines()
      .findLast((line) => /^\*\*\* (?:Add|Update|Delete) File: /.test(line))
      ?.replace(/^\*\*\* /, ""),
  )

  return (
    <box paddingLeft={1}>
      <text fg={props.colors.textMuted} wrapMode="none">
        {file() ? file() + " · " : ""}
        {lines().length} line{lines().length === 1 ? "" : "s"} received
      </text>
      <Show when={lines().length > 20}>
        <text fg={props.colors.textMuted}>… {lines().length - 20} earlier lines</text>
      </Show>
      <Index each={lines().slice(-20)}>
        {(line) => (
          <text
            wrapMode="none"
            fg={
              line().startsWith("+")
                ? props.colors.diffAdded
                : line().startsWith("-")
                  ? props.colors.diffRemoved
                  : props.colors.text
            }
          >
            {line()}
          </text>
        )}
      </Index>
    </box>
  )
}
