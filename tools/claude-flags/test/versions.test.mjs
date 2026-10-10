// An edit to the prompt or the schema is a new version (G9 of the plan): a
// file's `promptVersion` must always name the words that made it.

import {describe, it, before, after} from "node:test"
import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {readFileSync} from "node:fs"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"

import {openBridge} from "../lib/bridge.mjs"
import {PROMPT_SHA256, SCHEMA_SHA256, PROMPT_VERSION, SCHEMA_VERSION, COMPACT_VERSION, MODEL} from "../lib/versions.mjs"

const sha256 = text => createHash("sha256").update(text).digest("hex")
const PROMPT = join(dirname(fileURLToPath(import.meta.url)), "..", "prompt", "flags-v1.md")

describe("versions", () => {
  let bridge
  before(async () => { bridge = await openBridge() })
  after(async () => { await bridge.close() })

  it("G9: the prompt and the schema are the ones their versions name", async () => {
    assert.equal(sha256(readFileSync(PROMPT, "utf8")), PROMPT_SHA256,
      "prompt/flags-v1.md changed: bump PROMPT_VERSION (and name a new file) and update PROMPT_SHA256")
    assert.equal(sha256(JSON.stringify(await bridge.schema())), SCHEMA_SHA256,
      "the output schema changed: bump SCHEMA_VERSION and update SCHEMA_SHA256")
  })

  it("starts at version 1 on Opus 5.5", () => {
    assert.deepEqual([PROMPT_VERSION, SCHEMA_VERSION, COMPACT_VERSION], [1, 1, 1])
    assert.equal(MODEL, "claude-opus-5-5")
  })
})
