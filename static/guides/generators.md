# Note Generators

In order to provide unique sheet music to read, Sight Reading Trainer uses a random music generator. You can customize the generator to control the difficulty, and the types of things you want to practice.

Access the generator settings by clicking **Programme** at the top of the Staff page, which opens the programme drawer.

## Choosing a staff

The staff you choose configures the range of notes that are available to be read. The on-screen keyboard will display only the valid notes that can be played. Any notes generated will fall within the range of the staff chosen.

You can choose from the following:

* <img src="/static/svg/clefs.G.svg" alt="G Cleff" width=25 height=25 /> Treble
* <img src="/static/svg/clefs.F_change.svg" alt="F Cleff" width=25 height=20 /> Bass
* Grand — A combination of treble and bass at the same time

## Choosing a generator type

Sight Reading Trainer tries to generate something musical based on the parameters you've provided. The **generator type** is the function that picks which notes to show next. Each generator type can be customized using a series of parameters.

The available generator types:

*   **Random** — Chooses 1 to 5 random notes within the chosen key to be played in each column
*   **Triads** — Chooses a [triad](https://en.wikipedia.org/wiki/Triad_(music)) of notes in a random inversion in close voicing within the key signature
*   **Sevens** — Chooses a random [seventh chord](https://en.wikipedia.org/wiki/Seventh_chord) with open voicing (this one sounds the most pleasant)
*   **Progression** — Chooses a random chord from a popular progression within the key signature
*   **Position** — Generates notes in a way that encourages you to use all of your fingers. See below for more information

To read a real piece instead, use the **[Sheet music](/sheet-music)** page, described below.

## The smoothness parameter

Every generator has a **smoothness** setting. The smoothness setting makes the randomness less apparent by minimizing the movements of notes for each column of the generated notes. (It is never possible to get the sames notes repeated though).

If there are multiple notes, then it will minimize the average position of the notes in the column.

The higher you set the smoothnesss, the more iterations the generator will perform to find a next set of notes, the smoother the movements will be.

## The Random generator

The following parameters are available for the **Random** generator:

*   **Notes** — How many notes to generate at a time
*   **Hands** — How many hands should be used to play all the notes. For example, if you wanted to practice playing 5 chord notes in one hand, set notes to 5 and hands to 1
*   **Chord based** — The column of notes will be limited to notes that can be formed from stacked thirds

### The Position Generator

The **Position Generator** is designed to have you utilize all of your fingers while sight reading. You'll be given notes in sets of 5, the first note will contain a fingering. All subsequent notes should be played without moving your hand, and with using each of your fingers.

### The Sheet Music Page

The **[Sheet music](/sheet-music)** page turns a section of a piece into flash cards for repeated sight reading and memorization. Its **Programme** drawer holds only what applies to a real score: the piece, its section, the hand, the cards and the tempo. The score supplies its own staves, clefs and key, so there is no clef, exercise or key setting there.

Use **Import MusicXML** to load a MusicXML file (`.musicxml` or `.xml`, or a compressed `.mxl`). A PDF is a picture of a score, not notes, so picking one adds nothing to the deck and answers with the three steps to convert it to MusicXML first. Imported pieces are kept in your browser as a deck, so next time you pick the piece from the list instead of importing it again; **Remove** deletes the picked piece from the deck. For a piece, choose:

*   **Start measure** and **end measure** — The section to drill, using the bar numbers printed on the score (a pickup measure is 0)
*   **Hand** — Both hands, the right hand (treble staff) or the left hand (bass staff)

A piece with both a treble and a bass staff is drawn on the grand staff, so neither hand is skipped, and a piece with one staff on that staff.

A piece is drawn in the score's key signature at the start measure. A score key without its own key signature on the trainer (more than 5 sharps or 6 flats) is drawn in C major. A piece imported before the trainer followed score keys shows "Re-import to follow the score key"; importing the same score again (same title, tracks and measure numbers) updates that piece in place and keeps its stats, while a different score with the same title is added as a new piece.

Alternatively, pick **Pasted song notation** and paste song notation in the play along format. Measures of pasted notation count from 1, and **Track** limits the section to one track of the song, or uses all tracks.

Notes that start on the same beat are shown together as one column, and the section loops once you reach its end. An imported piece is engraved from its own score, card by card while waiting and the whole section on one line while scrolling, but rhythm is never judged: play the right notes of a column to move on, whatever their length, and rests and ties are only drawn, never played. A card can be as many measures as the section has. Pasted song notation, a piece imported before the trainer kept each piece's score, and a piece whose score can't be engraved are drawn on the trainer's own staff as whole notes a column apart; import the file again to practise a piece from its engraved score. Notes outside the range of the chosen staff are skipped, and the programme drawer reports how many. Generated accompaniment from chord symbols is not included. The piece or song, section, hand or track, wait or scroll mode and speed are saved in your browser, so reloading the page returns to the same drill.
