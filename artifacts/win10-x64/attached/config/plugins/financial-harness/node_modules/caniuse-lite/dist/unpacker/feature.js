'use strict'

const statuses = require('../lib/statuses')
const supported = require('../lib/supported')
const browsers = require('./browsers').browsers
const versions = require('./browserVersions').browserVersions

const MATH2LOG = Math.log(2)

function unpackSupport(cipher) {
  // bit flags
  let stats = Object.keys(supported).reduce((list, support) => {
    if (cipher & supported[support]) list.push(support)
    return list
  }, [])

  // notes
  let notes = cipher >> 7
  let notesArray = []
  while (notes) {
    let note = Math.floor(Math.log(notes) / MATH2LOG) + 1
    notesArray.unshift(`#${note}`)
    notes -= Math.pow(2, note - 1)
  }

  return stats.concat(notesArray).join(' ')
}

function unpackFeature(packed) {
  let unpacked = {
    status: statuses[packed.B],
    title: packed.C,
    shown: packed.D
  }
  unpacked.stats = Object.keys(packed.A).reduce((browserStats, key) => {
    let browser = packed.A[key]
    browserStats[browsers[key]] = Object.keys(browser).reduce(
      (stats, support) => {
        let packedVersions = browser[support].split(' ')
        let unpacked2 = unpackSupport(support)
        packedVersions.forEach(v => (stats[versions[v]] = unpacked2))
        return stats
      },
      {}
    )
    return browserStats
  }, {})
  return unpacked
}

module.exports = unpackFeature
module.exports.default = unpackFeature
