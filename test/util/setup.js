const { Test } = require('tape');
const mockStdIo = require('mock-stdio');

const noop = () => {};

Test.prototype.shouldReject = function(promise, expected) {
  return promise.then(
    () => this.throws(noop, expected),
    err => {
      const f = () => {
        throw err;
      };
      this.throws(f, expected);
    }
  );
};

Test.prototype.shouldBailOut = function(promise, expected, expectedStdErr) {
  mockStdIo.start();
  return promise.then(
    () => this.throws(noop, expected),
    err => {
      const { stderr } = mockStdIo.end();
      const f = () => {
        throw err;
      };
      this.throws(f, expected);
      const result = expectedStdErr.test(stderr);
      this.ok(result);
      if (!result) {
        console.error(err); // eslint-disable-line no-console
      }
    }
  );
};
