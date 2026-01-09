import z from "zod"

export const Stats = z.object({
  elapsed: z.object({
    secs: z.number(),
    nanos: z.number(),
    human: z.string(),
  }),
  searches: z.number(),
  searches_with_match: z.number(),
  bytes_searched: z.number(),
  bytes_printed: z.number(),
  matched_lines: z.number(),
  matches: z.number(),
})

export const Begin = z.object({
  type: z.literal("begin"),
  data: z.object({
    path: z.object({
      text: z.string(),
    }),
  }),
})

export const Match = z.object({
  type: z.literal("match"),
  data: z.object({
    path: z.object({
      text: z.string(),
    }),
    lines: z.object({
      text: z.string(),
    }),
    line_number: z.number(),
    absolute_offset: z.number(),
    submatches: z.array(
      z.object({
        match: z.object({
          text: z.string(),
        }),
        start: z.number(),
        end: z.number(),
      }),
    ),
  }),
})

export const End = z.object({
  type: z.literal("end"),
  data: z.object({
    path: z.object({
      text: z.string(),
    }),
    binary_offset: z.number().nullable(),
    stats: Stats,
  }),
})

export const Summary = z.object({
  type: z.literal("summary"),
  data: z.object({
    elapsed_total: z.object({
      human: z.string(),
      nanos: z.number(),
      secs: z.number(),
    }),
    stats: Stats,
  }),
})

export const Result = z.union([Begin, Match, End, Summary])

export type Result = z.infer<typeof Result>
export type Match = z.infer<typeof Match>
export type Begin = z.infer<typeof Begin>
export type End = z.infer<typeof End>
export type Summary = z.infer<typeof Summary>
