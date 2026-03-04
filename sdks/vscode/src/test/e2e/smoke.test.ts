import * as assert from 'assert'

suite('smoke-e2e', function() {
  test('passes', function() {
    assert.strictEqual(1 + 1, 2)
  })

  test('fails and triggers evidence', function() {
    // intentional failure to exercise evidence capture hooks
    throw new Error('Intentional failure for evidence capture')
  })
})
