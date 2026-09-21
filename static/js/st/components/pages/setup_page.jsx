// The setup screen: choose the staff, key, exercise and tempo of the
// programme, then begin reading in the trainer. The choices are stored where
// the trainer reads them at mount (see storeCurrentDrill in st/generators)

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"

import {STAVES, GENERATORS} from "st/data"
import {noteName} from "st/music"
import {setTitle} from "st/globals"
import {markOnboarded} from "st/onboarding"
import {
  generatorDefaultSettings, storeCurrentDrill, storeGeneratorSettings,
  currentStaffFor, currentGeneratorFor, currentKeySignature, currentDrillMode,
  currentScrollSpeed, allKeySignatures, DRILL_MODES, SCROLL_SPEED_RANGE,
} from "st/generators"
import {GeneratorSettings} from "st/components/sight_reading/settings_panel"
import {Plate, Pill, PullQuote, SectionLabel, TitleBlock, DoubleRule} from "st/components/salon"

import styles from "./setup_page.module.css"
import inputStyles from "./setup_generator_inputs.module.css"

// [plain, italic] title and short qualifier of each exercise, by mode and name
const EXERCISES = {
  "notes:random": {title: ["Random", "notes"], qualifier: "Steps & leaps"},
  "notes:triads": {title: ["Triad", "chords"], qualifier: "Chords"},
  "notes:sevens": {title: ["Open", "sevenths"], qualifier: "Spread chords"},
  "notes:progression": {title: ["Chord", "progressions"], qualifier: "Harmony"},
  "notes:position": {title: ["Five-finger", "positions"], qualifier: "Scalar"},
  "notes:intervals": {title: ["Melodic", "intervals"], qualifier: "Intervals"},
  "chords:random": {title: ["Random", "chords"], qualifier: "Chord names"},
  "chords:multi-key": {title: ["Chords in", "many keys"], qualifier: "Changing keys"},
}

const capitalize = str => str.charAt(0).toUpperCase() + str.slice(1)

// the exercises offered for a staff, as in the trainer's settings panel
export function exercisesFor(staff, generators=GENERATORS) {
  return generators.filter(g => !g.debug && g.mode == staff.mode)
}

// [plain, italic] parts of an exercise's title
export function exerciseTitle(generator) {
  let known = EXERCISES[`${generator.mode}:${generator.name}`]
  if (known) {
    return known.title
  }

  let words = capitalize(generator.name).split(" ")
  return [words.slice(0, -1).join(" "), words[words.length - 1]]
}

export function exerciseQualifier(generator) {
  let known = EXERCISES[`${generator.mode}:${generator.name}`]
  return known ? known.qualifier : generator.mode
}

// the key's name with accidental glyphs, eg. B♭
export function keyGlyph(key) {
  let name = key.name()
  if (key.isChromatic()) {
    return name
  }

  return name.charAt(0) + name.slice(1).replace("b", "♭").replace("#", "♯")
}

// what the summary plate shows for a programme
export function programmeSummary({staff, generator, settings, key, mode, speed}) {
  let [plain, italic] = exerciseTitle(generator)

  let place = key.isChromatic() ?
    `${capitalize(staff.name)} staff, chromatic` :
    `${capitalize(staff.name)} staff in ${keyGlyph(key)} major`

  let range

  if (generator.mode == "chords") {
    range = settings.notes ? `${settings.notes}-note chords` : "Chords"
  } else if (settings.noteRange) {
    range = settings.noteRange.map(noteName).join(" – ")
  } else {
    range = staff.range.join(" – ")
  }

  return {
    title: [plain, italic],
    subtitle: place,
    range,
    tempo: `${capitalize(mode)} · speed ${speed}`,
    length: "Until you stop",
  }
}

export function TempoSlider({value, min, max, onChange}) {
  let percent = (value - min) / (max - min) * 100

  return <div className={styles.tempo_slider}>
    <div className={styles.track}>
      <div className={styles.fill} style={{width: `${percent}%`}} />
      <input
        type="range"
        className={styles.range_input}
        aria-label="Speed"
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(Math.round(+e.target.value))} />
      <div className={styles.knob} style={{left: `${percent}%`}} aria-hidden="true" />
    </div>
    <div className={styles.legend} aria-hidden="true">
      <span>Largo</span>
      <span>Andante</span>
      <span>Presto</span>
    </div>
  </div>
}

TempoSlider.propTypes = {
  value: types.number.isRequired,
  min: types.number.isRequired,
  max: types.number.isRequired,
  onChange: types.func.isRequired,
}

export default function SetupPage({staves=STAVES, generators=GENERATORS}) {
  let [staff, setStaff] = React.useState(() => currentStaffFor(staves))
  let [generator, setGenerator] = React.useState(() => currentGeneratorFor(generators, staff.mode))
  // only generators with a storageKey carry their settings to the trainer
  let [settings, setSettings] = React.useState({})
  let [key, setKey] = React.useState(() => currentKeySignature())
  let [mode, setMode] = React.useState(() => currentDrillMode())
  let [speed, setSpeed] = React.useState(() => currentScrollSpeed())

  React.useEffect(() => {
    setTitle("Set the programme")
  }, [])

  let fullSettings = {...generatorDefaultSettings(generator, staff), ...settings}

  let chooseStaff = newStaff => {
    if (newStaff == staff) { return }
    setStaff(newStaff)
    storeCurrentDrill({staff: newStaff.name})

    if (newStaff.mode != generator.mode) {
      setGenerator(currentGeneratorFor(generators, newStaff.mode))
      setSettings({})
    }
  }

  let chooseGenerator = newGenerator => {
    if (newGenerator == generator) { return }
    setGenerator(newGenerator)
    setSettings({})
    storeCurrentDrill({generator: newGenerator.name})
  }

  let chooseKey = newKey => {
    setKey(newKey)
    storeCurrentDrill({key: newKey.name()})
  }

  let chooseMode = newMode => {
    setMode(newMode)
    storeCurrentDrill({mode: newMode})
  }

  let chooseSpeed = newSpeed => {
    setSpeed(newSpeed)
    storeCurrentDrill({speed: newSpeed})
  }

  // stores the whole programme before the link opens the trainer
  let begin = () => {
    storeCurrentDrill({
      staff: staff.name,
      generator: generator.name,
      key: key.name(),
      mode,
      speed,
    })

    if (generator.storageKey) {
      storeGeneratorSettings(generator.storageKey, fullSettings)
    }

    markOnboarded()
  }

  let summary = programmeSummary({staff, generator, settings: fullSettings, key, mode, speed})
  let [minSpeed, maxSpeed] = SCROLL_SPEED_RANGE

  return <main className={styles.setup_page}>
    <TitleBlock eyebrow="Before you begin" title="Set this evening's" italic="programme" />

    <div className={styles.setup_body}>
      <section className={styles.choice_panel}>
        <div className={styles.choice_group}>
          <SectionLabel rule={false} className={styles.group_label}>Clef</SectionLabel>
          <div className={styles.pills}>
            {staves.map(s =>
              <Pill
                key={s.name}
                variant="choice"
                selected={s == staff}
                onClick={() => chooseStaff(s)}>{capitalize(s.name)}</Pill>
            )}
          </div>
        </div>

        <div className={styles.choice_group}>
          <SectionLabel rule={false} className={styles.group_label}>Key signature</SectionLabel>
          <div className={styles.pills}>
            {allKeySignatures().map(k =>
              <Pill
                key={k.name()}
                variant="choice"
                className={styles.key_pill}
                selected={k.name() == key.name()}
                aria-label={k.isChromatic() ? "Chromatic" : `${keyGlyph(k)} major`}
                onClick={() => chooseKey(k)}>{keyGlyph(k)}</Pill>
            )}
          </div>
        </div>

        <div className={styles.choice_group}>
          <SectionLabel rule={false} className={classNames(styles.group_label, styles.exercise_label)}>Exercise</SectionLabel>
          <div className={styles.exercise_list}>
            {exercisesFor(staff, generators).map(g => {
              let selected = g == generator
              let title = exerciseTitle(g).filter(part => part).join(" ")

              return <div key={`${g.mode}:${g.name}`} className={classNames(styles.exercise, {[styles.selected]: selected})}>
                <button
                  type="button"
                  className={styles.exercise_row}
                  aria-pressed={selected}
                  onClick={() => chooseGenerator(g)}>
                  <span className={styles.exercise_title}>{title}</span>
                  {selected ?
                    <span className={styles.exercise_mark} aria-hidden="true">❖</span> :
                    <span className={styles.exercise_qualifier}>{exerciseQualifier(g)}</span>}
                </button>
                {selected && g.storageKey && g.inputs && g.inputs.length ?
                  <div className={styles.exercise_inputs}>
                    <GeneratorSettings
                      key={`${g.name}-${g.mode}`}
                      generator={g}
                      currentKey={key}
                      currentStaff={staff}
                      currentSettings={settings}
                      staves={staves}
                      classes={inputStyles}
                      setStaff={chooseStaff}
                      setGenerator={(_, newSettings) => setSettings(newSettings)} />
                  </div> : null}
              </div>
            })}
          </div>
        </div>

        <div className={styles.choice_group}>
          <div className={styles.tempo_header}>
            <SectionLabel rule={false}>Tempo</SectionLabel>
            <span className={styles.tempo_value}>Speed {speed}</span>
          </div>
          <div className={classNames(styles.pills, styles.mode_pills)}>
            {DRILL_MODES.map(m =>
              <Pill
                key={m}
                variant="choice"
                selected={m == mode}
                onClick={() => chooseMode(m)}>{capitalize(m)}</Pill>
            )}
          </div>
          <TempoSlider value={speed} min={minSpeed} max={maxSpeed} onChange={chooseSpeed} />
        </div>
      </section>

      <aside className={styles.programme_column}>
        <Plate compact className={styles.programme_plate}>
          <div className={styles.programme_label}>Your programme</div>
          <DoubleRule />
          <div className={styles.programme_heading}>
            <div className={styles.programme_title}>
              {summary.title[0]}{summary.title[0] ? " " : null}<span className={styles.italic}>{summary.title[1]}</span>
            </div>
            <div className={styles.programme_subtitle}>{summary.subtitle}</div>
          </div>
          <dl className={styles.programme_rows}>
            <div><dt>Range</dt><dd>{summary.range}</dd></div>
            <div><dt>Tempo</dt><dd>{summary.tempo}</dd></div>
            <div><dt>Length</dt><dd>{summary.length}</dd></div>
          </dl>
          <Pill variant="primary" to="/" className={styles.begin} onClick={begin}>Begin reading</Pill>
        </Plate>

        <PullQuote>Choose a programme you can hold at ninety per cent. Difficulty is not the same as progress.</PullQuote>
      </aside>
    </div>
  </main>
}

SetupPage.propTypes = {
  staves: types.array,
  generators: types.array,
}
