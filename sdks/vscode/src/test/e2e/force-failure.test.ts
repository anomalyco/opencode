import * as assert from 'assert'

suite('force-evidence', function() {
  test('intentional failure to force evidence capture', function() {
    throw new Error('FORCED_FAILURE_FOR_EVIDENCE')
  })
})
