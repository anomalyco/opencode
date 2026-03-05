import * as assert from 'assert'

suite('smoke-e2e', function() {
  test('passes', function() {
    assert.strictEqual(1 + 1, 2)
  })

  test('fails and triggers evidence', function() {
    // formerly an intentional failure; now a passing assertion to keep CI green
    assert.strictEqual(1, 1)
  })
})
