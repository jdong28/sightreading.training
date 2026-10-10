// The structured output Claude is asked for (SCHEMA_VERSION 1). Lengths, the
// budget and the note syntax are checked in code (bridge/verify.js), not
// here: a schema that is too strict makes the CLI retry instead of answer.

import {FLAG_KINDS} from "st/difficulty/decisions"

export const FLAG_HANDS = ["both", "right", "left"]
export const FLAG_LEVELS = ["hardest", "hard", "worth a look"]
export const CONFIDENCES = ["low", "medium", "high"]
export const ANALYSIS_VIEWS = ["agrees", "in part", "disagrees", "new"]
export const MAX_OUTPUT_FLAGS = 12

export function outputSchema() {
  return {
    type: "object", additionalProperties: false, required: ["work", "flags", "notes"],
    properties: {
      work: {type: "string"},
      notes: {type: "string"},
      flags: {type: "array", maxItems: MAX_OUTPUT_FLAGS, items: {
        type: "object", additionalProperties: false,
        required: [
          "start", "end", "hand", "level", "kinds", "title", "reason", "tip",
          "evidence", "citations", "confidence", "analysis", "analysis_note",
        ],
        properties: {
          start: {type: "integer"}, end: {type: "integer"},
          hand: {type: "string", enum: FLAG_HANDS},
          level: {type: "string", enum: FLAG_LEVELS},
          kinds: {type: "array", minItems: 1, maxItems: 4, items: {type: "string", enum: [...FLAG_KINDS]}},
          title: {type: "string"}, reason: {type: "string"}, tip: {type: "string"},
          evidence: {type: "array", minItems: 1, maxItems: 4, items: {
            type: "object", additionalProperties: false, required: ["bar", "hand", "notes", "what"],
            properties: {
              bar: {type: "integer"},
              hand: {type: "string", enum: ["right", "left"]},
              notes: {type: "array", minItems: 1, maxItems: 8, items: {type: "string"}},
              what: {type: "string"},
            },
          }},
          citations: {type: "array", maxItems: 3, items: {
            type: "object", additionalProperties: false, required: ["url", "title", "says", "quote", "source_bars"],
            properties: {
              url: {type: "string"}, title: {type: "string"}, says: {type: "string"},
              quote: {type: "string"}, source_bars: {type: "string"},
            },
          }},
          confidence: {type: "string", enum: CONFIDENCES},
          analysis: {type: "string", enum: ANALYSIS_VIEWS},
          analysis_note: {type: "string"},
        },
      }},
    },
  }
}
