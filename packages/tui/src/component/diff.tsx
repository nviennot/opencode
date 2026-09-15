import type { BoxRenderable, DiffRenderableOptions, RGBA } from "@opentui/core"
import { createMemo, For, Show, splitProps } from "solid-js"

export function DiffView(
  props: DiffRenderableOptions & {
    ref?: (element: BoxRenderable) => void
    separatorColor: string | RGBA
  },
) {
  const [local, options] = splitProps(props, ["diff", "ref", "separatorColor"])
  const hunks = createMemo(() => {
    const diff = local.diff ?? ""
    const headers = Array.from(diff.matchAll(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/gm))
    if (headers.length < 2) return [diff]
    // Each renderer needs the file header and original hunk coordinates to preserve line numbers.
    const header = diff.slice(0, headers[0].index)
    return headers.map((match, index) => header + diff.slice(match.index, headers[index + 1]?.index))
  })

  return (
    <box ref={local.ref} width="100%" flexShrink={0}>
      <For each={hunks()}>
        {(hunk, index) => (
          <>
            <Show when={index() > 0}>
              <box height={1} flexShrink={0} border={["top"]} borderColor={local.separatorColor} />
            </Show>
            <diff {...options} diff={hunk} />
          </>
        )}
      </For>
    </box>
  )
}
