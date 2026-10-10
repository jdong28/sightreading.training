// What a run records about itself. Editing the prompt or the schema without
// bumping its version fails test/versions.test.mjs, so a file's
// `promptVersion` always names the words that made it.

export const MODEL = "claude-opus-5-5"
export const DEFAULT_EFFORT = "high"

export const PROMPT_VERSION = 1
export const SCHEMA_VERSION = 1
export const COMPACT_VERSION = 1

// sha256 of prompt/flags-v1.md and of JSON.stringify(schema())
export const PROMPT_SHA256 = "ddcee6f0e78f15af46c024b84b14a4e76b22f4623395cf0c899990dfb3db362e"
export const SCHEMA_SHA256 = "220c2a3e7bef746a2567cac0943fc82db35a6aa6ba1724dd1605267e014d0400"
