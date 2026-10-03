# fixture

## Checks
PASS bar lines: the pages' measures add up to the MusicXML's - 16 on pages 1-2, 16 in the MusicXML
PASS p1: noteheads matched a MusicXML note - 65/65 (100%, need 90%)
PASS p1: every mark has a reading - 11 marks
PASS p2: noteheads matched a MusicXML note - 65/65 (100%, need 90%)
PASS p2: every mark has a reading - 6 marks
PASS markup: at least one page has ink - ink on page(s) [1, 2]
PASS hand order of 1 and 5 - 1 left for review
PASS one fingering per note - 0 notes with two readings
PASS well-formed - 
PASS MusicXML 4.0 schema (same verdict as the source) - skipped: no xsd in the manifest
PASS diff: insertions only - 51 lines inserted
PASS notes unchanged - 130 notes before, 130 after
PASS every planned fingering on its note - 10/10
PASS no other fingering added - 11 fingerings, expected 11
PASS music21 parses - 11 fingerings, 16 measures

## Pages
| Page | Bars | Ink px | Marks | Heads matched |
|---|---|---|---|---|
| 1 | 1-8 | 7691 | 11 | 65/65 |
| 2 | 9-16 | 4467 | 6 | 65/65 |

## Per bar
| Bar | Hand | Notes <- finger |
|---|---|---|
| 2 | RH | G5 (b.0) <- 1 #4 · G5 (b.1) <- 2 #5 |
| 3 | LH | E3 (b.2) <- 3 #6 · C3 (b.0) <- 5 #7 |
| 5 | RH | G5 (b.0) <- 5 #8 · E5 (b.0) <- 3 #9 · C5 (b.0) <- 1 #10 |
| 6 | RH | E5 (b.0) <- 2 #12 · C5 (b.0) <- 4 #13 |
| 7 | RH | G5 (b.0) <- 2-3 #11 |
| 9 | LH | G3 (b.0) <- 1 #14 |

## Left for review
- #1 p2-01 '1': hand order: LH 1 on G3 with B3, D4 struck with it
- #2 p2-02 '3': no notehead of a staff the digit may belong to within 1.6 spaces across
- #3 p2-06 '4': tentative, marked 'try'

## Not fingerings
- #15 p2-03: UC (una corda)
- #16 p2-04: circle round a note
- #17 p2-05: rit.

11 placed, 3 skipped
