/**
 * @license
 * Copyright © 2017-2018 Moov Corporation.  All rights reserved.
 */
import React, { Component } from 'react'
import PropTypes from 'prop-types'
import classnames from 'classnames'
import ExpansionPanel from '@material-ui/core/ExpansionPanel'
import ExpansionPanelDetails from '@material-ui/core/ExpansionPanelDetails'
import ExpansionPanelSummary from '@material-ui/core/ExpansionPanelSummary'
import ExpandMoreIcon from '@material-ui/icons/ExpandMore'
import Typography from '@material-ui/core/Typography'
import withStyles from '@material-ui/core/styles/withStyles'
import AmpExpandableSection from './amp/AmpExpandableSection'
import { inject } from 'mobx-react'
import withTheme from '@material-ui/core/styles/withTheme'
import { withAccordionContext } from './Accordion'

export const styles = theme => ({
  root: {
    boxShadow: 'none',
    borderBottom: `1px solid ${theme.palette.divider}`,
    background: 'transparent',

    '&::before': {
      display: 'none'
    },

    '& > *:first-child': {
      padding: '0',
      minHeight: '0'
    }
  },

  margins: {
    padding: `0 ${theme.margins.container}px`
  },

  caption: {
    transition: 'opacity .2s linear'
  },

  expandedCaption: {
    opacity: 0
  },

  largeTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#444'
  },

  details: {
    padding: 0
  },

  summary: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    '[aria-expanded=true] > &': {
      margin: '12px 0 !important'
    }
  },

  withCollapseIcon: {
    transform: 'translateY(-50%) rotate(0deg) !important'
  },

  summaryIconWrap: {
    right: `-${theme.margins.container}px`
  },

  expandedPanel: {
    margin: 0
  },

  expandIcon: {},
  collapseIcon: {}
})

@withStyles(styles, { name: 'RSFExpandableSection' })
@withTheme()
@inject(({ app }) => ({ amp: app.amp }))
class ExpandableSection extends Component {
  static propTypes = {
    /**
     * The title for the header of the expandable section
     */
    title: PropTypes.oneOfType([PropTypes.string, PropTypes.element]),

    /**
     * Text to display to the right of the heading
     */
    caption: PropTypes.oneOfType([PropTypes.string, PropTypes.element]),

    /**
     * The icon to use for collapsed groups
     */
    ExpandIcon: PropTypes.func,

    /**
     * The icon to use for expanded groups
     */
    CollapseIcon: PropTypes.func,

    /**
     * Set to false to remove the default left and right margins. Defaults to `true`.
     */
    margins: PropTypes.bool,

    /**
     * Controls the expanded state.  Defaults to false
     */
    expanded: PropTypes.bool,

    /**
     * Defaults the panel to being expanded, without controlling the state.  Defaults to false
     */
    defaultExpanded: PropTypes.bool,

    /**
     * Section ID used by Accordion, defaults to title prop
     */
    sectionId: PropTypes.string
  }

  static defaultProps = {
    margins: true
  }

  static getDerivedStateFromProps({ expanded, expandedSectionId, sectionId, title }) {
    if (typeof expanded !== 'undefined') {
      return { expanded }
    }
    if (expandedSectionId !== undefined) {
      const id = sectionId || title
      return { expanded: expandedSectionId === id }
    }
    // Do not update the component state from props
    return null
  }

  constructor({ expanded, defaultExpanded, ExpandIcon, CollapseIcon, theme }) {
    super()

    this.ExpandIcon = ExpandIcon || theme.ExpandIcon || ExpandMoreIcon
    this.CollapseIcon = CollapseIcon || theme.CollapseIcon || this.ExpandIcon

    this.state = {
      expanded: expanded || defaultExpanded
    }
  }

  render() {
    let {
      amp,
      classes,
      theme,
      children = [],
      title,
      caption,
      defaultExpanded,
      ExpandIcon: ei,
      CollapseIcon: ci,
      margins,
      sectionId,
      expandedSectionId,
      ...others
    } = this.props

    const { expanded } = this.state

    const { ExpandIcon, CollapseIcon } = this

    if (amp) {
      return (
        <AmpExpandableSection
          expandedSectionId={expandedSectionId}
          ExpandIcon={ExpandIcon}
          CollapseIcon={CollapseIcon}
          title={title}
        >
          {children}
        </AmpExpandableSection>
      )
    } else {
      return (
        <ExpansionPanel
          classes={{
            root: classnames({
              [classes.root]: true,
              [classes.margins]: margins,
              [classes.expandedPanel]: true
            })
          }}
          expanded={expanded}
          defaultExpanded={defaultExpanded}
          {...others}
          onChange={this.onChange}
        >
          <ExpansionPanelSummary
            expandIcon={
              this.state.expanded ? (
                <CollapseIcon className={classes.collapseIcon} />
              ) : (
                <ExpandIcon className={classes.expandIcon} />
              )
            }
            classes={this.getSummaryClasses()}
          >
            <Typography variant="subtitle1">{title}</Typography>
            {caption && (
              <Typography
                variant="caption"
                className={classnames({
                  [classes.caption]: true,
                  [classes.expandedCaption]: expanded
                })}
              >
                {caption}
              </Typography>
            )}
          </ExpansionPanelSummary>
          <ExpansionPanelDetails classes={{ root: classes.details }}>
            {children}
          </ExpansionPanelDetails>
        </ExpansionPanel>
      )
    }
  }

  /**
   * Gets the classes for the ExpansionPanelSummary
   * Here we add a class to remove the rotate transform if we're using a
   * separate icon for the collapse state.
   */
  getSummaryClasses() {
    const { classes } = this.props

    const result = {
      content: classes.summary,
      expandIcon: classes.summaryIconWrap
    }

    if (this.CollapseIcon !== this.ExpandIcon) {
      result.expandIcon = classes.withCollapseIcon
    }

    return result
  }

  onChange = (e, expanded) => {
    const { setExpandedSectionId, onChange, sectionId, title } = this.props
    if (onChange) {
      onChange(e, expanded)
    }
    if (setExpandedSectionId) {
      setExpandedSectionId(expanded ? sectionId || title : null)
    } else {
      this.setState({ expanded })
    }
  }
}

export default withAccordionContext(ExpandableSection)
