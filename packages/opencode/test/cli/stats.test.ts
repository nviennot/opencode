import { describe, expect, spyOn } from "bun:test"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { aggregateSessionStats, displayStats } from "@/cli/cmd/stats"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MessageID } from "@/session/schema"
import { Session } from "@/session/session"
import { provideTmpdirInstance, requireInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Session.node, SessionProjector.node, Database.node, CrossSpawnSpawner.node]), [
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
  ]),
)

const storedSession = (
  tokens: { input: number; output: number },
  options?: Parameters<Session.Interface["create"]>[0],
  updated?: number,
) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const database = yield* Database.Service
    const info = yield* Effect.acquireRelease(session.create(options), (info) =>
      session.remove(info.id).pipe(Effect.orDie),
    )
    yield* database.db
      .update(SessionTable)
      .set({
        tokens_input: tokens.input,
        tokens_output: tokens.output,
        tokens_reasoning: 1000,
        tokens_cache_read: 2000,
        tokens_cache_write: 3000,
        time_updated: updated,
      })
      .where(eq(SessionTable.id, info.id))
      .run()
      .pipe(Effect.orDie)
    return info
  })

describe("stats", () => {
  it.instance("counts user prompts without assistant turns or subagent prompts", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const info = yield* Effect.acquireRelease(session.create({}), (info) =>
        session.remove(info.id).pipe(Effect.orDie),
      )
      yield* Effect.forEach([2, 3], (turns) =>
        Effect.gen(function* () {
          const user = yield* session.updateMessage({
            id: MessageID.ascending(),
            sessionID: info.id,
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
          })
          yield* Effect.forEach(Array.from({ length: turns }), () =>
            session.updateMessage({
              id: MessageID.ascending(),
              sessionID: info.id,
              role: "assistant",
              parentID: user.id,
              time: { created: Date.now() },
              agent: "build",
              mode: "build",
              providerID: user.model.providerID,
              modelID: user.model.modelID,
              path: { cwd: info.directory, root: info.directory },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            }),
          )
        }),
      )

      const stats = yield* aggregateSessionStats()
      expect(stats.totalSessions).toBe(1)
      expect(stats.totalMessages).toBe(7)
      expect(stats.totalPrompts).toBe(2)

      const child = yield* session.create({ parentID: info.id })
      yield* session.updateMessage({
        id: MessageID.ascending(),
        sessionID: child.id,
        role: "user",
        time: { created: Date.now() },
        agent: "explore",
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
      })

      expect(yield* aggregateSessionStats()).toMatchObject({ totalSessions: 2, totalMessages: 8, totalPrompts: 2 })
    }),
  )

  it.instance("returns zero prompts and token usage with no sessions or an empty session", () =>
    Effect.gen(function* () {
      const tokenUsage = {
        input: {
          topLevel: { total: 0, average: 0, median: 0 },
          all: { total: 0, average: 0, median: 0 },
        },
        output: {
          topLevel: { total: 0, average: 0, median: 0 },
          all: { total: 0, average: 0, median: 0 },
        },
        cacheRead: {
          topLevel: { total: 0, average: 0, median: 0 },
          all: { total: 0, average: 0, median: 0 },
        },
        cacheWrite: {
          topLevel: { total: 0, average: 0, median: 0 },
          all: { total: 0, average: 0, median: 0 },
        },
      }
      expect(yield* aggregateSessionStats()).toMatchObject({
        totalSessions: 0,
        totalMessages: 0,
        totalPrompts: 0,
        tokenUsage,
      })

      const session = yield* Session.Service
      yield* Effect.acquireRelease(session.create({}), (info) => session.remove(info.id).pipe(Effect.orDie))

      expect(yield* aggregateSessionStats()).toMatchObject({
        totalSessions: 1,
        totalMessages: 0,
        totalPrompts: 0,
        tokenUsage,
      })
    }),
  )

  it.instance("summarizes input and output independently with odd/even medians and nested subagents", () =>
    Effect.gen(function* () {
      const root = yield* storedSession({ input: 40, output: 2 })
      yield* storedSession({ input: 10, output: 90 })
      const session = yield* Session.Service
      yield* Effect.acquireRelease(session.create({}), (info) => session.remove(info.id).pipe(Effect.orDie))

      expect((yield* aggregateSessionStats()).tokenUsage).toEqual({
        input: {
          topLevel: { total: 50, average: 50 / 3, median: 10 },
          all: { total: 50, average: 50 / 3, median: 10 },
        },
        output: {
          topLevel: { total: 2092, average: 2092 / 3, median: 1002 },
          all: { total: 2092, average: 2092 / 3, median: 1002 },
        },
        cacheRead: {
          topLevel: { total: 4000, average: 4000 / 3, median: 2000 },
          all: { total: 4000, average: 4000 / 3, median: 2000 },
        },
        cacheWrite: {
          topLevel: { total: 6000, average: 2000, median: 3000 },
          all: { total: 6000, average: 2000, median: 3000 },
        },
      })

      const child = yield* storedSession({ input: 21, output: 7 }, { parentID: root.id })
      yield* storedSession({ input: 14, output: 30 }, { parentID: child.id })
      yield* storedSession({ input: 5, output: 11 })

      expect((yield* aggregateSessionStats()).tokenUsage).toEqual({
        input: {
          topLevel: { total: 55, average: 55 / 4, median: 7.5 },
          all: { total: 90, average: 15, median: 12 },
        },
        output: {
          topLevel: { total: 3103, average: 3103 / 4, median: 1006.5 },
          all: { total: 5140, average: 5140 / 6, median: 1009 },
        },
        cacheRead: {
          topLevel: { total: 6000, average: 1500, median: 2000 },
          all: { total: 10000, average: 10000 / 6, median: 2000 },
        },
        cacheWrite: {
          topLevel: { total: 9000, average: 2250, median: 3000 },
          all: { total: 15000, average: 2500, median: 3000 },
        },
      })
    }),
  )

  it.instance("applies date and project filters to both token usage scopes", () =>
    Effect.gen(function* () {
      const instance = yield* requireInstance
      const root = yield* storedSession({ input: 10, output: 40 })
      yield* storedSession({ input: 30, output: 20 }, { parentID: root.id })
      yield* storedSession({ input: 1000, output: 2000 }, {}, Date.now() - 3 * 24 * 60 * 60 * 1000)
      const other = yield* provideTmpdirInstance(() => storedSession({ input: 500, output: 600 }), { git: true })
      expect(other.projectID).not.toBe(root.projectID)

      expect((yield* aggregateSessionStats(1)).tokenUsage.input.all.total).toBe(540)
      expect((yield* aggregateSessionStats(undefined, root.projectID)).tokenUsage.input.all.total).toBe(1040)
      const tokenUsage = {
        input: {
          topLevel: { total: 10, average: 10, median: 10 },
          all: { total: 40, average: 20, median: 20 },
        },
        output: {
          topLevel: { total: 1040, average: 1040, median: 1040 },
          all: { total: 2060, average: 1030, median: 1030 },
        },
        cacheRead: {
          topLevel: { total: 2000, average: 2000, median: 2000 },
          all: { total: 4000, average: 2000, median: 2000 },
        },
        cacheWrite: {
          topLevel: { total: 3000, average: 3000, median: 3000 },
          all: { total: 6000, average: 3000, median: 3000 },
        },
      }
      expect((yield* aggregateSessionStats(1, root.projectID)).tokenUsage).toEqual(tokenUsage)
      expect((yield* aggregateSessionStats(1, "", instance.project)).tokenUsage).toEqual(tokenUsage)
    }),
  )

  it.live("renders prompts, all token categories, and formatted input/output comparisons", () =>
    Effect.gen(function* () {
      const stats = yield* aggregateSessionStats()
      const log = spyOn(console, "log").mockImplementation(() => {})
      try {
        displayStats({
          ...stats,
          totalPrompts: 2,
          totalMessages: 7,
          totalTokens: { input: 1000, output: 2000, reasoning: 3000, cache: { read: 4000, write: 5000 } },
          tokenUsage: {
            input: {
              topLevel: { total: 1234, average: 12.4, median: 4.5 },
              all: { total: 2345, average: 23.6, median: 8.4 },
            },
            output: {
              topLevel: { total: 1234567, average: 34.5, median: 16.4 },
              all: { total: 2345678, average: 45.4, median: 32.5 },
            },
            cacheRead: {
              topLevel: { total: 3456, average: 56.4, median: 64.5 },
              all: { total: 4567, average: 67.5, median: 128.4 },
            },
            cacheWrite: {
              topLevel: { total: 3456789, average: 78.5, median: 256.4 },
              all: { total: 4567890, average: 89.4, median: 512.5 },
            },
          },
        })

        const output = log.mock.calls.map((args) => args.join(" ")).join("\n")
        expect(output).toMatch(/Prompts\s+2 /)
        expect(output).toMatch(/Messages\s+7 /)
        expect(output).toMatch(/Total Tokens\s+15\.0K /)
        expect(output).toMatch(/Output\s+5\.0K /)
        expect(output).toContain("INPUT & OUTPUT TOKENS")
        expect(output).toMatch(/Top-Level Only\s+Incl\. Subagents/)
        expect(output).toMatch(/Total Input Tokens\s+1\.2K\s+2\.3K /)
        expect(output).toMatch(/Total Output Tokens\s+1\.2M\s+2\.3M /)
        expect(output).toMatch(/Avg Input\/Session\s+12\s+24 /)
        expect(output).toMatch(/Avg Output\/Session\s+35\s+45 /)
        expect(output).toMatch(/Median Input\/Session\s+5\s+8 /)
        expect(output).toMatch(/Median Output\/Session\s+16\s+33 /)
        expect(output).toMatch(/Total Cache Read\s+3\.5K\s+4\.6K /)
        expect(output).toMatch(/Total Cache Write\s+3\.5M\s+4\.6M /)
        expect(output).toMatch(/Avg Cache Read\s+56\s+68 /)
        expect(output).toMatch(/Avg Cache Write\s+79\s+89 /)
        expect(output).toMatch(/Median Cache Read\s+65\s+128 /)
        expect(output).toMatch(/Median Cache Write\s+256\s+513 /)
        expect(output).toContain("Input is non-cached; cache is shown separately.")
        expect(output).toContain("Averages and medians are per session.")
        expect(output).toContain("Output includes reasoning.")
      } finally {
        log.mockRestore()
      }
    }),
  )
})
