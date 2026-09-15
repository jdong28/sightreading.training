import {
  notesLessThan, notesGreaterThan, compareNotes, noteName, parseNote, notesSame,
  noteStaffOffset, shiftNoteOctave, MIDDLE_C_PITCH,
  MajorScale, MinorScale, HarmonicMinorScale, AscendingMelodicMinorScale, Chord, KeySignature, ChromaticScale, Staff
} from "st/music"

describe("music", function() {
  it("less than", function() {
    expect(notesLessThan("C4", "C#4")).toBe(true);
    expect(notesLessThan("B4", "D5")).toBe(true);
    expect(notesLessThan("B4", "B4")).toBe(false);
  });

  it("notesSame", function() {
    expect(notesSame("C4", "C5")).toBe(true);
    expect(notesSame("C4", "C4")).toBe(true);

    expect(notesSame("C4", "D4")).toBe(false);
    expect(notesSame("C#4", "C4")).toBe(false);
    expect(notesSame("Ab4", "A2")).toBe(false);

    expect(notesSame("Db4", "Db5")).toBe(true);
    expect(notesSame("G#4", "G#6")).toBe(true);

    // wrapping
    expect(notesSame("B#4", "C5")).toBe(true);
    expect(notesSame("B#4", "C6")).toBe(true);

    expect(notesSame("B2", "Cb4")).toBe(true);
    expect(notesSame("B4", "Cb2")).toBe(true);
  });

  it("greater than", function() {
    expect(notesGreaterThan("G4", "C#4")).toBe(true);
    expect(notesGreaterThan("G4", "Fb4")).toBe(true);
    expect(notesGreaterThan("E#4", "F4")).toBe(false);
  });

  it("compare", function() {
    expect(compareNotes("E#4", "F4")).toBe(0);
  });

  it("gets note names", function() {
    let pitches = [24,25,26,27,28,29,30,31,32,33,34,35,36]

    // sharpened
    expect(pitches.map((p) => noteName(p))).toEqual([
      "C1", "C#1", "D1", "D#1", "E1", "F1", "F#1", "G1", "G#1", "A1", "A#1", "B1", "C2"
    ])

    // flattened
    expect(pitches.map((p) => noteName(p, false))).toEqual([
      "C1", "Db1", "D1", "Eb1", "E1", "F1", "Gb1", "G1", "Ab1", "A1", "Bb1", "B1", "C2"
    ])

  })

  it("gets notes pitches", function() {
    let sharpNames = [
      "C1", "C#1", "D1", "D#1", "E1", "F1", "F#1", "G1", "G#1", "A1", "A#1", "B1", "C2"
    ]

    let flatNames = [
      "C1", "Db1", "D1", "Eb1", "E1", "F1", "Gb1", "G1", "Ab1", "A1", "Bb1", "B1", "C2"
    ]

    expect(sharpNames.map((n) => parseNote(n))).toEqual([
      24,25,26,27,28,29,30,31,32,33,34,35,36
    ])

    expect(flatNames.map((n) => parseNote(n))).toEqual([
      24,25,26,27,28,29,30,31,32,33,34,35,36
    ])

  })

  it("names middle C C4 like MusicXML and MIDI", function() {
    expect(MIDDLE_C_PITCH).toEqual(60)
    expect(noteName(60)).toEqual("C4")
    expect(noteName(59)).toEqual("B3")
    expect(noteName(72)).toEqual("C5")
    expect(noteName(69)).toEqual("A4")

    expect(parseNote("C4")).toEqual(60)
    expect(parseNote("B3")).toEqual(59)
    expect(parseNote("C5")).toEqual(72)
    expect(parseNote("A4")).toEqual(69)
  })

  it("keeps accidentals on the octave of their letter across B3 to C4", function() {
    // sharps and flats around the boundary
    expect(noteName(58)).toEqual("A#3")
    expect(noteName(58, false)).toEqual("Bb3")
    expect(noteName(61)).toEqual("C#4")
    expect(noteName(61, false)).toEqual("Db4")

    expect(parseNote("A#3")).toEqual(58)
    expect(parseNote("Bb3")).toEqual(58)
    expect(parseNote("C#4")).toEqual(61)
    expect(parseNote("Db4")).toEqual(61)

    // spellings whose letter is in the other octave than their pitch
    expect(parseNote("B#3")).toEqual(60)
    expect(parseNote("Cb4")).toEqual(59)
    expect(compareNotes("B#3", "C4")).toBe(0)
    expect(compareNotes("Cb4", "B3")).toBe(0)
    expect(new MajorScale("Gb").getRange(4)[3]).toEqual("Cb5")
    expect(new MajorScale("C#").getRange(3)[6]).toEqual("B#3")
  })

  it("round trips every piano key", function() {
    for (let pitch = 21; pitch <= 108; pitch++) {
      expect(parseNote(noteName(pitch))).toEqual(pitch)
      expect(parseNote(noteName(pitch, false))).toEqual(pitch)
    }

    expect(noteName(21)).toEqual("A0")
    expect(noteName(108)).toEqual("C8")
  })

  it("shifts a note name's octave keeping its spelling", function() {
    expect(shiftNoteOctave("C5", -1)).toEqual("C4")
    expect(shiftNoteOctave("Cb5", -1)).toEqual("Cb4")
    expect(shiftNoteOctave("F#6", -1)).toEqual("F#5")
    expect(shiftNoteOctave("B3", 1)).toEqual("B4")
    expect(parseNote(shiftNoteOctave("Cb5", -1))).toEqual(parseNote("Cb5") - 12)
    expect(() => shiftNoteOctave("H5", -1)).toThrow()
  })
});

describe("scales", function() {
  it("gets notes in chromatic scale", function() {
    let scale = new ChromaticScale("C")
    expect(scale.getRange(4)).toEqual([
      "C4", "C#4", "D4", "D#4", "E4", "F4", "F#4", "G4", "G#4", "A4", "A#4", "B4", "C5"
    ]);
  })

  it("gets notes in C MajorScale", function() {
    let scale = new MajorScale("C");
    expect(scale.getRange(4)).toEqual([
      "C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"
    ]);
  });

  it("gets notes in D MajorScale", function() {
    let scale = new MajorScale("D");
    expect(scale.getRange(4)).toEqual([
      "D4", "E4", "F#4", "G4", "A4", "B4", "C#5", "D5"
    ]);
  });

  it("gets notes in Gb MajorScale", function() {
    let scale = new MajorScale("Gb");
    // G♭, A♭, B♭, C♭, D♭, E♭, F
    expect(scale.getRange(4)).toEqual([
      "Gb4", "Ab4", "Bb4", "Cb5", "Db5", "Eb5", "F5", "Gb5"
    ]);
  });

  // regression: getRange() used to spell notes from the raw pitch alone, so
  // scale degrees that are enharmonically a "natural" note (eg. Cb == B,
  // E# == F, B# == C) came out under the wrong letter instead of the one
  // that keeps each letter name used exactly once in the scale.
  it("gets notes in C# MajorScale", function() {
    let scale = new MajorScale("C#");
    // C♯, D♯, E♯, F♯, G♯, A♯, B♯
    expect(scale.getRange(4)).toEqual([
      "C#4", "D#4", "E#4", "F#4", "G#4", "A#4", "B#4", "C#5"
    ]);
  });

  it("gets notes in F MajorScale", function() {
    let scale = new MajorScale("F");
    // TODO: should be Bb4
    expect(scale.getRange(4)).toEqual([
      "F4", "G4", "A4", "Bb4", "C5", "D5", "E5", "F5"
    ]);
  });

  it("gets notes in loose range for scale", function() {
    let scale = new MajorScale("G");
    let range = scale.getLooseRange("C4", "C5")
    expect(range).toEqual([
      "C4", "D4", "E4", "F#4", "G4", "A4", "B4", "C5"
    ]);
  });

  it("gets scale degrees for C major", function() {
    let scale = new MajorScale("C")
    let range = scale.getLooseRange("C4", "C5")

    expect(range.map(scale.getDegree.bind(scale))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 1
    ])
  })

  it("gets scale degrees for G major", function() {
    let scale = new MajorScale("G")
    let range = scale.getLooseRange("C4", "C5")

    expect(range.map(scale.getDegree.bind(scale))).toEqual([
      4, 5, 6, 7, 1, 2, 3, 4
    ])
  })

  it("converts degree to note name", function() {
    let scale = new MajorScale("G")
    expect(scale.degreeToName(1)).toEqual("G")
    expect(scale.degreeToName(2)).toEqual("A")
    expect(scale.degreeToName(3)).toEqual("B")
    expect(scale.degreeToName(4)).toEqual("C")
    expect(scale.degreeToName(5)).toEqual("D")
    expect(scale.degreeToName(6)).toEqual("E")
    expect(scale.degreeToName(7)).toEqual("F#")
    expect(scale.degreeToName(8)).toEqual("G")
    expect(scale.degreeToName(9)).toEqual("A")
  })

  it("gets notes in A MinorScale", function() {
    let scale = new MinorScale("A");
    expect(scale.getRange(4)).toEqual([
      "A4", "B4", "C5", "D5", "E5", "F5", "G5", "A5"
    ]);
  });

  it("gets notes in C MinorScale", function() {
    let scale = new MinorScale("C");
    expect(scale.getRange(4)).toEqual([
      "C4", "D4", "Eb4", "F4", "G4", "Ab4", "Bb4", "C5"
    ]);
  });

  it("gets notes in C HarmonicMinorScale", function() {
    let scale = new HarmonicMinorScale("C");
    // TODO: this should be giving flats not sharps
    expect(scale.getRange(4)).toEqual([
      "C4", "D4", "Eb4", "F4", "G4", "Ab4", "B4", "C5"
    ]);
  });

  describe("buildChordSteps", function() {
    it("builds triad steps for major scale", function() {
      let scale = new MajorScale("C")
      expect(scale.buildChordSteps(1, 2)).toEqual(Chord.SHAPES.M)
      expect(scale.buildChordSteps(2, 2)).toEqual(Chord.SHAPES.m)
      expect(scale.buildChordSteps(3, 2)).toEqual(Chord.SHAPES.m)
      expect(scale.buildChordSteps(4, 2)).toEqual(Chord.SHAPES.M)
      expect(scale.buildChordSteps(5, 2)).toEqual(Chord.SHAPES.M)
      expect(scale.buildChordSteps(6, 2)).toEqual(Chord.SHAPES.m)
    })

    it("builds seventh chord steps for major scale", function() {
      let scale = new MajorScale("C")
      expect(scale.buildChordSteps(1, 3)).toEqual(Chord.SHAPES.M7)
      expect(scale.buildChordSteps(2, 3)).toEqual(Chord.SHAPES.m7)
      expect(scale.buildChordSteps(3, 3)).toEqual(Chord.SHAPES.m7)
      expect(scale.buildChordSteps(4, 3)).toEqual(Chord.SHAPES.M7)
      expect(scale.buildChordSteps(5, 3)).toEqual(Chord.SHAPES["7"])
      expect(scale.buildChordSteps(6, 3)).toEqual(Chord.SHAPES.m7)
    })


    it("builds triads chord steps for minor scale", function() {
      let scale = new MinorScale("C")
      expect(scale.buildChordSteps(1, 2)).toEqual(Chord.SHAPES.m)
      expect(scale.buildChordSteps(3, 2)).toEqual(Chord.SHAPES.M)
      expect(scale.buildChordSteps(4, 2)).toEqual(Chord.SHAPES.m)
      expect(scale.buildChordSteps(5, 2)).toEqual(Chord.SHAPES.m)
      expect(scale.buildChordSteps(6, 2)).toEqual(Chord.SHAPES.M)
      expect(scale.buildChordSteps(7, 2)).toEqual(Chord.SHAPES.M)
    })
  })

  describe("allChords", function() {
    it("gets all triads in major scale", function() {
      let scale = new MajorScale("C")
      let chords = scale.allChords(3)

      expect(chords.map(chord => chord.toString())).toEqual([
        "C",
        "Dm",
        "Em",
        "F",
        "G",
        "Am",
        "Bdim",
      ])
    })

    it("gets all 7 chords in major scale", function() {
      let scale = new MajorScale("C")
      let chords = scale.allChords(4)

      expect(chords.map(chord => chord.toString())).toEqual([
        "CM7",
        "Dm7",
        "Em7",
        "FM7",
        "G7",
        "Am7",
        "Bm7b5",
      ])
    })

    it("gets all triads in harmonic minor scale", function() {
      let scale = new HarmonicMinorScale("C")
      let chords = scale.allChords(3)

      expect(chords.map(chord => chord.toString())).toEqual([
        "Cm",
        "Ddim",
        "Ebaug",
        "Fm",
        "G",
        "Ab",
        "Bdim",
      ])
    })

    it("gets all 7 chords in harmonic minor scale", function() {
      let scale = new HarmonicMinorScale("C")
      let chords = scale.allChords(4)

      expect(chords.map(chord => chord.toString())).toEqual([
        "CmM7",
        "Dm7b5",
        "EbaugM7",
        "Fm7",
        "G7",
        "AbM7",
        "Bdim7",
      ])
    })

    it("gets all 7 chords in ascending melodic minor scale", function() {
      let scale = new AscendingMelodicMinorScale("C")
      let chords = scale.allChords(4)

      expect(chords.map(chord => chord.toString())).toEqual([
        "CmM7",
        "Dm7",
        "EbaugM7",
        "F7",
        "G7",
        "Am7b5",
        "Bm7b5",
      ])
    })


  })
})

describe("chords", function() {
  it("gets notes for major chord", function() {
    expect(Chord.notes("C4", "M")).toEqual([
      "C4", "E4", "G4"
    ])

    expect(Chord.notes("C4", "M", 1)).toEqual([
      "E4", "G4", "C5"
    ])

    expect(Chord.notes("C4", "M", -1)).toEqual([
      "G3", "C4", "E4"
    ])

    expect(Chord.notes("C4", "M", -2)).toEqual([
      "E3", "G3", "C4"
    ])

    expect(Chord.notes("C4", "M", -3)).toEqual([
      "C3", "E3", "G3"
    ])

  })

  it("gets notes for minor chord", function() {
    expect(Chord.notes("C4", "m")).toEqual([
      "C4", "D#4", "G4"
    ])

    expect(Chord.notes("C4", "m", 1)).toEqual([
      "D#4", "G4", "C5"
    ])
  })

  it("gets notes for major 7 chord", function() {
    expect(Chord.notes("C4", "M7")).toEqual([
      "C4", "E4", "G4", "B4"
    ])

    expect(Chord.notes("C4", "M7", 1)).toEqual([
      "E4", "G4", "B4", "C5"
    ])

    expect(Chord.notes("C4", "M7", -1)).toEqual([
      "B3", "C4", "E4", "G4"
    ])

    expect(Chord.notes("C4", "M7", -2)).toEqual([
      "G3", "B3", "C4", "E4"
    ])

    expect(Chord.notes("C4", "M7", -3)).toEqual([
      "E3", "G3", "B3", "C4"
    ])

  })

  it("gets notes for dominant 7 chord", function() {
    expect(Chord.notes("C4", "7")).toEqual([
      "C4", "E4", "G4", "A#4"
    ])

    expect(Chord.notes("C4", "7", 1)).toEqual([
      "E4", "G4", "A#4", "C5"
    ])
  })

  it("gets notes for minor 7 chord", function() {
    expect(Chord.notes("C4", "m7")).toEqual([
      "C4", "D#4", "G4", "A#4"
    ])
  })

  it("gets notes for minor 7 flat 5 chord", function() {
    expect(Chord.notes("C4", "m7b5")).toEqual([
      "C4", "D#4", "F#4", "A#4"
    ])
  })

  describe("chordShapeName", function() {
    it("gets the chord name of a M7 chord", function() {
      let chord = new Chord("C", "M7");
      expect(chord.chordShapeName()).toBe("M7")
    })

    it("gets the chord name of a M chord", function() {
      let chord = new Chord("D", "M");
      expect(chord.chordShapeName()).toBe("M")
    })

    it("gets the chord name of a m chord", function() {
      let chord = new Chord("E", "m");
      expect(chord.chordShapeName()).toBe("m")
    })

    it("gets the chord name of a 7 chord", function() {
      let chord = new Chord("F", "7");
      expect(chord.chordShapeName()).toBe("7")
    })

    it("gets the chord name of a m7 chord", function() {
      let chord = new Chord("G", "m7");
      expect(chord.chordShapeName()).toBe("m7")
    })

    it("gets the chord name of a m7b5 chord", function() {
      let chord = new Chord("A", "m7b5");
      expect(chord.chordShapeName()).toBe("m7b5")
    })
  })

  describe("secondary dominant", function() {
    it("checks if chords are dominant", function() {
      expect(new Chord("A", "m7b5").isDominant()).toBe(false)
      expect(new Chord("F#", "7").isDominant()).toBe(true)
      expect(new Chord("G", "M").isDominant()).toBe(true)
      expect(new Chord("G", "m").isDominant()).toBe(false)
    })

    it("gets secondary dominant targets", function() {
      let targets = (root, steps, noteCount=3) =>
        new Chord(root, steps).getSecondaryDominantTargets(noteCount).map(c => c.toString())

      expect(targets("A", "M")).toEqual(["D", "Dm"])
      expect(targets("B", "M")).toEqual(["E", "Em"])
      expect(targets("C", "M")).toEqual(["F", "Fm"])
      expect(targets("D", "M")).toEqual(["G", "Gm"])
      expect(targets("E", "M")).toEqual(["A", "Am"])

      expect(targets("A", "7")).toEqual(["D", "Dm"])
      expect(targets("B", "7")).toEqual(["E", "Em"])
      expect(targets("C", "7")).toEqual(["F", "Fm"])
      expect(targets("D", "7")).toEqual(["G", "Gm"])
      expect(targets("E", "7")).toEqual(["A", "Am"])


      expect(targets("A", "7", 4)).toEqual(["DM7", "Dm7"])
      expect(targets("B", "7", 4)).toEqual(["EM7", "Em7"])
      expect(targets("C", "7", 4)).toEqual(["FM7", "Fm7"])
      expect(targets("D", "7", 4)).toEqual(["GM7", "Gm7"])
      expect(targets("E", "7", 4)).toEqual(["AM7", "Am7"])
    })
  })

  describe("containsNote", function() {
    it("checks notes in CM7", function () {
      let chord = new Chord("C", "M7");

      for (let octave of [3,4,5]) {
        expect(chord.containsNote(`C${octave}`)).toBe(true)
        expect(chord.containsNote(`E${octave}`)).toBe(true)
        expect(chord.containsNote(`G${octave}`)).toBe(true)
        expect(chord.containsNote(`B${octave}`)).toBe(true)

        expect(chord.containsNote(`D${octave}`)).toBe(false)
        expect(chord.containsNote(`F${octave}`)).toBe(false)
        expect(chord.containsNote(`A${octave}`)).toBe(false)
      }
    })

    it("checks notes in Cm", function () {
      let chord = new Chord("C", "m");

      for (let octave of [3,4,5]) {
        expect(chord.containsNote(`C${octave}`)).toBe(true)
        expect(chord.containsNote(`D#${octave}`)).toBe(true)
        expect(chord.containsNote(`Eb${octave}`)).toBe(true)
        expect(chord.containsNote(`G${octave}`)).toBe(true)

        expect(chord.containsNote(`B${octave}`)).toBe(false)
        expect(chord.containsNote(`D${octave}`)).toBe(false)
        expect(chord.containsNote(`F${octave}`)).toBe(false)
        expect(chord.containsNote(`A${octave}`)).toBe(false)
      }
    })

  })

  it("gets shared notes", function() {
    expect(
      new Chord("C", "M").countSharedNotes(new Chord("G", "M"))
    ).toEqual(1)

    expect(
      new Chord("C", "M").countSharedNotes(new Chord("E", "m"))
    ).toEqual(2)

    expect(
      new Chord("C", "M").countSharedNotes(new Chord("D", "m"))
    ).toEqual(0)

    expect(
      new Chord("C", "M").countSharedNotes(new Chord("C", [12, 4]))
    ).toEqual(2)
  })
})

describe("key signature", function() {
  let trebleCleff = ["A3", "C6"]
  let bassCleff = ["C2", "E4"]

  it("gets name for key signature", function() {

    expect(new KeySignature(0).name()).toBe("C")

    expect(new KeySignature(1).name()).toBe("G")
    expect(new KeySignature(2).name()).toBe("D")
    expect(new KeySignature(3).name()).toBe("A")
    expect(new KeySignature(4).name()).toBe("E")
    expect(new KeySignature(5).name()).toBe("B")

    expect(new KeySignature(-1).name()).toBe("F")
    expect(new KeySignature(-2).name()).toBe("Bb")
    expect(new KeySignature(-3).name()).toBe("Eb")
    expect(new KeySignature(-4).name()).toBe("Ab")
    expect(new KeySignature(-5).name()).toBe("Db")
    expect(new KeySignature(-6).name()).toBe("Gb")
  })

  it("gets key signature notes for C", function() {
    let key = new KeySignature(0)

    expect(key.isFlat()).toBe(false)
    expect(key.isSharp()).toBe(false)

    expect(key.accidentalNotes()).toEqual([])

    expect(key.notesInRange(...trebleCleff)).toEqual([])
  })

  it("gets key signature notes for D", function() {
    let key = new KeySignature(2)

    expect(key.isFlat()).toBe(false)
    expect(key.isSharp()).toBe(true)

    expect(key.accidentalNotes()).toEqual(["F", "C"])

    expect(key.notesInRange(...trebleCleff)).toEqual(["F4", "C5"])
    expect(key.notesInRange(...trebleCleff)).toEqual(["F4", "C5"])
  })

  it("gets key signature notes for Bb", function() {
    let key = new KeySignature(-2)
    expect(key.isFlat()).toBe(true)
    expect(key.isSharp()).toBe(false)

    expect(key.accidentalNotes()).toEqual(["B", "E"])

    expect(key.notesInRange(...trebleCleff)).toEqual(["B4", "E4"])
    expect(key.notesInRange(...trebleCleff)).toEqual(["B4", "E4"])
  })

  it("gets key signature notes for E", function() {
    let key = new KeySignature(4)
    expect(key.isFlat()).toBe(false)
    expect(key.isSharp()).toBe(true)

    expect(key.accidentalNotes()).toEqual(["F", "C", "G", "D"])

    expect(key.notesInRange(...trebleCleff)).toEqual(["F4", "C5", "G5", "D5"])
    expect(key.notesInRange(...trebleCleff)).toEqual(["F4", "C5", "G5", "D5"])
  })

  it("gets accidentals for notes in D", function() {
    let key = new KeySignature(2) // f c
    let examples = [
      ["C4", 0],
      ["C#4", null],
      ["Cb4", -1],

      ["D4", null],
      ["D#4", 1],
      ["Db4", -1],

      ["E4", null],
      ["E#4", 1],
      ["Eb4", -1],

      ["F4", 0],
      ["F#4", null],
      ["Fb4", -1],

      ["G4", null],
      ["G#4", 1],
      ["Gb4", -1],

      ["A4", null],
      ["A#4", 1],
      ["Ab4", -1],

      ["B4", null],
      ["B#4", 1],
      ["Bb4", -1],
    ]

    for (let [note, accidentals] of examples) {
      expect(key.accidentalsForNote(note)).toBe(accidentals)
    }
  })

  it("gets accidentals for notes in Eb", function() {
    let key = new KeySignature(-3) // b e a

    let examples = [
      ["C4", null],
      ["C#4", 1],
      ["Cb4", -1],

      ["D4", null],
      ["D#4", 1],
      ["Db4", -1],

      ["E4", 0],
      ["E#4", 1],
      ["Eb4", null],

      ["F4", null],
      ["F#4", 1],
      ["Fb4", -1],

      ["G4", null],
      ["G#4", 1],
      ["Gb4", -1],

      ["A4", 0],
      ["A#4", 1],
      ["Ab4", null],

      ["B4", 0],
      ["B#4", 1],
      ["Bb4", null],
    ]

    for (let [note, accidentals] of examples) {
      expect(key.accidentalsForNote(note)).toBe(accidentals)
    }
  })

  it("gets enharmonic spelling of notes for key", function() {
    let key = new KeySignature(-3) // b e a
    let notes = new MajorScale(key.name()).getRange(3).map((n) => key.enharmonic(n))

    expect(notes).toEqual([
      "Eb3", "F3", "G3", "Ab3", "Bb3", "C4", "D4", "Eb4"
    ])
  })
})


describe("noteStaffOffset", function() {
  it("gets offsets for notes", function() {
    let notes = [
      "A#2",
      "B#2",
      "C#3",

      "Ab2",
      "Bb2",
      "Cb3",

      "A2",
      "B2",
      "C3",
    ]

    expect(notes.map(noteStaffOffset)).toEqual([
      26,27,28,
      26,27,28,
      26,27,28,
    ])
  })
})


describe("staff", function() {
  it("gets all staves", function() {
    const staves = Staff.allStaves()

    expect(staves.map((s) => ({
      name: s.name,
      lower: s.lowerNote,
      upper: s.upperNote,
      clefNote: s.clefNote,
      clefName: s.clefName(),
    }))).toEqual([
      {
        name: "treble",
        lower: "E4",
        upper: "F5",
        clefNote: "G4",
        clefName: "G"
      },
      {
        name: "bass",
        lower: "G2",
        upper: "A3",
        clefNote: "F3",
        clefName: "F"
      }
    ])
  })

  it ("gets staff by name", function() {
    for (let name of ["bass", "treble"]) {
      expect(Staff.forName(name).name).toEqual(name)
    }

    console.log(Staff.cache)
  })
})

