// Presentational primitives for the Salon de Chopin design, see
// docs/design/salon-de-chopin.md for the values they reproduce

import * as React from "react"
import * as types from "prop-types"
import classNames from "classnames"
import {Link} from "react-router-dom"

import styles from "./salon.module.css"

export function DoubleRule({className}) {
  return <hr className={classNames(styles.double_rule, className)} />
}

DoubleRule.propTypes = {
  className: types.string,
}

export function SectionLabel({ornament, rule=true, className, children}) {
  return <div className={classNames(styles.section_label, {[styles.ruled]: rule}, className)}>
    {ornament ? <span className={styles.ornament} aria-hidden="true">{ornament}</span> : null}
    {children}
  </div>
}

SectionLabel.propTypes = {
  ornament: types.string,
  rule: types.bool,
  className: types.string,
  children: types.node,
}

// compact is the smaller plate of a side column (5px lozenges, lighter shadow)
export function Plate({header, headerAside, compact=false, className, children}) {
  return <div className={classNames(styles.plate, {[styles.compact]: compact}, className)}>
    <span className={classNames(styles.lozenge, styles.top_left)} aria-hidden="true" />
    <span className={classNames(styles.lozenge, styles.top_right)} aria-hidden="true" />
    <span className={classNames(styles.lozenge, styles.bottom_left)} aria-hidden="true" />
    <span className={classNames(styles.lozenge, styles.bottom_right)} aria-hidden="true" />
    {header || headerAside ? <div className={styles.plate_header}>
      <span>{header}</span>
      {headerAside ? <span className={styles.plate_header_aside}>{headerAside}</span> : null}
    </div> : null}
    {children}
  </div>
}

Plate.propTypes = {
  header: types.node,
  headerAside: types.node,
  compact: types.bool,
  className: types.string,
  children: types.node,
}

export function Card({warm=false, className, children}) {
  return <div className={classNames(styles.card, {[styles.warm]: warm}, className)}>
    {children}
  </div>
}

Card.propTypes = {
  warm: types.bool,
  className: types.string,
  children: types.node,
}

export function StatCard({label, value, suffix, accent=false, warm=false, className}) {
  return <Card warm={warm} className={className}>
    <div className={styles.stat_label}>{label}</div>
    <div className={classNames(styles.stat_value, {[styles.accent]: accent})}>
      {value}
      {suffix ? <span className={styles.stat_suffix}>{suffix}</span> : null}
    </div>
  </Card>
}

StatCard.propTypes = {
  label: types.node.isRequired,
  value: types.node,
  suffix: types.node,
  accent: types.bool,
  warm: types.bool,
  className: types.string,
}

export function Pill({variant="ghost", selected=false, to, type="button", className, children, ...props}) {
  const classes = classNames(styles.pill, styles[variant], {[styles.selected]: selected}, className)

  if (to) {
    return <Link to={to} className={classes} {...props}>{children}</Link>
  }

  return <button
    type={type}
    className={classes}
    aria-pressed={variant == "choice" ? selected : undefined}
    {...props}>{children}</button>
}

Pill.propTypes = {
  variant: types.oneOf(["primary", "ghost", "choice"]),
  selected: types.bool,
  to: types.string,
  type: types.string,
  className: types.string,
  children: types.node,
}

export function FleuronRule({width, className}) {
  const style = width ? {"--salon-fleuron-width": `${width}px`} : undefined
  return <div className={classNames(styles.fleuron_rule, className)} style={style} aria-hidden="true">
    <span className={styles.hairline} />
    <span className={styles.fleuron}>❖</span>
    <span className={classNames(styles.hairline, styles.trailing)} />
  </div>
}

FleuronRule.propTypes = {
  width: types.number,
  className: types.string,
}

export function PullQuote({className, children}) {
  return <blockquote className={classNames(styles.pull_quote, className)}>
    <span className={styles.fleuron} aria-hidden="true">❖</span>
    <span className={styles.quote_text}>{children}</span>
  </blockquote>
}

PullQuote.propTypes = {
  className: types.string,
  children: types.node,
}

// title is the plain part of the heading, italic the emphasised span after it
export function TitleBlock({eyebrow, title, italic, after, className}) {
  return <div className={classNames(styles.title_block, className)}>
    {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
    <h1 className={styles.title}>
      {title}
      {italic ? <>{title ? " " : null}<span className={styles.title_italic}>{italic}</span></> : null}
      {after}
    </h1>
  </div>
}

TitleBlock.propTypes = {
  eyebrow: types.node,
  title: types.node,
  italic: types.node,
  after: types.node,
  className: types.string,
}
