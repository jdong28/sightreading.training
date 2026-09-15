import {SampleOutput, SampleOutputMetronome} from "st/sample_output"
import {parseNote} from "st/music"

// an output with a stand in for the loaded soundfont, recording the note
// names it's asked to play
let outputWith = (type, played) => {
  let output = Object.create(type.prototype)
  output.currentlyPlaying = {}
  output.instrument = {
    play: note => {
      played.push(note)
      return {stop: () => {}}
    }
  }
  return output
}

describe("sample output", function() {
  it("plays each pitch at its own note name", function() {
    let played = []
    let output = outputWith(SampleOutput, played)

    output.noteOn(60, 100)
    output.noteOn(21, 100)
    output.noteOn(108, 100)

    expect(played).toEqual(["C4", "A0", "C8"])
    expect(played.map(parseNote)).toEqual([60, 21, 108])
  })

  it("clicks the metronome on G4 and C4", function() {
    let played = []
    let metronome = outputWith(SampleOutputMetronome, played)

    metronome.tick()
    metronome.tock()

    expect(played).toEqual(["G4", "C4"])
  })
})
