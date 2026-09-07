import path from "path"
import { onMount } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import type { AgentPart, FilePart, TextPart } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "../context/helper"
import { useTuiPaths } from "../context/runtime"
import { appendText, readText, writeText } from "../util/persistence"

export type PromptInfo = {
  input: string
  mode?: "normal" | "shell"
  parts: (
    | Omit<FilePart, "id" | "messageID" | "sessionID">
    | Omit<AgentPart, "id" | "messageID" | "sessionID">
    | (Omit<TextPart, "id" | "messageID" | "sessionID"> & {
        source?: {
          text: {
            start: number
            end: number
            value: string
          }
        }
      })
  )[]
}

export const MAX_HISTORY_ENTRIES = 10000

/**
 * Rewriting the file costs O(history). Let it overshoot the cap by this much so
 * the history is compacted once per SLACK appends instead of being reserialized
 * on every append once it sits at the cap.
 */
export const HISTORY_TRIM_SLACK = 500

/**
 * Parse the history file, reporting whether it needs to be rewritten. Rewriting
 * is only warranted when the file is corrupt or has grown past the cap; the
 * steady state is append-only.
 */
export function readPromptHistory(text: string): { entries: PromptInfo[]; compact: boolean } {
  const entries: PromptInfo[] = []
  let corrupt = false
  for (const line of text.split("\n")) {
    if (!line) continue
    try {
      entries.push(JSON.parse(line) as PromptInfo)
    } catch {
      corrupt = true
    }
  }
  return {
    entries: entries.slice(-MAX_HISTORY_ENTRIES),
    compact: corrupt || entries.length > MAX_HISTORY_ENTRIES,
  }
}

export function parsePromptHistory(text: string) {
  return readPromptHistory(text).entries
}

export function isDuplicateEntry(previous: PromptInfo | undefined, next: PromptInfo): boolean {
  if (!previous) return false
  return JSON.stringify(previous) === JSON.stringify(next)
}

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext({
  name: "PromptHistory",
  init: () => {
    const paths = useTuiPaths()
    const historyPath = path.join(paths.state, "prompt-history.jsonl")
    onMount(async () => {
      const { entries, compact } = readPromptHistory(await readText(historyPath).catch(() => ""))
      setStore("history", entries)

      // Only rewrite when the file is corrupt or over the cap. Reserializing an
      // intact history on every startup is pure waste once it holds thousands
      // of entries.
      if (compact && entries.length > 0)
        writeText(historyPath, entries.map((line) => JSON.stringify(line)).join("\n") + "\n").catch(() => {})
    })

    const [store, setStore] = createStore({
      index: 0,
      history: [] as PromptInfo[],
    })

    return {
      list() {
        return store.history
      },
      move(direction: 1 | -1, input: string) {
        if (!store.history.length) return undefined
        const current = store.history.at(store.index)
        if (!current) return undefined
        if (current.input !== input && input.length) return
        setStore(
          produce((draft) => {
            const next = store.index + direction
            if (Math.abs(next) > store.history.length) return
            if (next > 0) return
            draft.index = next
          }),
        )
        if (store.index === 0) return { input: "", parts: [] }
        return store.history.at(store.index)
      },
      append(item: PromptInfo) {
        const entry = structuredClone(unwrap(item))
        if (isDuplicateEntry(store.history.at(-1), entry)) {
          setStore("index", 0)
          return
        }
        let trimmed = false
        setStore(
          produce((draft) => {
            draft.history.push(entry)
            if (draft.history.length > MAX_HISTORY_ENTRIES + HISTORY_TRIM_SLACK) {
              draft.history = draft.history.slice(-MAX_HISTORY_ENTRIES)
              trimmed = true
            }
            draft.index = 0
          }),
        )

        if (trimmed) {
          writeText(historyPath, store.history.map((line) => JSON.stringify(line)).join("\n") + "\n").catch(() => {})
          return
        }
        appendText(historyPath, JSON.stringify(entry) + "\n").catch(() => {})
      },
    }
  },
})
