import type { RGBA } from "@opentui/core"
import { createMemo, Index, Show } from "solid-js"

export function streamingWrite(raw: string): { path?: string; content?: string } {
  // Write's string fields can arrive in either order. Stay anchored to field
  // boundaries and consume only complete escapes in an unfinished value.
  return Object.fromEntries(
    Array.from(
      raw.matchAll(
        /(?:^\s*\{|,)\s*"(path|content)"\s*:\s*"((?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*)"?\s*/gy,
      ),
      (match) => [match[1], JSON.parse('"' + match[2] + '"')],
    ),
  )
}

export function WritePreview(props: { text: string; colors: { text: RGBA; textMuted: RGBA } }) {
  const lines = createMemo(() => props.text.trimEnd().split("\n"))

  return (
    <box paddingLeft={1}>
      <text fg={props.colors.textMuted} wrapMode="none">
        {lines().length} line{lines().length === 1 ? "" : "s"} received
      </text>
      <Show when={lines().length > 20}>
        <text fg={props.colors.textMuted}>… {lines().length - 20} earlier lines</text>
      </Show>
      <Index each={lines().slice(-20)}>
        {(line) => (
          <text fg={props.colors.text} wrapMode="none">
            {line()}
          </text>
        )}
      </Index>
    </box>
  )
}
