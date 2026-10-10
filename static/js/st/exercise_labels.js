// How a staff and an exercise generator are named on the pages that list
// them (the programme drawer, the evening list, Today's sessions). A module
// of their own so a page can name them without importing the drawer, whose
// own imports reach back to the app and so to every page

export function generatorLabel(generator) {
  return generator.label || generator.name
}

export function staffLabel(staff) {
  return staff.name.charAt(0).toUpperCase() + staff.name.slice(1)
}
